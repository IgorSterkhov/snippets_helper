use crate::whisper::audio::{pcm_i16_to_le_bytes, LiveRecorder, WAV_SAMPLE_RATE};
use crate::whisper::deepgram::{
    LiveState, EVT_LIVE_ERROR, EVT_LIVE_FINAL, EVT_LIVE_INTERIM, EVT_LIVE_LEVEL, EVT_LIVE_STATE,
};
use crate::whisper::inject;
use crate::whisper::speechkit_proto::{
    audio_format_options, final_refinement, recognizer_client::RecognizerClient,
    streaming_request, streaming_response, AlternativeUpdate, AudioChunk, AudioFormatOptions,
    LanguageRestrictionOptions, RawAudio, RecognitionModelOptions, StreamingOptions,
    StreamingRequest, StreamingResponse, TextNormalizationOptions,
};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_stream::wrappers::ReceiverStream;
use tonic::metadata::MetadataValue;

const SPEECHKIT_ENDPOINT: &str = "https://stt.api.cloud.yandex.net:443";
const LIVE_AUDIO_QUEUE_CAPACITY: usize = 64;
const FINALIZE_DRAIN_TIMEOUT: Duration = Duration::from_secs(5);
const SPEECHKIT_MAX_STREAM_DURATION: Duration = Duration::from_secs(270);

