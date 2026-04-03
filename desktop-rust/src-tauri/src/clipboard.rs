use arboard::Clipboard;

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd").args(["/c", "start", &url]).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_clipboard() -> Result<String, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}
