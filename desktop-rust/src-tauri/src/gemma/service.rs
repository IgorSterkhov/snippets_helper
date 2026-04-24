//! GemmaService — lazy-warm the llama-server sidecar on first postprocess(),
//! keep it warm for `idle_timeout`, unload after idle. Much simpler than
//! WhisperService because there's no recording / audio lifecycle — just a
//! single "given text → processed text" RPC.

use crate::gemma::catalog;
use crate::gemma::models;
use crate::gemma::postprocess;
use crate::gemma::server::LlamaServer;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

pub const EVT_STATE: &str = "gemma:state-changed";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State { Idle, Warming, Ready, Busy, Unloading }
impl State {
    pub fn as_str(&self) -> &'static str {
        match self {
            State::Idle => "idle",
            State::Warming => "warming",
            State::Ready => "ready",
            State::Busy => "busy",
            State::Unloading => "unloading",
        }
    }
}

pub struct GemmaService {
    inner: Arc<Mutex<Inner>>,
    app: AppHandle,
}

struct Inner {
    state: State,
    server: Option<LlamaServer>,
    model_path: Option<PathBuf>,
    model_name: Option<String>,
    idle_timer: Option<JoinHandle<()>>,
    idle_timeout: Duration,
}

impl GemmaService {
    pub fn new(app: AppHandle) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                state: State::Idle,
                server: None,
                model_path: None,
                model_name: None,
                idle_timer: None,
                idle_timeout: Duration::from_secs(300),
            })),
            app,
        }
    }

    /// Post-process a Whisper transcript with the currently-active Gemma
    /// model. Warms the server on first call; subsequent calls reuse it
    /// until the idle timer fires.
    pub async fn postprocess(&self, text: &str) -> Result<String, String> {
        if text.trim().is_empty() {
            return Ok(String::new());
        }
        // Ensure server is ready for the chosen model.
        self.ensure_ready().await?;

        self.transition(State::Busy, None).await;
        let result = {
            let inner = self.inner.lock().await;
            let server = inner.server.as_ref().ok_or("server not ready")?;
            let prompt = postprocess::build_prompt(text);
            // n_predict = 2x input tokens + 128 head-room; llama-server stops
            // early on our `stop` markers anyway. Input is voice-length so
            // usually short.
            let budget = (text.chars().count() as i32 * 2 + 128).min(1024);
            server.complete(&prompt, budget).await
        };

        let cleaned = match result {
            Ok(raw) => Ok(postprocess::sanitize_output(&raw)),
            Err(e) => Err(e),
        };

        // Back to Ready + restart idle timer.
        self.transition(State::Ready, self.inner.lock().await.model_name.clone()).await;
        self.arm_idle_timer().await;
        cleaned
    }

    async fn ensure_ready(&self) -> Result<(), String> {
        let (already_ready, desired_model) = {
            let inner = self.inner.lock().await;
            (
                matches!(inner.state, State::Ready | State::Busy)
                    && inner.server.is_some(),
                inner.model_name.clone(),
            )
        };
        if already_ready {
            return Ok(());
        }

        // Pick the default model: whichever is marked is_default OR the
        // recommended one if none set, OR first installed if neither.
        let app_data = self.app.path().app_data_dir().map_err(|e| e.to_string())?;
        let installed = crate::gemma::service::list_installed(&app_data);
        let chosen = desired_model
            .and_then(|n| installed.iter().find(|m| m.name == n).map(|m| m.name.to_string()))
            .or_else(|| installed.first().map(|m| m.name.to_string()))
            .ok_or("no Gemma model installed. Open Settings → Post-processing to install one.")?;

        let meta = catalog::find(&chosen).ok_or("model not in catalog")?;
        let path = models::model_path(&app_data, &chosen);
        if !path.exists() {
            return Err(format!("model file missing: {}", path.display()));
        }

        self.transition(State::Warming, Some(chosen.clone())).await;

        let srv = LlamaServer::spawn(&self.app, &path).await.map_err(|e| {
            // rollback to Idle
            let inner_arc = Arc::clone(&self.inner);
            let app_clone = self.app.clone();
            tokio::spawn(async move {
                let mut g = inner_arc.lock().await;
                g.state = State::Idle;
                let _ = app_clone.emit(EVT_STATE, serde_json::json!({
                    "state": State::Idle.as_str(),
                    "model": serde_json::Value::Null,
                }));
            });
            e
        })?;

        {
            let mut inner = self.inner.lock().await;
            inner.server = Some(srv);
            inner.model_path = Some(path);
            inner.model_name = Some(chosen.clone());
            let _ = meta; // silence unused if future refactor
        }
        self.transition(State::Ready, Some(chosen)).await;
        self.arm_idle_timer().await;
        Ok(())
    }

    pub async fn unload_now(&self) {
        let mut inner = self.inner.lock().await;
        if let Some(h) = inner.idle_timer.take() { h.abort(); }
        if let Some(srv) = inner.server.take() {
            srv.shutdown();
        }
        inner.model_path = None;
        // keep model_name as a hint for next warm
        inner.state = State::Idle;
        drop(inner);
        let _ = self.app.emit(EVT_STATE, serde_json::json!({
            "state": State::Idle.as_str(),
            "model": serde_json::Value::Null,
        }));
    }

    async fn arm_idle_timer(&self) {
        let mut inner = self.inner.lock().await;
        if let Some(h) = inner.idle_timer.take() { h.abort(); }
        let timeout = inner.idle_timeout;
        let inner_arc = Arc::clone(&self.inner);
        let app = self.app.clone();
        inner.idle_timer = Some(tokio::spawn(async move {
            tokio::time::sleep(timeout).await;
            let mut inner = inner_arc.lock().await;
            if !matches!(inner.state, State::Ready) { return; }
            if let Some(srv) = inner.server.take() {
                inner.state = State::Unloading;
                let _ = app.emit(EVT_STATE, serde_json::json!({
                    "state": State::Unloading.as_str(),
                    "model": serde_json::Value::Null,
                }));
                drop(inner);
                srv.shutdown();
                let mut inner = inner_arc.lock().await;
                inner.state = State::Idle;
                inner.model_path = None;
                let _ = app.emit(EVT_STATE, serde_json::json!({
                    "state": State::Idle.as_str(),
                    "model": serde_json::Value::Null,
                }));
            }
        }));
    }

    async fn transition(&self, new_state: State, model: Option<String>) {
        let mut inner = self.inner.lock().await;
        inner.state = new_state;
        drop(inner);
        let model_val = model.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null);
        let _ = self.app.emit(EVT_STATE, serde_json::json!({
            "state": new_state.as_str(),
            "model": model_val,
        }));
    }

    pub async fn current_state(&self) -> State {
        self.inner.lock().await.state
    }

    pub async fn set_default_model(&self, name: &str) -> Result<(), String> {
        if catalog::find(name).is_none() {
            return Err(format!("unknown model: {name}"));
        }
        let mut inner = self.inner.lock().await;
        // If a different model is warmed, shut it down — next postprocess
        // will re-warm with the new choice.
        if inner.model_name.as_deref() != Some(name) {
            if let Some(srv) = inner.server.take() {
                srv.shutdown();
            }
            if let Some(h) = inner.idle_timer.take() { h.abort(); }
            inner.state = State::Idle;
            inner.model_path = None;
        }
        inner.model_name = Some(name.to_string());
        drop(inner);
        let _ = self.app.emit(EVT_STATE, serde_json::json!({
            "state": "idle",
            "model": serde_json::Value::Null,
        }));
        Ok(())
    }
}

