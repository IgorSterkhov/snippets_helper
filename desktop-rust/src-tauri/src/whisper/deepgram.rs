use crate::whisper::audio::{pcm_i16_to_le_bytes, LiveRecorder};
use crate::whisper::inject;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

const LIVE_AUDIO_QUEUE_CAPACITY: usize = 64;
const FINALIZE_DRAIN_TIMEOUT: Duration = Duration::from_secs(5);
const CLOSE_FRAME_TIMEOUT: Duration = Duration::from_secs(2);

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
        "wss://api.deepgram.com/v1/listen?model={}&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&punctuate=true&smart_format=true&endpointing={}",
        cfg.model,
        cfg.endpointing_ms,
    );
    if let Some(lang) = cfg
        .language
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "auto")
    {
        url.push_str("&language=");
        url.push_str(lang);
    }
    url
}

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
    language: Option<String>,
    started_at: Option<Instant>,
    session_id: u64,
}

struct SendLiveRecorder(LiveRecorder);
// SAFETY: the live recorder is only stored behind a tokio Mutex and is dropped
// as a whole to stop the underlying cpal stream; no concurrent stream access is
// exposed through this wrapper.
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
                language: None,
                started_at: None,
                session_id: 0,
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

    pub async fn start(&self, cfg: DeepgramConfig) -> Result<(), String> {
        if cfg.api_key.trim().is_empty() {
            return Err(
                "Deepgram API key is missing. Open Whisper Settings and add a local Deepgram key."
                    .into(),
            );
        }

        let (audio_tx, audio_rx) =
            tokio::sync::mpsc::channel::<Vec<i16>>(LIVE_AUDIO_QUEUE_CAPACITY);

        let session_id = {
            let mut g = self.inner.lock().await;
            let Some(session_id) = reserve_live_start(&mut g, &cfg) else {
                return Ok(());
            };
            session_id
        };
        crate::whisper::service::position_overlay(&self.app, "bottom-right");
        crate::whisper::service::show_overlay(&self.app);
        emit_live_state(&self.app, LiveState::Connecting, Some(cfg.model.clone()));

        let recorder_result: Result<SendLiveRecorder, String> =
            LiveRecorder::start_with_level_event(
                self.app.clone(),
                cfg.mic_device.as_deref(),
                audio_tx,
                EVT_LIVE_LEVEL,
            )
            .map(SendLiveRecorder);
        let recorder = match recorder_result {
            Ok(recorder) => recorder,
            Err(e) => {
                let mut g = self.inner.lock().await;
                let emit_error = clear_failed_start_reservation(&mut g, session_id);
                let model = g.model.clone();
                drop(g);
                if emit_error {
                    emit_live_state(&self.app, LiveState::Error, model);
                }
                crate::whisper::service::hide_overlay(&self.app);
                return Err(e);
            }
        };

        {
            let mut g = self.inner.lock().await;
            if !is_start_reservation_current(&g, session_id) {
                return Ok(());
            }
            g.recorder = Some(recorder);
        }

        let app = self.app.clone();
        let inner = self.inner.clone();
        let task_cfg = cfg.clone();
        let handle = tokio::spawn(async move {
            if let Err(e) =
                run_deepgram_stream(app.clone(), inner.clone(), task_cfg, session_id, audio_rx)
                    .await
            {
                crate::whisper::events::emit_to_whisper_windows(
                    &app,
                    EVT_LIVE_ERROR,
                    serde_json::json!({ "message": e }),
                );
                let mut g = inner.lock().await;
                if is_current_session(g.session_id, session_id) {
                    g.state = LiveState::Error;
                    g.recorder = None;
                    g.task = None;
                    emit_live_state(&app, LiveState::Error, g.model.clone());
                }
            } else {
                let mut g = inner.lock().await;
                if is_current_session(g.session_id, session_id)
                    && should_cleanup_completed_task(g.state)
                {
                    crate::whisper::events::emit_to_whisper_windows(
                        &app,
                        EVT_LIVE_ERROR,
                        serde_json::json!({ "message": "Deepgram stream ended unexpectedly" }),
                    );
                    g.state = LiveState::Error;
                    g.recorder = None;
                    g.task = None;
                    emit_live_state(&app, LiveState::Error, g.model.clone());
                }
            }
        });

        let mut g = self.inner.lock().await;
        if is_start_reservation_current(&g, session_id) {
            g.task = Some(handle);
        } else {
            handle.abort();
        }
        Ok(())
    }

    pub async fn stop_and_persist(&self, db: &crate::db::DbState) -> Result<String, String> {
        let (task, model, language, duration_ms, session_id) = {
            let mut g = self.inner.lock().await;
            if matches!(g.state, LiveState::Idle) {
                return Ok(g.committed_text.clone());
            }
            g.state = LiveState::Stopping;
            emit_live_state(&self.app, LiveState::Stopping, g.model.clone());
            g.recorder = None;
            let duration_ms = g
                .started_at
                .map(|t| t.elapsed().as_millis() as i64)
                .unwrap_or(0);
            (
                g.task.take(),
                g.model.clone().unwrap_or_else(|| "nova-3".into()),
                g.language.clone(),
                duration_ms,
                g.session_id,
            )
        };

        if let Some(mut task) = task {
            if tokio::time::timeout(Duration::from_secs(8), &mut task)
                .await
                .is_err()
            {
                task.abort();
                let _ = tokio::time::timeout(Duration::from_secs(1), &mut task).await;
            }
        }

        let text = {
            let g = self.inner.lock().await;
            g.committed_text.clone()
        };

        if !text.trim().is_empty() {
            let conn = db.lock_recover();
            crate::db::queries::whisper_insert_history_with_provider(
                &conn,
                &text,
                None,
                &model,
                "deepgram",
                Some(&model),
                duration_ms,
                0,
                language.as_deref(),
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
            g.task = None;
            g.started_at = None;
            g.model = None;
            g.language = None;
            if is_current_session(g.session_id, session_id) {
                g.session_id = g.session_id.wrapping_add(1);
            }
        }
        emit_live_state(&self.app, LiveState::Idle, None);
        crate::whisper::service::hide_overlay(&self.app);
        Ok(text)
    }

    pub async fn cancel(&self) {
        let task = {
            let mut g = self.inner.lock().await;
            g.recorder = None;
            g.committed_text.clear();
            g.state = LiveState::Idle;
            g.started_at = None;
            g.model = None;
            g.language = None;
            g.session_id = g.session_id.wrapping_add(1);
            g.task.take()
        };
        if let Some(task) = task {
            task.abort();
        }
        emit_live_state(&self.app, LiveState::Idle, None);
        crate::whisper::service::hide_overlay(&self.app);
    }
}

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
    alternatives: Option<Vec<DeepgramAlternative>>,
}

