use tauri::State;
use crate::db::{DbState, queries, models::{NoteFolder, Note}};

// ── Note Folders ────────────────────────────────────────────

#[tauri::command]
pub fn list_note_folders(state: State<DbState>) -> Result<Vec<NoteFolder>, String> {
    let conn = state.lock_recover();
    queries::list_note_folders(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note_folder(state: State<DbState>, name: String, sort_order: i32, parent_id: Option<i64>) -> Result<NoteFolder, String> {
    let conn = state.lock_recover();
    queries::create_note_folder(&conn, &name, sort_order, parent_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_note_folder(state: State<DbState>, id: i64, name: String, sort_order: i32, parent_id: Option<i64>) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::update_note_folder(&conn, id, &name, sort_order, parent_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_note_folder(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::delete_note_folder(&conn, id).map_err(|e| e.to_string())
}

// ── Notes ───────────────────────────────────────────────────

#[tauri::command]
pub fn list_notes(state: State<DbState>, folder_id: i64) -> Result<Vec<Note>, String> {
    let conn = state.lock_recover();
    queries::list_notes(&conn, folder_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(state: State<DbState>, folder_id: i64, title: String, content: String) -> Result<Note, String> {
    let conn = state.lock_recover();
    queries::create_note(&conn, folder_id, &title, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_note(state: State<DbState>, id: i64, title: String, content: String, is_pinned: bool) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::update_note(&conn, id, &title, &content, is_pinned).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_note(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::delete_note(&conn, id).map_err(|e| e.to_string())
}
