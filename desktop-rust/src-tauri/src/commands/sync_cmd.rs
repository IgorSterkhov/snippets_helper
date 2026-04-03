use tauri::State;
use crate::db::{DbState, queries};
use crate::sync::client::SyncClient;
use serde_json::Value;

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

#[tauri::command]
pub async fn register_sync(state: State<'_, DbState>, api_url: String, name: String) -> Result<Value, String> {
    let computer_id = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Build HTTP client that accepts self-signed certs
    let ca_cert = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        queries::get_setting(&conn, &computer_id, "sync_ca_cert")
            .map_err(|e| e.to_string())?
    };

    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30));
    if let Some(ref path) = ca_cert {
        if std::path::Path::new(path).is_file() {
            let pem = std::fs::read(path).map_err(|e| format!("read CA cert: {e}"))?;
            let cert = reqwest::Certificate::from_pem(&pem).map_err(|e| format!("parse CA cert: {e}"))?;
            builder = builder.add_root_certificate(cert);
        } else if api_url.starts_with("https://") {
            builder = builder.danger_accept_invalid_certs(true);
        }
    } else if api_url.starts_with("https://") {
        builder = builder.danger_accept_invalid_certs(true);
    }

    let client = builder.build().map_err(|e| format!("build http client: {e}"))?;
    let url = format!("{}/v1/auth/register", api_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .json(&serde_json::json!({"name": name}))
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let data: Value = resp.json().await.map_err(|e| format!("parse response: {e}"))?;
    Ok(data)
}

#[tauri::command]
pub async fn check_sync_health(api_url: String) -> Result<bool, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(5));
    if api_url.starts_with("https://") {
        builder = builder.danger_accept_invalid_certs(true);
    }
    let client = builder.build().map_err(|e| e.to_string())?;
    let url = format!("{}/v1/health", api_url.trim_end_matches('/'));

    match client.get(&url).send().await {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}
