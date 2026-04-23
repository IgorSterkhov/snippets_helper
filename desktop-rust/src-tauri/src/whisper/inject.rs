//! Inject transcript into the active window: clipboard copy, auto-paste
//! (Ctrl+V / Cmd+V), or typed-key simulation.

use arboard::Clipboard;
use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub enum InjectMethod {
    CopyOnly,
    Paste,
    Type,
}

impl InjectMethod {
    pub fn from_setting(s: &str) -> Self {
        match s {
            "copy" => InjectMethod::CopyOnly,
            "paste" => InjectMethod::Paste,
            "type" => InjectMethod::Type,
            _ => InjectMethod::Paste,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            InjectMethod::CopyOnly => "copy",
            InjectMethod::Paste => "paste",
            InjectMethod::Type => "type",
        }
    }
}

pub async fn inject(text: &str, method: InjectMethod, clipboard_restore_delay_ms: u64) -> Result<&'static str, String> {
    match method {
        InjectMethod::CopyOnly => {
            copy_to_clipboard(text)?;
            Ok("copy")
        }
        InjectMethod::Paste => {
            let prev = read_clipboard().ok();
            copy_to_clipboard(text)?;
            simulate_paste()?;
            if let Some(prev_text) = prev {
                tokio::time::sleep(Duration::from_millis(clipboard_restore_delay_ms)).await;
                let _ = copy_to_clipboard(&prev_text);
            }
            Ok("paste")
        }
        InjectMethod::Type => {
            type_text(text)?;
            Ok("type")
        }
    }
}

fn copy_to_clipboard(text: &str) -> Result<(), String> {
    let mut cb = Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
    cb.set_text(text.to_string()).map_err(|e| format!("clipboard set: {e}"))?;
    Ok(())
}

fn read_clipboard() -> Result<String, String> {
    let mut cb = Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
    cb.get_text().map_err(|e| format!("clipboard get: {e}"))
}

fn simulate_paste() -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    enigo.key(modifier, Direction::Press).map_err(|e| format!("mod down: {e}"))?;
    enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| format!("v: {e}"))?;
    enigo.key(modifier, Direction::Release).map_err(|e| format!("mod up: {e}"))?;
    Ok(())
}

fn type_text(text: &str) -> Result<(), String> {
    use enigo::{Enigo, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;
    enigo.text(text).map_err(|e| format!("type: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_setting_parses_known_values() {
        assert!(matches!(InjectMethod::from_setting("copy"), InjectMethod::CopyOnly));
        assert!(matches!(InjectMethod::from_setting("paste"), InjectMethod::Paste));
        assert!(matches!(InjectMethod::from_setting("type"), InjectMethod::Type));
        assert!(matches!(InjectMethod::from_setting("garbage"), InjectMethod::Paste));
    }

    #[test]
    fn method_str_roundtrip() {
        assert_eq!(InjectMethod::CopyOnly.as_str(), "copy");
        assert_eq!(InjectMethod::Paste.as_str(), "paste");
        assert_eq!(InjectMethod::Type.as_str(), "type");
    }
}
