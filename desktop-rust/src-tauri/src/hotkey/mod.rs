pub mod native;
pub mod polling;

use tauri::Manager;

/// Toggle main-window visibility on hotkey press.
///
/// Previously the rule was `visible ? hide : show+focus`, which meant that
/// when the window was visible but behind another app (not focused) the
/// first press would hide it and a second press would be needed to
/// re-surface it. Now: hide only when the window is visible, focused and
/// not minimised; otherwise unminimise + show + focus.
pub fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        let minimized = window.is_minimized().unwrap_or(false);

        if visible && focused && !minimized {
            let _ = window.hide();
        } else {
            if minimized {
                let _ = window.unminimize();
            }
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}
