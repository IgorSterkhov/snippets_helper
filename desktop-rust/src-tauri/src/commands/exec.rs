use std::sync::atomic::{AtomicBool, Ordering};
use tauri::State;
use crate::db::{DbState, queries, models::{ExecCategory, ExecCommand}};

/// Global flag to signal subprocess cancellation.
static STOP_FLAG: AtomicBool = AtomicBool::new(false);

// ── Exec Categories ────────────────────────────────────────

#[tauri::command]
pub fn list_exec_categories(state: State<DbState>) -> Result<Vec<ExecCategory>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::list_exec_categories(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_exec_category(state: State<DbState>, name: String, sort_order: i32) -> Result<ExecCategory, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::create_exec_category(&conn, &name, sort_order).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_exec_category(state: State<DbState>, id: i64, name: String, sort_order: i32) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::update_exec_category(&conn, id, &name, sort_order).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_exec_category(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::delete_exec_category(&conn, id).map_err(|e| e.to_string())
}

// ── Exec Commands ──────────────────────────────────────────

#[tauri::command]
pub fn list_exec_commands(state: State<DbState>, category_id: i64) -> Result<Vec<ExecCommand>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::list_exec_commands(&conn, category_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_exec_command(
    state: State<DbState>,
    category_id: i64,
    name: String,
    command: String,
    description: String,
    sort_order: i32,
    hide_after_run: bool,
) -> Result<ExecCommand, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::create_exec_command(&conn, category_id, &name, &command, &description, sort_order, hide_after_run)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_exec_command(
    state: State<DbState>,
    id: i64,
    name: String,
    command: String,
    description: String,
    sort_order: i32,
    hide_after_run: bool,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::update_exec_command(&conn, id, &name, &command, &description, sort_order, hide_after_run)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_exec_command(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::delete_exec_command(&conn, id).map_err(|e| e.to_string())
}

// ── Run / Stop Command ─────────────────────────────────────

#[tauri::command]
pub async fn run_command(command: String) -> Result<String, String> {
    STOP_FLAG.store(false, Ordering::SeqCst);

    let child = tokio::process::Command::new("sh")
        .arg("-c")
        .arg(&command)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn: {e}"))?;

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("Process error: {e}"))?;

    if STOP_FLAG.load(Ordering::SeqCst) {
        return Err("Command stopped by user".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let code = output.status.code().unwrap_or(-1);

    let mut result = String::new();
    if !stdout.is_empty() {
        result.push_str(&stdout);
    }
    if !stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str("[stderr]\n");
        result.push_str(&stderr);
    }
    result.push_str(&format!("\n\n--- exit code: {code} ---"));

    if output.status.success() {
        Ok(result)
    } else {
        // Still return output even on non-zero exit
        Ok(result)
    }
}

#[tauri::command]
pub fn stop_command() -> Result<(), String> {
    STOP_FLAG.store(true, Ordering::SeqCst);
    Ok(())
}
