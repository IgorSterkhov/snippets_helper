//! Owns the state machine for whisper. Lazy-start, idle-timeout unload,
//! early-stop buffering during warm-up, cancellation safety.

use crate::whisper::audio::Recorder;
use crate::whisper::bin_manager::{self, BinVariant};
use crate::whisper::events::{self, StatePayload};
use crate::whisper::server::{InferenceResult, WhisperServer};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Idle,
    Warming,
    Ready,
    Recording,
    Transcribing,
    Unloading,
}
impl State {
    pub fn as_str(&self) -> &'static str {
        match self {
            State::Idle => "idle",
            State::Warming => "warming",
            State::Ready => "ready",
            State::Recording => "recording",
            State::Transcribing => "transcribing",
            State::Unloading => "unloading",
        }
    }
}

/// Outcome of a successful stop_recording call — carries the durations so the
/// command layer can write them to history and emit a correct
/// TranscribedPayload (fix F4).
#[derive(Debug, Clone)]
pub struct StopOutcome {
    pub result: InferenceResult,
    pub duration_ms: u64,
    pub transcribe_ms: u64,
    pub model_name: String,
}

pub struct WhisperService {
    inner: Arc<Mutex<Inner>>,
    app: AppHandle,
}

/// cpal::Stream contains PhantomData<*mut ()> as a conservative !Send marker,
/// but the stream is protected by the tokio Mutex and never accessed from
/// multiple threads simultaneously. SAFETY: all access is serialised.
struct SendRecorder(Recorder);
// SAFETY: cpal::Stream is !Send only on some platforms as a conservative
// guard; actual concurrent access is prevented by our Mutex.
unsafe impl Send for SendRecorder {}

struct Inner {
    state: State,
    server: Option<WhisperServer>,
    model_path: Option<PathBuf>,
    model_name: Option<String>,
    recorder: Option<SendRecorder>,
    idle_timer: Option<JoinHandle<()>>,
    pending_stop: bool, // user hit stop while warming
    cancelled: bool,    // user cancelled while warming (fix F5)
    idle_timeout: Duration,
}

