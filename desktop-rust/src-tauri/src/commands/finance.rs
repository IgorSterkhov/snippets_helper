use crate::db::{
    models::{FinanceItem, FinancePlan},
    queries, DbState,
};
use tauri::State;

#[tauri::command]
pub fn list_finance_plans(state: State<DbState>) -> Result<Vec<FinancePlan>, String> {
    let conn = state.lock_recover();
    queries::list_finance_plans(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_finance_plan(
    state: State<DbState>,
    name: String,
    currency: String,
    kind: Option<String>,
) -> Result<FinancePlan, String> {
    let conn = state.lock_recover();
    queries::create_finance_plan(&conn, &name, &currency, kind.as_deref().unwrap_or("monthly"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_finance_plan(
    state: State<DbState>,
    id: i64,
    name: String,
    currency: String,
    kind: Option<String>,
) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::update_finance_plan(&conn, id, &name, &currency, kind.as_deref().unwrap_or("monthly"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_finance_plans(state: State<DbState>, ids: Vec<i64>) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::reorder_finance_plans(&conn, &ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_finance_plan(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::delete_finance_plan(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_finance_items(
    state: State<DbState>,
    plan_id: i64,
) -> Result<Vec<FinanceItem>, String> {
    let conn = state.lock_recover();
    queries::list_finance_items(&conn, plan_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_finance_item(
    state: State<DbState>,
    plan_id: i64,
    parent_id: Option<i64>,
    name: String,
    amount_cents: i64,
    due_day: Option<i64>,
    due_date: Option<String>,
    note: String,
) -> Result<FinanceItem, String> {
    let conn = state.lock_recover();
    let due_day = due_day
        .map(i32::try_from)
        .transpose()
        .map_err(|_| "due_day is out of range".to_string())?;
    queries::create_finance_item(
        &conn,
        plan_id,
        parent_id,
        &name,
        amount_cents,
        due_day,
        due_date.as_deref(),
        &note,
    )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_finance_item(
    state: State<DbState>,
    id: i64,
    name: String,
    amount_cents: i64,
    due_day: Option<i64>,
    due_date: Option<String>,
    note: String,
) -> Result<(), String> {
    let conn = state.lock_recover();
    let due_day = due_day
        .map(i32::try_from)
        .transpose()
        .map_err(|_| "due_day is out of range".to_string())?;
    queries::update_finance_item(
        &conn,
        id,
        &name,
        amount_cents,
        due_day,
        due_date.as_deref(),
        &note,
    )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_finance_item(
    state: State<DbState>,
    id: i64,
    parent_id: Option<i64>,
    before_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::move_finance_item(&conn, id, parent_id, before_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_finance_item(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::delete_finance_item(&conn, id).map_err(|e| e.to_string())
}
