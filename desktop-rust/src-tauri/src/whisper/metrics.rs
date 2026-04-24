//! Per-transcription resource metrics: peak CPU of the whisper-server
//! process, peak GPU utilization and VRAM usage (NVIDIA-only, via
//! nvidia-smi polling).

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::task::JoinHandle;

#[derive(Debug, Clone, Copy, Default)]
pub struct PeakMetrics {
    pub cpu_percent: f64,
    pub gpu_percent: f64,
    pub vram_mb: i64,
}

/// Samples resource metrics for the given pid at ~5 Hz. The sampler runs
/// until `stop()` is called or the handle is dropped, whichever first.
pub struct Sampler {
    shared: Arc<Mutex<PeakMetrics>>,
    stop_flag: Arc<std::sync::atomic::AtomicBool>,
    task: Option<JoinHandle<()>>,
}

impl Sampler {
    pub fn start(pid: u32) -> Self {
        let shared = Arc::new(Mutex::new(PeakMetrics::default()));
        let stop_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let shared_clone = shared.clone();
        let stop_clone = stop_flag.clone();
        let task = tokio::task::spawn_blocking(move || {
            // sysinfo polls need to be called at least twice to get a valid
            // delta for CPU percent — so we warm up before the first read.
            let mut sys = sysinfo::System::new();
            let target = sysinfo::Pid::from(pid as usize);

            // First refresh establishes a baseline.
            sys.refresh_process(target);

            while !stop_clone.load(std::sync::atomic::Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(200));
                sys.refresh_process(target);
                let cpu_pct = sys.process(target).map(|p| p.cpu_usage() as f64).unwrap_or(0.0);
                let (gpu_pct, vram_mb) = sample_nvidia_smi();

                if let Ok(mut peak) = shared_clone.lock() {
                    if cpu_pct > peak.cpu_percent { peak.cpu_percent = cpu_pct; }
                    if gpu_pct > peak.gpu_percent { peak.gpu_percent = gpu_pct; }
                    if vram_mb > peak.vram_mb   { peak.vram_mb     = vram_mb; }
                }
            }
        });
        Self { shared, stop_flag, task: Some(task) }
    }

    /// Stop sampling and return the peak values observed so far.
    pub async fn stop(mut self) -> PeakMetrics {
        self.stop_flag.store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(t) = self.task.take() {
            let _ = t.await;
        }
        self.shared.lock().ok().map(|m| *m).unwrap_or_default()
    }
}

fn sample_nvidia_smi() -> (f64, i64) {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let out = Command::new("nvidia-smi")
            .args(["--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader,nounits"])
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout);
                if let Some(first) = s.lines().next() {
                    let parts: Vec<&str> = first.splitn(2, ',').map(|p| p.trim()).collect();
                    if parts.len() == 2 {
                        let gpu = parts[0].parse::<f64>().unwrap_or(0.0);
                        let mem = parts[1].parse::<i64>().unwrap_or(0);
                        return (gpu, mem);
                    }
                }
            }
        }
    }
    (0.0, 0)
}
