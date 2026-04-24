//! Prompt template for Gemma post-processing + output sanitation.
//!
//! Gemma-3 instruction format uses `<start_of_turn>user ... <end_of_turn>
//! <start_of_turn>model`. We embed the transcript in a short instruction
//! asking the model to fix punctuation/typos without changing meaning.

/// Default prompt template. `{TEXT}` is replaced with the raw transcript.
/// Later (Phase 2) we'll let the user edit this in Settings.
pub const DEFAULT_PROMPT: &str = r#"<start_of_turn>user
Ты — корректор голосовых транскриптов. Вот расшифровка голосового ввода:

{TEXT}

Исправь пунктуацию, опечатки и очевидные ошибки распознавания.
Не меняй смысл. Не добавляй новых слов или объяснений.
Выведи ТОЛЬКО исправленный текст без кавычек и без пояснений.<end_of_turn>
<start_of_turn>model
"#;

pub fn build_prompt(text: &str) -> String {
    DEFAULT_PROMPT.replace("{TEXT}", text.trim())
}

/// Models sometimes echo the prompt or add trailing chat tokens — strip them.
pub fn sanitize_output(raw: &str) -> String {
    let mut t = raw.trim().to_string();
    for marker in ["<end_of_turn>", "<start_of_turn>", "<|endoftext|>", "<eot_id>"] {
        if let Some(idx) = t.find(marker) {
            t.truncate(idx);
        }
    }
    // Some small models wrap output in quotes or guillemets — strip a pair.
    // Chars not bytes: '«' and '»' are 2 bytes in UTF-8.
    let t = t.trim();
    let chars: Vec<char> = t.chars().collect();
    let stripped = if chars.len() >= 2 {
        let first = chars[0];
        let last = chars[chars.len() - 1];
        let is_pair = (first == '"' && last == '"')
            || (first == '«' && last == '»')
            || (first == '\'' && last == '\'');
        if is_pair {
            chars[1..chars.len() - 1].iter().collect::<String>()
        } else {
            chars.iter().collect::<String>()
        }
    } else {
        chars.iter().collect::<String>()
    };
    stripped.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_includes_text() {
        let p = build_prompt("привет мир");
        assert!(p.contains("привет мир"));
        assert!(p.starts_with("<start_of_turn>user"));
        assert!(p.ends_with("<start_of_turn>model\n"));
    }

    #[test]
    fn sanitize_strips_chat_markers() {
        let raw = "Привет, мир.<end_of_turn>\n<start_of_turn>user\n";
        assert_eq!(sanitize_output(raw), "Привет, мир.");
    }

    #[test]
    fn sanitize_strips_wrapping_quotes() {
        assert_eq!(sanitize_output("\"hello\""), "hello");
        assert_eq!(sanitize_output("«мир»"), "мир");
    }

    #[test]
    fn sanitize_leaves_plain_text() {
        assert_eq!(sanitize_output("  привет, мир.  "), "привет, мир.");
    }
}
