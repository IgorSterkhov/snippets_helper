//! Hardware detection used by onboarding hints + bin selection.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub cpu_model: String,
    pub ram_mb: u64,
    pub cuda: bool,
    pub metal: bool,
    pub vram_mb: u64,
    /// Discrete GPU name if detectable (e.g. "NVIDIA GeForce RTX 3060"). None
    /// if no discrete GPU or detection failed. Note: `cpu_model` may mention
    /// integrated graphics (e.g. "Ryzen 7 5800H with Radeon Graphics") — that
    /// is NOT this field.
    pub gpu_name: Option<String>,
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
    let (cuda, vram_mb, gpu_name) = detect_cuda();

    HardwareInfo { cpu_model, ram_mb, cuda, metal, vram_mb, gpu_name }
}

fn detect_cuda() -> (bool, u64, Option<String>) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        // CREATE_NO_WINDOW — prevents cmd-window flicker, same as
        // commands/repo_search.rs pattern.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = Command::new("nvidia-smi")
            .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout);
                // nvidia-smi csv line: "NVIDIA GeForce RTX 3060, 12288"
                if let Some(first) = s.lines().next() {
                    let parts: Vec<&str> = first.splitn(2, ',').map(|p| p.trim()).collect();
                    if parts.len() == 2 {
                        let name = parts[0].to_string();
                        if let Ok(mb) = parts[1].parse::<u64>() {
                            return (true, mb, Some(name));
                        }
                    }
                }
            }
        }
    }
    (false, 0, None)
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
