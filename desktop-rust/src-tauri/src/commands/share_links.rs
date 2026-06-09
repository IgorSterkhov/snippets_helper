use crate::db::{queries, DbState};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct ShareLink {
    pub token: String,
    pub public_url: String,
    pub item_type: String,
    pub item_uuid: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TelegraphPage {
    pub item_type: String,
    pub item_uuid: String,
    pub url: String,
    pub path: String,
    pub title: String,
    pub content_hash: String,
    pub views: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub published_at: String,
}

#[derive(Debug, Deserialize)]
struct ShareStatusResponse {
    link: Option<ShareLink>,
}

#[derive(Debug, Deserialize)]
struct TelegraphStatusResponse {
    page: Option<TelegraphPage>,
}

#[derive(Debug, Serialize)]
struct CreateShareRequest<'a> {
    item_type: &'a str,
    item_uuid: &'a str,
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
    let cert =
        queries::get_setting(&conn, &computer_id, "sync_ca_cert").map_err(|e| e.to_string())?;
    Ok((url.trim_end_matches('/').to_string(), key, cert))
}

fn http_client(api_url: &str, ca_cert: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20));
    if let Some(path) = ca_cert {
        if std::path::Path::new(path).is_file() {
            let pem = std::fs::read(path).map_err(|e| format!("read CA cert: {e}"))?;
            let cert =
                reqwest::Certificate::from_pem(&pem).map_err(|e| format!("parse CA cert: {e}"))?;
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

async fn parse_json<T: for<'de> Deserialize<'de>>(resp: reqwest::Response) -> Result<T, String> {
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
pub async fn get_share_link(
    state: State<'_, DbState>,
    item_type: String,
    item_uuid: String,
) -> Result<Option<ShareLink>, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .get(format!("{api_url}/v1/share-links"))
        .bearer_auth(api_key)
        .query(&[("item_type", item_type), ("item_uuid", item_uuid)])
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status: ShareStatusResponse = parse_json(resp).await?;
    Ok(status.link)
}

#[tauri::command]
pub async fn create_share_link(
    state: State<'_, DbState>,
    item_type: String,
    item_uuid: String,
) -> Result<ShareLink, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .post(format!("{api_url}/v1/share-links"))
        .bearer_auth(api_key)
        .json(&CreateShareRequest {
            item_type: &item_type,
            item_uuid: &item_uuid,
        })
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json(resp).await
}

#[tauri::command]
pub async fn revoke_share_link(state: State<'_, DbState>, token: String) -> Result<(), String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .delete(format!("{api_url}/v1/share-links/{token}"))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let _: ShareStatusResponse = parse_json(resp).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_telegraph_page(
    state: State<'_, DbState>,
    item_type: String,
    item_uuid: String,
) -> Result<Option<TelegraphPage>, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .get(format!("{api_url}/v1/share-links/telegraph"))
        .bearer_auth(api_key)
        .query(&[("item_type", item_type), ("item_uuid", item_uuid)])
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status: TelegraphStatusResponse = parse_json(resp).await?;
    Ok(status.page)
}

#[tauri::command]
pub async fn publish_telegraph_page(
    state: State<'_, DbState>,
    item_type: String,
    item_uuid: String,
) -> Result<TelegraphPage, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .post(format!("{api_url}/v1/share-links/telegraph/publish"))
        .bearer_auth(api_key)
        .json(&CreateShareRequest {
            item_type: &item_type,
            item_uuid: &item_uuid,
        })
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json(resp).await
}
