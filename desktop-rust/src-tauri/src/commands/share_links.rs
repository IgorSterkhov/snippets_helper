use crate::db::{queries, DbState};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::State;

const TELEGRAPH_API_BASE: &str = "https://api.telegra.ph";

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

#[derive(Debug, Deserialize)]
struct TelegraphPrepareResponse {
    item_type: String,
    item_uuid: String,
    title: String,
    content_hash: String,
    content: Vec<serde_json::Value>,
    short_name: String,
    author_name: String,
    author_url: String,
    access_token: Option<String>,
    page: Option<TelegraphPage>,
}

#[derive(Debug, Serialize)]
struct CompleteTelegraphRequest {
    item_type: String,
    item_uuid: String,
    path: String,
    url: String,
    title: String,
    content_hash: String,
    views: Option<i64>,
    access_token: Option<String>,
    short_name: Option<String>,
    author_name: Option<String>,
    author_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegraphApiEnvelope<T> {
    ok: bool,
    result: Option<T>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegraphApiAccount {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct TelegraphApiPage {
    path: String,
    url: String,
    title: String,
    views: Option<i64>,
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

fn http_client(
    api_url: &str,
    ca_cert: Option<&str>,
    timeout: Duration,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(timeout);
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

fn format_request_error(context: &str, err: reqwest::Error) -> String {
    let mut parts = vec![format!("{context}: {err}")];
    if err.is_timeout() {
        parts.push("kind: timeout".to_string());
    }
    if err.is_connect() {
        parts.push("kind: connect".to_string());
    }
    if let Some(url) = err.url() {
        parts.push(format!("url: {url}"));
    }
    let mut source = std::error::Error::source(&err);
    while let Some(err) = source {
        parts.push(format!("caused by: {err}"));
        source = err.source();
    }
    parts.join("\n")
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

fn telegraph_page_endpoint(existing: Option<&TelegraphPage>) -> String {
    match existing {
        Some(page) => format!("/editPage/{}", page.path),
        None => "/createPage".to_string(),
    }
}

fn telegraph_limit_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn parse_telegraph_api_result<T: DeserializeOwned>(payload: serde_json::Value) -> Result<T, String> {
    let envelope: TelegraphApiEnvelope<T> = serde_json::from_value(payload)
        .map_err(|e| format!("parse Telegra.ph response: {e}"))?;
    if !envelope.ok {
        return Err(envelope
            .error
            .unwrap_or_else(|| "Telegra.ph API error".to_string()));
    }
    envelope
        .result
        .ok_or_else(|| "Telegra.ph response missing result".to_string())
}

#[cfg(test)]
fn parse_telegraph_api_page(payload: serde_json::Value) -> Result<TelegraphApiPage, String> {
    parse_telegraph_api_result(payload)
}

fn telegraph_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| format!("build Telegra.ph http client: {e}"))
}

async fn post_telegraph_form<T: DeserializeOwned>(
    client: &reqwest::Client,
    endpoint: &str,
    form: Vec<(&'static str, String)>,
) -> Result<T, String> {
    let url = format!("{TELEGRAPH_API_BASE}{endpoint}");
    let resp = client
        .post(&url)
        .form(&form)
        .send()
        .await
        .map_err(|e| format_request_error("direct Telegra.ph request failed", e))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("read Telegra.ph response: {e}"))?;
    if !status.is_success() {
        return Err(format!("Telegra.ph HTTP {status}: {body}"));
    }
    let payload: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("parse Telegra.ph JSON: {e}"))?;
    parse_telegraph_api_result(payload)
}

async fn create_telegraph_account(
    client: &reqwest::Client,
    prepared: &TelegraphPrepareResponse,
) -> Result<String, String> {
    let account: TelegraphApiAccount = post_telegraph_form(
        client,
        "/createAccount",
        vec![
            ("short_name", prepared.short_name.clone()),
            ("author_name", prepared.author_name.clone()),
            ("author_url", prepared.author_url.clone()),
        ],
    )
    .await?;
    let token = account.access_token.trim().to_string();
    if token.is_empty() {
        return Err("Telegra.ph account response missing access_token".to_string());
    }
    Ok(token)
}

async fn publish_telegraph_direct(
    client: &reqwest::Client,
    prepared: &TelegraphPrepareResponse,
    access_token: &str,
) -> Result<TelegraphApiPage, String> {
    let content = serde_json::to_string(&prepared.content)
        .map_err(|e| format!("serialize Telegra.ph content: {e}"))?;
    post_telegraph_form(
        client,
        &telegraph_page_endpoint(prepared.page.as_ref()),
        vec![
            ("access_token", access_token.to_string()),
            ("title", telegraph_limit_chars(&prepared.title, 256)),
            ("author_name", telegraph_limit_chars(&prepared.author_name, 128)),
            ("author_url", telegraph_limit_chars(&prepared.author_url, 512)),
            ("content", content),
            ("return_content", "false".to_string()),
        ],
    )
    .await
}

#[tauri::command]
pub async fn get_share_link(
    state: State<'_, DbState>,
    item_type: String,
    item_uuid: String,
) -> Result<Option<ShareLink>, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref(), Duration::from_secs(20))?;
    let resp = client
        .get(format!("{api_url}/v1/share-links"))
        .bearer_auth(api_key)
        .query(&[("item_type", item_type), ("item_uuid", item_uuid)])
        .send()
        .await
        .map_err(|e| format_request_error("get share link request failed", e))?;
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
    let client = http_client(&api_url, ca_cert.as_deref(), Duration::from_secs(20))?;
    let resp = client
        .post(format!("{api_url}/v1/share-links"))
        .bearer_auth(api_key)
        .json(&CreateShareRequest {
            item_type: &item_type,
            item_uuid: &item_uuid,
        })
        .send()
        .await
        .map_err(|e| format_request_error("create share link request failed", e))?;
    parse_json(resp).await
}

#[tauri::command]
pub async fn revoke_share_link(state: State<'_, DbState>, token: String) -> Result<(), String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref(), Duration::from_secs(20))?;
    let resp = client
        .delete(format!("{api_url}/v1/share-links/{token}"))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format_request_error("revoke share link request failed", e))?;
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
    let client = http_client(&api_url, ca_cert.as_deref(), Duration::from_secs(20))?;
    let resp = client
        .get(format!("{api_url}/v1/share-links/telegraph"))
        .bearer_auth(api_key)
        .query(&[("item_type", item_type), ("item_uuid", item_uuid)])
        .send()
        .await
        .map_err(|e| format_request_error("get Telegra.ph page request failed", e))?;
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
    let api_client = http_client(&api_url, ca_cert.as_deref(), Duration::from_secs(45))?;
    let prepare_resp = api_client
        .post(format!("{api_url}/v1/share-links/telegraph/prepare"))
        .bearer_auth(&api_key)
        .json(&CreateShareRequest {
            item_type: &item_type,
            item_uuid: &item_uuid,
        })
        .send()
        .await
        .map_err(|e| format_request_error("prepare Telegra.ph page request failed", e))?;
    let prepared: TelegraphPrepareResponse = parse_json(prepare_resp).await?;

