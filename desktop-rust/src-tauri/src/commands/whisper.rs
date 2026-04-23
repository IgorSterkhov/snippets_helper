//! Tauri commands for the whisper voice-input feature.

use tauri::{AppHandle, Emitter, Manager, State};
use crate::db::DbState;
use crate::db::queries::{
    self,
    WhisperHistoryRow, WhisperModelRow,
};
use crate::whisper::catalog::{self, ModelMeta};
use crate::whisper::events;
use crate::whisper::gpu_detect::{self, HardwareInfo};
use crate::whisper::bin_manager;
use crate::whisper::inject::{self, InjectMethod};
use crate::whisper::models;
use crate::whisper::postprocess::{self, LlmConfig};
use crate::whisper::service::WhisperService;

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
    app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
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
    let should_set_default;
    {
        let conn = db.lock_recover();
        queries::whisper_insert_or_upgrade_model(
            &conn,
            meta.name,
            meta.display_name,
            &path.to_string_lossy(),
            meta.size_bytes as i64,
            meta.sha256,
        ).map_err(|e| e.to_string())?;
        let all = queries::whisper_list_models(&conn).map_err(|e| e.to_string())?;
        should_set_default = all.len() == 1;
    }
    if should_set_default {
        let mut conn2 = db.lock_recover();
        queries::whisper_set_default_model(&mut conn2, meta.name).map_err(|e| e.to_string())?;
    }
    let conn = db.lock_recover();
    let rows = queries::whisper_list_models(&conn).map_err(|e| e.to_string())?;
    rows.into_iter()
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

#[tauri::command]
pub async fn whisper_start_recording(
    db: State<'_, DbState>,
    svc: State<'_, WhisperService>,
) -> Result<(), String> {
    let (model_path, model_name, device_name, idle_timeout_sec) = {
        let conn = db.lock_recover();
        let def = queries::whisper_get_default_model(&conn).map_err(|e| e.to_string())?
            .ok_or_else(|| "no default model installed".to_string())?;
        let cid = computer_id();
        let mic = queries::get_setting(&conn, &cid, "whisper.mic_device").ok().flatten().filter(|s| !s.is_empty());
        let idle = queries::get_setting(&conn, &cid, "whisper.idle_timeout_sec").ok().flatten()
            .and_then(|s| s.parse::<u64>().ok()).unwrap_or(300);
        (std::path::PathBuf::from(def.file_path), def.name, mic, idle)
    };
    svc.set_idle_timeout(std::time::Duration::from_secs(idle_timeout_sec)).await;
    svc.start_recording(model_path, model_name, device_name).await
}

#[tauri::command]
pub async fn whisper_stop_recording(
    app: AppHandle,
    db: State<'_, DbState>,
    svc: State<'_, WhisperService>,
) -> Result<String, String> {
    // Read settings
    let (inject_method_str, restore_delay_ms, rules_on, llm_cfg_opt, lang) = {
        let conn = db.lock_recover();
        let cid = computer_id();
        let inj = queries::get_setting(&conn, &cid, "whisper.inject_method").ok().flatten().unwrap_or_else(|| "paste".into());
        let delay = queries::get_setting(&conn, &cid, "whisper.clipboard_restore_delay_ms").ok().flatten()
            .and_then(|s| s.parse::<u64>().ok()).unwrap_or(200);
        let rules = queries::get_setting(&conn, &cid, "whisper.postprocess_rules").ok().flatten()
            .map(|s| s == "true").unwrap_or(true);
        let llm_enabled = queries::get_setting(&conn, &cid, "whisper.llm_enabled").ok().flatten()
            .map(|s| s == "true").unwrap_or(false);
        let llm_cfg = if llm_enabled {
            Some(LlmConfig {
                endpoint: queries::get_setting(&conn, &cid, "whisper.llm_endpoint").ok().flatten().unwrap_or_default(),
                api_key: queries::get_setting(&conn, &cid, "whisper.llm_api_key").ok().flatten().unwrap_or_default(),
                model: queries::get_setting(&conn, &cid, "whisper.llm_model").ok().flatten().unwrap_or_else(|| "gpt-4o-mini".into()),
                prompt: queries::get_setting(&conn, &cid, "whisper.llm_prompt").ok().flatten()
                    .unwrap_or_else(|| "Clean up filler words; fix punctuation. Keep language.".into()),
            })
        } else { None };
        let lang = queries::get_setting(&conn, &cid, "whisper.language").ok().flatten();
        (inj, delay, rules, llm_cfg, lang)
    };

    // F4: run inference, get StopOutcome (durations included)
    let outcome = svc.stop_recording(lang).await?;
    let result = outcome.result;
    let model_name = outcome.model_name;
    let duration_ms = outcome.duration_ms;
    let transcribe_ms = outcome.transcribe_ms;

    // Postprocess
    let raw = result.text.clone();
    let mut text = if rules_on { postprocess::apply_rules(&raw) } else { raw.clone() };
    if let Some(cfg) = llm_cfg_opt { text = postprocess::apply_llm(&text, &cfg).await; }

    // Inject
    let method = InjectMethod::from_setting(&inject_method_str);
    let injected = inject::inject(&text, method, restore_delay_ms).await
        .unwrap_or_else(|e| {
            eprintln!("[whisper inject] fallback: {e}");
            "copy"
        });

    // F4: emit real durations
    let _ = app.emit(events::EVT_TRANSCRIBED, events::TranscribedPayload {
        text: text.clone(),
        duration_ms,
        transcribe_ms,
        model: model_name.clone(),
        language: result.language.clone(),
    });

    // F4: persist real durations
    {
        let conn = db.lock_recover();
        let text_raw_opt = if raw != text { Some(raw.as_str()) } else { None };
        queries::whisper_insert_history(
            &conn,
            &text,
            text_raw_opt,
            &model_name,
            duration_ms as i64,
            transcribe_ms as i64,
            result.language.as_deref(),
            Some(injected),
        ).map_err(|e| e.to_string())?;
    }

    Ok(text)
}

#[tauri::command]
pub async fn whisper_cancel_recording(svc: State<'_, WhisperService>) -> Result<(), String> {
    svc.cancel_recording().await;
    Ok(())
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
        queries::get_setting(&conn, &cid, "whisper.clipboard_restore_delay_ms").ok().flatten()
            .and_then(|s| s.parse::<u64>().ok()).unwrap_or(200)
    };
    inject::inject(&text, InjectMethod::from_setting(&method), delay).await
}

// --- history -----------------------------------------------------------------

#[tauri::command]
pub fn whisper_get_history(db: State<DbState>, limit: Option<i64>) -> Result<Vec<WhisperHistoryRow>, String> {
    let conn = db.lock_recover();
    queries::whisper_list_history(&conn, limit.unwrap_or(200)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn whisper_delete_history(db: State<DbState>, id: Option<i64>) -> Result<(), String> {
    let conn = db.lock_recover();
    queries::whisper_delete_history(&conn, id).map_err(|e| e.to_string())
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
            variant: if p.to_string_lossy().contains("cuda") { "cuda" }
                else if p.to_string_lossy().contains("vulkan") { "vulkan" }
                else { "metal" },
            installed: true,
            path: Some(p.to_string_lossy().to_string()),
            dl_url: None, dl_size_bytes: None,
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
