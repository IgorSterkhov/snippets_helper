use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

const PICKER_LABEL: &str = "snippet_micro_picker";
const DEFAULT_HOTKEY: &str = "Ctrl+Alt+K";

#[derive(Debug, Serialize)]
pub struct MicroPickerInsertResult {
    pub method: &'static str,
    pub message: String,
}

pub fn default_hotkey() -> &'static str {
    DEFAULT_HOTKEY
}

pub fn picker_label() -> &'static str {
    PICKER_LABEL
}

#[tauri::command]
pub async fn open_snippet_micro_picker(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PICKER_LABEL) {
        let _ = window.close();
        return Ok(());
    }

    focus_target::capture_current();

    let url = "khapp://localhost/index.html?micro_picker=1"
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())?;
    let window = WebviewWindowBuilder::new(&app, PICKER_LABEL, WebviewUrl::CustomProtocol(url))
        .title("Code Snippet Picker")
        .inner_size(680.0, 360.0)
        .min_inner_size(520.0, 280.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    position_picker(&app, &window);
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn close_snippet_micro_picker(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PICKER_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn insert_snippet_micro_picker_text(
    app: AppHandle,
    text: String,
) -> Result<MicroPickerInsertResult, String> {
    if text.trim().is_empty() {
        return Ok(MicroPickerInsertResult {
            method: "none",
            message: "Selected snippet is empty".to_string(),
        });
    }

    if focus_target::has_target() {
        let picker = app.get_webview_window(PICKER_LABEL);
        if let Some(window) = picker.as_ref() {
            let _ = window.hide();
        }
        let restored = focus_target::restore_previous()?;
        if restored {
            tokio::time::sleep(std::time::Duration::from_millis(140)).await;
            match crate::whisper::inject::paste_chunk(&text, 200).await {
                Ok(_) => {
                    if let Some(window) = picker {
                        let _ = window.close();
                    }
                    return Ok(MicroPickerInsertResult {
                        method: "paste",
                        message: "Inserted into the previous window".to_string(),
                    });
                }
                Err(err) => {
                    if let Some(window) = picker.as_ref() {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    return Err(format!("paste failed: {err}"));
                }
            }
        }
        if let Some(window) = picker.as_ref() {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    crate::clipboard::copy_to_clipboard(text)?;
    Ok(MicroPickerInsertResult {
        method: "copy",
        message: "Focus restore is unavailable on this platform. Snippet copied to clipboard.".to_string(),
    })
}

fn position_picker(app: &AppHandle, window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };
    let position = monitor.position();
    let size = monitor.size();
    let x = position.x + ((size.width as i32 - 680) / 2).max(16);
    let y = position.y + ((size.height as i32 - 360) / 3).max(16);
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

#[cfg(windows)]
mod focus_target {
    use std::sync::{Mutex, OnceLock};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, IsWindow, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    fn store() -> &'static Mutex<Option<isize>> {
        static TARGET: OnceLock<Mutex<Option<isize>>> = OnceLock::new();
        TARGET.get_or_init(|| Mutex::new(None))
    }

    pub fn capture_current() {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd == 0 as HWND {
            return;
        }
        if let Ok(mut guard) = store().lock() {
            *guard = Some(hwnd as isize);
        }
    }

    pub fn has_target() -> bool {
        store().lock().ok().and_then(|g| *g).is_some()
    }

    pub fn restore_previous() -> Result<bool, String> {
        let raw = store().lock().ok().and_then(|mut g| g.take());
        let Some(raw) = raw else {
            return Ok(false);
        };
        let hwnd = raw as HWND;
        if unsafe { IsWindow(hwnd) } == 0 {
            return Ok(false);
        }
        unsafe {
            ShowWindow(hwnd, SW_RESTORE);
        }
        Ok(unsafe { SetForegroundWindow(hwnd) } != 0)
    }
}

#[cfg(not(windows))]
mod focus_target {
    pub fn capture_current() {}
    pub fn has_target() -> bool {
        false
    }
    pub fn restore_previous() -> Result<bool, String> {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::{default_hotkey, picker_label};

    #[test]
    fn picker_defaults_do_not_collide_with_main_or_whisper_hotkeys() {
        assert_eq!(default_hotkey(), "Ctrl+Alt+K");
        assert_ne!(default_hotkey(), "Alt+Space");
        assert_ne!(default_hotkey(), "Ctrl+Alt+Space");
    }

    #[test]
    fn picker_window_label_is_stable_for_ota_reload() {
        assert_eq!(picker_label(), "snippet_micro_picker");
    }
}