    let telegraph_client = telegraph_http_client()?;
    let access_token = match prepared
        .access_token
        .as_ref()
        .map(|token| token.trim())
        .filter(|token| !token.is_empty())
    {
        Some(token) => token.to_string(),
        None => create_telegraph_account(&telegraph_client, &prepared).await?,
    };
    let published = publish_telegraph_direct(&telegraph_client, &prepared, &access_token).await?;
    let complete = CompleteTelegraphRequest {
        item_type: prepared.item_type,
        item_uuid: prepared.item_uuid,
        path: published.path,
        url: published.url,
        title: published.title,
        content_hash: prepared.content_hash,
        views: published.views,
        access_token: Some(access_token),
        short_name: Some(prepared.short_name),
        author_name: Some(prepared.author_name),
        author_url: Some(prepared.author_url),
    };
    let complete_resp = api_client
        .post(format!("{api_url}/v1/share-links/telegraph/complete"))
        .bearer_auth(&api_key)
        .json(&complete)
        .send()
        .await
        .map_err(|e| format_request_error("complete Telegra.ph page request failed", e))?;
    parse_json(complete_resp).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_page() -> TelegraphPage {
        TelegraphPage {
            item_type: "shortcut".to_string(),
            item_uuid: "a27d8dfc-d14b-4418-9a0a-0325e6be1448".to_string(),
            url: "https://telegra.ph/Deploy-06-09".to_string(),
            path: "Deploy-06-09".to_string(),
            title: "Deploy".to_string(),
            content_hash: "hash".to_string(),
            views: Some(7),
            created_at: "2026-07-06T18:00:00Z".to_string(),
            updated_at: "2026-07-06T18:00:00Z".to_string(),
            published_at: "2026-07-06T18:00:00Z".to_string(),
        }
    }

    #[test]
    fn telegraph_page_path_uses_edit_for_existing_page() {
        assert_eq!(
            telegraph_page_endpoint(Some(&sample_page())),
            "/editPage/Deploy-06-09"
        );
        assert_eq!(telegraph_page_endpoint(None), "/createPage");
    }

    #[test]
    fn parse_telegraph_api_page_requires_ok_result() {
        let parsed = parse_telegraph_api_page(json!({
            "ok": true,
            "result": {
                "path": "Deploy-06-09",
                "url": "https://telegra.ph/Deploy-06-09",
                "title": "Deploy",
                "views": 3
            }
        }))
        .expect("valid Telegra.ph response");

        assert_eq!(parsed.path, "Deploy-06-09");
        assert_eq!(parsed.url, "https://telegra.ph/Deploy-06-09");
        assert_eq!(parsed.title, "Deploy");
        assert_eq!(parsed.views, Some(3));

        let err = parse_telegraph_api_page(json!({
            "ok": false,
            "error": "ACCESS_TOKEN_INVALID"
        }))
        .expect_err("Telegra.ph error should be surfaced");
        assert!(err.contains("ACCESS_TOKEN_INVALID"));
    }

    #[test]
    fn telegraph_limit_chars_is_utf8_safe() {
        let source = format!("{}{}", "Ж".repeat(255), "😀tail");
        let limited = telegraph_limit_chars(&source, 256);

        assert_eq!(limited.chars().count(), 256);
        assert!(limited.ends_with('😀'));
        assert!(!limited.contains("tail"));
    }
}
