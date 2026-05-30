use crate::db::{queries, DbState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct AiProviderSettings {
    pub deepseek_configured: bool,
    pub deepseek_updated_at: Option<String>,
    pub telegram_bot_configured: bool,
    pub telegram_bot_updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct AiProviderSettingsRequest {
    deepseek_api_key: String,
}

#[derive(Debug, Serialize)]
struct AiTelegramBotSettingsRequest {
    telegram_bot_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiProviderBalanceInfo {
    pub currency: String,
    pub total_balance: String,
    pub granted_balance: String,
    pub topped_up_balance: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiProviderBalance {
    pub is_available: bool,
    pub balance_infos: Vec<AiProviderBalanceInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiAgentSettings {
    pub custom_instructions: String,
    pub updated_at: Option<String>,
    pub core_instructions: String,
}

#[derive(Debug, Serialize)]
struct AiAgentSettingsRequest {
    custom_instructions: String,
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
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(45));
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

fn ai_chat_url(api_url: &str) -> String {
    if api_url.ends_with("/v1") {
        format!("{api_url}/ai/chat")
    } else {
        format!("{api_url}/v1/ai/chat")
    }
}

fn ai_provider_settings_url(api_url: &str) -> String {
    if api_url.ends_with("/v1") {
        format!("{api_url}/ai/provider-settings")
    } else {
        format!("{api_url}/v1/ai/provider-settings")
    }
}

fn ai_provider_balance_url(api_url: &str) -> String {
    if api_url.ends_with("/v1") {
        format!("{api_url}/ai/provider-balance")
    } else {
        format!("{api_url}/v1/ai/provider-balance")
    }
}

fn ai_agent_settings_url(api_url: &str) -> String {
    if api_url.ends_with("/v1") {
        format!("{api_url}/ai/agent-settings")
    } else {
        format!("{api_url}/v1/ai/agent-settings")
    }
}

fn ai_capabilities_url(api_url: &str) -> String {
    if api_url.ends_with("/v1") {
        format!("{api_url}/ai/capabilities")
    } else {
        format!("{api_url}/v1/ai/capabilities")
    }
}

fn ai_preview_url(api_url: &str) -> String {
    if api_url.ends_with("/v1") {
        format!("{api_url}/ai/preview")
    } else {
        format!("{api_url}/v1/ai/preview")
    }
}

fn ai_telegram_bot_settings_url(api_url: &str) -> String {
    if api_url.ends_with("/v1") {
        format!("{api_url}/ai/provider-settings/telegram-bot")
    } else {
        format!("{api_url}/v1/ai/provider-settings/telegram-bot")
    }
}

fn telegram_my_status_url(api_url: &str) -> String {
    if api_url.ends_with("/v1") {
        format!("{api_url}/telegram/my/status")
    } else {
        format!("{api_url}/v1/telegram/my/status")
    }
}

fn telegram_my_poll_once_url(api_url: &str) -> String {
    if api_url.ends_with("/v1") {
        format!("{api_url}/telegram/my/poll-once")
    } else {
        format!("{api_url}/v1/telegram/my/poll-once")
    }
}

fn telegram_my_chat_url(api_url: &str, chat_id: i64) -> String {
    if api_url.ends_with("/v1") {
        format!("{api_url}/telegram/my/chats/{chat_id}")
    } else {
        format!("{api_url}/v1/telegram/my/chats/{chat_id}")
    }
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
    parse_json::<Value>(resp).await
}

#[tauri::command]
pub async fn get_ai_provider_settings(
    state: State<'_, DbState>,
) -> Result<AiProviderSettings, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .get(ai_provider_settings_url(&api_url))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json::<AiProviderSettings>(resp).await
}

#[tauri::command]
pub async fn save_ai_provider_settings(
    state: State<'_, DbState>,
    deepseek_api_key: String,
) -> Result<AiProviderSettings, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .put(ai_provider_settings_url(&api_url))
        .bearer_auth(api_key)
        .json(&AiProviderSettingsRequest { deepseek_api_key })
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json::<AiProviderSettings>(resp).await
}

#[tauri::command]
pub async fn clear_ai_provider_settings(
    state: State<'_, DbState>,
) -> Result<AiProviderSettings, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .delete(ai_provider_settings_url(&api_url))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json::<AiProviderSettings>(resp).await
}

#[tauri::command]
pub async fn get_ai_provider_balance(
    state: State<'_, DbState>,
) -> Result<AiProviderBalance, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .get(ai_provider_balance_url(&api_url))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json::<AiProviderBalance>(resp).await
}

#[tauri::command]
pub async fn get_ai_agent_settings(state: State<'_, DbState>) -> Result<AiAgentSettings, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .get(ai_agent_settings_url(&api_url))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json::<AiAgentSettings>(resp).await
}

#[tauri::command]
pub async fn save_ai_agent_settings(
    state: State<'_, DbState>,
    custom_instructions: String,
) -> Result<AiAgentSettings, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .put(ai_agent_settings_url(&api_url))
        .bearer_auth(api_key)
        .json(&AiAgentSettingsRequest {
            custom_instructions,
        })
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json::<AiAgentSettings>(resp).await
}

