use tauri::State;
use crate::db::{DbState, queries, models::Shortcut};

#[tauri::command]
pub fn list_shortcuts(state: State<DbState>) -> Result<Vec<Shortcut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::list_shortcuts(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_shortcuts(state: State<DbState>, query: String) -> Result<Vec<Shortcut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::search_shortcuts(&conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_shortcut(state: State<DbState>, name: String, value: String, description: String) -> Result<Shortcut, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::create_shortcut(&conn, &name, &value, &description).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_shortcut(state: State<DbState>, id: i64, name: String, value: String, description: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::update_shortcut(&conn, id, &name, &value, &description).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_shortcut(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::delete_shortcut(&conn, id).map_err(|e| e.to_string())
}
