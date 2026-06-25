use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

const WINDOW_LABEL: &str = "micro_launchpad";
const DEFAULT_HOTKEY: &str = "Ctrl+Alt+L";

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LaunchpadWindowSpec {
    pub label: &'static str,
    pub url: &'static str,
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
    pub resizable: bool,
    pub decorations: bool,
    pub always_on_top: bool,
}

pub fn default_hotkey() -> &'static str {
    DEFAULT_HOTKEY
}

pub fn window_label() -> &'static str {
    WINDOW_LABEL
}

pub fn window_spec() -> LaunchpadWindowSpec {
    LaunchpadWindowSpec {
        label: WINDOW_LABEL,
        url: "khapp://localhost/index.html?launchpad=1",
        width: 640.0,
        height: 430.0,
        min_width: 520.0,
        min_height: 320.0,
        resizable: false,
        decorations: false,
        always_on_top: true,
    }
}

#[tauri::command]
pub async fn open_launchpad(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.close();
        return Ok(());
    }

    let spec = window_spec();
    let url = spec.url
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())?;
    let window = WebviewWindowBuilder::new(&app, spec.label, WebviewUrl::CustomProtocol(url))
        .title("Launchpad")
        .inner_size(spec.width, spec.height)
        .min_inner_size(spec.min_width, spec.min_height)
        .resizable(spec.resizable)
        .decorations(spec.decorations)
        .always_on_top(spec.always_on_top)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    position_launchpad(&app, &window);
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn close_launchpad(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn position_launchpad(app: &AppHandle, window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };
    let position = monitor.position();
    let size = monitor.size();
    let x = position.x + ((size.width as i32 - 640) / 2).max(16);
    let y = position.y + ((size.height as i32 - 430) / 3).max(16);
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

#[cfg(test)]
mod tests {
    use super::{default_hotkey, window_label, window_spec};

    #[test]
    fn launchpad_hotkey_and_label_are_stable() {
        assert_eq!(default_hotkey(), "Ctrl+Alt+L");
        assert_eq!(window_label(), "micro_launchpad");
    }

    #[test]
    fn launchpad_window_spec_is_frameless_and_compact() {
        let spec = window_spec();
        assert_eq!(spec.label, "micro_launchpad");
        assert_eq!(spec.url, "khapp://localhost/index.html?launchpad=1");
        assert_eq!(spec.width, 640.0);
        assert_eq!(spec.height, 430.0);
        assert_eq!(spec.min_width, 520.0);
        assert_eq!(spec.min_height, 320.0);
        assert!(!spec.resizable);
        assert!(!spec.decorations);
        assert!(spec.always_on_top);
    }
}