#[tauri::command]
pub async fn get_ai_capabilities(state: State<'_, DbState>) -> Result<Value, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .get(ai_capabilities_url(&api_url))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json::<Value>(resp).await
}

#[tauri::command]
pub async fn preview_ai_prompt(state: State<'_, DbState>, request: Value) -> Result<Value, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .post(ai_preview_url(&api_url))
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json::<Value>(resp).await
}

#[tauri::command]
pub async fn save_ai_telegram_bot_settings(
    state: State<'_, DbState>,
    telegram_bot_token: String,
) -> Result<AiProviderSettings, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .put(ai_telegram_bot_settings_url(&api_url))
        .bearer_auth(api_key)
        .json(&AiTelegramBotSettingsRequest { telegram_bot_token })
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json::<AiProviderSettings>(resp).await
}

#[tauri::command]
pub async fn clear_ai_telegram_bot_settings(
    state: State<'_, DbState>,
) -> Result<AiProviderSettings, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .delete(ai_telegram_bot_settings_url(&api_url))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json::<AiProviderSettings>(resp).await
}

#[tauri::command]
pub async fn get_ai_telegram_status(state: State<'_, DbState>) -> Result<Value, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .get(telegram_my_status_url(&api_url))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json::<Value>(resp).await
}

#[tauri::command]
pub async fn poll_ai_telegram_once(state: State<'_, DbState>) -> Result<Value, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .post(telegram_my_poll_once_url(&api_url))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json::<Value>(resp).await
}

#[tauri::command]
pub async fn unbind_ai_telegram_chat(
    state: State<'_, DbState>,
    chat_id: i64,
) -> Result<Value, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .delete(telegram_my_chat_url(&api_url, chat_id))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json::<Value>(resp).await
}

#[cfg(test)]
mod tests {
    use super::{
        ai_chat_url, ai_provider_balance_url, ai_provider_settings_url,
        ai_agent_settings_url, ai_capabilities_url, ai_preview_url,
        ai_telegram_bot_settings_url, telegram_my_chat_url, telegram_my_poll_once_url,
        telegram_my_status_url,
    };

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

    #[test]
    fn ai_provider_settings_url_accepts_plain_and_v1_bases() {
        assert_eq!(
            ai_provider_settings_url("https://example.test/snippets-api"),
            "https://example.test/snippets-api/v1/ai/provider-settings"
        );
        assert_eq!(
            ai_provider_settings_url("https://example.test/snippets-api/v1"),
            "https://example.test/snippets-api/v1/ai/provider-settings"
        );
    }

    #[test]
    fn ai_provider_balance_url_accepts_plain_and_v1_bases() {
        assert_eq!(
            ai_provider_balance_url("https://example.test/snippets-api"),
            "https://example.test/snippets-api/v1/ai/provider-balance"
        );
        assert_eq!(
            ai_provider_balance_url("https://example.test/snippets-api/v1"),
            "https://example.test/snippets-api/v1/ai/provider-balance"
        );
    }

    #[test]
    fn ai_agent_settings_url_accepts_plain_and_v1_bases() {
        assert_eq!(
            ai_agent_settings_url("https://example.test/snippets-api"),
            "https://example.test/snippets-api/v1/ai/agent-settings"
        );
        assert_eq!(
            ai_agent_settings_url("https://example.test/snippets-api/v1"),
            "https://example.test/snippets-api/v1/ai/agent-settings"
        );
    }

    #[test]
    fn ai_capabilities_and_preview_urls_accept_plain_and_v1_bases() {
        assert_eq!(
            ai_capabilities_url("https://example.test/snippets-api"),
            "https://example.test/snippets-api/v1/ai/capabilities"
        );
        assert_eq!(
            ai_preview_url("https://example.test/snippets-api/v1"),
            "https://example.test/snippets-api/v1/ai/preview"
        );
    }

    #[test]
    fn ai_telegram_bot_settings_url_accepts_plain_and_v1_bases() {
        assert_eq!(
            ai_telegram_bot_settings_url("https://example.test/snippets-api"),
            "https://example.test/snippets-api/v1/ai/provider-settings/telegram-bot"
        );
        assert_eq!(
            ai_telegram_bot_settings_url("https://example.test/snippets-api/v1"),
            "https://example.test/snippets-api/v1/ai/provider-settings/telegram-bot"
        );
    }

    #[test]
    fn telegram_my_urls_accept_plain_and_v1_bases() {
        assert_eq!(
            telegram_my_status_url("https://example.test/snippets-api"),
            "https://example.test/snippets-api/v1/telegram/my/status"
        );
        assert_eq!(
            telegram_my_poll_once_url("https://example.test/snippets-api/v1"),
            "https://example.test/snippets-api/v1/telegram/my/poll-once"
        );
        assert_eq!(
            telegram_my_chat_url("https://example.test/snippets-api", 12345),
            "https://example.test/snippets-api/v1/telegram/my/chats/12345"
        );
    }
}
