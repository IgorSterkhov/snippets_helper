use std::collections::HashMap;
use tauri::State;

use crate::db::{
    DbState,
    models::{SqlTableAnalyzerTemplate, SqlMacrosingTemplate},
    queries,
};
use crate::handlers::{
    sql_parser,
    sql_formatter,
    sql_obfuscator::{self, ObfuscationEntry},
    sql_analyzer,
    sql_macrosing::{self, PlaceholderConfig},
};

// ── Parser ──────────────────────────────────────────────────

#[tauri::command]
pub fn parse_sql_tables(sql: String) -> String {
    sql_parser::parse_sql(&sql)
}

// ── Formatter ───────────────────────────────────────────────

#[tauri::command]
pub fn format_sql(sql: String, keywords_upper: bool) -> (String, Option<String>) {
    sql_formatter::format_sql(&sql, keywords_upper)
}

// ── Obfuscator ──────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct ObfuscateResult {
    pub obfuscated: String,
    pub mappings: Vec<ObfuscationEntry>,
}

#[tauri::command]
pub fn obfuscate_sql(sql: String, mappings_json: String) -> Result<ObfuscateResult, String> {
    // Parse existing mappings if provided
    let existing_mappings: Vec<ObfuscationEntry> = if mappings_json.is_empty() {
        vec![]
    } else {
        serde_json::from_str(&mappings_json).map_err(|e| e.to_string())?
    };

    if existing_mappings.is_empty() {
        // First pass: extract entities and generate mappings
        let entities = sql_obfuscator::extract_entities(&sql);
        let mappings = sql_obfuscator::generate_obfuscated_names(&entities);
        let obfuscated = sql_obfuscator::apply_replacements(&sql, &mappings);
        Ok(ObfuscateResult { obfuscated, mappings })
    } else {
        // Apply provided mappings
        let obfuscated = sql_obfuscator::apply_replacements(&sql, &existing_mappings);
        Ok(ObfuscateResult {
            obfuscated,
            mappings: existing_mappings,
        })
    }
}

// ── Analyzer ────────────────────────────────────────────────

#[tauri::command]
pub fn analyze_ddl(
    ddl: String,
    where_clause: String,
    row_version_field: String,
    format_vertical: bool,
    templates: Vec<String>,
) -> Result<String, String> {
    sql_analyzer::analyze_ddl(&ddl, &where_clause, &row_version_field, format_vertical, &templates)
}

// ── Macrosing ───────────────────────────────────────────────

#[tauri::command]
pub fn generate_macros(
    template: String,
    placeholders_json: String,
    mode: String,
    separator: String,
) -> Result<String, String> {
    let config: HashMap<String, PlaceholderConfig> =
        serde_json::from_str(&placeholders_json).map_err(|e| e.to_string())?;
    sql_macrosing::generate_macros(&template, &config, &mode, &separator)
}

// ── Analyzer Templates CRUD ─────────────────────────────────

#[tauri::command]
pub fn list_analyzer_templates(
    state: State<DbState>,
) -> Result<Vec<SqlTableAnalyzerTemplate>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::list_sql_table_analyzer_templates(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_analyzer_template(
    state: State<DbState>,
    template_text: String,
) -> Result<SqlTableAnalyzerTemplate, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::create_sql_table_analyzer_template(&conn, &template_text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_analyzer_template(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::delete_sql_table_analyzer_template(&conn, id).map_err(|e| e.to_string())
}

// ── Macrosing Templates CRUD ────────────────────────────────

#[tauri::command]
pub fn list_macrosing_templates(
    state: State<DbState>,
) -> Result<Vec<SqlMacrosingTemplate>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::list_sql_macrosing_templates(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_macrosing_template(
    state: State<DbState>,
    template_name: String,
    template_text: String,
    placeholders_config: String,
    combination_mode: String,
    separator: String,
) -> Result<SqlMacrosingTemplate, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::create_sql_macrosing_template(
        &conn,
        &template_name,
        &template_text,
        &placeholders_config,
        &combination_mode,
        &separator,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_macrosing_template(
    state: State<DbState>,
    id: i64,
    template_name: String,
    template_text: String,
    placeholders_config: String,
    combination_mode: String,
    separator: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::update_sql_macrosing_template(
        &conn,
        id,
        &template_name,
        &template_text,
        &placeholders_config,
        &combination_mode,
        &separator,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_macrosing_template(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    queries::delete_sql_macrosing_template(&conn, id).map_err(|e| e.to_string())
}
