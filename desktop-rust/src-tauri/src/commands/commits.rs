use tauri::State;
use crate::db::{DbState, queries, models::{CommitHistory, CommitTag}};

// ── Commit History ─────────────────────────────────────────

#[tauri::command]
pub fn list_commit_history(state: State<DbState>, computer_id: String) -> Result<Vec<CommitHistory>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::list_commit_history(&conn, &computer_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_commit_history(
    state: State<DbState>,
    computer_id: String,
    task_link: String,
    task_id: String,
    commit_type: String,
    object_category: String,
    object_value: String,
    message: String,
    selected_tags: String,
    mr_link: String,
    test_report: String,
    prod_report: String,
    transfer_connect: String,
    test_dag: String,
) -> Result<CommitHistory, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::create_commit_history(
        &conn,
        &computer_id,
        &task_link,
        &task_id,
        &commit_type,
        &object_category,
        &object_value,
        &message,
        &selected_tags,
        &mr_link,
        &test_report,
        &prod_report,
        &transfer_connect,
        &test_dag,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_commit_history(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::delete_commit_history(&conn, id).map_err(|e| e.to_string())
}

// ── Commit Tags ────────────────────────────────────────────

#[tauri::command]
pub fn list_commit_tags(state: State<DbState>, computer_id: String) -> Result<Vec<CommitTag>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::list_commit_tags(&conn, &computer_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_commit_tag(
    state: State<DbState>,
    computer_id: String,
    tag_name: String,
    is_default: bool,
) -> Result<CommitTag, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::create_commit_tag(&conn, &computer_id, &tag_name, is_default).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_commit_tag(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::delete_commit_tag(&conn, id).map_err(|e| e.to_string())
}