#[derive(Debug, Clone)]
pub struct YandexSpeechKitConfig {
    pub api_key: String,
    pub model: String,
    pub language: Option<String>,
    pub text_normalization: bool,
    pub clipboard_restore_delay_ms: u64,
    pub mic_device: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpeechKitTranscript {
    pub transcript: String,
    pub is_final: bool,
    pub is_normalized: bool,
}

pub struct YandexSpeechKitLiveService {
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
// SAFETY: the recorder is stored behind a tokio Mutex and is only dropped as a
// whole to stop the cpal stream. No concurrent access to the stream is exposed.
unsafe impl Send for SendLiveRecorder {}

impl YandexSpeechKitLiveService {
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
            "provider": "yandex",
            "committed_text": g.committed_text,
        })
    }

    pub async fn start(&self, cfg: YandexSpeechKitConfig) -> Result<(), String> {
        if cfg.api_key.trim().is_empty() {
            return Err(
                "Yandex SpeechKit API key is missing. Open Whisper Settings and add a local Yandex key."
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
        emit_live_state(
            &self.app,
            LiveState::Connecting,
            Some(cfg.model.clone()),
            "yandex",
        );

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
                    emit_live_state(&self.app, LiveState::Error, model, "yandex");
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
                run_speechkit_stream(app.clone(), inner.clone(), task_cfg, session_id, audio_rx)
                    .await
            {
                crate::whisper::events::emit_to_whisper_windows(
                    &app,
                    EVT_LIVE_ERROR,
                    serde_json::json!({ "message": e, "provider": "yandex" }),
                );
                let mut g = inner.lock().await;
                if is_current_session(g.session_id, session_id) {
                    g.state = LiveState::Error;
                    g.recorder = None;
                    g.task = None;
                    emit_live_state(&app, LiveState::Error, g.model.clone(), "yandex");
                }
            } else {
                let mut g = inner.lock().await;
                if is_current_session(g.session_id, session_id)
                    && should_cleanup_completed_task(g.state)
                {
                    crate::whisper::events::emit_to_whisper_windows(
                        &app,
                        EVT_LIVE_ERROR,
                        serde_json::json!({
                            "message": "Yandex SpeechKit stream ended unexpectedly",
                            "provider": "yandex",
                        }),
                    );
                    g.state = LiveState::Error;
                    g.recorder = None;
                    g.task = None;
                    emit_live_state(&app, LiveState::Error, g.model.clone(), "yandex");
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
            emit_live_state(&self.app, LiveState::Stopping, g.model.clone(), "yandex");
            g.recorder = None;
            let duration_ms = g
                .started_at
                .map(|t| t.elapsed().as_millis() as i64)
                .unwrap_or(0);
            (
                g.task.take(),
                g.model.clone().unwrap_or_else(|| "general".into()),
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
                "yandex",
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
        emit_live_state(&self.app, LiveState::Idle, None, "yandex");
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
        emit_live_state(&self.app, LiveState::Idle, None, "yandex");
        crate::whisper::service::hide_overlay(&self.app);
    }
}

pub fn build_speechkit_options(cfg: &YandexSpeechKitConfig) -> StreamingOptions {
    let language = cfg
        .language
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "auto")
        .map(ToOwned::to_owned);

    StreamingOptions {
        recognition_model: Some(RecognitionModelOptions {
            model: if cfg.model.trim().is_empty() {
                "general".into()
            } else {
                cfg.model.trim().to_string()
            },
            audio_format: Some(AudioFormatOptions {
                audio_format: Some(audio_format_options::AudioFormat::RawAudio(RawAudio {
                    audio_encoding: 1,
                    sample_rate_hertz: WAV_SAMPLE_RATE as i64,
                    audio_channel_count: 1,
                })),
            }),
            text_normalization: Some(TextNormalizationOptions {
                text_normalization: if cfg.text_normalization { 1 } else { 2 },
                profanity_filter: false,
                literature_text: false,
                phone_formatting_mode: 1,
            }),
            language_restriction: language.map(|lang| LanguageRestrictionOptions {
                restriction_type: 1,
                language_code: vec![lang],
            }),
            audio_processing_type: 1,
        }),
    }
}

pub fn parse_speechkit_response(response: StreamingResponse) -> Option<SpeechKitTranscript> {
    match response.event? {
        streaming_response::Event::Partial(update) => first_text(update).map(|text| {
            SpeechKitTranscript {
                transcript: text,
                is_final: false,
                is_normalized: false,
            }
        }),
        streaming_response::Event::Final(update) => first_text(update).map(|text| {
            SpeechKitTranscript {
                transcript: text,
                is_final: true,
                is_normalized: false,
            }
        }),
        streaming_response::Event::FinalRefinement(refinement) => {
            let final_refinement::Type::NormalizedText(update) = refinement.r#type?;
            first_text(update).map(|text| SpeechKitTranscript {
                transcript: text,
                is_final: true,
                is_normalized: true,
            })
        }
        streaming_response::Event::StatusCode(_) => None,
    }
}

pub fn build_paste_chunk(committed_text: &str, finalized_delta: &str) -> String {
    crate::whisper::deepgram::build_paste_chunk(committed_text, finalized_delta)
}

fn first_text(update: AlternativeUpdate) -> Option<String> {
    update
        .alternatives
        .into_iter()
        .next()
        .map(|a| a.text.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn should_commit_transcript(text_normalization: bool, parsed: &SpeechKitTranscript) -> bool {
    parsed.is_final && (!text_normalization || parsed.is_normalized)
}

async fn run_speechkit_stream(
    app: AppHandle,
    inner: Arc<Mutex<LiveInner>>,
    cfg: YandexSpeechKitConfig,
    session_id: u64,
    mut audio_rx: tokio::sync::mpsc::Receiver<Vec<i16>>,
) -> Result<(), String> {
    let mut client = RecognizerClient::connect(SPEECHKIT_ENDPOINT)
        .await
        .map_err(|e| format!("yandex speechkit connect: {e}"))?;
    let (request_tx, request_rx) =
        tokio::sync::mpsc::channel::<StreamingRequest>(LIVE_AUDIO_QUEUE_CAPACITY);
    request_tx
        .send(StreamingRequest {
            event: Some(streaming_request::Event::SessionOptions(
                build_speechkit_options(&cfg),
            )),
        })
        .await
        .map_err(|e| format!("yandex speechkit options send: {e}"))?;

    let mut request = tonic::Request::new(ReceiverStream::new(request_rx));
    let auth = MetadataValue::try_from(format!("Api-Key {}", cfg.api_key.trim()))
        .map_err(|e| format!("yandex speechkit auth header: {e}"))?;
    request.metadata_mut().insert("authorization", auth);

    let mut response_stream = client
        .recognize_streaming(request)
        .await
        .map_err(|e| format!("yandex speechkit streaming: {e}"))?
        .into_inner();

    {
        let mut g = inner.lock().await;
        g.state = LiveState::Streaming;
    }
    emit_live_state(&app, LiveState::Streaming, Some(cfg.model.clone()), "yandex");

    let max_stream_timer = tokio::time::sleep(SPEECHKIT_MAX_STREAM_DURATION);
    tokio::pin!(max_stream_timer);
    loop {
        tokio::select! {
            _ = &mut max_stream_timer => {
                crate::whisper::events::emit_to_whisper_windows(
                    &app,
                    EVT_LIVE_ERROR,
                    serde_json::json!({
                        "message": "Yandex SpeechKit stream reached the single-session limit. Stop and start live dictation again.",
                        "provider": "yandex",
                    }),
                );
                break;
            }
            maybe_samples = audio_rx.recv() => {
                match maybe_samples {
                    Some(samples) if !samples.is_empty() => {
                        request_tx.send(StreamingRequest {
                            event: Some(streaming_request::Event::Chunk(AudioChunk {
                                data: pcm_i16_to_le_bytes(&samples),
                            })),
                        }).await.map_err(|e| format!("yandex speechkit audio send: {e}"))?;
                    }
                    Some(_) => {}
                    None => {
                        break;
                    }
                }
            }
            maybe_msg = response_stream.message() => {
                let Some(msg) = maybe_msg.map_err(|e| format!("yandex speechkit receive: {e}"))? else {
                    return classify_stream_eof(false);
                };
                handle_speechkit_response(&app, &inner, &cfg, session_id, msg).await?;
            }
        }
    }
    drop(request_tx);

    loop {
        match tokio::time::timeout(FINALIZE_DRAIN_TIMEOUT, response_stream.message()).await {
            Ok(Ok(Some(msg))) => {
                handle_speechkit_response(&app, &inner, &cfg, session_id, msg).await?;
            }
            Ok(Ok(None)) | Err(_) => break,
            Ok(Err(e)) => return Err(format!("yandex speechkit drain: {e}")),
        }
    }
    Ok(())
}

async fn handle_speechkit_response(
    app: &AppHandle,
    inner: &Arc<Mutex<LiveInner>>,
    cfg: &YandexSpeechKitConfig,
    session_id: u64,
    response: StreamingResponse,
) -> Result<(), String> {
    if let Some(streaming_response::Event::StatusCode(status)) = response.event.as_ref() {
        if status.code_type > 1 && !status.message.trim().is_empty() {
            crate::whisper::events::emit_to_whisper_windows(
                app,
                EVT_LIVE_ERROR,
                serde_json::json!({
                    "message": status.message,
                    "provider": "yandex",
                    "status_code": status.code_type,
                }),
            );
        }
    }

    let Some(parsed) = parse_speechkit_response(response) else {
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
                "speech_final": false,
                "provider": "yandex",
            }),
        );
        return Ok(());
    }

    if !should_commit_transcript(cfg.text_normalization, &parsed) {
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
                "speech_final": true,
                "provider": "yandex",
            }),
        );
    }
    Ok(())
}

