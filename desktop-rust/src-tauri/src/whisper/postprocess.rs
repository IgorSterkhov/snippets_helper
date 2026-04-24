//! Post-processing of whisper transcripts.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub prompt: String,
}

pub fn apply_rules(text: &str) -> String {
    let mut out = strip_fillers(text);
    out = collapse_whitespace(&out);
    out = capitalize_first(&out);
    out
}

fn strip_fillers(text: &str) -> String {
    const FILLERS_RU: &[&str] = &["эээ", "ээ", "ммм", "мм", "ну", "типа", "короче"];
    const FILLERS_EN: &[&str] = &["uh", "um", "like", "you know"];

    let mut result = text.to_string();
    for &w in FILLERS_RU.iter().chain(FILLERS_EN.iter()) {
        let re = regex::Regex::new(&format!(r"(?iu)\b{}\b[,\s]*", regex::escape(w))).unwrap();
        result = re.replace_all(&result, "").into_owned();
    }
    result
}

fn collapse_whitespace(text: &str) -> String {
    let re = regex::Regex::new(r"\s+").unwrap();
    re.replace_all(text.trim(), " ").into_owned()
}

fn capitalize_first(text: &str) -> String {
    let trimmed = text.trim_start();
    let mut chars = trimmed.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

pub async fn apply_llm(text: &str, cfg: &LlmConfig) -> String {
    let body = serde_json::json!({
        "model": cfg.model,
        "messages": [
            { "role": "system", "content": cfg.prompt },
            { "role": "user", "content": text },
        ],
        "temperature": 0,
    });
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build() { Ok(c) => c, Err(_) => return text.to_string() };

    let resp = client.post(&cfg.endpoint)
        .bearer_auth(&cfg.api_key)
        .json(&body)
        .send().await;
    let Ok(resp) = resp else { return text.to_string(); };
    if !resp.status().is_success() { return text.to_string(); }
    let json: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return text.to_string(),
    };
    json.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_strip_russian_filler() {
        assert_eq!(apply_rules("эээ привет, мир"), "Привет, мир");
    }

    #[test]
    fn rules_capitalize_first_letter() {
        assert_eq!(apply_rules("hello world"), "Hello world");
    }

    #[test]
    fn rules_collapse_spaces() {
        assert_eq!(apply_rules("hello   world"), "Hello world");
    }

    #[test]
    fn rules_empty_input() {
        assert_eq!(apply_rules(""), "");
        assert_eq!(apply_rules("   "), "");
    }

    #[test]
    fn rules_multi_filler() {
        let input = "ну эээ типа это то, ммм, что я хотел сказать";
        let out = apply_rules(input);
        assert!(!out.to_lowercase().contains("эээ"));
        assert!(!out.to_lowercase().contains("ммм"));
        assert!(!out.to_lowercase().contains("типа"));
        assert!(out.to_lowercase().contains("это то"));
    }
}