/// Synchronous shutdown used on app Exit (we can't await there).
impl GemmaService {
    pub fn shutdown_blocking(&self) {
        if let Ok(mut inner) = self.inner.try_lock() {
            if let Some(srv) = inner.server.take() {
                srv.shutdown();
            }
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct InstalledModel {
    pub name: String,
    pub display_name: String,
    pub size_bytes: u64,
    pub is_default: bool,
}

pub fn list_installed(app_data: &std::path::Path) -> Vec<InstalledModel> {
    let dir = crate::gemma::models::models_dir(app_data);
    if !dir.exists() { return vec![]; }
    let default_name = read_default_model(app_data);
    let mut out = vec![];
    for meta in catalog::CATALOG {
        let p = crate::gemma::models::model_path(app_data, meta.name);
        if p.exists() {
            let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            out.push(InstalledModel {
                name: meta.name.to_string(),
                display_name: meta.display_name.to_string(),
                size_bytes: size,
                is_default: default_name.as_deref() == Some(meta.name),
            });
        }
    }
    // If no default explicitly set but we have models, mark the recommended
    // one (or first) as default.
    if !out.iter().any(|m| m.is_default) {
        if let Some(first) = out.iter_mut().find(|m| catalog::find(&m.name).map(|c| c.recommended).unwrap_or(false))
            .or_else(|| None)
        {
            first.is_default = true;
        } else if let Some(first) = out.first_mut() {
            first.is_default = true;
        }
    }
    out
}

pub fn read_default_model(app_data: &std::path::Path) -> Option<String> {
    let p = app_data.join("gemma-default.txt");
    std::fs::read_to_string(p).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn write_default_model(app_data: &std::path::Path, name: &str) -> std::io::Result<()> {
    let p = app_data.join("gemma-default.txt");
    std::fs::write(p, name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_strings_stable() {
        assert_eq!(State::Idle.as_str(), "idle");
        assert_eq!(State::Warming.as_str(), "warming");
        assert_eq!(State::Ready.as_str(), "ready");
        assert_eq!(State::Busy.as_str(), "busy");
        assert_eq!(State::Unloading.as_str(), "unloading");
    }
}