impl WhisperService {
    pub fn new(app: AppHandle) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                state: State::Idle,
                server: None,
                model_path: None,
                model_name: None,
                recorder: None,
                idle_timer: None,
                pending_stop: false,
                cancelled: false,
                idle_timeout: Duration::from_secs(300),
            })),
            app,
        }
    }

    pub async fn set_idle_timeout(&self, dur: Duration) {
        self.inner.lock().await.idle_timeout = dur;
    }

    /// Called by `whisper_start_recording` command.
    /// Starts cpal recorder immediately, lazy-starts whisper-server.
    pub async fn start_recording(
        &self,
        model_path: PathBuf,
        model_name: String,
        device_name: Option<String>,
    ) -> Result<(), String> {
        let mut g = self.inner.lock().await;
        // Idempotent: double-clicks / duplicate hotkey events while we're
        // already warming, recording or transcribing are silently ignored
        // instead of erroring. The UI also disables the button in those
        // states, but race conditions between state-changed events and a
        // stale button click can still get here.
        if matches!(
            g.state,
            State::Warming | State::Recording | State::Transcribing | State::Unloading
        ) {
            return Ok(());
        }
        if let Some(t) = g.idle_timer.take() { t.abort(); }

        let rec = Recorder::start(self.app.clone(), device_name.as_deref())?;
        g.recorder = Some(SendRecorder(rec));
        // reset stale flags from previous cycles
        g.pending_stop = false;
        g.cancelled = false;

        match g.state {
            State::Idle => {
                g.model_path = Some(model_path.clone());
                g.model_name = Some(model_name.clone());
                g.state = State::Warming;
                emit_state(&self.app, g.state, g.model_name.clone());
                position_overlay(&self.app, "bottom-right");
                show_overlay(&self.app);
                drop(g);

                let app = self.app.clone();
                let inner = self.inner.clone();
                tokio::spawn(async move {
                    let variant = match bin_manager::downloaded_gpu_bin(&app_data_dir(&app)) {
                        Some(p) => BinVariant::DownloadedGpu { path: p },
                        None => BinVariant::BundledCpu,
                    };
                    let server_result = WhisperServer::spawn(&app, &variant, &model_path).await;
                    let mut g = inner.lock().await;
                    match server_result {
                        Ok(server) => {
                            g.server = Some(server);
                            // Transition based on what happened during warm-up (fix F5)
                            if g.cancelled {
                                g.cancelled = false;
                                g.state = State::Ready;
                                emit_state(&app, g.state, g.model_name.clone());
                                // arm idle timer inline
                                let inner_c = inner.clone();
                                let app_c = app.clone();
                                let timeout_dur = g.idle_timeout;
                                let handle = tokio::spawn(async move {
                                    tokio::time::sleep(timeout_dur).await;
                                    let mut g = inner_c.lock().await;
                                    if matches!(g.state, State::Ready) {
                                        g.state = State::Unloading;
                                        emit_state(&app_c, g.state, None);
                                        if let Some(srv) = g.server.take() { srv.shutdown(); }
                                        g.state = State::Idle;
                                        g.model_path = None;
                                        g.model_name = None;
                                        emit_state(&app_c, g.state, None);
                                        hide_overlay(&app_c);
                                    }
                                });
                                if let Some(old) = g.idle_timer.replace(handle) { old.abort(); }
                            } else if g.pending_stop {
                                g.pending_stop = false;
                                g.state = State::Transcribing;
                                emit_state(&app, g.state, g.model_name.clone());
                            } else {
                                g.state = State::Recording;
                                emit_state(&app, g.state, g.model_name.clone());
                            }
                        }
                        Err(e) => {
                            let _ = app.emit(events::EVT_ERROR, events::ErrorPayload {
                                code: "server_spawn_failed".into(),
                                message: e,
                            });
                            g.state = State::Idle;
                            g.model_path = None;
                            g.model_name = None;
                            g.recorder = None;
                            g.cancelled = false;
                            g.pending_stop = false;
                            emit_state(&app, g.state, None);
                        }
                    }
                });
            }
            State::Ready => {
                g.state = State::Recording;
                emit_state(&self.app, g.state, g.model_name.clone());
                position_overlay(&self.app, "bottom-right");
                show_overlay(&self.app);
            }
            _ => return Err(format!("cannot start from state {:?}", g.state)),
        }
        Ok(())
    }

    /// Called by `whisper_stop_recording`. Returns the full outcome (F4).
    pub async fn stop_recording(&self, language: Option<String>) -> Result<StopOutcome, String> {
        // Extract recorder data in a sync block before any await — Recorder is !Send.
        let (duration_ms, wav, model_name) = {
            let mut g = self.inner.lock().await;
            let rec = g.recorder.take().ok_or_else(|| "not recording".to_string())?.0;
            let name = g.model_name.clone().unwrap_or_default();
            if matches!(g.state, State::Warming) {
                g.pending_stop = true;
            } else {
                g.state = State::Transcribing;
                emit_state(&self.app, g.state, g.model_name.clone());
            }
            // Consume Recorder (finish_wav takes ownership) before first await.
            let dur = rec.duration_ms();
            let w = rec.finish_wav()?;
            (dur, w, name)
        };

        // Wait for server to become available; warm-up task flips state to Transcribing
        let t0 = std::time::Instant::now();
        loop {
            {
                let g = self.inner.lock().await;
                if g.server.is_some() && matches!(g.state, State::Transcribing) {
                    break;
                }
                if matches!(g.state, State::Idle) {
                    return Err("server failed to start".into());
                }
            }
            if t0.elapsed() > Duration::from_secs(60) {
                return Err("timeout waiting for server".into());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        // Inference — keep lock scope tight
        let (result, transcribe_ms) = {
            let g = self.inner.lock().await;
            let server = g.server.as_ref().ok_or_else(|| "no server".to_string())?;
            let start = std::time::Instant::now();
            let r = server.transcribe(wav, language.as_deref()).await?;
            let ms = start.elapsed().as_millis() as u64;
            drop(g);
            (r, ms)
        };

        // Transition to Ready, arm idle timer inline
        {
            let mut g = self.inner.lock().await;
            g.state = State::Ready;
            emit_state(&self.app, g.state, Some(model_name.clone()));
            let inner_c = self.inner.clone();
            let app_c = self.app.clone();
            let timeout_dur = g.idle_timeout;
            let handle = tokio::spawn(async move {
                tokio::time::sleep(timeout_dur).await;
                let mut g = inner_c.lock().await;
                if matches!(g.state, State::Ready) {
                    g.state = State::Unloading;
                    emit_state(&app_c, g.state, None);
                    if let Some(srv) = g.server.take() { srv.shutdown(); }
                    g.state = State::Idle;
                    g.model_path = None;
                    g.model_name = None;
                    emit_state(&app_c, g.state, None);
                    hide_overlay(&app_c);
                }
            });
            if let Some(old) = g.idle_timer.replace(handle) { old.abort(); }
        }

        let app_c = self.app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            hide_overlay(&app_c);
        });

        Ok(StopOutcome {
            result,
            duration_ms,
            transcribe_ms,
            model_name,
        })
    }

    pub async fn unload_now(&self) {
        let mut g = self.inner.lock().await;
        if let Some(t) = g.idle_timer.take() { t.abort(); }
        g.state = State::Unloading;
        emit_state(&self.app, g.state, None);
        if let Some(srv) = g.server.take() { srv.shutdown(); }
        g.state = State::Idle;
        g.model_path = None;
        g.model_name = None;
        emit_state(&self.app, g.state, None);
    }

    /// Cancel an in-flight recording (overlay ✕).
    /// F5: during Warming, we DON'T change state — we set `cancelled = true`
    /// and let the warm-up task land in Ready when the server comes up.
    /// Also calls hide_overlay at the end (relevant in Chunk 11).
    pub async fn cancel_recording(&self) {
        let mut g = self.inner.lock().await;
        g.recorder = None; // drops SendRecorder(Recorder) — stops the cpal stream
        match g.state {
            State::Warming => {
                g.cancelled = true;
                // state stays Warming; warm-up task will transition to Ready
            }
            State::Recording => {
                g.state = State::Ready;
                emit_state(&self.app, g.state, g.model_name.clone());
                // arm idle timer inline
                let inner_c = self.inner.clone();
                let app_c = self.app.clone();
                let timeout_dur = g.idle_timeout;
                let handle = tokio::spawn(async move {
                    tokio::time::sleep(timeout_dur).await;
                    let mut g = inner_c.lock().await;
                    if matches!(g.state, State::Ready) {
                        g.state = State::Unloading;
                        emit_state(&app_c, g.state, None);
                        if let Some(srv) = g.server.take() { srv.shutdown(); }
                        g.state = State::Idle;
                        g.model_path = None;
                        g.model_name = None;
                        emit_state(&app_c, g.state, None);
                        hide_overlay(&app_c);
                    }
                });
                if let Some(old) = g.idle_timer.replace(handle) { old.abort(); }
            }
            _ => {
                // idle, ready, transcribing, unloading — nothing sensible to cancel
            }
        }
        hide_overlay(&self.app);
    }
}

