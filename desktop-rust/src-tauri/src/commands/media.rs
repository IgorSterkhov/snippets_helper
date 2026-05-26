use crate::db::{queries, DbState};
use futures_util::{stream, TryStreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex as StdMutex, OnceLock,
};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use tokio_util::io::ReaderStream;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Serialize)]
struct ProgressPayload {
    phase: &'static str,
    bytes_done: u64,
    bytes_total: u64,
    finished: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MediaUploadResponse {
    pub job_id: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaVariant {
    pub variant: String,
    pub public_token: String,
    pub preview_url: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub width: i64,
    pub height: i64,
    pub sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MediaJobResponse {
    pub job_id: String,
    pub status: String,
    pub progress_current: i64,
    pub progress_total: i64,
    pub asset_uuid: Option<String>,
    pub variants: Vec<MediaVariant>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MediaSelectResponse {
    pub asset_uuid: String,
    pub variant: String,
    pub markdown: String,
    pub url: String,
    pub width: i64,
    pub height: i64,
    pub size_bytes: i64,
}

#[derive(Debug, Serialize)]
struct SelectVariantRequest<'a> {
    variant: &'a str,
}

static UPLOAD_CANCELLATIONS: OnceLock<StdMutex<HashMap<String, CancellationToken>>> =
    OnceLock::new();

fn upload_cancellations() -> &'static StdMutex<HashMap<String, CancellationToken>> {
    UPLOAD_CANCELLATIONS.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn remove_upload_cancellation(upload_id: &str) {
    if let Ok(mut map) = upload_cancellations().lock() {
        map.remove(upload_id);
    }
}

fn register_upload_cancellation(
    upload_id: String,
    cancel_token: CancellationToken,
) -> Result<(), String> {
    let mut map = upload_cancellations()
        .lock()
        .map_err(|_| "upload cancellation lock poisoned".to_string())?;
    if let Some(existing) = map.insert(upload_id, cancel_token) {
        existing.cancel();
    }
    Ok(())
}

fn sync_settings(state: &State<'_, DbState>) -> Result<(String, String, Option<String>), String> {
    let computer_id = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let conn = state.lock_recover();
    let url = queries::get_setting(&conn, &computer_id, "sync_api_url")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "sync_api_url not configured".to_string())?;
    let key = queries::get_setting(&conn, &computer_id, "sync_api_key")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "sync_api_key not configured".to_string())?;
    let cert =
        queries::get_setting(&conn, &computer_id, "sync_ca_cert").map_err(|e| e.to_string())?;
    Ok((url.trim_end_matches('/').to_string(), key, cert))
}

fn http_client(api_url: &str, ca_cert: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(60));
    if let Some(path) = ca_cert {
        if std::path::Path::new(path).is_file() {
            let pem = std::fs::read(path).map_err(|e| format!("read CA cert: {e}"))?;
            let cert =
                reqwest::Certificate::from_pem(&pem).map_err(|e| format!("parse CA cert: {e}"))?;
            builder = builder.add_root_certificate(cert);
        } else if api_url.starts_with("https://") {
            builder = builder.danger_accept_invalid_certs(true);
        }
    } else if api_url.starts_with("https://") {
        builder = builder.danger_accept_invalid_certs(true);
    }
    builder
        .build()
        .map_err(|e| format!("build http client: {e}"))
}

async fn parse_json<T: for<'de> Deserialize<'de>>(resp: reqwest::Response) -> Result<T, String> {
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {body}"));
    }
    resp.json::<T>()
        .await
        .map_err(|e| format!("parse response: {e}"))
}

