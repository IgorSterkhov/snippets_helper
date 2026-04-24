//! Typed event payloads for whisper — emitted to the frontend via Tauri events.

use serde::{Deserialize, Serialize};

pub const EVT_STATE_CHANGED: &str = "whisper:state-changed";
pub const EVT_LEVEL: &str = "whisper:level";
pub const EVT_MODEL_DOWNLOAD: &str = "whisper:model-download";
pub const EVT_TRANSCRIBED: &str = "whisper:transcribed";
pub const EVT_ERROR: &str = "whisper:error";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDownloadPayload {
    pub model: String,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub speed_bps: u64,
    pub finished: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LevelPayload {
    pub rms: f32, // 0.0..1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatePayload {
    pub state: String, // "idle" | "warming" | "ready" | "recording" | "transcribing" | "unloading"
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscribedPayload {
    pub text: String,
    pub duration_ms: u64,
    pub transcribe_ms: u64,
    pub model: String,
    pub language: Option<String>,
    pub cpu_peak_percent: f64,
    pub gpu_peak_percent: f64,
    pub vram_peak_mb: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}
