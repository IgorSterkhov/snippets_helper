# Whisper Deepgram Live Dictation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Deepgram live dictation to the desktop Whisper tab while preserving the existing local Whisper batch flow.

**Architecture:** Add a parallel `DeepgramLiveService` beside the existing `WhisperService`. The local path remains record-stop-transcribe-inject, while the Deepgram path streams 16 kHz mono PCM over WebSocket, shows interim text in UI, and pastes only finalized chunks into the active application.

**Tech Stack:** Tauri v2, Rust, `cpal`, `tokio`, `tokio-tungstenite`, SQLite via `rusqlite`, vanilla JS desktop UI, CDP browser mock tests.

---

## Required Context

- Spec: `.workflow/specs/2026-05-27-whisper-deepgram-live-dictation.md`
- Project rules: `CLAUDE.md`
- UI patterns: `FRONTEND_PATTERNS.md`
- Release rules: `desktop-rust/RELEASES.md`

This changes `desktop-rust/src-tauri/` and adds new Tauri commands, so the final release must be a full `v*` release, not an `f-*` OTA.

## File Map

Backend:

- Modify `desktop-rust/src-tauri/Cargo.toml`: add WebSocket dependency.
- Modify `desktop-rust/src-tauri/Cargo.lock`: refreshed by `cargo check`.
- Modify `desktop-rust/src-tauri/src/whisper/mod.rs`: export Deepgram module.
- Create `desktop-rust/src-tauri/src/whisper/deepgram.rs`: Deepgram parser, spacing helper, settings type, live state machine, WebSocket client.
- Modify `desktop-rust/src-tauri/src/whisper/audio.rs`: add live PCM frame capture while preserving existing WAV capture.
- Modify `desktop-rust/src-tauri/src/whisper/inject.rs`: add finalized chunk paste helper.
- Modify `desktop-rust/src-tauri/src/commands/whisper.rs`: add live commands and settings loading.
- Modify `desktop-rust/src-tauri/src/lib.rs`: manage `DeepgramLiveService` and register live commands.
- Modify `desktop-rust/src-tauri/src/db/mod.rs`: add history provider metadata migration.
- Modify `desktop-rust/src-tauri/src/db/queries.rs`: read/write provider metadata.

Frontend:

- Modify `desktop-rust/src/tabs/whisper/whisper-api.js`: add live commands and live events.
- Modify `desktop-rust/src/tabs/whisper/whisper-tab.js`: add `Live dictate` checkbox, live state handling, live interim/final UI updates.
- Modify `desktop-rust/src/tabs/whisper/whisper-settings.js`: add local Deepgram settings section.
- Modify `desktop-rust/src/tabs/whisper/whisper-overlay.js`: render live connecting/streaming/stopping states and interim text.
- Modify `desktop-rust/src/dev-mock.js`: mock live commands/events/settings.
- Modify `desktop-rust/src/dev-test.py`: add browser smoke coverage.

Release/help:

- Modify `desktop-rust/src/tabs/help.js`: describe Deepgram live dictation.
- Modify `desktop-rust/CHANGELOG.md`: add `vX.Y.Z` section during release.
- Modify `desktop-rust/src/release-history.md`: add matching release section before tag.

## Task 1: Add Whisper History Provider Metadata

**Files:**
- Modify: `desktop-rust/src-tauri/src/db/mod.rs`
- Modify: `desktop-rust/src-tauri/src/db/queries.rs`

- [ ] **Step 1: Write failing DB tests**

Add tests in `desktop-rust/src-tauri/src/db/queries.rs` inside `mod whisper_crud_tests`:

```rust
#[test]
fn whisper_history_defaults_to_local_provider() {
    let conn = setup();
    whisper_insert_history(
        &conn,
        "hello",
        None,
        "ggml-small",
        1000,
        200,
        Some("en"),
        Some("paste"),
        0.0,
        0.0,
        0,
    )
    .unwrap();

    let rows = whisper_list_history(&conn, 10).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].provider, "local");
    assert_eq!(rows[0].provider_model.as_deref(), Some("ggml-small"));
}

#[test]
fn whisper_history_can_store_deepgram_provider() {
    let conn = setup();
    whisper_insert_history_with_provider(
        &conn,
        "привет мир",
        None,
        "nova-3",
        "deepgram",
        Some("nova-3"),
        2500,
        0,
        Some("ru"),
        Some("paste"),
        0.0,
        0.0,
        0,
    )
    .unwrap();

    let rows = whisper_list_history(&conn, 10).unwrap();
    assert_eq!(rows[0].provider, "deepgram");
    assert_eq!(rows[0].provider_model.as_deref(), Some("nova-3"));
}
```

- [ ] **Step 2: Run DB tests and verify RED**

Run:

```bash
cd desktop-rust/src-tauri
cargo test whisper_crud_tests --lib
```

Expected: fail because `WhisperHistoryRow.provider`, `provider_model`, and `whisper_insert_history_with_provider` do not exist.

- [ ] **Step 3: Add schema migration**

In `desktop-rust/src-tauri/src/db/mod.rs`, after the `postprocessed_text` migration, add:

```rust
// Migration (v1.3.37): provider metadata for local/cloud Whisper history rows.
conn.execute_batch("ALTER TABLE whisper_history ADD COLUMN provider TEXT NOT NULL DEFAULT 'local'")
    .ok();
conn.execute_batch("ALTER TABLE whisper_history ADD COLUMN provider_model TEXT")
    .ok();
conn.execute_batch(
    "UPDATE whisper_history
     SET provider_model = model_name
     WHERE provider_model IS NULL OR provider_model = ''",
)
.ok();
```

- [ ] **Step 4: Extend history row and insert helpers**

In `desktop-rust/src-tauri/src/db/queries.rs`, extend `WhisperHistoryRow`:

```rust
pub provider: String,
pub provider_model: Option<String>,
```

Replace `whisper_insert_history` with a wrapper:

```rust
pub fn whisper_insert_history(
    conn: &Connection,
    text: &str,
    text_raw: Option<&str>,
    model_name: &str,
    duration_ms: i64,
    transcribe_ms: i64,
    language: Option<&str>,
    injected_to: Option<&str>,
    cpu_peak_percent: f64,
    gpu_peak_percent: f64,
    vram_peak_mb: i64,
) -> Result<i64> {
    whisper_insert_history_with_provider(
        conn,
        text,
        text_raw,
        model_name,
        "local",
        Some(model_name),
        duration_ms,
        transcribe_ms,
        language,
        injected_to,
        cpu_peak_percent,
        gpu_peak_percent,
        vram_peak_mb,
    )
}
```

Add the new helper:

