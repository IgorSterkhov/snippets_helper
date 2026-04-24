//! GGUF model file management: path resolution, SHA256 verify, progressed
//! download from HuggingFace. Mirrors crate::whisper::models but writes
//! `.gguf` files instead of `.bin` and emits `gemma:model-download` events.

use crate::gemma::catalog::ModelMeta;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub const EVT_MODEL_DOWNLOAD: &str = "gemma:model-download";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDownloadPayload {
    pub model: String,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub speed_bps: u64,
    pub finished: bool,
    pub error: Option<String>,
}

pub fn models_dir(app_data: &Path) -> PathBuf {
    app_data.join("gemma-models")
}

pub fn model_path(app_data: &Path, name: &str) -> PathBuf {
    models_dir(app_data).join(format!("{}.gguf", name))
}

pub fn verify_file_sha256(path: &Path, expected: &str) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else { return false; };
    let mut hasher = Sha256::new();
    if std::io::copy(&mut file, &mut hasher).is_err() {
        return false;
    }
    let hex = hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect::<String>();
    hex.eq_ignore_ascii_case(expected)
}

pub async fn download_and_install(
    app: &AppHandle,
    app_data: &Path,
    meta: &ModelMeta,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(models_dir(app_data))
        .map_err(|e| format!("create models dir: {e}"))?;

    let final_path = model_path(app_data, meta.name);
    let tmp_path = final_path.with_extension("gguf.part");

    if final_path.exists() && verify_file_sha256(&final_path, meta.sha256) {
        emit_done(app, meta.name, meta.size_bytes);
        return Ok(final_path);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 30))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let resp = client.get(meta.download_url)
        .send().await
        .map_err(|e| format!("http get: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("http status {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(meta.size_bytes);

    let mut file = std::fs::File::create(&tmp_path)
        .map_err(|e| format!("create tmp: {e}"))?;
    let mut stream = resp.bytes_stream();

    let mut done: u64 = 0;
    let mut last_emit = Instant::now();
    let started = Instant::now();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let _ = std::fs::remove_file(&tmp_path);
            format!("chunk: {e}")
        })?;
        file.write_all(&chunk).map_err(|e| {
            let _ = std::fs::remove_file(&tmp_path);
            format!("write: {e}")
        })?;
        done += chunk.len() as u64;
        if last_emit.elapsed().as_millis() > 200 {
            let secs = started.elapsed().as_secs_f64().max(0.001);
            let _ = app.emit(EVT_MODEL_DOWNLOAD, ModelDownloadPayload {
                model: meta.name.to_string(),
                bytes_done: done,
                bytes_total: total,
                speed_bps: (done as f64 / secs) as u64,
                finished: false,
                error: None,
            });
            last_emit = Instant::now();
        }
    }
    drop(file);

    if !verify_file_sha256(&tmp_path, meta.sha256) {
        let _ = std::fs::remove_file(&tmp_path);
        let _ = app.emit(EVT_MODEL_DOWNLOAD, ModelDownloadPayload {
            model: meta.name.to_string(),
            bytes_done: done,
            bytes_total: total,
            speed_bps: 0,
            finished: true,
            error: Some("sha256 mismatch".into()),
        });
        return Err("sha256 mismatch".into());
    }

    std::fs::rename(&tmp_path, &final_path)
        .map_err(|e| format!("rename: {e}"))?;
    emit_done(app, meta.name, total);
    Ok(final_path)
}

fn emit_done(app: &AppHandle, name: &str, total: u64) {
    let _ = app.emit(EVT_MODEL_DOWNLOAD, ModelDownloadPayload {
        model: name.to_string(),
        bytes_done: total,
        bytes_total: total,
        speed_bps: 0,
        finished: true,
        error: None,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_dir_and_path() {
        let base = Path::new("/tmp/app-data");
        assert_eq!(models_dir(base), PathBuf::from("/tmp/app-data/gemma-models"));
        assert_eq!(
            model_path(base, "gemma-3-4b-it-Q4_K_M"),
            PathBuf::from("/tmp/app-data/gemma-models/gemma-3-4b-it-Q4_K_M.gguf")
        );
    }

    #[test]
    fn verify_missing_is_false() {
        assert!(!verify_file_sha256(Path::new("/nonexistent"), "abcd"));
    }
}
