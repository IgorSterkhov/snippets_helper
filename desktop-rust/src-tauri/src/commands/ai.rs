use crate::db::{queries, DbState};
use serde_json::Value;
use tauri::State;

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
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(45));
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

fn ai_chat_url(api_url: &str) -> String {
    if api_url.ends_with("/v1") {
        format!("{api_url}/ai/chat")
    } else {
        format!("{api_url}/v1/ai/chat")
    }
}

async fn parse_json(resp: reqwest::Response) -> Result<Value, String> {
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {body}"));
    }
    resp.json::<Value>()
        .await
        .map_err(|e| format!("parse response: {e}"))
}

#[tauri::command]
pub async fn ai_chat(state: State<'_, DbState>, request: Value) -> Result<Value, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let mut payload = request;
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("channel".to_string(), Value::String("client".to_string()));
    }
    let resp = client
        .post(ai_chat_url(&api_url))
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json(resp).await
}

#[cfg(test)]
mod tests {
    use super::ai_chat_url;

    #[test]
    fn ai_chat_url_accepts_plain_and_v1_bases() {
        assert_eq!(
            ai_chat_url("https://example.test/snippets-api"),
            "https://example.test/snippets-api/v1/ai/chat"
        );
        assert_eq!(
            ai_chat_url("https://example.test/snippets-api/v1"),
            "https://example.test/snippets-api/v1/ai/chat"
        );
    }
}
