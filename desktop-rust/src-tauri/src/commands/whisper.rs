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
use crate::whisper::service::WhisperService;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};

const HOTKEY_DEBOUNCE_MS: u64 = 700;
static LAST_WHISPER_HOTKEY_MS: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HotkeyAction {
    LocalStart,
    LocalStop,
    LiveStart,
    LiveStop,
    Ignore,
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

fn decide_hotkey_action(
    live_enabled: bool,
    local_state: crate::whisper::service::State,
    live_state: LiveState,
) -> HotkeyAction {
    use crate::whisper::service::State as WState;

    match local_state {
        WState::Warming | WState::Recording => return HotkeyAction::LocalStop,
        WState::Transcribing | WState::Unloading => return HotkeyAction::Ignore,
        WState::Idle | WState::Ready => {}
    }

    match live_state {
        LiveState::Connecting | LiveState::Streaming => return HotkeyAction::LiveStop,
        LiveState::Stopping => return HotkeyAction::Ignore,
        LiveState::Idle | LiveState::Error => {}
    }

    if live_enabled {
        HotkeyAction::LiveStart
    } else {
        HotkeyAction::LocalStart
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
    let (model_path, model_name, device_name, idle_timeout_sec) = {
        let conn = db.lock_recover();
        let def = queries::whisper_get_default_model(&conn)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "no default model installed".to_string())?;
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
        (std::path::PathBuf::from(def.file_path), def.name, mic, idle)
    };
    svc.set_idle_timeout(std::time::Duration::from_secs(idle_timeout_sec))
        .await;
    svc.start_recording(model_path, model_name, device_name)
        .await
}

#[tauri::command]
pub async fn whisper_start_recording(app: AppHandle) -> Result<(), String> {
    start_recording_impl(&app).await
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

    // F4: run inference, get StopOutcome (durations + metrics included)
    let outcome = svc.stop_recording(lang).await?;
    let result = outcome.result;
    let model_name = outcome.model_name;
    let duration_ms = outcome.duration_ms;
    let transcribe_ms = outcome.transcribe_ms;
    let cpu_peak = outcome.cpu_peak_percent;
    let gpu_peak = outcome.gpu_peak_percent;
    let vram_peak = outcome.vram_peak_mb;

    // Postprocess
    let raw = result.text.clone();
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
    let _ = app.emit(
        events::EVT_TRANSCRIBED,
        events::TranscribedPayload {
            text: text.clone(),
            duration_ms,
            transcribe_ms,
            model: model_name.clone(),
            language: result.language.clone(),
            cpu_peak_percent: cpu_peak,
            gpu_peak_percent: gpu_peak,
            vram_peak_mb: vram_peak,
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
        let _ = queries::whisper_insert_history(
            &conn,
            &text,
            text_raw_opt,
            &model_name,
            duration_ms as i64,
            transcribe_ms as i64,
            result.language.as_deref(),
            Some(injected),
            cpu_peak,
            gpu_peak,
            vram_peak,
        )
        .map_err(|e| e.to_string());
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
    let live = app.state::<DeepgramLiveService>();
    let action = decide_hotkey_action(
        live_dictate_enabled(&db),
        local.current_state().await,
        live.current_state().await,
    );

    let res = match action {
        HotkeyAction::LocalStart => start_recording_impl(&app).await.map(|_| ()),
        HotkeyAction::LocalStop => stop_recording_impl(&app).await.map(|_| ()),
        HotkeyAction::LiveStart => match deepgram_config_from_settings(&db) {
            Ok(cfg) => live.start(cfg).await,
            Err(e) => Err(e),
        },
        HotkeyAction::LiveStop => live.stop_and_persist(&db).await.map(|_| ()),
        HotkeyAction::Ignore => Ok(()),
    };
    if let Err(e) = res {
        let _ = app.emit(
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
pub async fn whisper_live_status(
    svc: State<'_, DeepgramLiveService>,
) -> Result<serde_json::Value, String> {
    Ok(svc.status().await)
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
    fn hotkey_uses_live_service_when_live_dictate_is_enabled() {
        assert_eq!(
            decide_hotkey_action(true, LocalState::Idle, LiveState::Idle),
            HotkeyAction::LiveStart
        );
        assert_eq!(
            decide_hotkey_action(true, LocalState::Ready, LiveState::Streaming),
            HotkeyAction::LiveStop
        );
    }

    #[test]
    fn hotkey_stops_active_local_recording_before_starting_live() {
        assert_eq!(
            decide_hotkey_action(true, LocalState::Recording, LiveState::Idle),
            HotkeyAction::LocalStop
        );
        assert_eq!(
            decide_hotkey_action(true, LocalState::Warming, LiveState::Idle),
            HotkeyAction::LocalStop
        );
    }

    #[test]
    fn hotkey_stops_active_live_stream_even_when_live_setting_is_off() {
        assert_eq!(
            decide_hotkey_action(false, LocalState::Idle, LiveState::Streaming),
            HotkeyAction::LiveStop
        );
    }

    #[test]
    fn hotkey_debounce_rejects_auto_repeat_pressed_events() {
        assert!(should_accept_hotkey_press(1_000, Some(100)));
        assert!(!should_accept_hotkey_press(1_100, Some(1_000)));
        assert!(should_accept_hotkey_press(1_900, Some(1_100)));
    }
}
