use crate::db::{queries, DbState};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct AdminMe {
    pub user_id: String,
    pub name: Option<String>,
    pub is_admin: bool,
    pub media_quota_bytes: i64,
    pub media_max_upload_bytes: i64,
    pub media_used_bytes: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AdminUser {
    pub user_id: String,
    pub name: Option<String>,
    pub created_at: String,
    pub last_seen_at: Option<String>,
    pub is_admin: bool,
    pub media_quota_bytes: i64,
    pub media_max_upload_bytes: i64,
    pub media_used_bytes: i64,
}

#[derive(Debug, Serialize)]
struct LimitsRequest {
    media_quota_bytes: i64,
    media_max_upload_bytes: i64,
}

fn sync_settings(state: &State<'_, DbState>) -> Result<(String, String, Option<String>), String> {
    let computer_id = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let conn = state.lock_recover();
    let url = queries::get_setting(&conn, &computer_id, "sync_api_url")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "sync_api_url not configured".to_string())?;
    let key = queries::get_setting(&conn, &computer_id, "sync_api_key")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "sync_api_key not configured".to_string())?;
    let cert = queries::get_setting(&conn, &computer_id, "sync_ca_cert")
        .map_err(|e| e.to_string())?;
    Ok((url.trim_end_matches('/').to_string(), key, cert))
}

fn http_client(api_url: &str, ca_cert: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20));
    if let Some(path) = ca_cert {
        if std::path::Path::new(path).is_file() {
            let pem = std::fs::read(path).map_err(|e| format!("read CA cert: {e}"))?;
            let cert = reqwest::Certificate::from_pem(&pem)
                .map_err(|e| format!("parse CA cert: {e}"))?;
            builder = builder.add_root_certificate(cert);
        } else if api_url.starts_with("https://") {
            builder = builder.danger_accept_invalid_certs(true);
        }
    } else if api_url.starts_with("https://") {
        builder = builder.danger_accept_invalid_certs(true);
    }
    builder
        .build()
        .map_err(|e| format!("build http client: {e}"))
}

async fn parse_json<T: for<'de> Deserialize<'de>>(
    resp: reqwest::Response,
) -> Result<T, String> {
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {body}"));
    }
    resp.json::<T>()
        .await
        .map_err(|e| format!("parse response: {e}"))
}

#[tauri::command]
pub async fn get_admin_me(state: State<'_, DbState>) -> Result<AdminMe, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .get(format!("{api_url}/v1/admin/me"))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json(resp).await
}

#[tauri::command]
pub async fn list_admin_users(state: State<'_, DbState>) -> Result<Vec<AdminUser>, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .get(format!("{api_url}/v1/admin/users"))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json(resp).await
}

#[tauri::command]
pub async fn update_admin_user_limits(
    state: State<'_, DbState>,
    user_id: String,
    media_quota_bytes: i64,
    media_max_upload_bytes: i64,
) -> Result<AdminUser, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .patch(format!("{api_url}/v1/admin/users/{user_id}/limits"))
        .bearer_auth(api_key)
        .json(&LimitsRequest {
            media_quota_bytes,
            media_max_upload_bytes,
        })
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json(resp).await
}
