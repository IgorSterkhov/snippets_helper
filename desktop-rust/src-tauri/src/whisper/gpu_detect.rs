//! Hardware detection used by onboarding hints + bin selection.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub cpu_model: String,
    pub ram_mb: u64,
    pub cuda: bool,
    pub metal: bool,
    pub vram_mb: u64,
}

/// Cheap introspection intended to run once at onboarding time.
pub fn detect() -> HardwareInfo {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_all();
    let cpu_model = sys.cpus().first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "unknown".into());
    let ram_mb = sys.total_memory() / 1024 / 1024;

    let metal = cfg!(all(target_os = "macos", target_arch = "aarch64"));
    let (cuda, vram_mb) = detect_cuda();

    HardwareInfo { cpu_model, ram_mb, cuda, metal, vram_mb }
}

fn detect_cuda() -> (bool, u64) {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let out = Command::new("nvidia-smi")
            .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout);
                let first = s.lines().next().unwrap_or("").trim();
                if let Ok(mb) = first.parse::<u64>() {
                    return (true, mb);
                }
            }
        }
    }
    (false, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_returns_non_zero_ram() {
        let hw = detect();
        assert!(hw.ram_mb > 0, "ram should be detected on any running system");
        assert!(!hw.cpu_model.is_empty());
    }
}
