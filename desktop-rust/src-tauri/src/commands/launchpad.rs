use crate::db::{queries, DbState};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

const WINDOW_LABEL: &str = "micro_launchpad";
const DEFAULT_HOTKEY: &str = "Ctrl+Alt+Space";
const DEFAULT_COLUMNS: u32 = 4;
const DEFAULT_ROWS: u32 = 3;
const MIN_COLUMNS: u32 = 3;
const MAX_COLUMNS: u32 = 8;
const MIN_ROWS: u32 = 2;
const MAX_ROWS: u32 = 6;
const CELL_WIDTH: f64 = 148.0;
const CELL_HEIGHT: f64 = 96.0;
const WIDTH_CHROME: f64 = 48.0;
const HEIGHT_CHROME: f64 = 142.0;

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LaunchpadGridSize {
    pub columns: u32,
    pub rows: u32,
}

pub fn default_hotkey() -> &'static str {
    DEFAULT_HOTKEY
}

pub fn window_label() -> &'static str {
    WINDOW_LABEL
}

pub fn window_spec() -> LaunchpadWindowSpec {
    window_spec_for_grid(DEFAULT_COLUMNS, DEFAULT_ROWS)
}

pub fn normalize_grid_size(columns: u32, rows: u32) -> LaunchpadGridSize {
    LaunchpadGridSize {
        columns: columns.clamp(MIN_COLUMNS, MAX_COLUMNS),
        rows: rows.clamp(MIN_ROWS, MAX_ROWS),
    }
}

pub fn window_spec_for_grid(columns: u32, rows: u32) -> LaunchpadWindowSpec {
    let grid = normalize_grid_size(columns, rows);
    LaunchpadWindowSpec {
        label: WINDOW_LABEL,
        url: "khapp://localhost/index.html?launchpad=1",
        width: grid.columns as f64 * CELL_WIDTH + WIDTH_CHROME,
        height: grid.rows as f64 * CELL_HEIGHT + HEIGHT_CHROME,
        min_width: 520.0,
        min_height: 320.0,
        resizable: false,
        decorations: false,
        always_on_top: true,
    }
}

fn computer_id() -> String {
    hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

fn grid_size_from_settings(app: &AppHandle) -> LaunchpadGridSize {
    let db_state = app.state::<DbState>();
    let conn = db_state.lock_recover();
    let cid = computer_id();
    let columns = queries::get_setting(&conn, &cid, "launchpad.columns")
        .ok()
        .flatten()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(DEFAULT_COLUMNS);
    let rows = queries::get_setting(&conn, &cid, "launchpad.rows")
        .ok()
        .flatten()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(DEFAULT_ROWS);
    normalize_grid_size(columns, rows)
}

#[tauri::command]
pub async fn open_launchpad(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.close();
        return Ok(());
    }

    let grid = grid_size_from_settings(&app);
    let spec = window_spec_for_grid(grid.columns, grid.rows);
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

#[tauri::command]
pub fn resize_launchpad_window(app: AppHandle, columns: u32, rows: u32) -> Result<(), String> {
    let grid = normalize_grid_size(columns, rows);
    let spec = window_spec_for_grid(grid.columns, grid.rows);
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window
            .set_size(LogicalSize::new(spec.width, spec.height))
            .map_err(|e| e.to_string())?;
        position_launchpad(&app, &window);
    }
    Ok(())
}

fn position_launchpad(app: &AppHandle, window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };
    let position = monitor.position();
    let size = monitor.size();
    let window_size = window.outer_size().ok();
    let window_width = window_size.map(|s| s.width as i32).unwrap_or(640);
    let window_height = window_size.map(|s| s.height as i32).unwrap_or(430);
    let x = position.x + ((size.width as i32 - window_width) / 2).max(16);
    let y = position.y + ((size.height as i32 - window_height) / 3).max(16);
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

#[cfg(test)]
mod tests {
    use super::{
        default_hotkey, normalize_grid_size, window_label, window_spec, window_spec_for_grid,
    };

    #[test]
    fn launchpad_hotkey_and_label_are_stable() {
        assert_eq!(default_hotkey(), "Ctrl+Alt+Space");
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

    #[test]
    fn launchpad_grid_size_keeps_default_window_stable() {
        let spec = window_spec_for_grid(4, 3);
        assert_eq!(spec.width, 640.0);
        assert_eq!(spec.height, 430.0);
    }

    #[test]
    fn launchpad_grid_size_scales_and_clamps() {
        let larger = window_spec_for_grid(6, 5);
        assert!(larger.width > 640.0);
        assert!(larger.height > 430.0);

        let clamped = normalize_grid_size(99, 0);
        assert_eq!(clamped.columns, 8);
        assert_eq!(clamped.rows, 2);
    }
}