```rust
pub fn whisper_insert_history_with_provider(
    conn: &Connection,
    text: &str,
    text_raw: Option<&str>,
    model_name: &str,
    provider: &str,
    provider_model: Option<&str>,
    duration_ms: i64,
    transcribe_ms: i64,
    language: Option<&str>,
    injected_to: Option<&str>,
    cpu_peak_percent: f64,
    gpu_peak_percent: f64,
    vram_peak_mb: i64,
) -> Result<i64> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO whisper_history
            (text, text_raw, model_name, provider, provider_model, duration_ms, transcribe_ms, language, injected_to, created_at, cpu_peak_percent, gpu_peak_percent, vram_peak_mb)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            text,
            text_raw,
            model_name,
            provider,
            provider_model,
            duration_ms,
            transcribe_ms,
            language,
            injected_to,
            now,
            cpu_peak_percent,
            gpu_peak_percent,
            vram_peak_mb,
        ],
    )?;
    conn.execute(
        "DELETE FROM whisper_history WHERE id NOT IN
            (SELECT id FROM whisper_history ORDER BY id DESC LIMIT 200)",
        [],
    )?;
    Ok(conn.last_insert_rowid())
}
```

Update `whisper_list_history` select:

```sql
SELECT id, text, text_raw, model_name, duration_ms, transcribe_ms, language, injected_to, created_at,
       cpu_peak_percent, gpu_peak_percent, vram_peak_mb, postprocessed_text, provider, provider_model
FROM whisper_history ORDER BY created_at DESC, id DESC LIMIT ?1
```

Map the new fields:

```rust
provider: r.get(13)?,
provider_model: r.get(14)?,
```

- [ ] **Step 5: Run DB tests and verify GREEN**

Run:

```bash
cd desktop-rust/src-tauri
cargo test whisper_crud_tests --lib
```

Expected: all `whisper_crud_tests` pass.

- [ ] **Step 6: Commit**

```bash
git add desktop-rust/src-tauri/src/db/mod.rs desktop-rust/src-tauri/src/db/queries.rs
git commit -m "add whisper provider history metadata"
```

## Task 2: Add Deepgram Parser And Chunk Spacing Helpers

**Files:**
- Create: `desktop-rust/src-tauri/src/whisper/deepgram.rs`
- Modify: `desktop-rust/src-tauri/src/whisper/mod.rs`

- [ ] **Step 1: Write failing parser tests**

