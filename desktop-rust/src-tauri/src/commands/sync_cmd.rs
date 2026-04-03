use tauri::State;
use crate::db::{DbState, queries};
use crate::sync::client::SyncClient;
use serde_json::{Value, json};

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

#[tauri::command]
pub async fn check_for_update() -> Result<Value, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .danger_accept_invalid_certs(true)
        .user_agent("KeyboardHelper")
        .build()
        .map_err(|e| format!("build http client: {e}"))?;

    // Try Tauri latest.json first
    let tauri_url = "https://github.com/IgorSterkhov/snippets_helper/releases/latest/download/latest.json";
    if let Ok(resp) = client.get(tauri_url).send().await {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<Value>().await {
                if let Some(version_str) = data.get("version").and_then(|v| v.as_str()) {
                    let latest = version_str.trim_start_matches('v').to_string();
                    let has_update = version_is_newer(&current_version, &latest);
                    // Build download URL from notes or default
                    let download_url = format!(
                        "https://github.com/IgorSterkhov/snippets_helper/releases/tag/v{}",
                        latest
                    );
                    return Ok(json!({
                        "current_version": current_version,
                        "latest_version": latest,
                        "has_update": has_update,
                        "download_url": download_url,
                    }));
                }
            }
        }
    }

    // Fallback: GitHub API
    let api_url = "https://api.github.com/repos/IgorSterkhov/snippets_helper/releases/latest";
    let resp = client
        .get(api_url)
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned HTTP {}", resp.status()));
    }

    let data: Value = resp.json().await.map_err(|e| format!("parse GitHub response: {e}"))?;
    let tag = data
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    let html_url = data
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let has_update = version_is_newer(&current_version, &tag);

    Ok(json!({
        "current_version": current_version,
        "latest_version": tag,
        "has_update": has_update,
        "download_url": html_url,
    }))
}

/// Compare semver strings: returns true if `latest` is strictly newer than `current`.
fn version_is_newer(current: &str, latest: &str) -> bool {
    let parse = |s: &str| -> Vec<u64> {
        s.split('.')
            .filter_map(|p| p.parse::<u64>().ok())
            .collect()
    };
    let c = parse(current);
    let l = parse(latest);
    for i in 0..c.len().max(l.len()) {
        let cv = c.get(i).copied().unwrap_or(0);
        let lv = l.get(i).copied().unwrap_or(0);
        if lv > cv {
            return true;
        }
        if lv < cv {
            return false;
        }
    }
    false
}