fn emit_state(app: &AppHandle, state: State, model: Option<String>) {
    let _ = app.emit(events::EVT_STATE_CHANGED, StatePayload {
        state: state.as_str().to_string(),
        model,
    });
}

fn app_data_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn overlay_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("whisper-overlay")
}

fn show_overlay(app: &AppHandle) {
    if let Some(w) = overlay_window(app) {
        let _ = w.show();
    }
}

fn position_overlay(app: &AppHandle, corner: &str) {
    let Some(w) = overlay_window(app) else { return; };
    let Ok(Some(mon)) = w.current_monitor() else { return; };
    let size = mon.size();
    let scale = mon.scale_factor();
    let w_w = (260.0 * scale) as i32;
    let w_h = (90.0 * scale) as i32;
    let margin = (16.0 * scale) as i32;
    let (x, y) = match corner {
        "bottom-left"  => (margin, (size.height as i32) - w_h - margin),
        "top-right"    => ((size.width as i32) - w_w - margin, margin),
        "top-left"     => (margin, margin),
        _              => ((size.width as i32) - w_w - margin, (size.height as i32) - w_h - margin), // bottom-right (default)
    };
    let _ = w.set_position(tauri::PhysicalPosition { x, y });
}

fn hide_overlay(app: &AppHandle) {
    if let Some(w) = overlay_window(app) {
        let _ = w.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::State;

    #[test]
    fn state_string_matches_frontend_contract() {
        assert_eq!(State::Idle.as_str(), "idle");
        assert_eq!(State::Warming.as_str(), "warming");
        assert_eq!(State::Ready.as_str(), "ready");
        assert_eq!(State::Recording.as_str(), "recording");
        assert_eq!(State::Transcribing.as_str(), "transcribing");
        assert_eq!(State::Unloading.as_str(), "unloading");
    }
}
