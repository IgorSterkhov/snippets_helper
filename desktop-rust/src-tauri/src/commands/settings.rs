use tauri::State;
use crate::db::{DbState, queries};
use crate::sync::client::SyncClient;

#[tauri::command]
pub fn get_setting(state: State<DbState>, key: String) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let computer_id = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    queries::get_setting(&conn, &computer_id, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(state: State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let computer_id = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    queries::set_setting(&conn, &computer_id, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hide_and_sync(window: tauri::WebviewWindow, state: State<'_, DbState>) -> Result<(), String> {
    let _ = window.hide();

    // Try to sync in background -- don't block on errors
    let computer_id = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Read sync settings
    let (url_opt, key_opt, ca_cert) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let url = queries::get_setting(&db, &computer_id, "sync_api_url").ok().flatten();
        let key = queries::get_setting(&db, &computer_id, "sync_api_key").ok().flatten();
        let cert = queries::get_setting(&db, &computer_id, "sync_ca_cert").ok().flatten();
        (url, key, cert)
    };

    if let (Some(url), Some(key)) = (url_opt, key_opt) {
        if let Ok(client) = SyncClient::new(&url, &key, ca_cert.as_deref()) {
            let _ = client.push(&state.0, &computer_id).await;
        }
    }
    Ok(())
}
