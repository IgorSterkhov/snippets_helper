//! Tauri commands for the whisper voice-input feature.

use crate::db::queries::{self, WhisperHistoryRow, WhisperModelRow};
use crate::db::DbState;
use crate::whisper::bin_manager;
use crate::whisper::catalog::{self, ModelMeta};
use crate::whisper::deepgram::{DeepgramConfig, DeepgramLiveService, LiveState};
use crate::whisper::events;
use crate::whisper::gpu_detect::{self, HardwareInfo};
use crate::whisper::inject::{self, InjectMethod};
use crate::whisper::models;
use crate::whisper::postprocess::{self, LlmConfig};
use crate::whisper::service::{RecordingProvider, WhisperService};
use crate::whisper::yandex::{YandexSpeechKitConfig, YandexSpeechKitLiveService};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager, State};

const HOTKEY_DEBOUNCE_MS: u64 = 700;
static LAST_WHISPER_HOTKEY_MS: AtomicU64 = AtomicU64::new(0);
const YANDEX_FOLDER_ID_MISSING_MESSAGE: &str = "Yandex batch recognition needs Folder ID. Add Yandex Folder ID in Whisper Settings, or enable Live dictate to use Yandex streaming instead.";

#[derive(Debug, Clone, PartialEq, Eq)]
enum HotkeyAction {
    BatchStart(RecognitionEngine),
    BatchStop,
    LiveStart(LiveProvider),
    LiveStop(LiveProvider),
    Ignore,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RecognitionEngine {
    Local(String),
    Deepgram,
    Yandex,
}

impl RecognitionEngine {
    fn cloud_provider(&self) -> Option<LiveProvider> {
        match self {
            RecognitionEngine::Deepgram => Some(LiveProvider::Deepgram),
            RecognitionEngine::Yandex => Some(LiveProvider::Yandex),
            RecognitionEngine::Local(_) => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LiveProvider {
    Deepgram,
    Yandex,
}

impl LiveProvider {
    fn from_setting(value: Option<String>) -> Self {
        match value.as_deref().map(str::trim) {
            Some("yandex") => LiveProvider::Yandex,
            _ => LiveProvider::Deepgram,
        }
    }

    fn recognition_engine(self) -> RecognitionEngine {
        match self {
            LiveProvider::Deepgram => RecognitionEngine::Deepgram,
            LiveProvider::Yandex => RecognitionEngine::Yandex,
        }
    }
}

// --- helpers -----------------------------------------------------------------

/// F2: computer_id is derived from hostname, matching the existing settings.rs
/// and lib.rs patterns. Do NOT read a "computer_id" setting from the DB.
fn computer_id() -> String {
    hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

fn app_data(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn should_accept_hotkey_press(now_ms: u64, last_ms: Option<u64>) -> bool {
    match last_ms {
        Some(last) => now_ms.saturating_sub(last) >= HOTKEY_DEBOUNCE_MS,
        None => true,
    }
}

fn claim_hotkey_press() -> bool {
    let now = now_millis();
    loop {
        let last = LAST_WHISPER_HOTKEY_MS.load(Ordering::Relaxed);
        let last_opt = if last == 0 { None } else { Some(last) };
        if !should_accept_hotkey_press(now, last_opt) {
            return false;
        }
        if LAST_WHISPER_HOTKEY_MS
            .compare_exchange(last, now, Ordering::SeqCst, Ordering::Relaxed)
            .is_ok()
        {
            return true;
        }
    }
}

fn live_dictate_enabled(db: &DbState) -> bool {
    let conn = db.lock_recover();
    let cid = computer_id();
    queries::get_setting(&conn, &cid, "whisper.live_dictate")
        .ok()
        .flatten()
        .map(|s| s == "true")
        .unwrap_or(false)
}

fn selected_live_provider(db: &DbState) -> LiveProvider {
    let conn = db.lock_recover();
    let cid = computer_id();
    LiveProvider::from_setting(
        queries::get_setting(&conn, &cid, "whisper.live_provider")
            .ok()
            .flatten(),
    )
}

fn resolve_recognition_engine_setting(
    setting: Option<&str>,
    live_enabled: bool,
    live_provider: LiveProvider,
    default_model: Option<&str>,
    installed_models: &[&str],
) -> Result<RecognitionEngine, String> {
    let fallback_local = || {
        default_model
            .filter(|name| installed_models.iter().any(|m| m == name))
            .map(|name| RecognitionEngine::Local(name.to_string()))
            .ok_or_else(|| "no local Whisper model installed".to_string())
    };

    if let Some(value) = setting.map(str::trim).filter(|s| !s.is_empty()) {
        match value {
            "deepgram" => return Ok(RecognitionEngine::Deepgram),
            "yandex" => return Ok(RecognitionEngine::Yandex),
            _ => {
                if let Some(name) = value.strip_prefix("local:").map(str::trim) {
                    if installed_models.iter().any(|m| *m == name) {
                        return Ok(RecognitionEngine::Local(name.to_string()));
                    }
                    return fallback_local();
                }
                return fallback_local();
            }
        }
    }

    if live_enabled {
        Ok(live_provider.recognition_engine())
    } else {
        fallback_local()
    }
}

fn selected_recognition_engine(db: &DbState) -> Result<RecognitionEngine, String> {
    let conn = db.lock_recover();
    let cid = computer_id();
    let setting = queries::get_setting(&conn, &cid, "whisper.recognition_engine")
        .ok()
        .flatten();
    let live_enabled = queries::get_setting(&conn, &cid, "whisper.live_dictate")
        .ok()
        .flatten()
        .map(|s| s == "true")
        .unwrap_or(false);
    let live_provider = LiveProvider::from_setting(
        queries::get_setting(&conn, &cid, "whisper.live_provider")
            .ok()
            .flatten(),
    );
    let models = queries::whisper_list_models(&conn).map_err(|e| e.to_string())?;
    let default_model = models
        .iter()
        .find(|m| m.is_default)
        .or_else(|| models.first())
        .map(|m| m.name.as_str());
    let installed: Vec<&str> = models.iter().map(|m| m.name.as_str()).collect();
    resolve_recognition_engine_setting(
        setting.as_deref(),
        live_enabled,
        live_provider,
        default_model,
        &installed,
    )
}

fn active_live_provider(
    deepgram_state: LiveState,
    yandex_state: LiveState,
) -> Option<LiveProvider> {
    match deepgram_state {
        LiveState::Connecting | LiveState::Streaming | LiveState::Stopping => {
            return Some(LiveProvider::Deepgram)
        }
        LiveState::Idle | LiveState::Error => {}
    }
    match yandex_state {
        LiveState::Connecting | LiveState::Streaming | LiveState::Stopping => {
            Some(LiveProvider::Yandex)
        }
        LiveState::Idle | LiveState::Error => None,
    }
}

fn decide_hotkey_action(
    live_enabled: bool,
    selected_engine: RecognitionEngine,
    local_state: crate::whisper::service::State,
    deepgram_state: LiveState,
    yandex_state: LiveState,
) -> HotkeyAction {
    use crate::whisper::service::State as WState;

    match local_state {
        WState::Warming | WState::Recording => return HotkeyAction::BatchStop,
        WState::Transcribing | WState::Unloading => return HotkeyAction::Ignore,
        WState::Idle | WState::Ready => {}
    }

    if let Some(provider) = active_live_provider(deepgram_state, yandex_state) {
        return match (provider, deepgram_state, yandex_state) {
            (LiveProvider::Deepgram, LiveState::Stopping, _) => HotkeyAction::Ignore,
            (LiveProvider::Yandex, _, LiveState::Stopping) => HotkeyAction::Ignore,
            _ => HotkeyAction::LiveStop(provider),
        };
    }

    if live_enabled {
        if let Some(provider) = selected_engine.cloud_provider() {
            HotkeyAction::LiveStart(provider)
        } else {
            HotkeyAction::BatchStart(selected_engine)
        }
    } else {
        HotkeyAction::BatchStart(selected_engine)
    }
}

fn decide_active_stop_action(
    local_state: crate::whisper::service::State,
    deepgram_state: LiveState,
    yandex_state: LiveState,
) -> HotkeyAction {
    use crate::whisper::service::State as WState;

    if let Some(provider) = active_live_provider(deepgram_state, yandex_state) {
        return HotkeyAction::LiveStop(provider);
    }

    match local_state {
        WState::Warming | WState::Recording => HotkeyAction::BatchStop,
        WState::Idle | WState::Ready | WState::Transcribing | WState::Unloading => {
            HotkeyAction::Ignore
        }
    }
}

fn decide_active_cancel_action(
    local_state: crate::whisper::service::State,
    deepgram_state: LiveState,
    yandex_state: LiveState,
) -> HotkeyAction {
    use crate::whisper::service::State as WState;

    if let Some(provider) = active_live_provider(deepgram_state, yandex_state) {
        return HotkeyAction::LiveStop(provider);
    }

    match local_state {
        WState::Warming | WState::Recording => HotkeyAction::BatchStop,
        WState::Idle | WState::Ready | WState::Transcribing | WState::Unloading => {
            HotkeyAction::Ignore
        }
    }
}

// --- model catalog / installation --------------------------------------------

#[tauri::command]
pub fn whisper_list_catalog() -> Vec<ModelMeta> {
    catalog::CATALOG.to_vec()
}

#[tauri::command]
pub fn whisper_list_models(db: State<DbState>) -> Result<Vec<WhisperModelRow>, String> {
    let conn = db.lock_recover();
    queries::whisper_list_models(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn whisper_install_model(
    app: AppHandle,
    db: State<'_, DbState>,
    name: String,
) -> Result<WhisperModelRow, String> {
    let meta = catalog::find(&name).ok_or_else(|| format!("unknown model: {name}"))?;
    let app_data_dir = app_data(&app);
    let path = models::download_and_install(&app, &app_data_dir, meta).await?;
    let mut conn = db.lock_recover();
    queries::whisper_insert_or_upgrade_model(
        &conn,
        meta.name,
        meta.display_name,
        &path.to_string_lossy(),
        meta.size_bytes as i64,
        meta.sha256,
    )
    .map_err(|e| e.to_string())?;
    let all = queries::whisper_list_models(&conn).map_err(|e| e.to_string())?;
    if all.len() == 1 {
        queries::whisper_set_default_model(&mut conn, meta.name).map_err(|e| e.to_string())?;
    }
    queries::whisper_list_models(&conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|m| m.name == meta.name)
        .ok_or_else(|| "install succeeded but model not found".into())
}

#[tauri::command]
pub fn whisper_delete_model(
    app: AppHandle,
    db: State<DbState>,
    name: String,
) -> Result<(), String> {
    let app_data_dir = app_data(&app);
    let path = models::model_path(&app_data_dir, &name);
    let _ = std::fs::remove_file(&path);
    let conn = db.lock_recover();
    queries::whisper_delete_model(&conn, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn whisper_set_default_model(db: State<DbState>, name: String) -> Result<(), String> {
    let mut conn = db.lock_recover();
    queries::whisper_set_default_model(&mut conn, &name).map_err(|e| e.to_string())
}

// --- recording & transcription -----------------------------------------------

/// Core start logic, callable from both the Tauri command and the global
/// hotkey handler. Resolves default model + mic + idle-timeout from
/// app_settings and drives the WhisperService directly.
pub async fn start_recording_impl(app: &AppHandle) -> Result<(), String> {
    let db = app.state::<DbState>();
    let svc = app.state::<WhisperService>();
    let engine = selected_recognition_engine(&db)?;
    match engine {
        RecognitionEngine::Local(selected_model) => {
            let (model_path, model_name, device_name, idle_timeout_sec) = {
                let conn = db.lock_recover();
                let models = queries::whisper_list_models(&conn).map_err(|e| e.to_string())?;
                let model = models
                    .iter()
                    .find(|m| m.name == selected_model)
                    .or_else(|| models.iter().find(|m| m.is_default))
                    .or_else(|| models.first())
                    .ok_or_else(|| "no local Whisper model installed".to_string())?;
                let cid = computer_id();
                let mic = queries::get_setting(&conn, &cid, "whisper.mic_device")
                    .ok()
                    .flatten()
                    .filter(|s| !s.is_empty());
                let idle = queries::get_setting(&conn, &cid, "whisper.idle_timeout_sec")
                    .ok()
                    .flatten()
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(300);
                (
                    std::path::PathBuf::from(&model.file_path),
                    model.name.clone(),
                    mic,
                    idle,
                )
            };
            svc.set_idle_timeout(std::time::Duration::from_secs(idle_timeout_sec))
                .await;
            svc.start_recording(model_path, model_name, device_name)
                .await
        }
        RecognitionEngine::Deepgram => {
            let cfg = deepgram_config_from_settings(&db)?;
            svc.start_capture_only(
                RecordingProvider::Deepgram,
                cfg.model.clone(),
                cfg.mic_device,
            )
            .await
        }
        RecognitionEngine::Yandex => {
            let cfg = yandex_config_from_settings(&db, true)?;
            svc.start_capture_only(RecordingProvider::Yandex, cfg.model.clone(), cfg.mic_device)
                .await
        }
    }
}

#[tauri::command]
pub async fn whisper_start_recording(app: AppHandle) -> Result<(), String> {
    start_recording_impl(&app).await
}

struct StoppedTranscript {
    raw: String,
    model_name: String,
    provider: &'static str,
    provider_model: Option<String>,
    duration_ms: u64,
    transcribe_ms: u64,
    language: Option<String>,
    cpu_peak_percent: f64,
    gpu_peak_percent: f64,
    vram_peak_mb: i64,
}

async fn stop_deepgram_batch(
    db: &DbState,
    svc: &WhisperService,
) -> Result<StoppedTranscript, String> {
    let cfg = deepgram_config_from_settings(db)?;
    let captured = svc.stop_capture_only().await?;
    if captured.provider != RecordingProvider::Deepgram {
        svc.finish_capture_only().await;
        return Err("active recording is not Deepgram batch".into());
    }
    let start = std::time::Instant::now();
    let transcript =
        match crate::whisper::deepgram::transcribe_prerecorded_file(&cfg, captured.wav).await {
            Ok(transcript) => transcript,
            Err(e) => {
                svc.finish_capture_only().await;
                return Err(e);
            }
        };
    Ok(StoppedTranscript {
        raw: transcript.text,
        model_name: captured.model_name,
        provider: "deepgram",
        provider_model: Some(cfg.model),
        duration_ms: captured.duration_ms,
        transcribe_ms: start.elapsed().as_millis() as u64,
        language: transcript
            .language
            .or_else(|| cfg.language.filter(|s| s != "auto")),
        cpu_peak_percent: 0.0,
        gpu_peak_percent: 0.0,
        vram_peak_mb: 0,
    })
}

async fn stop_yandex_batch(
    db: &DbState,
    svc: &WhisperService,
) -> Result<StoppedTranscript, String> {
    let cfg = yandex_config_from_settings(db, true)?;
    let captured = svc.stop_capture_only().await?;
    if captured.provider != RecordingProvider::Yandex {
        svc.finish_capture_only().await;
        return Err("active recording is not Yandex SpeechKit batch".into());
    }
    let start = std::time::Instant::now();
    let transcript = match crate::whisper::yandex::transcribe_file(&cfg, captured.wav).await {
        Ok(transcript) => transcript,
        Err(e) => {
            svc.finish_capture_only().await;
            return Err(e);
        }
    };
    Ok(StoppedTranscript {
        raw: transcript.text,
        model_name: captured.model_name,
        provider: "yandex",
        provider_model: Some(cfg.model),
        duration_ms: captured.duration_ms,
        transcribe_ms: start.elapsed().as_millis() as u64,
        language: transcript.language.or(cfg.language),
        cpu_peak_percent: 0.0,
        gpu_peak_percent: 0.0,
        vram_peak_mb: 0,
    })
}

/// Core stop+transcribe+inject+persist logic, callable from both the
/// Tauri command and the global hotkey handler.
pub async fn stop_recording_impl(app: &AppHandle) -> Result<String, String> {
    let db = app.state::<DbState>();
    let svc = app.state::<WhisperService>();
    // Read settings
    let (inject_method_str, restore_delay_ms, rules_on, llm_cfg_opt, lang) = {
        let conn = db.lock_recover();
        let cid = computer_id();
        let inj = queries::get_setting(&conn, &cid, "whisper.inject_method")
            .ok()
            .flatten()
            .unwrap_or_else(|| "paste".into());
        let delay = queries::get_setting(&conn, &cid, "whisper.clipboard_restore_delay_ms")
            .ok()
            .flatten()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(200);
        let rules = queries::get_setting(&conn, &cid, "whisper.postprocess_rules")
            .ok()
            .flatten()
            .map(|s| s == "true")
            .unwrap_or(true);
        let llm_enabled = queries::get_setting(&conn, &cid, "whisper.llm_enabled")
            .ok()
            .flatten()
            .map(|s| s == "true")
            .unwrap_or(false);
        let llm_cfg = if llm_enabled {
            Some(LlmConfig {
                endpoint: queries::get_setting(&conn, &cid, "whisper.llm_endpoint")
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
                api_key: queries::get_setting(&conn, &cid, "whisper.llm_api_key")
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
                model: queries::get_setting(&conn, &cid, "whisper.llm_model")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "gpt-4o-mini".into()),
                prompt: queries::get_setting(&conn, &cid, "whisper.llm_prompt")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| {
                        "Clean up filler words; fix punctuation. Keep language.".into()
                    }),
            })
        } else {
            None
        };
        let lang = queries::get_setting(&conn, &cid, "whisper.language")
            .ok()
            .flatten();
        (inj, delay, rules, llm_cfg, lang)
    };

    let stopped = match svc.current_recording_provider().await {
        Some(RecordingProvider::Deepgram) => stop_deepgram_batch(&db, &svc).await?,
        Some(RecordingProvider::Yandex) => stop_yandex_batch(&db, &svc).await?,
        Some(RecordingProvider::Local) | None => {
            // F4: run local inference, get StopOutcome (durations + metrics included)
            let outcome = svc.stop_recording(lang).await?;
            StoppedTranscript {
                raw: outcome.result.text,
                model_name: outcome.model_name.clone(),
                provider: "local",
                provider_model: Some(outcome.model_name),
                duration_ms: outcome.duration_ms,
                transcribe_ms: outcome.transcribe_ms,
                language: outcome.result.language,
                cpu_peak_percent: outcome.cpu_peak_percent,
                gpu_peak_percent: outcome.gpu_peak_percent,
                vram_peak_mb: outcome.vram_peak_mb,
            }
        }
    };

    // Postprocess
    let raw = stopped.raw.clone();
    let mut text = if rules_on {
        postprocess::apply_rules(&raw)
    } else {
        raw.clone()
    };
    if let Some(cfg) = llm_cfg_opt {
        text = postprocess::apply_llm(&text, &cfg).await;
    }

    // Inject
    let method = InjectMethod::from_setting(&inject_method_str);
    let injected = inject::inject(&text, method, restore_delay_ms)
        .await
        .unwrap_or_else(|e| {
            eprintln!("[whisper inject] fallback: {e}");
            "copy"
        });

    // F4: emit real durations + metrics
    events::emit_to_whisper_windows(
        app,
        events::EVT_TRANSCRIBED,
        events::TranscribedPayload {
            text: text.clone(),
            duration_ms: stopped.duration_ms,
            transcribe_ms: stopped.transcribe_ms,
            model: stopped.model_name.clone(),
            language: stopped.language.clone(),
            cpu_peak_percent: stopped.cpu_peak_percent,
            gpu_peak_percent: stopped.gpu_peak_percent,
            vram_peak_mb: stopped.vram_peak_mb,
        },
    );

    // F4: persist real durations
    {
        let conn = db.lock_recover();
        let text_raw_opt = if raw != text {
            Some(raw.as_str())
        } else {
            None
        };
        let _ = queries::whisper_insert_history_with_provider(
            &conn,
            &text,
            text_raw_opt,
            &stopped.model_name,
            stopped.provider,
            stopped.provider_model.as_deref(),
            stopped.duration_ms as i64,
            stopped.transcribe_ms as i64,
            stopped.language.as_deref(),
            Some(injected),
            stopped.cpu_peak_percent,
            stopped.gpu_peak_percent,
            stopped.vram_peak_mb,
        )
        .map_err(|e| e.to_string());
    }

    if stopped.provider != "local" {
        svc.finish_capture_only().await;
    }

    Ok(text)
}

#[tauri::command]
pub async fn whisper_stop_recording(app: AppHandle) -> Result<String, String> {
    stop_recording_impl(&app).await
}

/// Toggle entry used by the global hotkey. It mirrors the main-window Record
/// button: active local/live sessions stop first; otherwise the persisted
/// `whisper.live_dictate` setting chooses the provider to start.
pub async fn hotkey_toggle(app: AppHandle) {
    if !claim_hotkey_press() {
        return;
    }

    let db = app.state::<DbState>();
    let local = app.state::<WhisperService>();
    let deepgram = app.state::<DeepgramLiveService>();
    let yandex = app.state::<YandexSpeechKitLiveService>();
    let selected_engine = match selected_recognition_engine(&db) {
        Ok(engine) => engine,
        Err(e) => {
            events::emit_to_whisper_windows(
                &app,
                events::EVT_ERROR,
                events::ErrorPayload {
                    code: "hotkey_toggle_failed".into(),
                    message: e,
                },
            );
            return;
        }
    };
    let action = decide_hotkey_action(
        live_dictate_enabled(&db),
        selected_engine,
        local.current_state().await,
        deepgram.current_state().await,
        yandex.current_state().await,
    );

    let res = match action {
        HotkeyAction::BatchStart(_) => start_recording_impl(&app).await.map(|_| ()),
        HotkeyAction::BatchStop => stop_recording_impl(&app).await.map(|_| ()),
        HotkeyAction::LiveStart(provider) => {
            start_live_provider(provider, &db, &deepgram, &yandex).await
        }
        HotkeyAction::LiveStop(provider) => stop_live_provider(provider, &db, &deepgram, &yandex)
            .await
            .map(|_| ()),
        HotkeyAction::Ignore => Ok(()),
    };
    if let Err(e) = res {
        events::emit_to_whisper_windows(
            &app,
            events::EVT_ERROR,
            events::ErrorPayload {
                code: "hotkey_toggle_failed".into(),
                message: e,
            },
        );
    }
}

#[tauri::command]
pub async fn whisper_cancel_recording(svc: State<'_, WhisperService>) -> Result<(), String> {
    svc.cancel_recording().await;
    Ok(())
}

#[tauri::command]
pub async fn whisper_stop_active(app: AppHandle) -> Result<String, String> {
    let db = app.state::<DbState>();
    let local = app.state::<WhisperService>();
    let deepgram = app.state::<DeepgramLiveService>();
    let yandex = app.state::<YandexSpeechKitLiveService>();
    match decide_active_stop_action(
        local.current_state().await,
        deepgram.current_state().await,
        yandex.current_state().await,
    ) {
        HotkeyAction::BatchStop => stop_recording_impl(&app).await,
        HotkeyAction::LiveStop(provider) => {
            stop_live_provider(provider, &db, &deepgram, &yandex).await
        }
        HotkeyAction::Ignore | HotkeyAction::BatchStart(_) | HotkeyAction::LiveStart(_) => {
            Ok(String::new())
        }
    }
}

#[tauri::command]
pub async fn whisper_cancel_active(app: AppHandle) -> Result<(), String> {
    let local = app.state::<WhisperService>();
    let deepgram = app.state::<DeepgramLiveService>();
    let yandex = app.state::<YandexSpeechKitLiveService>();
    match decide_active_cancel_action(
        local.current_state().await,
        deepgram.current_state().await,
        yandex.current_state().await,
    ) {
        HotkeyAction::BatchStop => local.cancel_recording().await,
        HotkeyAction::LiveStop(provider) => {
            cancel_live_provider(provider, &deepgram, &yandex).await
        }
        HotkeyAction::Ignore | HotkeyAction::BatchStart(_) | HotkeyAction::LiveStart(_) => {}
    }
    Ok(())
}

#[tauri::command]
pub async fn whisper_status(svc: State<'_, WhisperService>) -> Result<serde_json::Value, String> {
    Ok(svc.status().await)
}

fn deepgram_config_from_settings(db: &DbState) -> Result<DeepgramConfig, String> {
    let conn = db.lock_recover();
    let cid = computer_id();
    let api_key = queries::get_setting(&conn, &cid, "whisper.deepgram_api_key")
        .ok()
        .flatten()
        .unwrap_or_default();
    if api_key.trim().is_empty() {
        return Err(
            "Deepgram API key is missing. Open Whisper Settings and add a local Deepgram key."
                .into(),
        );
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

fn yandex_config_from_settings(
    db: &DbState,
    require_folder_id: bool,
) -> Result<YandexSpeechKitConfig, String> {
    let conn = db.lock_recover();
    let cid = computer_id();
    let api_key = queries::get_setting(&conn, &cid, "whisper.yandex_api_key")
        .ok()
        .flatten()
        .unwrap_or_default();
    if api_key.trim().is_empty() {
        return Err(
            "Yandex SpeechKit API key is missing. Open Whisper Settings and add a local Yandex key."
                .into(),
        );
    }
    let model = queries::get_setting(&conn, &cid, "whisper.yandex_model")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "general".into());
    let folder_id = queries::get_setting(&conn, &cid, "whisper.yandex_folder_id")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty());
    if require_folder_id && folder_id.is_none() {
        return Err(YANDEX_FOLDER_ID_MISSING_MESSAGE.into());
    }
    let language = queries::get_setting(&conn, &cid, "whisper.yandex_language")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| Some("ru-RU".into()));
    let text_normalization = queries::get_setting(&conn, &cid, "whisper.yandex_text_normalization")
        .ok()
        .flatten()
        .map(|s| s == "true")
        .unwrap_or(true);
    let literature_text = queries::get_setting(&conn, &cid, "whisper.yandex_literature_text")
        .ok()
        .flatten()
        .map(|s| s == "true")
        .unwrap_or(true);
    let profanity_filter = queries::get_setting(&conn, &cid, "whisper.yandex_profanity_filter")
        .ok()
        .flatten()
        .map(|s| s == "true")
        .unwrap_or(false);
    let phone_formatting = queries::get_setting(&conn, &cid, "whisper.yandex_phone_formatting")
        .ok()
        .flatten()
        .map(|s| s == "true")
        .unwrap_or(false);
    let restore = queries::get_setting(&conn, &cid, "whisper.clipboard_restore_delay_ms")
        .ok()
        .flatten()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(200);
    let mic_device = queries::get_setting(&conn, &cid, "whisper.mic_device")
        .ok()
        .flatten()
        .filter(|s| !s.is_empty());
    Ok(YandexSpeechKitConfig {
        api_key,
        folder_id,
        model,
        language,
        text_normalization,
        literature_text,
        profanity_filter,
        phone_formatting,
        clipboard_restore_delay_ms: restore,
        mic_device,
    })
}

async fn start_live_provider(
    provider: LiveProvider,
    db: &DbState,
    deepgram: &DeepgramLiveService,
    yandex: &YandexSpeechKitLiveService,
) -> Result<(), String> {
    match provider {
        LiveProvider::Deepgram => deepgram.start(deepgram_config_from_settings(db)?).await,
        LiveProvider::Yandex => yandex.start(yandex_config_from_settings(db, false)?).await,
    }
}

async fn stop_live_provider(
    provider: LiveProvider,
    db: &DbState,
    deepgram: &DeepgramLiveService,
    yandex: &YandexSpeechKitLiveService,
) -> Result<String, String> {
    match provider {
        LiveProvider::Deepgram => deepgram.stop_and_persist(db).await,
        LiveProvider::Yandex => yandex.stop_and_persist(db).await,
    }
}

async fn cancel_live_provider(
    provider: LiveProvider,
    deepgram: &DeepgramLiveService,
    yandex: &YandexSpeechKitLiveService,
) {
    match provider {
        LiveProvider::Deepgram => deepgram.cancel().await,
        LiveProvider::Yandex => yandex.cancel().await,
    }
}

#[tauri::command]
pub async fn whisper_live_start(
    db: State<'_, DbState>,
    deepgram: State<'_, DeepgramLiveService>,
    yandex: State<'_, YandexSpeechKitLiveService>,
) -> Result<(), String> {
    if active_live_provider(deepgram.current_state().await, yandex.current_state().await).is_some()
    {
        return Ok(());
    }
    start_live_provider(selected_live_provider(&db), &db, &deepgram, &yandex).await
}

#[tauri::command]
pub async fn whisper_live_stop(
    db: State<'_, DbState>,
    deepgram: State<'_, DeepgramLiveService>,
    yandex: State<'_, YandexSpeechKitLiveService>,
) -> Result<String, String> {
    let provider =
        active_live_provider(deepgram.current_state().await, yandex.current_state().await)
            .unwrap_or_else(|| selected_live_provider(&db));
    stop_live_provider(provider, &db, &deepgram, &yandex).await
}

#[tauri::command]
pub async fn whisper_live_cancel(
    deepgram: State<'_, DeepgramLiveService>,
    yandex: State<'_, YandexSpeechKitLiveService>,
) -> Result<(), String> {
    if let Some(provider) =
        active_live_provider(deepgram.current_state().await, yandex.current_state().await)
    {
        cancel_live_provider(provider, &deepgram, &yandex).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn whisper_live_status(
    db: State<'_, DbState>,
    deepgram: State<'_, DeepgramLiveService>,
    yandex: State<'_, YandexSpeechKitLiveService>,
) -> Result<serde_json::Value, String> {
    let provider =
        active_live_provider(deepgram.current_state().await, yandex.current_state().await)
            .unwrap_or_else(|| selected_live_provider(&db));
    match provider {
        LiveProvider::Deepgram => Ok(deepgram.status().await),
        LiveProvider::Yandex => Ok(yandex.status().await),
    }
}

#[tauri::command]
pub async fn whisper_unload_now(svc: State<'_, WhisperService>) -> Result<(), String> {
    svc.unload_now().await;
    Ok(())
}

#[tauri::command]
pub async fn whisper_inject_text(
    text: String,
    method: String,
    db: State<'_, DbState>,
) -> Result<&'static str, String> {
    let delay = {
        let conn = db.lock_recover();
        let cid = computer_id();
        queries::get_setting(&conn, &cid, "whisper.clipboard_restore_delay_ms")
            .ok()
            .flatten()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(200)
    };
    inject::inject(&text, InjectMethod::from_setting(&method), delay).await
}

// --- history -----------------------------------------------------------------

#[tauri::command]
pub fn whisper_get_history(
    db: State<DbState>,
    limit: Option<i64>,
) -> Result<Vec<WhisperHistoryRow>, String> {
    let conn = db.lock_recover();
    queries::whisper_list_history(&conn, limit.unwrap_or(200)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn whisper_delete_history(db: State<DbState>, id: Option<i64>) -> Result<(), String> {
    let conn = db.lock_recover();
    queries::whisper_delete_history(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn whisper_set_postprocessed(db: State<DbState>, id: i64, text: String) -> Result<(), String> {
    let conn = db.lock_recover();
    queries::whisper_set_postprocessed(&conn, id, &text).map_err(|e| e.to_string())
}

// --- mics & GPU --------------------------------------------------------------

#[tauri::command]
pub fn whisper_list_mics() -> Vec<crate::whisper::audio::InputDevice> {
    crate::whisper::audio::list_input_devices()
}

#[tauri::command]
pub fn whisper_gpu_info() -> HardwareInfo {
    gpu_detect::detect()
}

#[derive(serde::Serialize)]
pub struct WhisperBinInfo {
    pub variant: &'static str,
    pub installed: bool,
    pub path: Option<String>,
    pub dl_url: Option<String>,
    pub dl_size_bytes: Option<u64>,
}

#[tauri::command]
pub fn whisper_detect_whisper_bin(app: AppHandle) -> WhisperBinInfo {
    let data = app_data(&app);
    if let Some(p) = bin_manager::downloaded_gpu_bin(&data) {
        return WhisperBinInfo {
            variant: if p.to_string_lossy().contains("cuda") {
                "cuda"
            } else if p.to_string_lossy().contains("vulkan") {
                "vulkan"
            } else {
                "metal"
            },
            installed: true,
            path: Some(p.to_string_lossy().to_string()),
            dl_url: None,
            dl_size_bytes: None,
        };
    }
    WhisperBinInfo {
        variant: "cpu",
        installed: true,
        path: None,
        dl_url: None,
        dl_size_bytes: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::whisper::deepgram::LiveState;
    use crate::whisper::service::State as LocalState;

    #[test]
    fn yandex_missing_folder_id_message_explains_batch_and_live_alternative() {
        assert!(YANDEX_FOLDER_ID_MISSING_MESSAGE.contains("Yandex batch recognition"));
        assert!(YANDEX_FOLDER_ID_MISSING_MESSAGE.contains("Folder ID"));
        assert!(YANDEX_FOLDER_ID_MISSING_MESSAGE.contains("Live dictate"));
    }

    #[test]
    fn recognition_engine_setting_parses_local_and_cloud_values() {
        let installed = ["ggml-base", "ggml-small"];

        assert_eq!(
            resolve_recognition_engine_setting(
                Some("local:ggml-small"),
                false,
                LiveProvider::Deepgram,
                Some("ggml-base"),
                &installed,
            )
            .unwrap(),
            RecognitionEngine::Local("ggml-small".into())
        );
        assert_eq!(
            resolve_recognition_engine_setting(
                Some("deepgram"),
                false,
                LiveProvider::Yandex,
                Some("ggml-base"),
                &installed,
            )
            .unwrap(),
            RecognitionEngine::Deepgram
        );
        assert_eq!(
            resolve_recognition_engine_setting(
                Some("yandex"),
                false,
                LiveProvider::Deepgram,
                Some("ggml-base"),
                &installed,
            )
            .unwrap(),
            RecognitionEngine::Yandex
        );
    }

    #[test]
    fn missing_recognition_engine_preserves_existing_live_settings() {
        let installed = ["ggml-base"];

        assert_eq!(
            resolve_recognition_engine_setting(
                None,
                true,
                LiveProvider::Yandex,
                Some("ggml-base"),
                &installed,
            )
            .unwrap(),
            RecognitionEngine::Yandex
        );
        assert_eq!(
            resolve_recognition_engine_setting(
                None,
                false,
                LiveProvider::Deepgram,
                Some("ggml-base"),
                &installed,
            )
            .unwrap(),
            RecognitionEngine::Local("ggml-base".into())
        );
    }

    #[test]
    fn invalid_or_deleted_local_engine_falls_back_to_default_model() {
        let installed = ["ggml-base"];

        assert_eq!(
            resolve_recognition_engine_setting(
                Some("local:ggml-missing"),
                false,
                LiveProvider::Deepgram,
                Some("ggml-base"),
                &installed,
            )
            .unwrap(),
            RecognitionEngine::Local("ggml-base".into())
        );
        assert_eq!(
            resolve_recognition_engine_setting(
                Some("not-a-real-engine"),
                false,
                LiveProvider::Deepgram,
                Some("ggml-base"),
                &installed,
            )
            .unwrap(),
            RecognitionEngine::Local("ggml-base".into())
        );
    }

    #[test]
    fn cloud_engine_does_not_require_local_model_when_explicitly_selected() {
        assert_eq!(
            resolve_recognition_engine_setting(
                Some("deepgram"),
                false,
                LiveProvider::Deepgram,
                None,
                &[],
            )
            .unwrap(),
            RecognitionEngine::Deepgram
        );
        assert!(
            resolve_recognition_engine_setting(None, false, LiveProvider::Deepgram, None, &[],)
                .is_err()
        );
    }

    #[test]
    fn hotkey_uses_live_service_when_live_dictate_is_enabled() {
        assert_eq!(
            decide_hotkey_action(
                true,
                RecognitionEngine::Deepgram,
                LocalState::Idle,
                LiveState::Idle,
                LiveState::Idle,
            ),
            HotkeyAction::LiveStart(LiveProvider::Deepgram)
        );
        assert_eq!(
            decide_hotkey_action(
                true,
                RecognitionEngine::Deepgram,
                LocalState::Ready,
                LiveState::Streaming,
                LiveState::Idle,
            ),
            HotkeyAction::LiveStop(LiveProvider::Deepgram)
        );
    }

    #[test]
    fn hotkey_stops_active_local_recording_before_starting_live() {
        assert_eq!(
            decide_hotkey_action(
                true,
                RecognitionEngine::Deepgram,
                LocalState::Recording,
                LiveState::Idle,
                LiveState::Idle,
            ),
            HotkeyAction::BatchStop
        );
        assert_eq!(
            decide_hotkey_action(
                true,
                RecognitionEngine::Deepgram,
                LocalState::Warming,
                LiveState::Idle,
                LiveState::Idle,
            ),
            HotkeyAction::BatchStop
        );
    }

    #[test]
    fn hotkey_stops_active_live_stream_even_when_live_setting_is_off() {
        assert_eq!(
            decide_hotkey_action(
                false,
                RecognitionEngine::Deepgram,
                LocalState::Idle,
                LiveState::Streaming,
                LiveState::Idle,
            ),
            HotkeyAction::LiveStop(LiveProvider::Deepgram)
        );
    }

    #[test]
    fn hotkey_starts_cloud_batch_when_cloud_engine_live_is_off() {
        assert_eq!(
            decide_hotkey_action(
                false,
                RecognitionEngine::Deepgram,
                LocalState::Idle,
                LiveState::Idle,
                LiveState::Idle,
            ),
            HotkeyAction::BatchStart(RecognitionEngine::Deepgram)
        );
        assert_eq!(
            decide_hotkey_action(
                false,
                RecognitionEngine::Yandex,
                LocalState::Ready,
                LiveState::Idle,
                LiveState::Idle,
            ),
            HotkeyAction::BatchStart(RecognitionEngine::Yandex)
        );
    }

    #[test]
    fn hotkey_debounce_rejects_auto_repeat_pressed_events() {
        assert!(should_accept_hotkey_press(1_000, Some(100)));
        assert!(!should_accept_hotkey_press(1_100, Some(1_000)));
        assert!(should_accept_hotkey_press(1_900, Some(1_100)));
    }

    #[test]
    fn overlay_stop_targets_active_live_before_local_ready() {
        assert_eq!(
            decide_active_stop_action(LocalState::Ready, LiveState::Streaming, LiveState::Idle),
            HotkeyAction::LiveStop(LiveProvider::Deepgram)
        );
        assert_eq!(
            decide_active_stop_action(
                LocalState::Recording,
                LiveState::Connecting,
                LiveState::Idle
            ),
            HotkeyAction::LiveStop(LiveProvider::Deepgram)
        );
    }

    #[test]
    fn overlay_stop_falls_back_to_local_recording() {
        assert_eq!(
            decide_active_stop_action(LocalState::Recording, LiveState::Idle, LiveState::Idle),
            HotkeyAction::BatchStop
        );
        assert_eq!(
            decide_active_stop_action(LocalState::Warming, LiveState::Idle, LiveState::Idle),
            HotkeyAction::BatchStop
        );
    }

    #[test]
    fn overlay_stop_ignores_inactive_states() {
        assert_eq!(
            decide_active_stop_action(LocalState::Ready, LiveState::Idle, LiveState::Idle),
            HotkeyAction::Ignore
        );
        assert_eq!(
            decide_active_stop_action(LocalState::Transcribing, LiveState::Idle, LiveState::Idle),
            HotkeyAction::Ignore
        );
    }

    #[test]
    fn live_provider_setting_defaults_to_deepgram() {
        assert_eq!(LiveProvider::from_setting(None), LiveProvider::Deepgram);
        assert_eq!(
            LiveProvider::from_setting(Some("".to_string())),
            LiveProvider::Deepgram
        );
        assert_eq!(
            LiveProvider::from_setting(Some("yandex".to_string())),
            LiveProvider::Yandex
        );
    }

    #[test]
    fn hotkey_starts_selected_live_provider_when_enabled() {
        assert_eq!(
            decide_hotkey_action(
                true,
                RecognitionEngine::Yandex,
                LocalState::Idle,
                LiveState::Idle,
                LiveState::Idle,
            ),
            HotkeyAction::LiveStart(LiveProvider::Yandex)
        );
    }

    #[test]
    fn stop_targets_active_yandex_even_if_deepgram_is_selected() {
        assert_eq!(
            decide_active_stop_action(LocalState::Ready, LiveState::Idle, LiveState::Streaming,),
            HotkeyAction::LiveStop(LiveProvider::Yandex)
        );
    }

    #[test]
    fn live_error_state_does_not_block_new_selected_provider_start() {
        assert_eq!(
            decide_hotkey_action(
                true,
                RecognitionEngine::Yandex,
                LocalState::Ready,
                LiveState::Error,
                LiveState::Idle,
            ),
            HotkeyAction::LiveStart(LiveProvider::Yandex)
        );
        assert_eq!(
            decide_hotkey_action(
                true,
                RecognitionEngine::Yandex,
                LocalState::Ready,
                LiveState::Idle,
                LiveState::Error,
            ),
            HotkeyAction::LiveStart(LiveProvider::Yandex)
        );
    }
}