#[derive(Debug, Deserialize)]
struct DeepgramAlternative {
    transcript: Option<String>,
}

pub fn parse_deepgram_message(raw: &str) -> Result<Option<DeepgramTranscript>, String> {
    let parsed: DeepgramResponse =
        serde_json::from_str(raw).map_err(|e| format!("deepgram json parse: {e}"))?;
    if parsed.kind.as_deref() != Some("Results") {
        return Ok(None);
    }
    let transcript = parsed
        .channel
        .and_then(|c| c.alternatives)
        .and_then(|alternatives| alternatives.into_iter().next())
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
        || committed_text.ends_with(['(', '[', '{', '«', '“', '"'])
        || delta.starts_with(char::is_whitespace)
        || delta.starts_with([',', '.', '!', '?', ':', ';', ')', ']', '}'])
    {
        delta.to_string()
    } else {
        format!(" {delta}")
    }
}

async fn run_deepgram_stream(
    app: AppHandle,
    inner: Arc<Mutex<LiveInner>>,
    cfg: DeepgramConfig,
    session_id: u64,
    mut audio_rx: tokio::sync::mpsc::Receiver<Vec<i16>>,
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
                        // Deepgram's documented live-stream finalization message asks
                        // the service to flush pending audio without immediately closing
                        // the socket. We then drain briefly for final Results.
                        sink.send(Message::Text(r#"{"type":"Finalize"}"#.to_string())).await
                            .map_err(|e| format!("deepgram finalize: {e}"))?;
                        break;
                    }
                }
            }
            maybe_msg = stream.next() => {
                let Some(msg) = maybe_msg else { return classify_stream_eof(false); };
                let msg = msg.map_err(|e| format!("deepgram receive: {e}"))?;
                if let Message::Text(text) = msg {
                    handle_deepgram_text_message(&app, &inner, &cfg, session_id, &text).await?;
                }
            }
        }
    }

    loop {
        match tokio::time::timeout(FINALIZE_DRAIN_TIMEOUT, stream.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                handle_deepgram_text_message(&app, &inner, &cfg, session_id, &text).await?;
            }
            Ok(Some(Ok(Message::Close(_)))) | Err(_) => break,
            Ok(None) => {
                classify_stream_eof(true)?;
                break;
            }
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(e))) => return Err(format!("deepgram drain: {e}")),
        }
    }
    let _ = tokio::time::timeout(CLOSE_FRAME_TIMEOUT, sink.close()).await;
    Ok(())
}

