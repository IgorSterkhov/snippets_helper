use tauri::State;

use crate::db::{
    models::{Task, TaskCategory, TaskCheckbox, TaskLink, TaskStatus},
    queries::{self, CheckboxReorderEntry, TaskFilter},
    DbState,
};

// ── Categories ───────────────────────────────────────────────

#[tauri::command]
pub fn list_task_categories(state: State<DbState>) -> Result<Vec<TaskCategory>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::list_task_categories(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_task_category(
    state: State<DbState>,
    name: String,
    color: String,
) -> Result<TaskCategory, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::create_task_category(&conn, &name, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task_category(
    state: State<DbState>,
    id: i64,
    name: String,
    color: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::update_task_category(&conn, id, &name, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task_category(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::delete_task_category(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_task_categories(state: State<DbState>, ids: Vec<i64>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::reorder_task_categories(&conn, &ids).map_err(|e| e.to_string())
}

// ── Statuses ─────────────────────────────────────────────────

#[tauri::command]
pub fn list_task_statuses(state: State<DbState>) -> Result<Vec<TaskStatus>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::list_task_statuses(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_task_status(
    state: State<DbState>,
    name: String,
    color: String,
) -> Result<TaskStatus, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::create_task_status(&conn, &name, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task_status(
    state: State<DbState>,
    id: i64,
    name: String,
    color: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::update_task_status(&conn, id, &name, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task_status(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::delete_task_status(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_task_statuses(state: State<DbState>, ids: Vec<i64>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::reorder_task_statuses(&conn, &ids).map_err(|e| e.to_string())
}

// ── Tasks ────────────────────────────────────────────────────

#[tauri::command]
pub fn list_tasks(
    state: State<DbState>,
    category: Option<String>,
    status: Option<String>,
) -> Result<Vec<Task>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cat = TaskFilter::from_opt_str(category.as_deref());
    let st = TaskFilter::from_opt_str(status.as_deref());
    queries::list_tasks(&conn, cat, st).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_pinned_tasks(state: State<DbState>) -> Result<Vec<Task>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::list_pinned_tasks(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_task(
    state: State<DbState>,
    title: String,
    category_id: Option<i64>,
    status_id: Option<i64>,
) -> Result<Task, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::create_task(&conn, &title, category_id, status_id).map_err(|e| e.to_string())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn update_task(
    state: State<DbState>,
    id: i64,
    title: String,
    category_id: Option<i64>,
    status_id: Option<i64>,
    is_pinned: bool,
    bg_color: Option<String>,
    tracker_url: Option<String>,
    notes_md: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::update_task(
        &conn,
        id,
        &title,
        category_id,
        status_id,
        is_pinned,
        bg_color.as_deref(),
        tracker_url.as_deref(),
        &notes_md,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_tasks(state: State<DbState>, ids: Vec<i64>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::reorder_tasks(&conn, &ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::delete_task(&conn, id).map_err(|e| e.to_string())
}

// ── Checkboxes ───────────────────────────────────────────────

#[tauri::command]
pub fn list_task_checkboxes(state: State<DbState>, task_id: i64) -> Result<Vec<TaskCheckbox>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::list_task_checkboxes(&conn, task_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_task_checkbox(
    state: State<DbState>,
    task_id: i64,
    parent_id: Option<i64>,
    text: String,
) -> Result<TaskCheckbox, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::create_task_checkbox(&conn, task_id, parent_id, &text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task_checkbox(
    state: State<DbState>,
    id: i64,
    text: String,
    is_checked: bool,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::update_task_checkbox(&conn, id, &text, is_checked).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_task_checkboxes(
    state: State<DbState>,
    task_id: i64,
    entries: Vec<CheckboxReorderEntry>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::reorder_task_checkboxes(&conn, task_id, &entries).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task_checkbox(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::delete_task_checkbox(&conn, id).map_err(|e| e.to_string())
}

// ── Links ────────────────────────────────────────────────────

#[tauri::command]
pub fn list_task_links(state: State<DbState>, task_id: i64) -> Result<Vec<TaskLink>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::list_task_links(&conn, task_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_task_link(
    state: State<DbState>,
    task_id: i64,
    url: String,
    label: Option<String>,
) -> Result<TaskLink, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::create_task_link(&conn, task_id, &url, label.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task_link(
    state: State<DbState>,
    id: i64,
    url: String,
    label: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::update_task_link(&conn, id, &url, label.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_task_links(
    state: State<DbState>,
    task_id: i64,
    ids: Vec<i64>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::reorder_task_links(&conn, task_id, &ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task_link(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::delete_task_link(&conn, id).map_err(|e| e.to_string())
}
