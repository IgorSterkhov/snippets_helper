use tauri::State;
use crate::db::{DbState, queries};
use crate::sync::client::SyncClient;

#[tauri::command]
pub async fn trigger_sync(state: State<'_, DbState>) -> Result<String, String> {
    let computer_id = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Read sync settings while holding the lock briefly
    let (api_url, api_key, ca_cert) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let url = queries::get_setting(&conn, &computer_id, "sync_api_url")
            .map_err(|e| e.to_string())?;
        let key = queries::get_setting(&conn, &computer_id, "sync_api_key")
            .map_err(|e| e.to_string())?;
        let cert = queries::get_setting(&conn, &computer_id, "sync_ca_cert")
            .map_err(|e| e.to_string())?;
        (url, key, cert)
    };

    let url = api_url.ok_or("sync_api_url not configured")?;
    let key = api_key.ok_or("sync_api_key not configured")?;

    let client = SyncClient::new(&url, &key, ca_cert.as_deref())?;

    // Push then Pull -- the client manages its own locking internally
    client.push(&state.0, &computer_id).await?;
    client.pull(&state.0, &computer_id).await?;

    Ok("ok".to_string())
}