async fn handle_deepgram_text_message(
    app: &AppHandle,
    inner: &Arc<Mutex<LiveInner>>,
    cfg: &DeepgramConfig,
    session_id: u64,
    text: &str,
) -> Result<(), String> {
    let Some(parsed) = parse_deepgram_message(text)? else {
        return Ok(());
    };

    if !parsed.is_final {
        if !is_current_session(inner.lock().await.session_id, session_id) {
            return Ok(());
        }
        crate::whisper::events::emit_to_whisper_windows(
            app,
            EVT_LIVE_INTERIM,
            serde_json::json!({
                "text": parsed.transcript,
                "speech_final": parsed.speech_final,
            }),
        );
        return Ok(());
    }

    let paste_text = {
        let mut g = inner.lock().await;
        if !is_current_session(g.session_id, session_id) {
            return Ok(());
        }
        let chunk = build_paste_chunk(&g.committed_text, &parsed.transcript);
        g.committed_text.push_str(&chunk);
        chunk
    };

    if !paste_text.trim().is_empty() {
        inject::paste_chunk(&paste_text, cfg.clipboard_restore_delay_ms).await?;
        let committed = inner.lock().await.committed_text.clone();
        crate::whisper::events::emit_to_whisper_windows(
            app,
            EVT_LIVE_FINAL,
            serde_json::json!({
                "chunk": paste_text,
                "committed_text": committed,
                "speech_final": parsed.speech_final,
            }),
        );
    }
    Ok(())
}

fn is_current_session(active_session_id: u64, task_session_id: u64) -> bool {
    active_session_id == task_session_id
}

fn classify_stream_eof(finalizing: bool) -> Result<(), String> {
    if finalizing {
        Ok(())
    } else {
        Err("deepgram websocket closed unexpectedly".into())
    }
}

fn should_cleanup_completed_task(state: LiveState) -> bool {
    matches!(state, LiveState::Connecting | LiveState::Streaming)
}

fn reserve_live_start(inner: &mut LiveInner, cfg: &DeepgramConfig) -> Option<u64> {
    if !matches!(inner.state, LiveState::Idle | LiveState::Error) {
        return None;
    }
    if let Some(task) = inner.task.take() {
        task.abort();
    }
    inner.session_id = inner.session_id.wrapping_add(1);
    inner.state = LiveState::Connecting;
    inner.recorder = None;
    inner.committed_text.clear();
    inner.model = Some(cfg.model.clone());
    inner.language = cfg
        .language
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "auto")
        .map(ToOwned::to_owned);
    inner.started_at = Some(Instant::now());
    Some(inner.session_id)
}

fn is_start_reservation_current(inner: &LiveInner, session_id: u64) -> bool {
    is_current_session(inner.session_id, session_id)
        && matches!(inner.state, LiveState::Connecting | LiveState::Streaming)
}

fn clear_failed_start_reservation(inner: &mut LiveInner, session_id: u64) -> bool {
    if !is_current_session(inner.session_id, session_id) || inner.state != LiveState::Connecting {
        return false;
    }
    if let Some(task) = inner.task.take() {
        task.abort();
    }
    inner.state = LiveState::Error;
    inner.recorder = None;
    inner.started_at = None;
    true
}

