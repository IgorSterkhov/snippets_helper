use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeepgramTranscript {
    pub transcript: String,
    pub is_final: bool,
    pub speech_final: bool,
}

#[derive(Debug, Deserialize)]
struct DeepgramResponse {
    #[serde(rename = "type")]
    kind: Option<String>,
    is_final: Option<bool>,
    speech_final: Option<bool>,
    channel: Option<DeepgramChannel>,
}

#[derive(Debug, Deserialize)]
struct DeepgramChannel {
    alternatives: Vec<DeepgramAlternative>,
}

#[derive(Debug, Deserialize)]
struct DeepgramAlternative {
    transcript: Option<String>,
}

pub fn parse_deepgram_message(raw: &str) -> Result<Option<DeepgramTranscript>, String> {
    let parsed: DeepgramResponse =
        serde_json::from_str(raw).map_err(|e| format!("deepgram json parse: {e}"))?;
    if parsed.kind.as_deref() != Some("Results") {
        return Ok(None);
    }
    let transcript = parsed
        .channel
        .and_then(|c| c.alternatives.into_iter().next())
        .and_then(|a| a.transcript)
        .unwrap_or_default()
        .trim()
        .to_string();
    if transcript.is_empty() {
        return Ok(None);
    }
    Ok(Some(DeepgramTranscript {
        transcript,
        is_final: parsed.is_final.unwrap_or(false),
        speech_final: parsed.speech_final.unwrap_or(false),
    }))
}

pub fn build_paste_chunk(committed_text: &str, finalized_delta: &str) -> String {
    let delta = finalized_delta.trim();
    if delta.is_empty() {
        return String::new();
    }
    if committed_text.is_empty()
        || committed_text.ends_with(char::is_whitespace)
        || delta.starts_with(char::is_whitespace)
        || delta.starts_with([',', '.', '!', '?', ':', ';', ')', ']', '}'])
    {
        delta.to_string()
    } else {
        format!(" {delta}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_interim_result() {
        let json = r#"{
            "type":"Results",
            "is_final":false,
            "speech_final":false,
            "channel":{"alternatives":[{"transcript":"hello wor"}]}
        }"#;

        let msg = parse_deepgram_message(json).unwrap().unwrap();
        assert_eq!(msg.transcript, "hello wor");
        assert!(!msg.is_final);
        assert!(!msg.speech_final);
    }

    #[test]
    fn parse_final_result() {
        let json = r#"{
            "type":"Results",
            "is_final":true,
            "speech_final":true,
            "channel":{"alternatives":[{"transcript":"hello world"}]}
        }"#;

        let msg = parse_deepgram_message(json).unwrap().unwrap();
        assert_eq!(msg.transcript, "hello world");
        assert!(msg.is_final);
        assert!(msg.speech_final);
    }

    #[test]
    fn ignore_empty_or_non_result_messages() {
        assert!(parse_deepgram_message(r#"{"type":"Metadata"}"#)
            .unwrap()
            .is_none());
        assert!(parse_deepgram_message(
            r#"{"type":"Results","is_final":true,"channel":{"alternatives":[{"transcript":""}]}}"#
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn paste_chunk_adds_spaces_for_russian_and_latin_text() {
        assert_eq!(build_paste_chunk("", "привет"), "привет");
        assert_eq!(build_paste_chunk("привет", "мир"), " мир");
        assert_eq!(build_paste_chunk("hello", "world."), " world.");
        assert_eq!(build_paste_chunk("hello ", "world"), "world");
        assert_eq!(build_paste_chunk("hello", ", world"), ", world");
    }
}
