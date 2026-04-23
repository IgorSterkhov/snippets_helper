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