Create `desktop-rust/src-tauri/src/whisper/deepgram.rs` with only tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_interim_result() {
        let json = r#"{
            "type":"Results",
            "is_final":false,
            "speech_final":false,
            "channel":{"alternatives":[{"transcript":"hello wor"}]}
        }"#;

        let msg = parse_deepgram_message(json).unwrap().unwrap();
        assert_eq!(msg.transcript, "hello wor");
        assert!(!msg.is_final);
        assert!(!msg.speech_final);
    }

    #[test]
    fn parse_final_result() {
        let json = r#"{
            "type":"Results",
            "is_final":true,
            "speech_final":true,
            "channel":{"alternatives":[{"transcript":"hello world"}]}
        }"#;

        let msg = parse_deepgram_message(json).unwrap().unwrap();
        assert_eq!(msg.transcript, "hello world");
        assert!(msg.is_final);
        assert!(msg.speech_final);
    }

    #[test]
    fn ignore_empty_or_non_result_messages() {
        assert!(parse_deepgram_message(r#"{"type":"Metadata"}"#).unwrap().is_none());
        assert!(parse_deepgram_message(r#"{"type":"Results","is_final":true,"channel":{"alternatives":[{"transcript":""}]}}"#).unwrap().is_none());
    }

    #[test]
    fn paste_chunk_adds_spaces_for_russian_and_latin_text() {
        assert_eq!(build_paste_chunk("", "привет"), "привет");
        assert_eq!(build_paste_chunk("привет", "мир"), " мир");
        assert_eq!(build_paste_chunk("hello", "world."), " world.");
        assert_eq!(build_paste_chunk("hello ", "world"), "world");
        assert_eq!(build_paste_chunk("hello", ", world"), ", world");
    }
}
```

- [ ] **Step 2: Export module and verify RED**

In `desktop-rust/src-tauri/src/whisper/mod.rs`, add:

```rust
pub mod deepgram;
```

Run:

```bash
cd desktop-rust/src-tauri
cargo test whisper::deepgram --lib
```

Expected: fail because parser functions and types are missing.

- [ ] **Step 3: Implement parser and spacing helper**

Add above the tests in `desktop-rust/src-tauri/src/whisper/deepgram.rs`:

```rust
use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeepgramTranscript {
    pub transcript: String,
    pub is_final: bool,
    pub speech_final: bool,
}

#[derive(Debug, Deserialize)]
struct DeepgramResponse {
    #[serde(rename = "type")]
    kind: Option<String>,
    is_final: Option<bool>,
    speech_final: Option<bool>,
    channel: Option<DeepgramChannel>,
}

#[derive(Debug, Deserialize)]
struct DeepgramChannel {
    alternatives: Vec<DeepgramAlternative>,
}

#[derive(Debug, Deserialize)]
struct DeepgramAlternative {
    transcript: Option<String>,
}

pub fn parse_deepgram_message(raw: &str) -> Result<Option<DeepgramTranscript>, String> {
    let parsed: DeepgramResponse = serde_json::from_str(raw)
        .map_err(|e| format!("deepgram json parse: {e}"))?;
    if parsed.kind.as_deref() != Some("Results") {
        return Ok(None);
    }
    let transcript = parsed
        .channel
        .and_then(|c| c.alternatives.into_iter().next())
        .and_then(|a| a.transcript)
        .unwrap_or_default()
        .trim()
        .to_string();
    if transcript.is_empty() {
        return Ok(None);
    }
    Ok(Some(DeepgramTranscript {
        transcript,
        is_final: parsed.is_final.unwrap_or(false),
        speech_final: parsed.speech_final.unwrap_or(false),
    }))
}

pub fn build_paste_chunk(committed_text: &str, finalized_delta: &str) -> String {
    let delta = finalized_delta.trim();
    if delta.is_empty() {
        return String::new();
    }
    if committed_text.is_empty()
        || committed_text.ends_with(char::is_whitespace)
        || delta.starts_with(char::is_whitespace)
        || delta.starts_with([',', '.', '!', '?', ':', ';', ')', ']', '}'])
    {
        delta.to_string()
    } else {
        format!(" {delta}")
    }
}
```

- [ ] **Step 4: Run parser tests and verify GREEN**

Run:

```bash
cd desktop-rust/src-tauri
cargo test whisper::deepgram --lib
```

Expected: all `whisper::deepgram` tests pass.

- [ ] **Step 5: Commit**

```bash
git add desktop-rust/src-tauri/src/whisper/mod.rs desktop-rust/src-tauri/src/whisper/deepgram.rs
git commit -m "add deepgram transcript parser"
```

## Task 3: Add Live Audio Frame Capture

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/audio.rs`

- [ ] **Step 1: Write failing audio helper test**

In `desktop-rust/src-tauri/src/whisper/audio.rs`, inside the existing `#[cfg(test)] mod tests`, add:

```rust
#[test]
fn pcm_i16_to_le_bytes_preserves_samples() {
    let samples = vec![0_i16, 1, -1, 256, -256];
    let bytes = pcm_i16_to_le_bytes(&samples);
    assert_eq!(
        bytes,
        vec![0, 0, 1, 0, 255, 255, 0, 1, 0, 255]
    );
}
```

- [ ] **Step 2: Run audio tests and verify RED**

Run:

```bash
cd desktop-rust/src-tauri
cargo test whisper::audio --lib
```

Expected: fail because `pcm_i16_to_le_bytes` does not exist.

- [ ] **Step 3: Implement PCM byte helper**

Add near `encode_wav`:

```rust
pub fn pcm_i16_to_le_bytes(samples: &[i16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}
```

- [ ] **Step 4: Add live recorder type**

In `desktop-rust/src-tauri/src/whisper/audio.rs`, add:

```rust
pub struct LiveRecorder {
    _stream: cpal::Stream,
    started_at: Instant,
}

impl LiveRecorder {
    pub fn start(
        app: AppHandle,
        device_name: Option<&str>,
        tx: tokio::sync::mpsc::UnboundedSender<Vec<i16>>,
    ) -> Result<Self, String> {
        let host = cpal::default_host();
        let device = match device_name {
            None => host
                .default_input_device()
                .ok_or_else(|| "no default input device".to_string())?,
            Some(name) => host
                .input_devices()
                .map_err(|e| format!("enum: {e}"))?
                .find(|d| d.name().ok().as_deref() == Some(name))
                .ok_or_else(|| format!("device not found: {name}"))?,
        };

        let default_config = device
            .default_input_config()
            .map_err(|e| format!("default config: {e}"))?;
        let sample_format = default_config.sample_format();
        let sample_rate = default_config.sample_rate().0;
        let channels = default_config.channels();
        let config: StreamConfig = default_config.into();
        let emit_every: usize = (sample_rate as usize / 20).max(100);
        let err_fn = |e| eprintln!("[whisper live audio] stream error: {e}");

        let stream = match sample_format {
            SampleFormat::F32 => {
                let app_for_cb = app.clone();
                let tx_for_cb = tx.clone();
                let mut since_emit: usize = 0;
                let mut rms_sq: f64 = 0.0;
                let mut rms_n: usize = 0;
                device.build_input_stream(
                    &config,
                    move |data: &[f32], _| {
                        let samples = convert_frames_f32_to_i16_16k(
                            data,
                            sample_rate,
                            channels,
                            &app_for_cb,
                            &mut since_emit,
                            emit_every,
                            &mut rms_sq,
                            &mut rms_n,
                        );
                        let _ = tx_for_cb.send(samples);
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::I16 => {
                let app_for_cb = app.clone();
                let tx_for_cb = tx.clone();
                let mut since_emit: usize = 0;
                let mut rms_sq: f64 = 0.0;
                let mut rms_n: usize = 0;
                device.build_input_stream(
                    &config,
                    move |data: &[i16], _| {
                        let f32_data: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                        let samples = convert_frames_f32_to_i16_16k(
                            &f32_data,
                            sample_rate,
                            channels,
                            &app_for_cb,
                            &mut since_emit,
                            emit_every,
                            &mut rms_sq,
                            &mut rms_n,
                        );
                        let _ = tx_for_cb.send(samples);
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::U16 => {
                let app_for_cb = app.clone();
                let tx_for_cb = tx.clone();
                let mut since_emit: usize = 0;
                let mut rms_sq: f64 = 0.0;
                let mut rms_n: usize = 0;
                device.build_input_stream(
                    &config,
                    move |data: &[u16], _| {
                        let f32_data: Vec<f32> = data
                            .iter()
                            .map(|&s| (s as i32 - 32_768) as f32 / 32768.0)
                            .collect();
                        let samples = convert_frames_f32_to_i16_16k(
                            &f32_data,
                            sample_rate,
                            channels,
                            &app_for_cb,
                            &mut since_emit,
                            emit_every,
                            &mut rms_sq,
                            &mut rms_n,
                        );
                        let _ = tx_for_cb.send(samples);
                    },
                    err_fn,
                    None,
                )
            }
            other => return Err(format!("unsupported sample format: {:?}", other)),
        }
        .map_err(|e| format!("build_input_stream: {e}"))?;

        stream.play().map_err(|e| format!("stream.play: {e}"))?;
        Ok(Self {
            _stream: stream,
            started_at: Instant::now(),
        })
    }

    pub fn duration_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }
}
```

Add the shared converter used by live capture:

```rust
fn convert_frames_f32_to_i16_16k(
    data: &[f32],
    in_sample_rate: u32,
    in_channels: u16,
    app: &AppHandle,
    since_emit: &mut usize,
    emit_every: usize,
    rms_sq: &mut f64,
    rms_n: &mut usize,
) -> Vec<i16> {
    let mono: Vec<f32> = if in_channels == 1 {
        data.to_vec()
    } else {
        let c = in_channels as usize;
        data.chunks_exact(c)
            .map(|ch| ch.iter().sum::<f32>() / c as f32)
            .collect()
    };
    let resampled = resample_linear_f32(&mono, in_sample_rate, WAV_SAMPLE_RATE);
    for &s in &mono {
        *rms_sq += (s as f64) * (s as f64);
        *rms_n += 1;
    }
    *since_emit += mono.len();
    if *since_emit >= emit_every && *rms_n > 0 {
        let rms = ((*rms_sq / *rms_n as f64).sqrt() as f32).clamp(0.0, 1.0);
        let _ = app.emit(events::EVT_LEVEL, LevelPayload { rms });
        *since_emit = 0;
        *rms_sq = 0.0;
        *rms_n = 0;
    }
    resampled
        .iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect()
}
```

Then simplify `process_frames_f32` so it calls `convert_frames_f32_to_i16_16k` and extends the WAV buffer with the returned samples.

- [ ] **Step 5: Run audio tests and verify GREEN**

Run:

```bash
cd desktop-rust/src-tauri
cargo test whisper::audio --lib
```

Expected: all `whisper::audio` tests pass.

- [ ] **Step 6: Commit**

```bash
git add desktop-rust/src-tauri/src/whisper/audio.rs
git commit -m "add live whisper audio frames"
```

## Task 4: Add Finalized Chunk Paste Helper

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/inject.rs`

- [ ] **Step 1: Write failing inject method test**

In `desktop-rust/src-tauri/src/whisper/inject.rs`, inside tests, add:

```rust
#[test]
fn paste_chunk_method_name_is_stable() {
    assert_eq!(InjectMethod::Paste.as_str(), "paste");
}
```

This test should already pass; it protects the method name used for Deepgram history rows.

- [ ] **Step 2: Add paste chunk API**

Add a public helper:

```rust
pub async fn paste_chunk(text: &str, clipboard_restore_delay_ms: u64) -> Result<&'static str, String> {
    if text.trim().is_empty() {
        return Ok("paste");
    }
    inject(text, InjectMethod::Paste, clipboard_restore_delay_ms).await
}
```

- [ ] **Step 3: Run inject tests**

Run:

```bash
cd desktop-rust/src-tauri
cargo test whisper::inject --lib
```

Expected: all `whisper::inject` tests pass.

- [ ] **Step 4: Commit**

```bash
git add desktop-rust/src-tauri/src/whisper/inject.rs
git commit -m "add live paste helper"
```

## Task 5: Add Deepgram Live Service Skeleton And Commands

**Files:**
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/src/whisper/deepgram.rs`
- Modify: `desktop-rust/src-tauri/src/commands/whisper.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`

- [ ] **Step 1: Add WebSocket dependency**

In `desktop-rust/src-tauri/Cargo.toml`, add near `futures-util`:

```toml
tokio-tungstenite = { version = "0.24", features = ["rustls-tls-webpki-roots"] }
```

- [ ] **Step 2: Add service state tests**

In `desktop-rust/src-tauri/src/whisper/deepgram.rs`, add tests:

```rust
#[test]
fn live_state_strings_match_frontend_contract() {
    assert_eq!(LiveState::Idle.as_str(), "idle");
    assert_eq!(LiveState::Connecting.as_str(), "connecting");
    assert_eq!(LiveState::Streaming.as_str(), "streaming");
    assert_eq!(LiveState::Stopping.as_str(), "stopping");
    assert_eq!(LiveState::Error.as_str(), "error");
}

#[test]
fn build_deepgram_url_contains_required_streaming_params() {
    let cfg = DeepgramConfig {
        api_key: "secret".into(),
        model: "nova-3".into(),
        language: Some("ru".into()),
        endpointing_ms: 300,
        clipboard_restore_delay_ms: 200,
        mic_device: None,
    };
    let url = build_deepgram_url(&cfg);
    assert!(url.starts_with("wss://api.deepgram.com/v1/listen?"));
    assert!(url.contains("model=nova-3"));
    assert!(url.contains("encoding=linear16"));
    assert!(url.contains("sample_rate=16000"));
    assert!(url.contains("channels=1"));
    assert!(url.contains("interim_results=true"));
    assert!(url.contains("endpointing=300"));
    assert!(url.contains("language=ru"));
}
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
cd desktop-rust/src-tauri
cargo test whisper::deepgram --lib
```

Expected: fail because `LiveState`, `DeepgramConfig`, and `build_deepgram_url` do not exist.

- [ ] **Step 4: Implement config, state, and events**

In `desktop-rust/src-tauri/src/whisper/deepgram.rs`, add:

```rust
use crate::whisper::audio::{pcm_i16_to_le_bytes, LiveRecorder};
use crate::whisper::inject;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

pub const EVT_LIVE_STATE: &str = "whisper:live-state-changed";
pub const EVT_LIVE_LEVEL: &str = "whisper:live-level";
pub const EVT_LIVE_INTERIM: &str = "whisper:live-interim";
pub const EVT_LIVE_FINAL: &str = "whisper:live-final";
pub const EVT_LIVE_ERROR: &str = "whisper:live-error";

#[derive(Debug, Clone)]
pub struct DeepgramConfig {
    pub api_key: String,
    pub model: String,
    pub language: Option<String>,
    pub endpointing_ms: u64,
    pub clipboard_restore_delay_ms: u64,
    pub mic_device: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiveState {
    Idle,
    Connecting,
    Streaming,
    Stopping,
    Error,
}

impl LiveState {
    pub fn as_str(self) -> &'static str {
        match self {
            LiveState::Idle => "idle",
            LiveState::Connecting => "connecting",
            LiveState::Streaming => "streaming",
            LiveState::Stopping => "stopping",
            LiveState::Error => "error",
        }
    }
}

pub fn build_deepgram_url(cfg: &DeepgramConfig) -> String {
    let mut url = format!(
        "wss://api.deepgram.com/v1/listen?model={}&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&endpointing={}",
        cfg.model,
        cfg.endpointing_ms,
    );
    if let Some(lang) = cfg.language.as_deref().filter(|s| !s.is_empty() && *s != "auto") {
        url.push_str("&language=");
        url.push_str(lang);
    }
    url
}
```

Add service scaffolding:

```rust
pub struct DeepgramLiveService {
    app: AppHandle,
    inner: Arc<Mutex<LiveInner>>,
}

struct LiveInner {
    state: LiveState,
    recorder: Option<SendLiveRecorder>,
    task: Option<JoinHandle<()>>,
    committed_text: String,
    model: Option<String>,
    started_at: Option<Instant>,
}

struct SendLiveRecorder(LiveRecorder);
unsafe impl Send for SendLiveRecorder {}

impl DeepgramLiveService {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            inner: Arc::new(Mutex::new(LiveInner {
                state: LiveState::Idle,
                recorder: None,
                task: None,
                committed_text: String::new(),
                model: None,
                started_at: None,
            })),
        }
    }

    pub async fn current_state(&self) -> LiveState {
        self.inner.lock().await.state
    }

    pub async fn status(&self) -> serde_json::Value {
        let g = self.inner.lock().await;
        serde_json::json!({
            "state": g.state.as_str(),
            "model": g.model,
            "committed_text": g.committed_text,
        })
    }
}
```

- [ ] **Step 5: Add command stubs**

In `desktop-rust/src-tauri/src/commands/whisper.rs`, import `DeepgramLiveService`:

```rust
use crate::whisper::deepgram::{DeepgramConfig, DeepgramLiveService};
```

Add commands:

```rust
fn deepgram_config_from_settings(db: &DbState) -> Result<DeepgramConfig, String> {
    let conn = db.lock_recover();
    let cid = computer_id();
    let api_key = queries::get_setting(&conn, &cid, "whisper.deepgram_api_key")
        .ok()
        .flatten()
        .unwrap_or_default();
    if api_key.trim().is_empty() {
        return Err("Deepgram API key is missing. Open Whisper Settings and add a local Deepgram key.".into());
    }
    let model = queries::get_setting(&conn, &cid, "whisper.deepgram_model")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "nova-3".into());
    let endpointing_ms = queries::get_setting(&conn, &cid, "whisper.deepgram_endpointing_ms")
        .ok()
        .flatten()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(300);
    let restore = queries::get_setting(&conn, &cid, "whisper.clipboard_restore_delay_ms")
        .ok()
        .flatten()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(200);
    let mic_device = queries::get_setting(&conn, &cid, "whisper.mic_device")
        .ok()
        .flatten()
        .filter(|s| !s.is_empty());
    let language = queries::get_setting(&conn, &cid, "whisper.language")
        .ok()
        .flatten()
        .filter(|s| !s.is_empty());
    Ok(DeepgramConfig {
        api_key,
        model,
        language,
        endpointing_ms,
        clipboard_restore_delay_ms: restore,
        mic_device,
    })
}

#[tauri::command]
pub async fn whisper_live_start(
    db: State<'_, DbState>,
    svc: State<'_, DeepgramLiveService>,
) -> Result<(), String> {
    let cfg = deepgram_config_from_settings(&db)?;
    svc.start(cfg).await
}

#[tauri::command]
pub async fn whisper_live_stop(
    db: State<'_, DbState>,
    svc: State<'_, DeepgramLiveService>,
) -> Result<String, String> {
    svc.stop_and_persist(&db).await
}

#[tauri::command]
pub async fn whisper_live_cancel(svc: State<'_, DeepgramLiveService>) -> Result<(), String> {
    svc.cancel().await;
    Ok(())
}

#[tauri::command]
pub async fn whisper_live_status(svc: State<'_, DeepgramLiveService>) -> Result<serde_json::Value, String> {
    Ok(svc.status().await)
}
```

The `start`, `stop_and_persist`, and `cancel` methods are implemented in Task 6.

- [ ] **Step 6: Register managed service and commands**

In `desktop-rust/src-tauri/src/lib.rs`, in `.setup`, after `WhisperService`:

```rust
let dsvc = crate::whisper::deepgram::DeepgramLiveService::new(app.handle().clone());
app.manage(dsvc);
```

In `invoke_handler`, register:

```rust
commands::whisper::whisper_live_start,
commands::whisper::whisper_live_stop,
commands::whisper::whisper_live_cancel,
commands::whisper::whisper_live_status,
```

- [ ] **Step 7: Run compile check for expected missing methods**

Run:

```bash
cd desktop-rust/src-tauri
cargo check
```

Expected: fail only on missing `DeepgramLiveService::start`, `stop_and_persist`, and `cancel`.

Do not commit this task until Task 6 implements those methods and `cargo check` passes.

## Task 6: Implement Deepgram WebSocket Streaming

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/deepgram.rs`
- Modify: `desktop-rust/src-tauri/src/db/queries.rs`

- [ ] **Step 1: Implement `start`**

Add to `impl DeepgramLiveService`:

```rust
pub async fn start(&self, cfg: DeepgramConfig) -> Result<(), String> {
    if cfg.api_key.trim().is_empty() {
        return Err("Deepgram API key is missing. Open Whisper Settings and add a local Deepgram key.".into());
    }

    let (audio_tx, mut audio_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<i16>>();
    let recorder = LiveRecorder::start(self.app.clone(), cfg.mic_device.as_deref(), audio_tx)?;

    {
        let mut g = self.inner.lock().await;
        if !matches!(g.state, LiveState::Idle | LiveState::Error) {
            return Ok(());
        }
        g.state = LiveState::Connecting;
        g.recorder = Some(SendLiveRecorder(recorder));
        g.committed_text.clear();
        g.model = Some(cfg.model.clone());
        g.started_at = Some(Instant::now());
    }
    emit_live_state(&self.app, LiveState::Connecting, Some(cfg.model.clone()));

    let app = self.app.clone();
    let inner = self.inner.clone();
    let task_cfg = cfg.clone();
    let handle = tokio::spawn(async move {
        if let Err(e) = run_deepgram_stream(app.clone(), inner.clone(), task_cfg, &mut audio_rx).await {
            let _ = app.emit(EVT_LIVE_ERROR, serde_json::json!({ "message": e }));
            let mut g = inner.lock().await;
            g.state = LiveState::Error;
            g.recorder = None;
            emit_live_state(&app, LiveState::Error, g.model.clone());
        }
    });

    let mut g = self.inner.lock().await;
    if let Some(old) = g.task.replace(handle) {
        old.abort();
    }
    Ok(())
}
```

- [ ] **Step 2: Implement stream runner**

Add:

```rust
async fn run_deepgram_stream(
    app: AppHandle,
    inner: Arc<Mutex<LiveInner>>,
    cfg: DeepgramConfig,
    audio_rx: &mut tokio::sync::mpsc::UnboundedReceiver<Vec<i16>>,
) -> Result<(), String> {
    let url = build_deepgram_url(&cfg);
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("deepgram request: {e}"))?;
    request.headers_mut().insert(
        "Authorization",
        format!("Token {}", cfg.api_key.trim())
            .parse()
            .map_err(|e| format!("deepgram auth header: {e}"))?,
    );

    let (ws, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| format!("deepgram websocket: {e}"))?;
    let (mut sink, mut stream) = ws.split();

    {
        let mut g = inner.lock().await;
        g.state = LiveState::Streaming;
    }
    emit_live_state(&app, LiveState::Streaming, Some(cfg.model.clone()));

    loop {
        tokio::select! {
            maybe_samples = audio_rx.recv() => {
                match maybe_samples {
                    Some(samples) if !samples.is_empty() => {
                        sink.send(Message::Binary(pcm_i16_to_le_bytes(&samples))).await
                            .map_err(|e| format!("deepgram audio send: {e}"))?;
                    }
                    Some(_) => {}
                    None => {
                        sink.send(Message::Text(r#"{"type":"Finalize"}"#.to_string())).await
                            .map_err(|e| format!("deepgram finalize: {e}"))?;
                        break;
                    }
                }
            }
            maybe_msg = stream.next() => {
                let Some(msg) = maybe_msg else { break; };
                let msg = msg.map_err(|e| format!("deepgram receive: {e}"))?;
                if let Message::Text(text) = msg {
                    handle_deepgram_text_message(&app, &inner, &cfg, &text).await?;
                }
            }
        }
    }

    while let Some(msg) = stream.next().await {
        let msg = msg.map_err(|e| format!("deepgram drain: {e}"))?;
        if let Message::Text(text) = msg {
            handle_deepgram_text_message(&app, &inner, &cfg, &text).await?;
        }
    }
    Ok(())
}
```

- [ ] **Step 3: Implement message handler**

Add:

```rust
async fn handle_deepgram_text_message(
    app: &AppHandle,
    inner: &Arc<Mutex<LiveInner>>,
    cfg: &DeepgramConfig,
    text: &str,
) -> Result<(), String> {
    let Some(parsed) = parse_deepgram_message(text)? else {
        return Ok(());
    };

    if !parsed.is_final {
        let _ = app.emit(EVT_LIVE_INTERIM, serde_json::json!({
            "text": parsed.transcript,
            "speech_final": parsed.speech_final,
        }));
        return Ok(());
    }

    let paste_text = {
        let mut g = inner.lock().await;
        let chunk = build_paste_chunk(&g.committed_text, &parsed.transcript);
        g.committed_text.push_str(&chunk);
        chunk
    };

    if !paste_text.trim().is_empty() {
        inject::paste_chunk(&paste_text, cfg.clipboard_restore_delay_ms).await?;
        let committed = inner.lock().await.committed_text.clone();
        let _ = app.emit(EVT_LIVE_FINAL, serde_json::json!({
            "chunk": paste_text,
            "committed_text": committed,
            "speech_final": parsed.speech_final,
        }));
    }
    Ok(())
}
```

- [ ] **Step 4: Implement stop and persist**

Add:

```rust
pub async fn stop_and_persist(&self, db: &crate::db::DbState) -> Result<String, String> {
    let (text, model, duration_ms, task) = {
        let mut g = self.inner.lock().await;
        g.state = LiveState::Stopping;
        emit_live_state(&self.app, LiveState::Stopping, g.model.clone());
        g.recorder = None;
        let duration_ms = g.started_at.map(|t| t.elapsed().as_millis() as i64).unwrap_or(0);
        (g.committed_text.clone(), g.model.clone().unwrap_or_else(|| "nova-3".into()), duration_ms, g.task.take())
    };

    if let Some(task) = task {
        let _ = tokio::time::timeout(std::time::Duration::from_secs(8), task).await;
    }

    if !text.trim().is_empty() {
        let conn = db.lock_recover();
        let _ = crate::db::queries::whisper_insert_history_with_provider(
            &conn,
            &text,
            None,
            &model,
            "deepgram",
            Some(&model),
            duration_ms,
            0,
            None,
            Some("paste"),
            0.0,
            0.0,
            0,
        )
        .map_err(|e| e.to_string())?;
    }

    {
        let mut g = self.inner.lock().await;
        g.state = LiveState::Idle;
        g.recorder = None;
        g.started_at = None;
    }
    emit_live_state(&self.app, LiveState::Idle, None);
    Ok(text)
}
```

- [ ] **Step 5: Implement cancel**

Add:

```rust
pub async fn cancel(&self) {
    let task = {
        let mut g = self.inner.lock().await;
        g.recorder = None;
        g.committed_text.clear();
        g.state = LiveState::Idle;
        g.started_at = None;
        g.task.take()
    };
    if let Some(task) = task {
        task.abort();
    }
    emit_live_state(&self.app, LiveState::Idle, None);
}
```

Add helper:

```rust
fn emit_live_state(app: &AppHandle, state: LiveState, model: Option<String>) {
    let _ = app.emit(EVT_LIVE_STATE, serde_json::json!({
        "state": state.as_str(),
        "model": model,
    }));
}
```

- [ ] **Step 6: Run Rust checks**

Run:

```bash
cd desktop-rust/src-tauri
cargo check
cargo test whisper::deepgram --lib
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add desktop-rust/src-tauri/Cargo.toml desktop-rust/src-tauri/Cargo.lock desktop-rust/src-tauri/src/whisper/deepgram.rs desktop-rust/src-tauri/src/commands/whisper.rs desktop-rust/src-tauri/src/lib.rs desktop-rust/src-tauri/src/db/queries.rs
git commit -m "add deepgram live service"
```

## Task 7: Add Frontend API, Mock, And Settings

**Files:**
- Modify: `desktop-rust/src/tabs/whisper/whisper-api.js`
- Modify: `desktop-rust/src/tabs/whisper/whisper-settings.js`
- Modify: `desktop-rust/src/dev-mock.js`

- [ ] **Step 1: Add API wrapper**

In `desktop-rust/src/tabs/whisper/whisper-api.js`, add under recording:

```js
  startLive: () => call('whisper_live_start'),
  stopLive: () => call('whisper_live_stop'),
  cancelLive: () => call('whisper_live_cancel'),
  liveStatus: () => call('whisper_live_status'),
```

Extend `EVENTS`:

```js
  liveStateChanged: 'whisper:live-state-changed',
  liveLevel: 'whisper:live-level',
  liveInterim: 'whisper:live-interim',
  liveFinal: 'whisper:live-final',
  liveError: 'whisper:live-error',
```

- [ ] **Step 2: Add settings keys**

In `desktop-rust/src/tabs/whisper/whisper-settings.js`, add keys to `loadAllSettings()`:

```js
'whisper.deepgram_api_key','whisper.deepgram_model','whisper.deepgram_endpointing_ms',
```

Add this block before `Overlay`:

```js
content.appendChild(deepgramBlock(s));
```

Add helper:

```js
function deepgramBlock(s) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px;border:1px dashed var(--border,#30363d);border-radius:4px';

  const title = document.createElement('div');
  title.textContent = 'Deepgram Live Dictate';
  title.style.cssText = 'color:var(--text-muted,#8b949e);font-size:11px;text-transform:uppercase;letter-spacing:.5px';
  wrap.appendChild(title);

  const note = document.createElement('div');
  note.textContent = 'API key is stored locally on this desktop and is not synced.';
  note.style.cssText = 'font-size:11px;color:var(--text-muted,#8b949e)';
  wrap.appendChild(note);

  const key = textInput('deepgram_api_key', s['whisper.deepgram_api_key'] || '', 'Deepgram API key');
  key.type = 'password';
  key.dataset.key = 'whisper.deepgram_api_key';
  wrap.appendChild(section('API key', key));

  const model = textInput('deepgram_model', s['whisper.deepgram_model'] || 'nova-3', 'nova-3');
  model.dataset.key = 'whisper.deepgram_model';
  wrap.appendChild(section('Model', model));

  const endpoint = numInput('deepgram_endpointing_ms', s['whisper.deepgram_endpointing_ms'] || '300', 10, 1000, 10);
  endpoint.dataset.key = 'whisper.deepgram_endpointing_ms';
  wrap.appendChild(section('Endpointing ms', endpoint));

  return wrap;
}
```

- [ ] **Step 3: Add mock state and handlers**

In `desktop-rust/src/dev-mock.js`, extend `whisperMockState` with:

```js
liveState: 'idle',
liveTimer: null,
liveCommittedText: '',
liveInterimIndex: 0,
```

Add handlers:

```js
whisper_live_start() {
  const key = (storeGet('settings', {})['whisper.deepgram_api_key'] || '');
  if (!key.trim()) throw new Error('Deepgram API key is missing. Open Whisper Settings and add a local Deepgram key.');
  whisperMockState.liveState = 'streaming';
  whisperMockState.liveCommittedText = '';
  whisperMockState.liveInterimIndex = 0;
  window.dispatchEvent(new CustomEvent('whisper:live-state-changed', { detail: { state: 'streaming', model: 'nova-3' } }));
  const interims = ['привет', 'привет мир', 'привет мир это'];
  whisperMockState.liveTimer = setInterval(() => {
    const text = interims[Math.min(whisperMockState.liveInterimIndex, interims.length - 1)];
    whisperMockState.liveInterimIndex += 1;
    window.dispatchEvent(new CustomEvent('whisper:live-interim', { detail: { text, speech_final: false } }));
    window.dispatchEvent(new CustomEvent('whisper:live-level', { detail: { rms: 0.25 + Math.random() * 0.3 } }));
  }, 120);
  return null;
},
async whisper_live_stop() {
  if (whisperMockState.liveTimer) clearInterval(whisperMockState.liveTimer);
  whisperMockState.liveTimer = null;
  whisperMockState.liveState = 'stopping';
  window.dispatchEvent(new CustomEvent('whisper:live-state-changed', { detail: { state: 'stopping', model: 'nova-3' } }));
  await new Promise(r => setTimeout(r, 120));
  const text = 'привет мир это live диктовка';
  whisperMockState.liveCommittedText = text;
  window.dispatchEvent(new CustomEvent('whisper:live-final', { detail: { chunk: text, committed_text: text, speech_final: true } }));
  whisperMockState.history.unshift({
    id: Date.now(),
    text,
    text_raw: null,
    model_name: 'nova-3',
    provider: 'deepgram',
    provider_model: 'nova-3',
    duration_ms: 2500,
    transcribe_ms: 0,
    language: 'ru',
    injected_to: 'paste',
    created_at: Math.floor(Date.now() / 1000),
  });
  whisperMockState.liveState = 'idle';
  window.dispatchEvent(new CustomEvent('whisper:live-state-changed', { detail: { state: 'idle', model: null } }));
  return text;
},
whisper_live_cancel() {
  if (whisperMockState.liveTimer) clearInterval(whisperMockState.liveTimer);
  whisperMockState.liveTimer = null;
  whisperMockState.liveState = 'idle';
  whisperMockState.liveCommittedText = '';
  window.dispatchEvent(new CustomEvent('whisper:live-state-changed', { detail: { state: 'idle', model: null } }));
  return null;
},
whisper_live_status() {
  return { state: whisperMockState.liveState, model: 'nova-3', committed_text: whisperMockState.liveCommittedText };
},
```

- [ ] **Step 4: Run syntax checks**

Run:

```bash
node --check desktop-rust/src/tabs/whisper/whisper-api.js
node --check desktop-rust/src/tabs/whisper/whisper-settings.js
node --check desktop-rust/src/dev-mock.js
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add desktop-rust/src/tabs/whisper/whisper-api.js desktop-rust/src/tabs/whisper/whisper-settings.js desktop-rust/src/dev-mock.js
git commit -m "add deepgram live settings"
```

## Task 8: Add Live Dictate Header And UI State

**Files:**
- Modify: `desktop-rust/src/tabs/whisper/whisper-tab.js`
- Modify: `desktop-rust/src/tabs/whisper/whisper-overlay.js`

- [ ] **Step 1: Add failing browser smoke tests**

In `desktop-rust/src/dev-test.py`, add tests after current Whisper tests:

```python
async def t21h_whisper_live_dictate_toggle():
    await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"whisper\"]').click()")
    await wait_until(cdp, "!!document.querySelector('#live-dictate-toggle')", timeout=5)
    checked = await cdp.eval("document.querySelector('#live-dictate-toggle').checked")
    assert checked is False
    await cdp.eval("document.querySelector('#live-dictate-toggle').click()")
    label = await cdp.eval("document.querySelector('#record-btn').textContent")
    assert 'live' in label.lower()

await check('T21h Whisper live dictate toggle', t21h_whisper_live_dictate_toggle)

async def t21i_whisper_live_dictate_mock_flow():
    await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"whisper\"]').click()")
    await wait_until(cdp, "!!document.querySelector('#live-dictate-toggle')", timeout=5)
    await cdp.eval("window.__TAURI__.core.invoke('set_setting', { key: 'whisper.deepgram_api_key', value: 'mock-key' })")
    await cdp.eval("document.querySelector('#live-dictate-toggle').click()")
    await cdp.eval("document.querySelector('#record-btn').click()")
    await wait_until(cdp, "document.querySelector('#state-chip')?.textContent.includes('streaming')", timeout=5)
    await wait_until(cdp, "document.querySelector('#live-interim')?.textContent.includes('привет')", timeout=5)
    await cdp.eval("document.querySelector('#record-btn').click()")
    await wait_until(cdp, "document.body.innerText.includes('live диктовка')", timeout=5)

await check('T21i Whisper live dictate mock flow', t21i_whisper_live_dictate_mock_flow)
```

- [ ] **Step 2: Run smoke tests and verify RED**

Run:

```bash
cd desktop-rust/src
python3 dev-test.py
```

Expected: fail because `#live-dictate-toggle` and live UI state do not exist.

- [ ] **Step 3: Add header checkbox**

In `desktop-rust/src/tabs/whisper/whisper-tab.js`, add to header HTML near model controls:

```html
<label id="live-dictate-wrap" title="Live dictate: stream speech through Deepgram and insert finalized chunks into the active app" style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--bg,#0d1117);border:1px solid var(--border,#30363d);border-radius:6px;color:var(--text,#c9d1d9);font-size:12px;cursor:pointer">
  <input id="live-dictate-toggle" type="checkbox" style="accent-color:var(--accent,#388bfd)">
  <span>Live dictate</span>
</label>
```

In JS variables:

```js
const liveToggle = header.querySelector('#live-dictate-toggle');
```

Add state fields:

```js
liveMode: false,
liveState: 'idle',
liveCommittedText: '',
liveInterimText: '',
```

Add a live interim element in the detail panel:

```js
const liveInterim = document.createElement('div');
liveInterim.id = 'live-interim';
liveInterim.style.cssText = 'display:none;padding:8px 10px;border:1px solid var(--border,#30363d);border-radius:4px;background:var(--bg-secondary,#161b22);color:var(--text-muted,#8b949e);font-size:12px';
liveInterim.textContent = '';
whisperPane.insertBefore(liveInterim, whisperTextarea);
```

- [ ] **Step 4: Route Record button by live mode**

Replace `recordBtn.onclick` with:

```js
recordBtn.onclick = async () => {
  if (recordBtn.disabled || recordBtn.dataset.mode === 'noop') return;
  try {
    if (state.liveMode) {
      if (recordBtn.dataset.mode === 'live-stop') {
        await whisperApi.stopLive();
        await reloadHistory();
      } else {
        await whisperApi.startLive();
      }
      return;
    }

    if (recordBtn.dataset.mode === 'stop') {
      await whisperApi.stopRecording();
      await reloadHistory();
    } else {
      await whisperApi.startRecording();
    }
  } catch (e) {
    alert(`Whisper error: ${e}`);
  }
};
```

Add toggle handler:

```js
liveToggle.onchange = () => {
  state.liveMode = liveToggle.checked;
  updateRecordButtonForMode();
};
```

Add helper:

```js
function updateRecordButtonForMode() {
  if (state.liveMode) {
    if (state.liveState === 'streaming') {
      recordBtn.textContent = '⏹ Stop live';
      recordBtn.dataset.mode = 'live-stop';
      recordBtn.disabled = false;
    } else if (state.liveState === 'connecting' || state.liveState === 'stopping') {
      recordBtn.textContent = state.liveState === 'connecting' ? '… Connecting' : '… Stopping';
      recordBtn.dataset.mode = 'noop';
      recordBtn.disabled = true;
    } else {
      recordBtn.textContent = '🎙 Start live';
      recordBtn.dataset.mode = 'live-start';
      recordBtn.disabled = false;
    }
    return;
  }
  setChip(state.currentState || 'idle');
}
```

Call `updateRecordButtonForMode()` at the end of `setChip(st)`.

- [ ] **Step 5: Add live event listeners**

Add after existing Whisper event listeners:

```js
const offLiveState = await onWhisperEvent('liveStateChanged', (p) => {
  state.liveState = p.state || 'idle';
  const active = ['connecting', 'streaming', 'stopping'].includes(state.liveState);
  liveToggle.disabled = active || ['warming', 'recording', 'transcribing', 'unloading'].includes(state.currentState);
  chip.textContent = active ? `● live ${state.liveState}` : (state.currentState === 'idle' ? '○ idle' : chip.textContent);
  liveInterim.style.display = active ? '' : 'none';
  updateRecordButtonForMode();
});
state.cleanup.push(offLiveState);

const offLiveInterim = await onWhisperEvent('liveInterim', (p) => {
  state.liveInterimText = p.text || '';
  liveInterim.style.display = '';
  liveInterim.textContent = state.liveInterimText;
});
state.cleanup.push(offLiveInterim);

const offLiveFinal = await onWhisperEvent('liveFinal', (p) => {
  state.liveCommittedText = p.committed_text || state.liveCommittedText;
  whisperTextarea.value = state.liveCommittedText;
  liveInterim.textContent = '';
});
state.cleanup.push(offLiveFinal);

const offLiveError = await onWhisperEvent('liveError', (p) => {
  alert(`Deepgram live error: ${p.message || p}`);
});
state.cleanup.push(offLiveError);
```

- [ ] **Step 6: Add overlay live states**

In `desktop-rust/src/tabs/whisper/whisper-overlay.js`, listen to live events:

```js
await onWhisperEvent('liveStateChanged', (p) => {
  if (p.state === 'connecting') {
    titleEl.textContent = 'Connecting Deepgram…';
    progress.style.display = 'block';
    progressBar.style.width = '35%';
  } else if (p.state === 'streaming') {
    titleEl.textContent = 'Live dictation';
    bars.style.display = 'flex';
    dot.classList.add('rec');
  } else if (p.state === 'stopping') {
    titleEl.textContent = 'Finishing live…';
    progress.style.display = 'block';
    progressBar.style.width = '80%';
  } else if (p.state === 'idle') {
    setMode('idle');
  }
});
await onWhisperEvent('liveInterim', (p) => {
  sub.textContent = p.text || '';
});
await onWhisperEvent('liveFinal', (p) => {
  const text = p.committed_text || '';
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  sub.textContent = `${words} committed words`;
});
```

- [ ] **Step 7: Run frontend checks**

Run:

```bash
node --check desktop-rust/src/tabs/whisper/whisper-tab.js
node --check desktop-rust/src/tabs/whisper/whisper-overlay.js
cd desktop-rust/src && python3 dev-test.py
```

Expected: `node --check` passes and `dev-test.py` includes passing `T21h Whisper live dictate toggle` and `T21i Whisper live dictate mock flow` lines.

- [ ] **Step 8: Commit**

```bash
git add desktop-rust/src/tabs/whisper/whisper-tab.js desktop-rust/src/tabs/whisper/whisper-overlay.js desktop-rust/src/dev-test.py
git commit -m "add whisper live dictate ui"
```

## Task 9: Help, Release Notes, And Final Verification

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `FRONTEND_PATTERNS.md` only if a reusable new UI pattern emerges during implementation.

- [ ] **Step 1: Update Help text**

In `desktop-rust/src/tabs/help.js`, update `shortcuts_desc` is not relevant. Update `whisper_desc` or the Whisper feature description in both `en` and `ru` dictionaries. Include:

English sentence:

```text
Whisper can use local offline models for batch transcription or Deepgram Live Dictate for cloud streaming; Live Dictate shows interim text in the overlay and pastes only finalized chunks into the active app.
```

Russian sentence:

```text
Whisper умеет работать с локальными offline-моделями для batch-распознавания или с Deepgram Live Dictate для облачного стриминга; Live Dictate показывает interim-текст в overlay и вставляет в активное приложение только финализированные фрагменты.
```

- [ ] **Step 2: Prepare release history**

Choose the next native version by reading current `desktop-rust/src-tauri/Cargo.toml`. If current version is `1.3.36`, use `1.3.37`.

Add to top of `desktop-rust/CHANGELOG.md`:

```markdown
## v1.3.37 (2026-05-27)

- **Deepgram Live Dictate:** Whisper can now stream speech through Deepgram from the desktop app, show interim recognition live, and paste only finalized chunks into the active application while preserving local Whisper as the offline batch path.
```

Add the same section to `desktop-rust/src/release-history.md`.

- [ ] **Step 3: Bump native version**

Update:

- `desktop-rust/src-tauri/Cargo.toml`: `version = "1.3.37"`
- `desktop-rust/src-tauri/tauri.conf.json`: `"version": "1.3.37"`

- [ ] **Step 4: Run complete local verification**

Run:

```bash
cd desktop-rust/src-tauri
cargo check
cargo test whisper::audio whisper::inject whisper::deepgram whisper_crud_tests --lib
cd ../src
node --check tabs/whisper/whisper-api.js
node --check tabs/whisper/whisper-settings.js
node --check tabs/whisper/whisper-tab.js
node --check tabs/whisper/whisper-overlay.js
node --check tabs/help.js
node --check dev-mock.js
python3 dev-test.py
```

Expected:

- `cargo check` exits 0.
- Rust tests pass.
- all `node --check` commands exit 0.
- `dev-test.py` prints `=== N/N passed ===`.

- [ ] **Step 5: Optional manual Deepgram test**

If a valid Deepgram key is available locally:

1. Open desktop dev/native app.
2. Add Deepgram key in Whisper Settings.
3. Enable `Live dictate`.
4. Focus Telegram message input.
5. Press the Whisper hotkey.
6. Dictate a short Russian sentence.
7. Stop live dictation.

Expected:

- overlay shows interim text during speech;
- Telegram receives only stable finalized chunks;
- history contains one `deepgram` row with `provider_model='nova-3'`.

- [ ] **Step 6: Commit final release-prep changes**

```bash
git add desktop-rust/src/tabs/help.js desktop-rust/CHANGELOG.md desktop-rust/src/release-history.md desktop-rust/src-tauri/Cargo.toml desktop-rust/src-tauri/Cargo.lock desktop-rust/src-tauri/tauri.conf.json
git commit -m "prepare deepgram live dictation release"
```

## Task 10: Release

**Files:**
- No code edits unless verification reveals a release-blocking issue.

- [ ] **Step 1: Confirm clean working tree**

Run:

```bash
git status --short
```

Expected: no output.

- [ ] **Step 2: Push main**

Run:

```bash
GIT_SSH_COMMAND='ssh -F /dev/null -i /home/aster/.ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' git push origin main
```

Expected: push succeeds.

- [ ] **Step 3: Tag native release**

Run:

```bash
git tag v1.3.37
GIT_SSH_COMMAND='ssh -F /dev/null -i /home/aster/.ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' git push origin v1.3.37
```

Expected: tag push succeeds and GitHub Actions starts the desktop release workflow.

- [ ] **Step 4: Monitor CI**

Run:

```bash
wget --header='Accept: application/vnd.github+json' --header='User-Agent: codex' -qO- https://api.github.com/repos/IgorSterkhov/snippets_helper/actions/runs?per_page=5
```

Expected: latest `Release Desktop (Rust)` run for `v1.3.37` has `status=completed` and `conclusion=success`.

- [ ] **Step 5: Verify release manifest**

Run:

```bash
wget -qO- https://github.com/IgorSterkhov/snippets_helper/releases/download/v1.3.37/frontend-version.json
```

Expected: JSON version starts with `1.3.37`.

- [ ] **Step 6: Report result**

Report:

- commit SHA;
- tag;
- CI result;
- local verification commands;
- any manual Deepgram test result or state that no API key was available for manual live verification.
