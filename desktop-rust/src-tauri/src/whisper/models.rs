//! Model file management: path resolution, SHA256 verify, download with progress.

use crate::whisper::catalog::ModelMeta;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Base directory for installed model files (inside the OS app data dir).
pub fn models_dir(app_data: &Path) -> PathBuf {
    app_data.join("whisper-models")
}

/// Absolute path to a specific model's ggml .bin file.
pub fn model_path(app_data: &Path, name: &str) -> PathBuf {
    models_dir(app_data).join(format!("{}.bin", name))
}

/// Return true iff the file exists AND its SHA256 matches `expected`.
pub fn verify_file_sha256(path: &Path, expected: &str) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else { return false; };
    let mut hasher = Sha256::new();
    if std::io::copy(&mut file, &mut hasher).is_err() {
        return false;
    }
    let digest = hasher.finalize();
    let hex = digest.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    hex.eq_ignore_ascii_case(expected)
}

use crate::whisper::events::{self, ModelDownloadPayload};
use std::io::Write;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Download a model to a temp file, verify SHA256, then atomically rename
/// into place. Emits progress events at ~5Hz while downloading.
///
/// On error, the partial temp file is removed.
/// On success returns the final file path.
pub async fn download_and_install(
    app: &AppHandle,
    app_data: &Path,
    meta: &ModelMeta,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(models_dir(app_data))
        .map_err(|e| format!("create models dir: {e}"))?;

    let final_path = model_path(app_data, meta.name);
    let tmp_path = final_path.with_extension("bin.part");

    // If already installed + verified, short-circuit.
    if final_path.exists() && verify_file_sha256(&final_path, meta.sha256) {
        emit_done(app, meta.name, meta.size_bytes);
        return Ok(final_path);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 30)) // 30 min cap per download
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
            let speed = (done as f64 / secs) as u64;
            let _ = app.emit(
                events::EVT_MODEL_DOWNLOAD,
                ModelDownloadPayload {
                    model: meta.name.to_string(),
                    bytes_done: done,
                    bytes_total: total,
                    speed_bps: speed,
                    finished: false,
                    error: None,
                },
            );
            last_emit = Instant::now();
        }
    }
    drop(file);

    if !verify_file_sha256(&tmp_path, meta.sha256) {
        let _ = std::fs::remove_file(&tmp_path);
        let _ = app.emit(
            events::EVT_MODEL_DOWNLOAD,
            ModelDownloadPayload {
                model: meta.name.to_string(),
                bytes_done: done,
                bytes_total: total,
                speed_bps: 0,
                finished: true,
                error: Some("sha256 mismatch".into()),
            },
        );
        return Err("sha256 mismatch".into());
    }

    std::fs::rename(&tmp_path, &final_path)
        .map_err(|e| format!("rename: {e}"))?;

    emit_done(app, meta.name, total);
    Ok(final_path)
}

fn emit_done(app: &AppHandle, name: &str, total: u64) {
    let _ = app.emit(
        events::EVT_MODEL_DOWNLOAD,
        ModelDownloadPayload {
            model: name.to_string(),
            bytes_done: total,
            bytes_total: total,
            speed_bps: 0,
            finished: true,
            error: None,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn verify_returns_false_for_missing_file() {
        assert!(!verify_file_sha256(Path::new("/nonexistent/path.bin"), "deadbeef"));
    }

    #[test]
    fn verify_returns_true_for_matching_hash() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        tmp.as_file().write_all(b"hello world").unwrap();
        tmp.as_file().sync_all().unwrap();
        // SHA256("hello world") = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
        assert!(verify_file_sha256(
            tmp.path(),
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        ));
    }

    #[test]
    fn verify_returns_false_for_wrong_hash() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        tmp.as_file().write_all(b"hello world").unwrap();
        tmp.as_file().sync_all().unwrap();
        assert!(!verify_file_sha256(
            tmp.path(),
            "0000000000000000000000000000000000000000000000000000000000000000"
        ));
    }

    #[test]
    fn models_dir_and_path_are_under_app_data() {
        let base = Path::new("/tmp/app-data");
        assert_eq!(models_dir(base), PathBuf::from("/tmp/app-data/whisper-models"));
        assert_eq!(
            model_path(base, "ggml-small"),
            PathBuf::from("/tmp/app-data/whisper-models/ggml-small.bin")
        );
    }

    #[allow(dead_code)]
    fn _ensure_meta_compiles(_: &ModelMeta) {}
}