fn emit_live_state(app: &AppHandle, state: LiveState, model: Option<String>) {
    crate::whisper::events::emit_to_whisper_windows(
        app,
        EVT_LIVE_STATE,
        serde_json::json!({
            "state": state.as_str(),
            "model": model,
        }),
    );
}

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
        assert!(parse_deepgram_message(r#"{"type":"Metadata"}"#)
            .unwrap()
            .is_none());
        assert!(parse_deepgram_message(
            r#"{"type":"Results","is_final":true,"channel":{"alternatives":[{"transcript":""}]}}"#
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn ignore_results_without_transcript_alternatives() {
        assert!(
            parse_deepgram_message(r#"{"type":"Results","is_final":true}"#)
                .unwrap()
                .is_none()
        );
        assert!(parse_deepgram_message(r#"{"type":"Results","channel":{}}"#)
            .unwrap()
            .is_none());
        assert!(
            parse_deepgram_message(r#"{"type":"Results","channel":{"alternatives":[]}}"#)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn missing_deepgram_booleans_default_to_false() {
        let msg = parse_deepgram_message(
            r#"{"type":"Results","channel":{"alternatives":[{"transcript":"hello"}]}}"#,
        )
        .unwrap()
        .unwrap();

        assert_eq!(msg.transcript, "hello");
        assert!(!msg.is_final);
        assert!(!msg.speech_final);
    }

    #[test]
    fn invalid_deepgram_json_or_type_mismatch_returns_error() {
        assert!(parse_deepgram_message("{").is_err());
        assert!(
            parse_deepgram_message(r#"{"type":"Results","channel":{"alternatives":{}}}"#).is_err()
        );
    }

    #[test]
    fn paste_chunk_adds_spaces_for_russian_and_latin_text() {
        assert_eq!(build_paste_chunk("", "привет"), "привет");
        assert_eq!(build_paste_chunk("привет", "мир"), " мир");
        assert_eq!(build_paste_chunk("hello", "world."), " world.");
        assert_eq!(build_paste_chunk("hello ", "world"), "world");
        assert_eq!(build_paste_chunk("hello", ", world"), ", world");
    }

    #[test]
    fn paste_chunk_does_not_add_spaces_after_opening_delimiters() {
        assert_eq!(build_paste_chunk("hello (", "world"), "world");
        assert_eq!(build_paste_chunk("hello [", "world"), "world");
        assert_eq!(build_paste_chunk("hello {", "world"), "world");
        assert_eq!(build_paste_chunk("hello «", "мир"), "мир");
        assert_eq!(build_paste_chunk("hello “", "world"), "world");
        assert_eq!(build_paste_chunk("hello \"", "world"), "world");
    }

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
        assert!(url.contains("punctuate=true"));
        assert!(url.contains("smart_format=true"));
        assert!(url.contains("endpointing=300"));
        assert!(url.contains("language=ru"));
    }

    #[test]
    fn build_deepgram_url_omits_auto_language() {
        let cfg = DeepgramConfig {
            api_key: "secret".into(),
            model: "nova-3".into(),
            language: Some("auto".into()),
            endpointing_ms: 300,
            clipboard_restore_delay_ms: 200,
            mic_device: None,
        };
        let url = build_deepgram_url(&cfg);
        assert!(!url.contains("language=auto"));
    }

    #[test]
    fn session_guard_rejects_stale_stream_work() {
        assert!(is_current_session(7, 7));
        assert!(!is_current_session(8, 7));
    }

    #[test]
    fn websocket_eof_before_stop_is_an_error() {
        assert!(classify_stream_eof(false).is_err());
        assert!(classify_stream_eof(true).is_ok());
    }

    #[test]
    fn completed_task_cleanup_only_targets_active_stream_states() {
        assert!(should_cleanup_completed_task(LiveState::Connecting));
        assert!(should_cleanup_completed_task(LiveState::Streaming));
        assert!(!should_cleanup_completed_task(LiveState::Stopping));
        assert!(!should_cleanup_completed_task(LiveState::Idle));
        assert!(!should_cleanup_completed_task(LiveState::Error));
    }

    #[test]
    fn live_start_reserves_connecting_session_before_recorder_creation() {
        let mut inner = live_inner_for_tests(LiveState::Idle);
        let cfg = test_config();

        let session_id = reserve_live_start(&mut inner, &cfg).unwrap();

        assert_eq!(session_id, 1);
        assert_eq!(inner.session_id, 1);
        assert_eq!(inner.state, LiveState::Connecting);
        assert_eq!(inner.model.as_deref(), Some("nova-3"));
        assert_eq!(inner.language.as_deref(), Some("ru"));
        assert!(inner.started_at.is_some());
    }

    #[test]
    fn stale_start_reservation_cannot_install_after_cancel() {
        let mut inner = live_inner_for_tests(LiveState::Idle);
        let cfg = test_config();
        let session_id = reserve_live_start(&mut inner, &cfg).unwrap();

        inner.state = LiveState::Idle;
        inner.session_id = inner.session_id.wrapping_add(1);

        assert!(!is_start_reservation_current(&inner, session_id));
    }

    #[test]
    fn current_start_failure_clears_connecting_reservation() {
        let mut inner = live_inner_for_tests(LiveState::Idle);
        let cfg = test_config();
        let session_id = reserve_live_start(&mut inner, &cfg).unwrap();

        assert!(clear_failed_start_reservation(&mut inner, session_id));

        assert_eq!(inner.state, LiveState::Error);
        assert!(inner.recorder.is_none());
        assert!(inner.task.is_none());
        assert!(inner.started_at.is_none());
    }

    fn live_inner_for_tests(state: LiveState) -> LiveInner {
        LiveInner {
            state,
            recorder: None,
            task: None,
            committed_text: String::new(),
            model: None,
            language: None,
            started_at: None,
            session_id: 0,
        }
    }

    fn test_config() -> DeepgramConfig {
        DeepgramConfig {
            api_key: "secret".into(),
            model: "nova-3".into(),
            language: Some("ru".into()),
            endpointing_ms: 300,
            clipboard_restore_delay_ms: 200,
            mic_device: None,
        }
    }
}