fn classify_stream_eof(finalizing: bool) -> Result<(), String> {
    if finalizing {
        Ok(())
    } else {
        Err("yandex speechkit stream closed unexpectedly".into())
    }
}

fn should_cleanup_completed_task(state: LiveState) -> bool {
    matches!(state, LiveState::Connecting | LiveState::Streaming)
}

fn reserve_live_start(inner: &mut LiveInner, cfg: &YandexSpeechKitConfig) -> Option<u64> {
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
    inner.model = Some(if cfg.model.trim().is_empty() {
        "general".into()
    } else {
        cfg.model.trim().to_string()
    });
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

fn is_current_session(active_session_id: u64, task_session_id: u64) -> bool {
    active_session_id == task_session_id
}

fn emit_live_state(app: &AppHandle, state: LiveState, model: Option<String>, provider: &str) {
    crate::whisper::events::emit_to_whisper_windows(
        app,
        EVT_LIVE_STATE,
        serde_json::json!({
            "state": state.as_str(),
            "model": model,
            "provider": provider,
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_speechkit_options_defaults_to_ru_realtime_linear16() {
        let cfg = YandexSpeechKitConfig {
            api_key: "test-key".into(),
            model: "general".into(),
            language: Some("ru-RU".into()),
            text_normalization: true,
            clipboard_restore_delay_ms: 200,
            mic_device: None,
        };

        let options = build_speechkit_options(&cfg);
        let recognition = options.recognition_model.expect("recognition model");
        assert_eq!(recognition.model, "general");
        assert_eq!(recognition.audio_processing_type, 1);
        let raw = recognition
            .audio_format
            .expect("audio format")
            .audio_format
            .expect("audio oneof");
        assert!(matches!(
            raw,
            crate::whisper::speechkit_proto::audio_format_options::AudioFormat::RawAudio(_)
        ));
        let lang = recognition
            .language_restriction
            .expect("language restriction");
        assert_eq!(lang.language_code, vec!["ru-RU"]);
        assert_eq!(lang.restriction_type, 1);
        let norm = recognition.text_normalization.expect("normalization");
        assert_eq!(norm.text_normalization, 1);
    }

    #[test]
    fn parse_partial_response_returns_interim() {
        let response = crate::whisper::speechkit_proto::StreamingResponse {
            event: Some(crate::whisper::speechkit_proto::streaming_response::Event::Partial(
                crate::whisper::speechkit_proto::AlternativeUpdate {
                    alternatives: vec![crate::whisper::speechkit_proto::Alternative {
                        text: "проверка микрофона".into(),
                    }],
                },
            )),
        };

        let parsed = parse_speechkit_response(response).expect("parsed");
        assert_eq!(parsed.transcript, "проверка микрофона");
        assert!(!parsed.is_final);
    }

    #[test]
    fn parse_final_refinement_preferred_when_normalization_enabled() {
        let response = crate::whisper::speechkit_proto::StreamingResponse {
            event: Some(
                crate::whisper::speechkit_proto::streaming_response::Event::FinalRefinement(
                    crate::whisper::speechkit_proto::FinalRefinement {
                        final_index: 1,
                        r#type: Some(
                            crate::whisper::speechkit_proto::final_refinement::Type::NormalizedText(
                                crate::whisper::speechkit_proto::AlternativeUpdate {
                                    alternatives: vec![crate::whisper::speechkit_proto::Alternative {
                                        text: "Купить 2 упаковки.".into(),
                                    }],
                                },
                            ),
                        ),
                    },
                ),
            ),
        };

        let parsed = parse_speechkit_response(response).expect("parsed");
        assert_eq!(parsed.transcript, "Купить 2 упаковки.");
        assert!(parsed.is_final);
    }

    #[test]
    fn build_paste_chunk_handles_russian_spacing() {
        assert_eq!(build_paste_chunk("Привет", "мир"), " мир");
        assert_eq!(build_paste_chunk("Привет", ", мир"), ", мир");
        assert_eq!(build_paste_chunk("", "Привет"), "Привет");
    }

    #[test]
    fn normalization_enabled_ignores_raw_final_before_refinement() {
        let raw_final = SpeechKitTranscript {
            transcript: "kupit dva".into(),
            is_final: true,
            is_normalized: false,
        };
        let normalized = SpeechKitTranscript {
            transcript: "Купить 2.".into(),
            is_final: true,
            is_normalized: true,
        };

        assert!(!should_commit_transcript(true, &raw_final));
        assert!(should_commit_transcript(true, &normalized));
        assert!(should_commit_transcript(false, &raw_final));
    }
}