#[tauri::command]
pub async fn pick_media_file(app: AppHandle) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| format!("pick file task: {e}"))?;
    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn start_media_upload(
    app: AppHandle,
    state: State<'_, DbState>,
    file_path: String,
    upload_id: String,
) -> Result<MediaUploadResponse, String> {
    let path = std::path::PathBuf::from(&file_path);
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();
    let total = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("read file metadata: {e}"))?
        .len();
    let _ = app.emit(
        "media-upload-progress",
        ProgressPayload {
            phase: "upload",
            bytes_done: 0,
            bytes_total: total,
            finished: false,
        },
    );
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| format!("open file: {e}"))?;
    let cancel_token = CancellationToken::new();
    register_upload_cancellation(upload_id.clone(), cancel_token.clone())?;
    let sent = Arc::new(AtomicU64::new(0));
    let app_for_progress = app.clone();
    let cancel_for_stream = cancel_token.clone();
    let stream = ReaderStream::new(file).map_ok(move |chunk| {
        if cancel_for_stream.is_cancelled() {
            return chunk;
        }
        let done = sent.fetch_add(chunk.len() as u64, Ordering::Relaxed) + chunk.len() as u64;
        let _ = app_for_progress.emit(
            "media-upload-progress",
            ProgressPayload {
                phase: "upload",
                bytes_done: done.min(total),
                bytes_total: total,
                finished: done >= total,
            },
        );
        chunk
    });
    let body = reqwest::Body::wrap_stream(stream);
    let part = reqwest::multipart::Part::stream_with_length(body, total).file_name(file_name);
    let form = reqwest::multipart::Form::new().part("file", part);
    let send_future = client
        .post(format!("{api_url}/v1/media/uploads"))
        .bearer_auth(api_key)
        .multipart(form)
        .send();
    let resp = tokio::select! {
        _ = cancel_token.cancelled() => {
            remove_upload_cancellation(&upload_id);
            return Err("upload cancelled".to_string());
        }
        result = send_future => {
            remove_upload_cancellation(&upload_id);
            result.map_err(|e| format!("request failed: {e}"))?
        }
    };
    let parsed = parse_json(resp).await?;
    let _ = app.emit(
        "media-upload-progress",
        ProgressPayload {
            phase: "upload",
            bytes_done: total,
            bytes_total: total,
            finished: true,
        },
    );
    Ok(parsed)
}

#[tauri::command]
pub async fn start_media_clipboard_upload(
    app: AppHandle,
    state: State<'_, DbState>,
    upload_id: String,
) -> Result<MediaUploadResponse, String> {
    let png = tauri::async_runtime::spawn_blocking(read_clipboard_image_png)
        .await
        .map_err(|e| format!("clipboard task: {e}"))??;
    upload_memory_image(
        app,
        state,
        upload_id,
        "clipboard-screenshot.png".to_string(),
        png,
    )
    .await
}

fn read_clipboard_image_png() -> Result<Vec<u8>, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("open clipboard: {e}"))?;
    let image = clipboard
        .get_image()
        .map_err(|_| "clipboard does not contain an image".to_string())?;
    encode_rgba_png(image.width, image.height, image.bytes.into_owned())
}

fn encode_rgba_png(width: usize, height: usize, rgba: Vec<u8>) -> Result<Vec<u8>, String> {
    let expected = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "clipboard image is too large".to_string())?;
    if rgba.len() != expected {
        return Err(format!(
            "clipboard image buffer size mismatch: got {}, expected {}",
            rgba.len(),
            expected
        ));
    }
    let width_u32 = u32::try_from(width).map_err(|_| "clipboard image is too wide".to_string())?;
    let height_u32 =
        u32::try_from(height).map_err(|_| "clipboard image is too tall".to_string())?;
    let buffer = image::RgbaImage::from_raw(width_u32, height_u32, rgba)
        .ok_or_else(|| "clipboard image buffer is invalid".to_string())?;
    let mut cursor = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(buffer)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("encode clipboard image: {e}"))?;
    Ok(cursor.into_inner())
}

