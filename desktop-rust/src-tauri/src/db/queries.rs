use chrono::{NaiveDateTime, Utc};
use regex::Regex;
use rusqlite::{params, Connection, Result};
use serde_json::{Map, Value};
use uuid::Uuid;

use super::models::*;
use crate::sync::schema::{self, SYNCED_TABLES};

// ── Helpers ──────────────────────────────────────────────────

/// Format for storing NaiveDateTime as TEXT in SQLite.
const DT_FMT: &str = "%Y-%m-%d %H:%M:%S%.f";

fn now_str() -> String {
    Utc::now().naive_utc().format(DT_FMT).to_string()
}

fn parse_dt(s: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(s, DT_FMT)
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S"))
        .unwrap_or_default()
}

// ── Shortcuts ────────────────────────────────────────────────

pub fn list_shortcuts(conn: &Connection) -> Result<Vec<Shortcut>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, value, description, uuid, updated_at, sync_status, user_id
         FROM shortcuts WHERE sync_status != 'deleted' ORDER BY name",
    )?;
    let rows = stmt.query_map([], |row| {
        let updated_at_str: String = row.get(5)?;
        Ok(Shortcut {
            id: row.get(0)?,
            name: row.get(1)?,
            value: row.get(2)?,
            description: row.get(3)?,
            uuid: row.get(4)?,
            updated_at: parse_dt(&updated_at_str),
            sync_status: row.get(6)?,
            user_id: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn search_shortcuts(conn: &Connection, query: &str) -> Result<Vec<Shortcut>> {
    let pattern = format!("%{}%", query);
    let mut stmt = conn.prepare(
        "SELECT id, name, value, description, uuid, updated_at, sync_status, user_id
         FROM shortcuts
         WHERE sync_status != 'deleted'
           AND (name LIKE ?1 OR value LIKE ?1 OR description LIKE ?1)
         ORDER BY name",
    )?;
    let rows = stmt.query_map(params![pattern], |row| {
        let updated_at_str: String = row.get(5)?;
        Ok(Shortcut {
            id: row.get(0)?,
            name: row.get(1)?,
            value: row.get(2)?,
            description: row.get(3)?,
            uuid: row.get(4)?,
            updated_at: parse_dt(&updated_at_str),
            sync_status: row.get(6)?,
            user_id: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn create_shortcut(conn: &Connection, name: &str, value: &str, description: &str) -> Result<Shortcut> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO shortcuts (name, value, description, uuid, updated_at, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', '')",
        params![name, value, description, uuid, now],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Shortcut {
        id: Some(id),
        name: name.to_string(),
        value: value.to_string(),
        description: description.to_string(),
        uuid,
        updated_at: parse_dt(&now),
        sync_status: "pending".to_string(),
        user_id: String::new(),
    })
}

pub fn update_shortcut(conn: &Connection, id: i64, name: &str, value: &str, description: &str) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE shortcuts SET name = ?1, value = ?2, description = ?3, updated_at = ?4, sync_status = 'pending'
         WHERE id = ?5",
        params![name, value, description, now, id],
    )?;
    Ok(())
}

pub fn delete_shortcut(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE shortcuts SET sync_status = 'deleted', updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

// ── Snippet Tags ────────────────────────────────────────────

pub fn list_snippet_tags(conn: &Connection) -> Result<Vec<SnippetTag>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, patterns, color, sort_order, uuid, updated_at, sync_status, user_id
         FROM snippet_tags WHERE sync_status != 'deleted' ORDER BY sort_order, name",
    )?;
    let rows = stmt.query_map([], |row| {
        let updated_at_str: String = row.get(6)?;
        Ok(SnippetTag {
            id: row.get(0)?,
            name: row.get(1)?,
            patterns: row.get(2)?,
            color: row.get(3)?,
            sort_order: row.get(4)?,
            uuid: row.get(5)?,
            updated_at: parse_dt(&updated_at_str),
            sync_status: row.get(7)?,
            user_id: row.get(8)?,
        })
    })?;
    rows.collect()
}

pub fn create_snippet_tag(
    conn: &Connection,
    name: &str,
    patterns: &str,
    color: &str,
    sort_order: i32,
) -> Result<SnippetTag> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO snippet_tags (name, patterns, color, sort_order, uuid, updated_at, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', '')",
        params![name, patterns, color, sort_order, uuid, now],
    )?;
    let id = conn.last_insert_rowid();
    Ok(SnippetTag {
        id: Some(id),
        name: name.to_string(),
        patterns: patterns.to_string(),
        color: color.to_string(),
        sort_order,
        uuid,
        updated_at: parse_dt(&now),
        sync_status: "pending".to_string(),
        user_id: String::new(),
    })
}

pub fn update_snippet_tag(
    conn: &Connection,
    id: i64,
    name: &str,
    patterns: &str,
    color: &str,
    sort_order: i32,
) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE snippet_tags SET name = ?1, patterns = ?2, color = ?3, sort_order = ?4,
                updated_at = ?5, sync_status = 'pending'
         WHERE id = ?6",
        params![name, patterns, color, sort_order, now, id],
    )?;
    Ok(())
}

pub fn delete_snippet_tag(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE snippet_tags SET sync_status = 'deleted', updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

/// Convert a glob pattern (with `*` as wildcard) to a case-insensitive regex.
fn glob_to_regex(pattern: &str) -> Option<Regex> {
    let escaped = regex::escape(pattern).replace(r"\*", ".*");
    let anchored = format!("(?i)^{}$", escaped);
    Regex::new(&anchored).ok()
}

/// Filter shortcuts by glob patterns on the name field, then by search query.
pub fn filter_shortcuts_by_patterns(
    conn: &Connection,
    patterns: &[String],
    query: &str,
) -> Result<Vec<Shortcut>> {
    let all = list_shortcuts(conn)?;

    // Compile glob patterns to regexes
    let regexes: Vec<Regex> = patterns.iter().filter_map(|p| glob_to_regex(p)).collect();

    let filtered: Vec<Shortcut> = all
        .into_iter()
        .filter(|s| {
            if regexes.is_empty() {
                return true;
            }
            regexes.iter().any(|re| re.is_match(&s.name))
        })
        .filter(|s| {
            if query.is_empty() {
                return true;
            }
            let q = query.to_lowercase();
            s.name.to_lowercase().contains(&q)
                || s.value.to_lowercase().contains(&q)
                || s.description.to_lowercase().contains(&q)
        })
        .collect();

    Ok(filtered)
}

// ── Note Folders ─────────────────────────────────────────────

pub fn list_note_folders(conn: &Connection) -> Result<Vec<NoteFolder>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, sort_order, uuid, updated_at, sync_status, user_id
         FROM note_folders WHERE sync_status != 'deleted' ORDER BY sort_order, name",
    )?;
    let rows = stmt.query_map([], |row| {
        let updated_at_str: String = row.get(4)?;
        Ok(NoteFolder {
            id: row.get(0)?,
            name: row.get(1)?,
            sort_order: row.get(2)?,
            uuid: row.get(3)?,
            updated_at: parse_dt(&updated_at_str),
            sync_status: row.get(5)?,
            user_id: row.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn create_note_folder(conn: &Connection, name: &str, sort_order: i32) -> Result<NoteFolder> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO note_folders (name, sort_order, uuid, updated_at, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, 'pending', '')",
        params![name, sort_order, uuid, now],
    )?;
    let id = conn.last_insert_rowid();
    Ok(NoteFolder {
        id: Some(id),
        name: name.to_string(),
        sort_order,
        uuid,
        updated_at: parse_dt(&now),
        sync_status: "pending".to_string(),
        user_id: String::new(),
    })
}

pub fn update_note_folder(conn: &Connection, id: i64, name: &str, sort_order: i32) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE note_folders SET name = ?1, sort_order = ?2, updated_at = ?3, sync_status = 'pending'
         WHERE id = ?4",
        params![name, sort_order, now, id],
    )?;
    Ok(())
}

pub fn delete_note_folder(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE note_folders SET sync_status = 'deleted', updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

// ── Notes ────────────────────────────────────────────────────

pub fn list_notes(conn: &Connection, folder_id: i64) -> Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, folder_id, title, content, created_at, updated_at, is_pinned, uuid, sync_status, user_id
         FROM notes WHERE folder_id = ?1 AND sync_status != 'deleted'
         ORDER BY is_pinned DESC, updated_at DESC",
    )?;
    let rows = stmt.query_map(params![folder_id], |row| {
        let created_str: String = row.get(4)?;
        let updated_str: String = row.get(5)?;
        Ok(Note {
            id: row.get(0)?,
            folder_id: row.get(1)?,
            title: row.get(2)?,
            content: row.get(3)?,
            created_at: parse_dt(&created_str),
            updated_at: parse_dt(&updated_str),
            is_pinned: row.get(6)?,
            uuid: row.get(7)?,
            sync_status: row.get(8)?,
            user_id: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn create_note(conn: &Connection, folder_id: i64, title: &str, content: &str) -> Result<Note> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO notes (folder_id, title, content, created_at, updated_at, is_pinned, uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 'pending', '')",
        params![folder_id, title, content, now, now, uuid],
    )?;
    let id = conn.last_insert_rowid();
    let dt = parse_dt(&now);
    Ok(Note {
        id: Some(id),
        folder_id,
        title: title.to_string(),
        content: content.to_string(),
        created_at: dt,
        updated_at: dt,
        is_pinned: false,
        uuid,
        sync_status: "pending".to_string(),
        user_id: String::new(),
    })
}

pub fn update_note(
    conn: &Connection,
    id: i64,
    title: &str,
    content: &str,
    is_pinned: bool,
) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE notes SET title = ?1, content = ?2, is_pinned = ?3, updated_at = ?4, sync_status = 'pending'
         WHERE id = ?5",
        params![title, content, is_pinned, now, id],
    )?;
    Ok(())
}

pub fn delete_note(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE notes SET sync_status = 'deleted', updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

// ── SQL Table Analyzer Templates ─────────────────────────────

pub fn list_sql_table_analyzer_templates(conn: &Connection) -> Result<Vec<SqlTableAnalyzerTemplate>> {
    let mut stmt = conn.prepare(
        "SELECT id, template_text, uuid, updated_at, sync_status, user_id
         FROM sql_table_analyzer_templates WHERE sync_status != 'deleted' ORDER BY id",
    )?;
    let rows = stmt.query_map([], |row| {
        let updated_str: String = row.get(3)?;
        Ok(SqlTableAnalyzerTemplate {
            id: row.get(0)?,
            template_text: row.get(1)?,
            uuid: row.get(2)?,
            updated_at: parse_dt(&updated_str),
            sync_status: row.get(4)?,
            user_id: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn create_sql_table_analyzer_template(conn: &Connection, template_text: &str) -> Result<SqlTableAnalyzerTemplate> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO sql_table_analyzer_templates (template_text, uuid, updated_at, sync_status, user_id)
         VALUES (?1, ?2, ?3, 'pending', '')",
        params![template_text, uuid, now],
    )?;
    let id = conn.last_insert_rowid();
    Ok(SqlTableAnalyzerTemplate {
        id: Some(id),
        template_text: template_text.to_string(),
        uuid,
        updated_at: parse_dt(&now),
        sync_status: "pending".to_string(),
        user_id: String::new(),
    })
}

pub fn delete_sql_table_analyzer_template(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE sql_table_analyzer_templates SET sync_status = 'deleted', updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

// ── SQL Macrosing Templates ──────────────────────────────────

pub fn list_sql_macrosing_templates(conn: &Connection) -> Result<Vec<SqlMacrosingTemplate>> {
    let mut stmt = conn.prepare(
        "SELECT id, template_name, template_text, placeholders_config, combination_mode, separator,
                uuid, updated_at, sync_status, user_id
         FROM sql_macrosing_templates WHERE sync_status != 'deleted' ORDER BY template_name",
    )?;
    let rows = stmt.query_map([], |row| {
        let updated_str: String = row.get(7)?;
        Ok(SqlMacrosingTemplate {
            id: row.get(0)?,
            template_name: row.get(1)?,
            template_text: row.get(2)?,
            placeholders_config: row.get(3)?,
            combination_mode: row.get(4)?,
            separator: row.get(5)?,
            uuid: row.get(6)?,
            updated_at: parse_dt(&updated_str),
            sync_status: row.get(8)?,
            user_id: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn create_sql_macrosing_template(
    conn: &Connection,
    template_name: &str,
    template_text: &str,
    placeholders_config: &str,
    combination_mode: &str,
    separator: &str,
) -> Result<SqlMacrosingTemplate> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO sql_macrosing_templates
            (template_name, template_text, placeholders_config, combination_mode, separator,
             uuid, updated_at, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', '')",
        params![template_name, template_text, placeholders_config, combination_mode, separator, uuid, now],
    )?;
    let id = conn.last_insert_rowid();
    Ok(SqlMacrosingTemplate {
        id: Some(id),
        template_name: template_name.to_string(),
        template_text: template_text.to_string(),
        placeholders_config: placeholders_config.to_string(),
        combination_mode: combination_mode.to_string(),
        separator: separator.to_string(),
        uuid,
        updated_at: parse_dt(&now),
        sync_status: "pending".to_string(),
        user_id: String::new(),
    })
}

pub fn update_sql_macrosing_template(
    conn: &Connection,
    id: i64,
    template_name: &str,
    template_text: &str,
    placeholders_config: &str,
    combination_mode: &str,
    separator: &str,
) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE sql_macrosing_templates
         SET template_name = ?1, template_text = ?2, placeholders_config = ?3,
             combination_mode = ?4, separator = ?5, updated_at = ?6, sync_status = 'pending'
         WHERE id = ?7",
        params![template_name, template_text, placeholders_config, combination_mode, separator, now, id],
    )?;
    Ok(())
}

pub fn delete_sql_macrosing_template(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE sql_macrosing_templates SET sync_status = 'deleted', updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

// ── Obfuscation Mappings ────────────────────────────────────

pub fn list_obfuscation_mappings_by_session(conn: &Connection, session_name: &str) -> Result<Vec<ObfuscationMapping>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_name, entity_type, original_value, obfuscated_value,
                created_at, uuid, updated_at, sync_status, user_id
         FROM obfuscation_mappings
         WHERE session_name = ?1 AND sync_status != 'deleted'
         ORDER BY id",
    )?;
    let rows = stmt.query_map(params![session_name], |row| {
        let created_str: String = row.get(5)?;
        let updated_str: String = row.get(7)?;
        Ok(ObfuscationMapping {
            id: row.get(0)?,
            session_name: row.get(1)?,
            entity_type: row.get(2)?,
            original_value: row.get(3)?,
            obfuscated_value: row.get(4)?,
            created_at: parse_dt(&created_str),
            uuid: row.get(6)?,
            updated_at: parse_dt(&updated_str),
            sync_status: row.get(8)?,
            user_id: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn create_obfuscation_mapping(
    conn: &Connection,
    session_name: &str,
    entity_type: &str,
    original_value: &str,
    obfuscated_value: &str,
) -> Result<ObfuscationMapping> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO obfuscation_mappings
            (session_name, entity_type, original_value, obfuscated_value, created_at, uuid, updated_at, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', '')",
        params![session_name, entity_type, original_value, obfuscated_value, now, uuid, now],
    )?;
    let id = conn.last_insert_rowid();
    let dt = parse_dt(&now);
    Ok(ObfuscationMapping {
        id: Some(id),
        session_name: session_name.to_string(),
        entity_type: entity_type.to_string(),
        original_value: original_value.to_string(),
        obfuscated_value: obfuscated_value.to_string(),
        created_at: dt,
        uuid,
        updated_at: dt,
        sync_status: "pending".to_string(),
        user_id: String::new(),
    })
}

pub fn delete_obfuscation_mapping(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE obfuscation_mappings SET sync_status = 'deleted', updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

// ── App Settings ─────────────────────────────────────────────

pub fn get_setting(conn: &Connection, computer_id: &str, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT setting_value FROM app_settings WHERE computer_id = ?1 AND setting_key = ?2",
    )?;
    let mut rows = stmt.query_map(params![computer_id, key], |row| row.get(0))?;
    match rows.next() {
        Some(val) => Ok(Some(val?)),
        None => Ok(None),
    }
}

pub fn set_setting(conn: &Connection, computer_id: &str, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO app_settings (computer_id, setting_key, setting_value)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(computer_id, setting_key) DO UPDATE SET setting_value = excluded.setting_value",
        params![computer_id, key, value],
    )?;
    Ok(())
}

// ── Superset Settings ────────────────────────────────────────

pub fn get_superset_setting(conn: &Connection, computer_id: &str, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT setting_value FROM superset_settings WHERE computer_id = ?1 AND setting_key = ?2",
    )?;
    let mut rows = stmt.query_map(params![computer_id, key], |row| row.get(0))?;
    match rows.next() {
        Some(val) => Ok(Some(val?)),
        None => Ok(None),
    }
}

pub fn set_superset_setting(conn: &Connection, computer_id: &str, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO superset_settings (computer_id, setting_key, setting_value)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(computer_id, setting_key) DO UPDATE SET setting_value = excluded.setting_value",
        params![computer_id, key, value],
    )?;
    Ok(())
}

// ── Commit Tags ──────────────────────────────────────────────

pub fn list_commit_tags(conn: &Connection, computer_id: &str) -> Result<Vec<CommitTag>> {
    let mut stmt = conn.prepare(
        "SELECT id, computer_id, tag_name, is_default
         FROM commit_tags WHERE computer_id = ?1 ORDER BY tag_name",
    )?;
    let rows = stmt.query_map(params![computer_id], |row| {
        Ok(CommitTag {
            id: row.get(0)?,
            computer_id: row.get(1)?,
            tag_name: row.get(2)?,
            is_default: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn create_commit_tag(conn: &Connection, computer_id: &str, tag_name: &str, is_default: bool) -> Result<CommitTag> {
    conn.execute(
        "INSERT INTO commit_tags (computer_id, tag_name, is_default) VALUES (?1, ?2, ?3)",
        params![computer_id, tag_name, is_default],
    )?;
    let id = conn.last_insert_rowid();
    Ok(CommitTag {
        id: Some(id),
        computer_id: computer_id.to_string(),
        tag_name: tag_name.to_string(),
        is_default,
    })
}

pub fn delete_commit_tag(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM commit_tags WHERE id = ?1", params![id])?;
    Ok(())
}

// ── Commit History ───────────────────────────────────────────

pub fn list_commit_history(conn: &Connection, computer_id: &str) -> Result<Vec<CommitHistory>> {
    let mut stmt = conn.prepare(
        "SELECT id, computer_id, created_at, task_link, task_id, commit_type,
                object_category, object_value, message, selected_tags,
                mr_link, test_report, prod_report, transfer_connect, test_dag
         FROM commit_history WHERE computer_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![computer_id], |row| {
        let created_str: String = row.get(2)?;
        Ok(CommitHistory {
            id: row.get(0)?,
            computer_id: row.get(1)?,
            created_at: parse_dt(&created_str),
            task_link: row.get(3)?,
            task_id: row.get(4)?,
            commit_type: row.get(5)?,
            object_category: row.get(6)?,
            object_value: row.get(7)?,
            message: row.get(8)?,
            selected_tags: row.get(9)?,
            mr_link: row.get(10)?,
            test_report: row.get(11)?,
            prod_report: row.get(12)?,
            transfer_connect: row.get(13)?,
            test_dag: row.get(14)?,
        })
    })?;
    rows.collect()
}

pub fn create_commit_history(
    conn: &Connection,
    computer_id: &str,
    task_link: &str,
    task_id: &str,
    commit_type: &str,
    object_category: &str,
    object_value: &str,
    message: &str,
    selected_tags: &str,
    mr_link: &str,
    test_report: &str,
    prod_report: &str,
    transfer_connect: &str,
    test_dag: &str,
) -> Result<CommitHistory> {
    let now = now_str();
    conn.execute(
        "INSERT INTO commit_history
            (computer_id, created_at, task_link, task_id, commit_type,
             object_category, object_value, message, selected_tags,
             mr_link, test_report, prod_report, transfer_connect, test_dag)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            computer_id, now, task_link, task_id, commit_type,
            object_category, object_value, message, selected_tags,
            mr_link, test_report, prod_report, transfer_connect, test_dag
        ],
    )?;
    let id = conn.last_insert_rowid();
    Ok(CommitHistory {
        id: Some(id),
        computer_id: computer_id.to_string(),
        created_at: parse_dt(&now),
        task_link: task_link.to_string(),
        task_id: task_id.to_string(),
        commit_type: commit_type.to_string(),
        object_category: object_category.to_string(),
        object_value: object_value.to_string(),
        message: message.to_string(),
        selected_tags: selected_tags.to_string(),
        mr_link: mr_link.to_string(),
        test_report: test_report.to_string(),
        prod_report: prod_report.to_string(),
        transfer_connect: transfer_connect.to_string(),
        test_dag: test_dag.to_string(),
    })
}

pub fn delete_commit_history(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM commit_history WHERE id = ?1", params![id])?;
    Ok(())
}

// ── Exec Categories ──────────────────────────────────────────

pub fn list_exec_categories(conn: &Connection) -> Result<Vec<ExecCategory>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, sort_order FROM exec_categories ORDER BY sort_order, name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ExecCategory {
            id: row.get(0)?,
            name: row.get(1)?,
            sort_order: row.get(2)?,
        })
    })?;
    rows.collect()
}

pub fn create_exec_category(conn: &Connection, name: &str, sort_order: i32) -> Result<ExecCategory> {
    conn.execute(
        "INSERT INTO exec_categories (name, sort_order) VALUES (?1, ?2)",
        params![name, sort_order],
    )?;
    let id = conn.last_insert_rowid();
    Ok(ExecCategory {
        id: Some(id),
        name: name.to_string(),
        sort_order,
    })
}

pub fn update_exec_category(conn: &Connection, id: i64, name: &str, sort_order: i32) -> Result<()> {
    conn.execute(
        "UPDATE exec_categories SET name = ?1, sort_order = ?2 WHERE id = ?3",
        params![name, sort_order, id],
    )?;
    Ok(())
}

pub fn delete_exec_category(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM exec_categories WHERE id = ?1", params![id])?;
    Ok(())
}

// ── Exec Commands ────────────────────────────────────────────

pub fn list_exec_commands(conn: &Connection, category_id: i64) -> Result<Vec<ExecCommand>> {
    let mut stmt = conn.prepare(
        "SELECT id, category_id, name, command, description, sort_order, hide_after_run
         FROM exec_commands WHERE category_id = ?1 ORDER BY sort_order, name",
    )?;
    let rows = stmt.query_map(params![category_id], |row| {
        Ok(ExecCommand {
            id: row.get(0)?,
            category_id: row.get(1)?,
            name: row.get(2)?,
            command: row.get(3)?,
            description: row.get(4)?,
            sort_order: row.get(5)?,
            hide_after_run: row.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn create_exec_command(
    conn: &Connection,
    category_id: i64,
    name: &str,
    command: &str,
    description: &str,
    sort_order: i32,
    hide_after_run: bool,
) -> Result<ExecCommand> {
    conn.execute(
        "INSERT INTO exec_commands (category_id, name, command, description, sort_order, hide_after_run)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![category_id, name, command, description, sort_order, hide_after_run],
    )?;
    let id = conn.last_insert_rowid();
    Ok(ExecCommand {
        id: Some(id),
        category_id,
        name: name.to_string(),
        command: command.to_string(),
        description: description.to_string(),
        sort_order,
        hide_after_run,
    })
}

pub fn update_exec_command(
    conn: &Connection,
    id: i64,
    name: &str,
    command: &str,
    description: &str,
    sort_order: i32,
    hide_after_run: bool,
) -> Result<()> {
    conn.execute(
        "UPDATE exec_commands SET name = ?1, command = ?2, description = ?3,
                sort_order = ?4, hide_after_run = ?5
         WHERE id = ?6",
        params![name, command, description, sort_order, hide_after_run, id],
    )?;
    Ok(())
}

pub fn delete_exec_command(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM exec_commands WHERE id = ?1", params![id])?;
    Ok(())
}

// ── Sync Helpers ────────────────────────────────────────────

fn validate_table(table: &str) -> Result<()> {
    if SYNCED_TABLES.contains(&table) {
        Ok(())
    } else {
        Err(rusqlite::Error::InvalidParameterName(format!(
            "unknown synced table: {table}"
        )))
    }
}

/// Get all rows with sync_status = 'pending' or 'deleted' from a synced table.
/// Returns each row as a serde_json::Value (object).
pub fn get_pending_rows(conn: &Connection, table: &str) -> Result<Vec<Value>> {
    validate_table(table)?;

    let data_cols = schema::data_columns(table);
    // Build column list: data columns + uuid, updated_at, sync_status, user_id
    let mut cols: Vec<&str> = data_cols.to_vec();
    cols.extend_from_slice(&["uuid", "updated_at", "sync_status", "user_id"]);

    let col_list = cols.join(", ");
    let sql = format!(
        "SELECT {col_list} FROM {table} WHERE sync_status IN ('pending', 'deleted')"
    );

    let mut stmt = conn.prepare(&sql)?;
    let col_count = cols.len();
    let rows = stmt.query_map([], |row| {
        let mut map = Map::new();
        for (i, &col_name) in cols.iter().enumerate().take(col_count) {
            let val: Value = match row.get_ref(i)? {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Integer(n) => Value::Number(n.into()),
                rusqlite::types::ValueRef::Real(f) => {
                    serde_json::Number::from_f64(f)
                        .map(Value::Number)
                        .unwrap_or(Value::Null)
                }
                rusqlite::types::ValueRef::Text(s) => {
                    Value::String(String::from_utf8_lossy(s).to_string())
                }
                rusqlite::types::ValueRef::Blob(b) => {
                    Value::String(String::from_utf8_lossy(b).to_string())
                }
            };
            map.insert(col_name.to_string(), val);
        }
        Ok(Value::Object(map))
    })?;
    rows.collect()
}

/// Mark rows as synced by UUID, but only when updated_at still matches
/// (race-condition guard: if the user edited a row between push and ack,
/// we don't overwrite the new 'pending' status).
pub fn mark_as_synced(
    conn: &Connection,
    table: &str,
    uuid_timestamps: &[(String, String)],
) -> Result<()> {
    validate_table(table)?;
    let sql = format!(
        "UPDATE {table} SET sync_status = 'synced' WHERE uuid = ?1 AND updated_at = ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    for (uuid, updated_at) in uuid_timestamps {
        stmt.execute(params![uuid, updated_at])?;
    }
    Ok(())
}

/// Hard-delete rows that were confirmed deleted on the server.
pub fn purge_deleted(conn: &Connection, table: &str, uuids: &[String]) -> Result<()> {
    validate_table(table)?;
    if uuids.is_empty() {
        return Ok(());
    }
    let placeholders: Vec<String> = (1..=uuids.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "DELETE FROM {table} WHERE uuid IN ({})",
        placeholders.join(", ")
    );
    let params: Vec<&dyn rusqlite::types::ToSql> =
        uuids.iter().map(|u| u as &dyn rusqlite::types::ToSql).collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

/// Upsert rows received from the server.
/// Uses INSERT OR REPLACE keyed on uuid (via a unique index).
/// All rows are marked sync_status = 'synced'.
pub fn upsert_from_server(conn: &Connection, table: &str, rows: &[Value]) -> Result<()> {
    validate_table(table)?;
    if rows.is_empty() {
        return Ok(());
    }

    // Ensure unique index on uuid exists (idempotent)
    conn.execute_batch(&format!(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_uuid ON {table}(uuid)"
    ))?;

    let data_cols = schema::data_columns(table);
    // Columns we'll write: data_cols + uuid, updated_at, user_id, sync_status
    let mut cols: Vec<&str> = data_cols.to_vec();
    cols.extend_from_slice(&["uuid", "updated_at", "user_id"]);

    // For notes, remove folder_uuid if present (it's not a real column)
    // folder_id is already in data_cols

    let col_list = cols.join(", ");
    let placeholders: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
    let update_clauses: Vec<String> = cols
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{c} = ?{}", i + 1))
        .collect();

    let sql = format!(
        "INSERT INTO {table} ({col_list}, sync_status) VALUES ({}, 'synced') \
         ON CONFLICT(uuid) DO UPDATE SET {}, sync_status = 'synced'",
        placeholders.join(", "),
        update_clauses.join(", ")
    );

    let mut stmt = conn.prepare(&sql)?;

    for row in rows {
        let obj = match row.as_object() {
            Some(o) => o,
            None => continue,
        };

        let params: Vec<Box<dyn rusqlite::types::ToSql>> = cols
            .iter()
            .map(|&col| -> Box<dyn rusqlite::types::ToSql> {
                match obj.get(col) {
                    Some(Value::String(s)) => Box::new(s.clone()),
                    Some(Value::Number(n)) => {
                        if let Some(i) = n.as_i64() {
                            Box::new(i)
                        } else if let Some(f) = n.as_f64() {
                            Box::new(f)
                        } else {
                            Box::new(n.to_string())
                        }
                    }
                    Some(Value::Bool(b)) => Box::new(*b as i64),
                    Some(Value::Null) | None => Box::new(Option::<String>::None),
                    Some(other) => Box::new(other.to_string()),
                }
            })
            .collect();

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        stmt.execute(param_refs.as_slice())?;
    }
    Ok(())
}

/// Get the UUID of a note_folder by its local integer id.
pub fn get_folder_uuid_by_id(conn: &Connection, folder_id: i64) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT uuid FROM note_folders WHERE id = ?1")?;
    let mut rows = stmt.query_map(params![folder_id], |row| row.get(0))?;
    match rows.next() {
        Some(val) => Ok(Some(val?)),
        None => Ok(None),
    }
}

/// Get the local integer id of a note_folder by its UUID.
pub fn get_folder_id_by_uuid(conn: &Connection, folder_uuid: &str) -> Result<Option<i64>> {
    let mut stmt = conn.prepare("SELECT id FROM note_folders WHERE uuid = ?1")?;
    let mut rows = stmt.query_map(params![folder_uuid], |row| row.get(0))?;
    match rows.next() {
        Some(val) => Ok(Some(val?)),
        None => Ok(None),
    }
}

// ── Tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    // ── Shortcuts CRUD ───────────────────────────────────────

    #[test]
    fn test_shortcuts_create_and_list() {
        let conn = init_test_db();
        let s = create_shortcut(&conn, "greet", "Hello!", "A greeting").unwrap();
        assert_eq!(s.name, "greet");
        assert_eq!(s.sync_status, "pending");
        assert!(s.id.is_some());

        let list = list_shortcuts(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "greet");
    }

    #[test]
    fn test_shortcuts_update() {
        let conn = init_test_db();
        let s = create_shortcut(&conn, "greet", "Hello!", "desc").unwrap();
        update_shortcut(&conn, s.id.unwrap(), "greet2", "Hi!", "new desc").unwrap();

        let list = list_shortcuts(&conn).unwrap();
        assert_eq!(list[0].name, "greet2");
        assert_eq!(list[0].value, "Hi!");
        assert_eq!(list[0].sync_status, "pending");
    }

    #[test]
    fn test_shortcuts_soft_delete() {
        let conn = init_test_db();
        let s = create_shortcut(&conn, "greet", "Hello!", "desc").unwrap();
        delete_shortcut(&conn, s.id.unwrap()).unwrap();

        let list = list_shortcuts(&conn).unwrap();
        assert_eq!(list.len(), 0, "Soft-deleted shortcut should not appear in list");
    }

    #[test]
    fn test_shortcuts_search() {
        let conn = init_test_db();
        create_shortcut(&conn, "hello", "world", "desc").unwrap();
        create_shortcut(&conn, "foo", "bar", "desc").unwrap();

        let results = search_shortcuts(&conn, "hel").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "hello");

        let results = search_shortcuts(&conn, "bar").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "foo");
    }

    #[test]
    fn test_shortcuts_uuid_generated() {
        let conn = init_test_db();
        let s = create_shortcut(&conn, "test", "val", "desc").unwrap();
        assert!(!s.uuid.is_empty());
        // UUID v4 format: 8-4-4-4-12 hex chars
        assert_eq!(s.uuid.len(), 36);
    }

    // ── App Settings CRUD ────────────────────────────────────

    #[test]
    fn test_settings_set_and_get() {
        let conn = init_test_db();
        set_setting(&conn, "pc1", "theme", "dark").unwrap();
        let val = get_setting(&conn, "pc1", "theme").unwrap();
        assert_eq!(val, Some("dark".to_string()));
    }

    #[test]
    fn test_settings_get_missing() {
        let conn = init_test_db();
        let val = get_setting(&conn, "pc1", "nonexistent").unwrap();
        assert_eq!(val, None);
    }

    #[test]
    fn test_settings_upsert() {
        let conn = init_test_db();
        set_setting(&conn, "pc1", "theme", "dark").unwrap();
        set_setting(&conn, "pc1", "theme", "light").unwrap();
        let val = get_setting(&conn, "pc1", "theme").unwrap();
        assert_eq!(val, Some("light".to_string()));
    }

    #[test]
    fn test_superset_settings() {
        let conn = init_test_db();
        set_superset_setting(&conn, "pc1", "url", "http://localhost").unwrap();
        let val = get_superset_setting(&conn, "pc1", "url").unwrap();
        assert_eq!(val, Some("http://localhost".to_string()));

        let missing = get_superset_setting(&conn, "pc1", "nope").unwrap();
        assert_eq!(missing, None);
    }

    // ── Note Folders + Notes ─────────────────────────────────

    #[test]
    fn test_note_folders_crud() {
        let conn = init_test_db();
        let f = create_note_folder(&conn, "Work", 0).unwrap();
        assert!(f.id.is_some());

        let list = list_note_folders(&conn).unwrap();
        assert_eq!(list.len(), 1);

        update_note_folder(&conn, f.id.unwrap(), "Work Updated", 1).unwrap();
        let list = list_note_folders(&conn).unwrap();
        assert_eq!(list[0].name, "Work Updated");

        delete_note_folder(&conn, f.id.unwrap()).unwrap();
        let list = list_note_folders(&conn).unwrap();
        assert_eq!(list.len(), 0);
    }

    #[test]
    fn test_notes_crud() {
        let conn = init_test_db();
        let folder = create_note_folder(&conn, "Folder", 0).unwrap();
        let fid = folder.id.unwrap();

        let n = create_note(&conn, fid, "Title", "Content").unwrap();
        assert!(n.id.is_some());
        assert!(!n.is_pinned);

        let list = list_notes(&conn, fid).unwrap();
        assert_eq!(list.len(), 1);

        update_note(&conn, n.id.unwrap(), "New Title", "New Content", true).unwrap();
        let list = list_notes(&conn, fid).unwrap();
        assert_eq!(list[0].title, "New Title");
        assert!(list[0].is_pinned);

        delete_note(&conn, n.id.unwrap()).unwrap();
        let list = list_notes(&conn, fid).unwrap();
        assert_eq!(list.len(), 0);
    }

    // ── SQL Table Analyzer Templates ─────────────────────────

    #[test]
    fn test_sql_table_analyzer_templates_crud() {
        let conn = init_test_db();
        let t = create_sql_table_analyzer_template(&conn, "SELECT * FROM {{table}}").unwrap();
        assert!(t.id.is_some());

        let list = list_sql_table_analyzer_templates(&conn).unwrap();
        assert_eq!(list.len(), 1);

        delete_sql_table_analyzer_template(&conn, t.id.unwrap()).unwrap();
        let list = list_sql_table_analyzer_templates(&conn).unwrap();
        assert_eq!(list.len(), 0);
    }

    // ── SQL Macrosing Templates ──────────────────────────────

    #[test]
    fn test_sql_macrosing_templates_crud() {
        let conn = init_test_db();
        let t = create_sql_macrosing_template(
            &conn, "tmpl1", "SELECT 1", "{}", "cross", ","
        ).unwrap();
        assert!(t.id.is_some());

        let list = list_sql_macrosing_templates(&conn).unwrap();
        assert_eq!(list.len(), 1);

        update_sql_macrosing_template(
            &conn, t.id.unwrap(), "tmpl1_upd", "SELECT 2", "{}", "zip", ";"
        ).unwrap();
        let list = list_sql_macrosing_templates(&conn).unwrap();
        assert_eq!(list[0].template_name, "tmpl1_upd");

        delete_sql_macrosing_template(&conn, t.id.unwrap()).unwrap();
        let list = list_sql_macrosing_templates(&conn).unwrap();
        assert_eq!(list.len(), 0);
    }

    // ── Obfuscation Mappings ─────────────────────────────────

    #[test]
    fn test_obfuscation_mappings_crud() {
        let conn = init_test_db();
        let m = create_obfuscation_mapping(
            &conn, "session1", "table", "users", "t_001"
        ).unwrap();
        assert!(m.id.is_some());

        let list = list_obfuscation_mappings_by_session(&conn, "session1").unwrap();
        assert_eq!(list.len(), 1);

        let empty = list_obfuscation_mappings_by_session(&conn, "other").unwrap();
        assert_eq!(empty.len(), 0);

        delete_obfuscation_mapping(&conn, m.id.unwrap()).unwrap();
        let list = list_obfuscation_mappings_by_session(&conn, "session1").unwrap();
        assert_eq!(list.len(), 0);
    }

    // ── Commit Tags ──────────────────────────────────────────

    #[test]
    fn test_commit_tags_crud() {
        let conn = init_test_db();
        let t = create_commit_tag(&conn, "pc1", "bugfix", true).unwrap();
        assert!(t.id.is_some());

        let list = list_commit_tags(&conn, "pc1").unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].is_default);

        delete_commit_tag(&conn, t.id.unwrap()).unwrap();
        let list = list_commit_tags(&conn, "pc1").unwrap();
        assert_eq!(list.len(), 0);
    }

    // ── Commit History ───────────────────────────────────────

    #[test]
    fn test_commit_history_crud() {
        let conn = init_test_db();
        let h = create_commit_history(
            &conn, "pc1", "http://task", "TASK-1", "feat",
            "ETL", "dag_x", "Added new dag", "tag1,tag2",
            "http://mr", "", "", "", "",
        ).unwrap();
        assert!(h.id.is_some());

        let list = list_commit_history(&conn, "pc1").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].task_id, "TASK-1");

        delete_commit_history(&conn, h.id.unwrap()).unwrap();
        let list = list_commit_history(&conn, "pc1").unwrap();
        assert_eq!(list.len(), 0);
    }

    // ── Snippet Tags ─────────────────────────────────────────

    #[test]
    fn test_snippet_tags_crud() {
        let conn = init_test_db();
        let t = create_snippet_tag(&conn, "Airflow", r#"["af_*","airflow_*"]"#, "#f0883e", 0).unwrap();
        assert!(t.id.is_some());
        assert_eq!(t.name, "Airflow");

        let list = list_snippet_tags(&conn).unwrap();
        assert_eq!(list.len(), 1);

        update_snippet_tag(&conn, t.id.unwrap(), "Airflow v2", r#"["af_*"]"#, "#00ff00", 1).unwrap();
        let list = list_snippet_tags(&conn).unwrap();
        assert_eq!(list[0].name, "Airflow v2");
        assert_eq!(list[0].color, "#00ff00");

        delete_snippet_tag(&conn, t.id.unwrap()).unwrap();
        let list = list_snippet_tags(&conn).unwrap();
        assert_eq!(list.len(), 0);
    }

    #[test]
    fn test_filter_shortcuts_by_patterns() {
        let conn = init_test_db();
        create_shortcut(&conn, "af_pipeline", "val1", "desc").unwrap();
        create_shortcut(&conn, "af_dag_test", "val2", "desc").unwrap();
        create_shortcut(&conn, "sql_query", "val3", "desc").unwrap();
        create_shortcut(&conn, "airflow_config", "val4", "desc").unwrap();

        // Filter by af_* pattern
        let results = filter_shortcuts_by_patterns(&conn, &["af_*".to_string()], "").unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|s| s.name.starts_with("af_")));

        // Filter by multiple patterns
        let results = filter_shortcuts_by_patterns(
            &conn,
            &["af_*".to_string(), "airflow_*".to_string()],
            "",
        ).unwrap();
        assert_eq!(results.len(), 3);

        // Filter by pattern + search query
        let results = filter_shortcuts_by_patterns(&conn, &["af_*".to_string()], "pipeline").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "af_pipeline");

        // Empty patterns returns all
        let results = filter_shortcuts_by_patterns(&conn, &[], "").unwrap();
        assert_eq!(results.len(), 4);
    }

    // ── Exec Categories + Commands ───────────────────────────

    #[test]
    fn test_exec_categories_crud() {
        let conn = init_test_db();
        let c = create_exec_category(&conn, "Deploy", 0).unwrap();
        assert!(c.id.is_some());

        let list = list_exec_categories(&conn).unwrap();
        assert_eq!(list.len(), 1);

        update_exec_category(&conn, c.id.unwrap(), "Deploy V2", 1).unwrap();
        let list = list_exec_categories(&conn).unwrap();
        assert_eq!(list[0].name, "Deploy V2");

        delete_exec_category(&conn, c.id.unwrap()).unwrap();
        let list = list_exec_categories(&conn).unwrap();
        assert_eq!(list.len(), 0);
    }

    #[test]
    fn test_exec_commands_crud() {
        let conn = init_test_db();
        let cat = create_exec_category(&conn, "Cat1", 0).unwrap();
        let cid = cat.id.unwrap();

        let cmd = create_exec_command(&conn, cid, "Run", "make run", "Run the app", 0, false).unwrap();
        assert!(cmd.id.is_some());

        let list = list_exec_commands(&conn, cid).unwrap();
        assert_eq!(list.len(), 1);
        assert!(!list[0].hide_after_run);

        update_exec_command(&conn, cmd.id.unwrap(), "Run V2", "make run2", "Run v2", 1, true).unwrap();
        let list = list_exec_commands(&conn, cid).unwrap();
        assert_eq!(list[0].name, "Run V2");
        assert!(list[0].hide_after_run);

        delete_exec_command(&conn, cmd.id.unwrap()).unwrap();
        let list = list_exec_commands(&conn, cid).unwrap();
        assert_eq!(list.len(), 0);
    }
}
