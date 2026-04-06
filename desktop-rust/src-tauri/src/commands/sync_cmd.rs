use tauri::State;
use crate::db::{DbState, queries};
use crate::sync::client::SyncClient;
use serde_json::{Value, json};

#[tauri::command]
pub async fn trigger_sync(state: State<'_, DbState>) -> Result<Value, String> {
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

    // Ensure user_id is saved (needed for pull to fill user_id on rows)
    let needs_user_id = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        queries::get_setting(&conn, &computer_id, "sync_user_id").ok().flatten().is_none()
    };
    if needs_user_id {
        let http = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(10))
            .build().map_err(|e| e.to_string())?;
        if let Ok(resp) = http.get(format!("{}/v1/auth/me", url.trim_end_matches('/')))
            .bearer_auth(&key).send().await {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(uid) = data.get("user_id").and_then(|v| v.as_str()) {
                    let conn = state.0.lock().map_err(|e| e.to_string())?;
                    let _ = queries::set_setting(&conn, &computer_id, "sync_user_id", uid);
                }
            }
        }
    }

    // Push then Pull -- the client manages its own locking internally
    let push_result = client.push(&state.0, &computer_id).await?;
    let pull_result = client.pull(&state.0, &computer_id).await?;

    Ok(json!({
        "push": push_result,
        "pull": pull_result,
        "timestamp": chrono::Utc::now().format("%H:%M:%S").to_string(),
    }))
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
pub async fn check_for_update(state: State<'_, DbState>) -> Result<Value, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    // Read GitHub token from settings (needed for private repos)
    let github_token = {
        let computer_id = hostname::get().unwrap_or_default().to_string_lossy().to_string();
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        queries::get_setting(&conn, &computer_id, "github_token")
            .map_err(|e| e.to_string())?
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .danger_accept_invalid_certs(true)
        .user_agent("KeyboardHelper")
        .build()
        .map_err(|e| format!("build http client: {e}"))?;

    // Use GitHub API to check latest release (works for both public and private repos with token)
    let api_url = "https://api.github.com/repos/IgorSterkhov/snippets_helper/releases/latest";
    let mut req = client.get(api_url);
    if let Some(ref token) = github_token {
        req = req.bearer_auth(token);
    }
    let resp = req
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

    // Find the right asset for current platform
    let platform_suffix = if cfg!(target_os = "windows") {
        "x64-setup.exe"
    } else if cfg!(target_os = "macos") {
        "aarch64.dmg"
    } else {
        "amd64.AppImage"
    };

    let mut asset_ready = false;
    let mut download_url = html_url.clone();
    if let Some(assets) = data.get("assets").and_then(|v| v.as_array()) {
        for asset in assets {
            if let Some(name) = asset.get("name").and_then(|v| v.as_str()) {
                if name.ends_with(platform_suffix) {
                    asset_ready = true;
                    if let Some(url) = asset.get("browser_download_url").and_then(|v| v.as_str()) {
                        download_url = url.to_string();
                    }
                    break;
                }
            }
        }
    }

    Ok(json!({
        "current_version": current_version,
        "latest_version": tag,
        "has_update": has_update && asset_ready,
        "download_url": download_url,
        "build_in_progress": has_update && !asset_ready,
    }))
}

#[tauri::command]
pub async fn force_full_sync(state: State<'_, DbState>) -> Result<Value, String> {
    let computer_id = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Delete last_sync_at to force full pull (null, not empty string)
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM app_settings WHERE computer_id = ?1 AND setting_key = 'last_sync_at'",
            rusqlite::params![computer_id],
        ).map_err(|e| e.to_string())?;
    }

    // Now do normal sync
    trigger_sync(state).await
}

#[tauri::command]
pub async fn debug_sync(state: State<'_, DbState>) -> Result<Value, String> {
    let computer_id = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

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

    let url = match api_url {
        Some(u) => u,
        None => return Ok(json!({"error": "sync_api_url not configured"})),
    };
    let key = match api_key {
        Some(k) => k,
        None => return Ok(json!({"error": "sync_api_key not configured"})),
    };

    // Check auth
    let client = SyncClient::new(&url, &key, ca_cert.as_deref())?;
    let http = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(10))
        .build().map_err(|e| e.to_string())?;

    let auth_resp = http
        .get(format!("{}/v1/auth/me", url.trim_end_matches('/')))
        .bearer_auth(&key)
        .send().await.map_err(|e| format!("auth request: {e}"))?;
    let auth_status = auth_resp.status().as_u16();
    let auth_body: Value = auth_resp.json().await.unwrap_or(json!(null));

    // Try pull with CURRENT last_sync_at
    let last_sync = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        queries::get_setting(&conn, &computer_id, "last_sync_at")
            .map_err(|e| e.to_string())?
    };

    let pull_resp = http
        .post(format!("{}/v1/sync/pull", url.trim_end_matches('/')))
        .bearer_auth(&key)
        .json(&json!({"last_sync_at": last_sync}))
        .send().await.map_err(|e| format!("pull request: {e}"))?;
    let pull_status = pull_resp.status().as_u16();
    let pull_body: Value = pull_resp.json().await.unwrap_or(json!(null));

    // Also try FULL pull (last_sync_at = null) to see what server would return
    let full_pull_resp = http
        .post(format!("{}/v1/sync/pull", url.trim_end_matches('/')))
        .bearer_auth(&key)
        .json(&json!({"last_sync_at": null}))
        .send().await.map_err(|e| format!("full pull request: {e}"))?;
    let full_pull_status = full_pull_resp.status().as_u16();
    let full_pull_body: Value = full_pull_resp.json().await.unwrap_or(json!(null));

    // Count local rows
    let local_counts = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut counts = serde_json::Map::new();
        for table in &["shortcuts", "note_folders", "notes", "sql_table_analyzer_templates", "sql_macrosing_templates", "obfuscation_mappings"] {
            let count: i64 = conn.query_row(
                &format!("SELECT COUNT(*) FROM {}", table), [], |row| row.get(0)
            ).unwrap_or(0);
            counts.insert(table.to_string(), json!(count));
        }
        counts
    };

    // Summarize pull response
    let mut pull_summary = serde_json::Map::new();
    if let Some(changes) = pull_body.get("changes").and_then(|v| v.as_object()) {
        for (table, rows) in changes {
            let count = rows.as_array().map(|a| a.len()).unwrap_or(0);
            pull_summary.insert(table.clone(), json!(count));
        }
    }

    // Summarize full pull
    let mut full_pull_summary = serde_json::Map::new();
    if let Some(changes) = full_pull_body.get("changes").and_then(|v| v.as_object()) {
        for (table, rows) in changes {
            let count = rows.as_array().map(|a| a.len()).unwrap_or(0);
            full_pull_summary.insert(table.clone(), json!(count));
        }
    }

    Ok(json!({
        "computer_id": computer_id,
        "api_url": url,
        "api_key_prefix": &key[..8.min(key.len())],
        "last_sync_at": last_sync,
        "auth": {"status": auth_status, "body": auth_body},
        "pull_incremental": {"status": pull_status, "rows_received": pull_summary, "server_time": pull_body.get("server_time")},
        "pull_full": {"status": full_pull_status, "rows_available": full_pull_summary},
        "local_row_counts": local_counts,
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
