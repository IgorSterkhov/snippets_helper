#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    if enabled {
        create_autostart_entry()
    } else {
        remove_autostart_entry()
    }
}

#[tauri::command]
pub fn get_autostart() -> Result<bool, String> {
    Ok(autostart_entry_exists())
}

// ── Linux ─────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn create_autostart_entry() -> Result<(), String> {
    let autostart_dir = dirs::config_dir()
        .ok_or("No config dir")?
        .join("autostart");
    std::fs::create_dir_all(&autostart_dir).map_err(|e| e.to_string())?;
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let desktop = format!(
        "[Desktop Entry]\nType=Application\nName=Keyboard Helper\nExec={}\nX-GNOME-Autostart-enabled=true",
        exe_path.display()
    );
    std::fs::write(autostart_dir.join("keyboard-helper.desktop"), desktop)
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn remove_autostart_entry() -> Result<(), String> {
    let path = dirs::config_dir()
        .ok_or("No config dir")?
        .join("autostart/keyboard-helper.desktop");
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn autostart_entry_exists() -> bool {
    dirs::config_dir()
        .map(|d| d.join("autostart/keyboard-helper.desktop").exists())
        .unwrap_or(false)
}

// ── macOS stub ────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn create_autostart_entry() -> Result<(), String> {
    Ok(()) // TODO: implement macOS autostart
}

#[cfg(target_os = "macos")]
fn remove_autostart_entry() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn autostart_entry_exists() -> bool {
    false
}

// ── Windows ──────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn create_autostart_entry() -> Result<(), String> {
    use std::process::Command;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let output = Command::new("reg")
        .args([
            "add",
            r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "KeyboardHelper",
            "/t",
            "REG_SZ",
            "/d",
            &exe.display().to_string(),
            "/f",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg(target_os = "windows")]
fn remove_autostart_entry() -> Result<(), String> {
    use std::process::Command;
    let _ = Command::new("reg")
        .args([
            "delete",
            r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "KeyboardHelper",
            "/f",
        ])
        .output();
    Ok(())
}

#[cfg(target_os = "windows")]
fn autostart_entry_exists() -> bool {
    use std::process::Command;
    Command::new("reg")
        .args([
            "query",
            r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "KeyboardHelper",
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