async fn upload_memory_image(
    app: AppHandle,
    state: State<'_, DbState>,
    upload_id: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<MediaUploadResponse, String> {
    let total = bytes.len() as u64;
    let _ = app.emit(
        "media-upload-progress",
        ProgressPayload {
            phase: "upload",
            bytes_done: 0,
            bytes_total: total,
            finished: false,
        },
    );
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let cancel_token = CancellationToken::new();
    register_upload_cancellation(upload_id.clone(), cancel_token.clone())?;

    let sent = Arc::new(AtomicU64::new(0));
    let app_for_progress = app.clone();
    let cancel_for_stream = cancel_token.clone();
    let chunks: Vec<Vec<u8>> = bytes
        .chunks(64 * 1024)
        .map(|chunk| chunk.to_vec())
        .collect();
    let stream = stream::iter(chunks.into_iter().map(move |chunk| {
        if cancel_for_stream.is_cancelled() {
            return Ok(Vec::<u8>::new());
        }
        let done = sent.fetch_add(chunk.len() as u64, Ordering::Relaxed) + chunk.len() as u64;
        let _ = app_for_progress.emit(
            "media-upload-progress",
            ProgressPayload {
                phase: "upload",
                bytes_done: done.min(total),
                bytes_total: total,
                finished: done >= total,
            },
        );
        Ok::<Vec<u8>, std::io::Error>(chunk)
    }));
    let body = reqwest::Body::wrap_stream(stream);
    let part = reqwest::multipart::Part::stream_with_length(body, total).file_name(file_name);
    let form = reqwest::multipart::Form::new().part("file", part);
    let send_future = client
        .post(format!("{api_url}/v1/media/uploads"))
        .bearer_auth(api_key)
        .multipart(form)
        .send();
    let resp = tokio::select! {
        _ = cancel_token.cancelled() => {
            remove_upload_cancellation(&upload_id);
            return Err("upload cancelled".to_string());
        }
        result = send_future => {
            remove_upload_cancellation(&upload_id);
            result.map_err(|e| format!("request failed: {e}"))?
        }
    };
    let parsed = parse_json(resp).await?;
    let _ = app.emit(
        "media-upload-progress",
        ProgressPayload {
            phase: "upload",
            bytes_done: total,
            bytes_total: total,
            finished: true,
        },
    );
    Ok(parsed)
}

#[tauri::command]
pub async fn cancel_media_upload(upload_id: String) -> Result<bool, String> {
    let token = upload_cancellations()
        .lock()
        .map_err(|_| "upload cancellation lock poisoned".to_string())?
        .remove(&upload_id);
    if let Some(token) = token {
        token.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn get_media_job(
    state: State<'_, DbState>,
    job_id: String,
) -> Result<MediaJobResponse, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .get(format!("{api_url}/v1/media/jobs/{job_id}"))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json(resp).await
}

#[cfg(test)]
mod tests {
    use super::encode_rgba_png;

    #[test]
    fn encode_rgba_png_returns_png_bytes() {
        let png = encode_rgba_png(1, 1, vec![255, 0, 0, 255]).unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
    }

    #[test]
    fn encode_rgba_png_rejects_bad_buffer_size() {
        let err = encode_rgba_png(2, 2, vec![0, 0, 0, 255]).unwrap_err();
        assert!(err.contains("buffer size mismatch"));
    }
}

#[tauri::command]
pub async fn delete_media_asset(
    state: State<'_, DbState>,
    asset_uuid: String,
) -> Result<(), String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .delete(format!("{api_url}/v1/media/assets/{asset_uuid}"))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let _: serde_json::Value = parse_json(resp).await?;
    Ok(())
}

#[tauri::command]
pub async fn select_media_variant(
    state: State<'_, DbState>,
    asset_uuid: String,
    variant: String,
) -> Result<MediaSelectResponse, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .post(format!("{api_url}/v1/media/assets/{asset_uuid}/select"))
        .bearer_auth(api_key)
        .json(&SelectVariantRequest { variant: &variant })
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json(resp).await
}
