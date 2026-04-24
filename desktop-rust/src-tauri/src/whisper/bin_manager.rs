//! Resolves which whisper-server binary to use for this platform/GPU combo.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub enum BinVariant {
    /// Pre-bundled CPU binary shipped via Tauri `externalBin`.
    BundledCpu,
    /// Downloaded variant living under `app_data/whisper-bin/`.
    DownloadedGpu { path: PathBuf },
}

/// Path where downloaded GPU builds are stored.
pub fn gpu_bin_dir(app_data: &Path) -> PathBuf {
    app_data.join("whisper-bin")
}

/// Return the GPU-variant file if one has been downloaded and exists on disk.
pub fn downloaded_gpu_bin(app_data: &Path) -> Option<PathBuf> {
    let dir = gpu_bin_dir(app_data);
    #[cfg(target_os = "windows")]
    {
        let cuda = dir.join("whisper-server-cuda.exe");
        if cuda.exists() { return Some(cuda); }
        let vulkan = dir.join("whisper-server-vulkan.exe");
        if vulkan.exists() { return Some(vulkan); }
    }
    // macOS and Linux: only the bundled variant in MVP
    let _ = dir;
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_gpu_bin_in_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(downloaded_gpu_bin(tmp.path()).is_none());
    }
}
