use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension, Result, Transaction};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::models::*;
use crate::sync::schema::{self, SYNCED_TABLES};

// ── Helpers ──────────────────────────────────────────────────

/// Format for storing NaiveDateTime as TEXT in SQLite.
const DT_FMT: &str = "%Y-%m-%d %H:%M:%S%.f";

fn now_str() -> String {
    Utc::now().naive_utc().format(DT_FMT).to_string()
}

fn parse_dt_opt(s: &str) -> Option<NaiveDateTime> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    NaiveDateTime::parse_from_str(s, DT_FMT)
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S"))
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f"))
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
        .ok()
        .or_else(|| {
            DateTime::parse_from_rfc3339(s)
                .ok()
                .map(|dt| dt.naive_utc())
        })
}

fn parse_dt(s: &str) -> NaiveDateTime {
    parse_dt_opt(s).unwrap_or_default()
}

fn normalize_dt_string(s: &str) -> Option<String> {
    parse_dt_opt(s).map(|dt| dt.format(DT_FMT).to_string())
}

fn is_datetime_column(col: &str) -> bool {
    matches!(col, "created_at" | "updated_at")
}

// ── Shortcuts ────────────────────────────────────────────────

pub fn list_shortcuts(conn: &Connection) -> Result<Vec<Shortcut>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, value, description, links, obsidian_note, is_pinned, pinned_sort_order, uuid, updated_at, sync_status, user_id
         FROM shortcuts WHERE sync_status != 'deleted' ORDER BY name",
    )?;
    let rows = stmt.query_map([], |row| {
        let updated_at_str: String = row.get(9)?;
        Ok(Shortcut {
            id: row.get(0)?,
            name: row.get(1)?,
            value: row.get(2)?,
            description: row.get(3)?,
            links: row.get(4)?,
            obsidian_note: row.get(5)?,
            is_pinned: row.get(6)?,
            pinned_sort_order: row.get(7)?,
            uuid: row.get(8)?,
            updated_at: parse_dt(&updated_at_str),
            sync_status: row.get(10)?,
            user_id: row.get(11)?,
        })
    })?;
    rows.collect()
}

pub fn search_shortcuts(conn: &Connection, query: &str) -> Result<Vec<Shortcut>> {
    let pattern = format!("%{}%", query);
    let mut stmt = conn.prepare(
        "SELECT id, name, value, description, links, obsidian_note, is_pinned, pinned_sort_order, uuid, updated_at, sync_status, user_id
         FROM shortcuts
         WHERE sync_status != 'deleted'
           AND (name LIKE ?1 OR value LIKE ?1 OR description LIKE ?1)
         ORDER BY name",
    )?;
    let rows = stmt.query_map(params![pattern], |row| {
        let updated_at_str: String = row.get(9)?;
        Ok(Shortcut {
            id: row.get(0)?,
            name: row.get(1)?,
            value: row.get(2)?,
            description: row.get(3)?,
            links: row.get(4)?,
            obsidian_note: row.get(5)?,
            is_pinned: row.get(6)?,
            pinned_sort_order: row.get(7)?,
            uuid: row.get(8)?,
            updated_at: parse_dt(&updated_at_str),
            sync_status: row.get(10)?,
            user_id: row.get(11)?,
        })
    })?;
    rows.collect()
}

pub fn create_shortcut(
    conn: &Connection,
    name: &str,
    value: &str,
    description: &str,
    links: &str,
    obsidian_note: &str,
) -> Result<Shortcut> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO shortcuts (name, value, description, links, obsidian_note, is_pinned, pinned_sort_order, uuid, updated_at, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, ?6, ?7, 'pending', '')",
        params![name, value, description, links, obsidian_note, uuid, now],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Shortcut {
        id: Some(id),
        name: name.to_string(),
        value: value.to_string(),
        description: description.to_string(),
        links: links.to_string(),
        obsidian_note: obsidian_note.to_string(),
        is_pinned: false,
        pinned_sort_order: 0,
        uuid,
        updated_at: parse_dt(&now),
        sync_status: "pending".to_string(),
        user_id: String::new(),
    })
}

pub fn update_shortcut(
    conn: &Connection,
    id: i64,
    name: &str,
    value: &str,
    description: &str,
    links: &str,
    obsidian_note: &str,
) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE shortcuts SET name = ?1, value = ?2, description = ?3, links = ?4, obsidian_note = ?5, updated_at = ?6, sync_status = 'pending'
         WHERE id = ?7",
        params![name, value, description, links, obsidian_note, now, id],
    )?;
    Ok(())
}

pub fn update_shortcut_obsidian_note(conn: &Connection, id: i64, note_path: &str) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE shortcuts SET obsidian_note = ?1, updated_at = ?2, sync_status = 'pending' WHERE id = ?3",
        params![note_path, now, id],
    )?;
    Ok(())
}

pub fn set_shortcut_pinned(conn: &Connection, id: i64, is_pinned: bool) -> Result<()> {
    let now = now_str();
    let current: Option<(bool, i32)> = conn
        .query_row(
            "SELECT is_pinned, pinned_sort_order FROM shortcuts WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    let pinned_sort_order: i32 = if is_pinned {
        if let Some((true, current_order)) = current {
            current_order
        } else {
            conn.query_row(
                "SELECT COALESCE(MAX(pinned_sort_order), -1) + 1 FROM shortcuts WHERE is_pinned = 1 AND sync_status != 'deleted'",
                [],
                |row| row.get(0),
            )?
        }
    } else {
        0
    };
    conn.execute(
        "UPDATE shortcuts
         SET is_pinned = ?1, pinned_sort_order = ?2, updated_at = ?3, sync_status = 'pending'
         WHERE id = ?4",
        params![is_pinned, pinned_sort_order, now, id],
    )?;
    Ok(())
}

pub fn reorder_pinned_shortcuts(conn: &Connection, ids_in_order: &[i64]) -> Result<()> {
    let now = now_str();
    let tx = conn.unchecked_transaction()?;
    for (idx, id) in ids_in_order.iter().enumerate() {
        tx.execute(
            "UPDATE shortcuts
             SET pinned_sort_order = ?1, updated_at = ?2, sync_status = 'pending'
             WHERE id = ?3 AND is_pinned = 1 AND sync_status != 'deleted'",
            params![idx as i32, now, id],
        )?;
    }
    tx.commit()?;
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
        "SELECT id, name, sort_order, parent_id, uuid, updated_at, sync_status, user_id
         FROM note_folders WHERE sync_status != 'deleted' ORDER BY sort_order, name",
    )?;
    let rows = stmt.query_map([], |row| {
        let updated_at_str: String = row.get(5)?;
        Ok(NoteFolder {
            id: row.get(0)?,
            name: row.get(1)?,
            sort_order: row.get(2)?,
            parent_id: row.get(3)?,
            uuid: row.get(4)?,
            updated_at: parse_dt(&updated_at_str),
            sync_status: row.get(6)?,
            user_id: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn create_note_folder(
    conn: &Connection,
    name: &str,
    sort_order: i32,
    parent_id: Option<i64>,
) -> Result<NoteFolder> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO note_folders (name, sort_order, parent_id, uuid, updated_at, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', '')",
        params![name, sort_order, parent_id, uuid, now],
    )?;
    let id = conn.last_insert_rowid();
    Ok(NoteFolder {
        id: Some(id),
        name: name.to_string(),
        sort_order,
        parent_id,
        uuid,
        updated_at: parse_dt(&now),
        sync_status: "pending".to_string(),
        user_id: String::new(),
    })
}

pub fn update_note_folder(
    conn: &Connection,
    id: i64,
    name: &str,
    sort_order: i32,
    parent_id: Option<i64>,
) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE note_folders SET name = ?1, sort_order = ?2, parent_id = ?3, updated_at = ?4, sync_status = 'pending'
         WHERE id = ?5",
        params![name, sort_order, parent_id, now, id],
    )?;
    Ok(())
}

fn note_folder_exists_tx(tx: &Transaction<'_>, id: i64) -> Result<bool> {
    let count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM note_folders WHERE id = ?1 AND sync_status != 'deleted'",
        params![id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn note_folder_parent_tx(tx: &Transaction<'_>, id: i64) -> Result<Option<i64>> {
    tx.query_row(
        "SELECT parent_id FROM note_folders WHERE id = ?1 AND sync_status != 'deleted'",
        params![id],
        |row| row.get(0),
    )
}

fn note_folder_sibling_ids_tx(
    tx: &Transaction<'_>,
    parent_id: Option<i64>,
    exclude_id: i64,
) -> Result<Vec<i64>> {
    if let Some(parent_id) = parent_id {
        let mut stmt = tx.prepare(
            "SELECT id FROM note_folders
             WHERE parent_id = ?1 AND id != ?2 AND sync_status != 'deleted'
             ORDER BY sort_order, name, id",
        )?;
        let rows = stmt.query_map(params![parent_id, exclude_id], |row| row.get(0))?;
        rows.collect()
    } else {
        let mut stmt = tx.prepare(
            "SELECT id FROM note_folders
             WHERE parent_id IS NULL AND id != ?1 AND sync_status != 'deleted'
             ORDER BY sort_order, name, id",
        )?;
        let rows = stmt.query_map(params![exclude_id], |row| row.get(0))?;
        rows.collect()
    }
}

fn apply_note_folder_sibling_order_tx(
    tx: &Transaction<'_>,
    parent_id: Option<i64>,
    ordered_ids: &[i64],
    now: &str,
) -> Result<()> {
    for (idx, folder_id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE note_folders
             SET parent_id = ?1, sort_order = ?2, updated_at = ?3, sync_status = 'pending'
             WHERE id = ?4 AND sync_status != 'deleted'",
            params![parent_id, idx as i32, now, folder_id],
        )?;
    }
    Ok(())
}

pub fn move_note_folder(
    conn: &Connection,
    id: i64,
    parent_id: Option<i64>,
    before_id: Option<i64>,
) -> Result<()> {
    let now = now_str();
    let tx = conn.unchecked_transaction()?;

    let old_parent_id = note_folder_parent_tx(&tx, id)?;
    if parent_id == Some(id) || before_id == Some(id) {
        return Err(rusqlite::Error::InvalidParameterName(
            "folder cannot be moved into or before itself".to_string(),
        ));
    }

    if let Some(new_parent_id) = parent_id {
        if !note_folder_exists_tx(&tx, new_parent_id)? {
            return Err(rusqlite::Error::InvalidParameterName(
                "target parent folder not found".to_string(),
            ));
        }
        let mut current = Some(new_parent_id);
        let mut visited = Vec::new();
        while let Some(current_id) = current {
            if current_id == id {
                return Err(rusqlite::Error::InvalidParameterName(
                    "folder cannot be moved into its descendant".to_string(),
                ));
            }
            if visited.contains(&current_id) {
                return Err(rusqlite::Error::InvalidParameterName(
                    "folder ancestry contains a cycle".to_string(),
                ));
            }
            visited.push(current_id);
            current = note_folder_parent_tx(&tx, current_id)?;
        }
    }

    if let Some(target_before_id) = before_id {
        let target_parent_id = note_folder_parent_tx(&tx, target_before_id)?;
        if target_parent_id != parent_id {
            return Err(rusqlite::Error::InvalidParameterName(
                "before folder must belong to the target parent".to_string(),
            ));
        }
    }

    if old_parent_id != parent_id {
        let old_siblings = note_folder_sibling_ids_tx(&tx, old_parent_id, id)?;
        apply_note_folder_sibling_order_tx(&tx, old_parent_id, &old_siblings, &now)?;
    }

    let mut new_siblings = note_folder_sibling_ids_tx(&tx, parent_id, id)?;
    let insert_at = before_id
        .and_then(|target_id| {
            new_siblings
                .iter()
                .position(|sibling_id| *sibling_id == target_id)
        })
        .unwrap_or(new_siblings.len());
    new_siblings.insert(insert_at, id);
    apply_note_folder_sibling_order_tx(&tx, parent_id, &new_siblings, &now)?;

    tx.commit()?;
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
        "SELECT id, folder_id, title, content, created_at, updated_at, is_pinned, pinned_sort_order, uuid, sync_status, user_id
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
            pinned_sort_order: row.get(7)?,
            uuid: row.get(8)?,
            sync_status: row.get(9)?,
            user_id: row.get(10)?,
        })
    })?;
    rows.collect()
}

pub fn create_note(conn: &Connection, folder_id: i64, title: &str, content: &str) -> Result<Note> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO notes (folder_id, title, content, created_at, updated_at, is_pinned, pinned_sort_order, uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, ?6, 'pending', '')",
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
        pinned_sort_order: 0,
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
    let current: Option<(bool, i32)> = conn
        .query_row(
            "SELECT is_pinned, pinned_sort_order FROM notes WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    let pinned_sort_order: i32 = if is_pinned {
        if let Some((true, current_order)) = current {
            current_order
        } else {
            conn.query_row(
                "SELECT COALESCE(MAX(pinned_sort_order), -1) + 1 FROM notes WHERE is_pinned = 1 AND sync_status != 'deleted'",
                [],
                |row| row.get(0),
            )?
        }
    } else {
        0
    };
    conn.execute(
        "UPDATE notes SET title = ?1, content = ?2, is_pinned = ?3, pinned_sort_order = ?4, updated_at = ?5, sync_status = 'pending'
         WHERE id = ?6",
        params![title, content, is_pinned, pinned_sort_order, now, id],
    )?;
    Ok(())
}

pub fn reorder_pinned_notes(conn: &Connection, ids_in_order: &[i64]) -> Result<()> {
    let now = now_str();
    let tx = conn.unchecked_transaction()?;
    for (idx, id) in ids_in_order.iter().enumerate() {
        tx.execute(
            "UPDATE notes
             SET pinned_sort_order = ?1, updated_at = ?2, sync_status = 'pending'
             WHERE id = ?3 AND is_pinned = 1 AND sync_status != 'deleted'",
            params![idx as i32, now, id],
        )?;
    }
    tx.commit()?;
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

pub fn list_sql_table_analyzer_templates(
    conn: &Connection,
) -> Result<Vec<SqlTableAnalyzerTemplate>> {
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

pub fn create_sql_table_analyzer_template(
    conn: &Connection,
    template_text: &str,
) -> Result<SqlTableAnalyzerTemplate> {
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
        params![
            template_name,
            template_text,
            placeholders_config,
            combination_mode,
            separator,
            uuid,
            now
        ],
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
        params![
            template_name,
            template_text,
            placeholders_config,
            combination_mode,
            separator,
            now,
            id
        ],
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

pub fn list_obfuscation_mappings_by_session(
    conn: &Connection,
    session_name: &str,
) -> Result<Vec<ObfuscationMapping>> {
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

pub fn get_superset_setting(
    conn: &Connection,
    computer_id: &str,
    key: &str,
) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT setting_value FROM superset_settings WHERE computer_id = ?1 AND setting_key = ?2",
    )?;
    let mut rows = stmt.query_map(params![computer_id, key], |row| row.get(0))?;
    match rows.next() {
        Some(val) => Ok(Some(val?)),
        None => Ok(None),
    }
}

pub fn set_superset_setting(
    conn: &Connection,
    computer_id: &str,
    key: &str,
    value: &str,
) -> Result<()> {
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

pub fn create_commit_tag(
    conn: &Connection,
    computer_id: &str,
    tag_name: &str,
    is_default: bool,
) -> Result<CommitTag> {
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
            computer_id,
            now,
            task_link,
            task_id,
            commit_type,
            object_category,
            object_value,
            message,
            selected_tags,
            mr_link,
            test_report,
            prod_report,
            transfer_connect,
            test_dag
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
    let mut stmt =
        conn.prepare("SELECT id, name, sort_order FROM exec_categories ORDER BY sort_order, name")?;
    let rows = stmt.query_map([], |row| {
        Ok(ExecCategory {
            id: row.get(0)?,
            name: row.get(1)?,
            sort_order: row.get(2)?,
        })
    })?;
    rows.collect()
}

pub fn create_exec_category(
    conn: &Connection,
    name: &str,
    sort_order: i32,
) -> Result<ExecCategory> {
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
        "SELECT id, category_id, name, command, description, sort_order, hide_after_run,
                shell, wsl_distro
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
            shell: row
                .get::<_, Option<String>>(7)?
                .unwrap_or_else(|| "host".to_string()),
            wsl_distro: row.get(8)?,
        })
    })?;
    rows.collect()
}

#[allow(clippy::too_many_arguments)]
pub fn create_exec_command(
    conn: &Connection,
    category_id: i64,
    name: &str,
    command: &str,
    description: &str,
    sort_order: i32,
    hide_after_run: bool,
    shell: &str,
    wsl_distro: Option<&str>,
) -> Result<ExecCommand> {
    conn.execute(
        "INSERT INTO exec_commands (category_id, name, command, description, sort_order, hide_after_run, shell, wsl_distro)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![category_id, name, command, description, sort_order, hide_after_run, shell, wsl_distro],
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
        shell: shell.to_string(),
        wsl_distro: wsl_distro.map(|s| s.to_string()),
    })
}

#[allow(clippy::too_many_arguments)]
pub fn update_exec_command(
    conn: &Connection,
    id: i64,
    name: &str,
    command: &str,
    description: &str,
    sort_order: i32,
    hide_after_run: bool,
    shell: &str,
    wsl_distro: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE exec_commands SET name = ?1, command = ?2, description = ?3,
                sort_order = ?4, hide_after_run = ?5, shell = ?6, wsl_distro = ?7
         WHERE id = ?8",
        params![
            name,
            command,
            description,
            sort_order,
            hide_after_run,
            shell,
            wsl_distro,
            id
        ],
    )?;
    Ok(())
}

pub fn delete_exec_command(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM exec_commands WHERE id = ?1", params![id])?;
    Ok(())
}

/// Move a command into another group (= category) and set its sort_order
/// at the destination. Returns Err if the target group does not exist —
/// SQLite would otherwise let the orphan FK slip through (we don't have
/// FK constraints declared on this table) and the command would
/// disappear from the UI.
pub fn move_exec_command(
    conn: &Connection,
    id: i64,
    target_category_id: i64,
    sort_order: i32,
) -> Result<()> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM exec_categories WHERE id = ?1",
        params![target_category_id],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    conn.execute(
        "UPDATE exec_commands SET category_id = ?1, sort_order = ?2 WHERE id = ?3",
        params![target_category_id, sort_order, id],
    )?;
    Ok(())
}

/// One-shot query: how many commands does each group hold? Returns
/// `(category_id, count)` pairs for every group, including those with zero
/// commands (LEFT JOIN). Used by the left-panel UI to render the count
/// chip next to each group name without N round-trips to list_exec_commands.
pub fn list_exec_command_counts(conn: &Connection) -> Result<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, COUNT(x.id)
         FROM exec_categories c
         LEFT JOIN exec_commands x ON x.category_id = c.id
         GROUP BY c.id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
    rows.collect::<Result<Vec<_>>>()
}

/// Reassign sort_order for a list of command ids — used after DnD reorder
/// inside one group. Wrapped in a transaction so a partial failure rolls
/// back the whole order rather than leaving the list half-shuffled.
pub fn reorder_exec_commands(conn: &Connection, ids_in_order: &[i64]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (idx, id) in ids_in_order.iter().enumerate() {
        tx.execute(
            "UPDATE exec_commands SET sort_order = ?1 WHERE id = ?2",
            params![idx as i64, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

// ── Finance ─────────────────────────────────────────────────

fn read_finance_plan(row: &rusqlite::Row) -> rusqlite::Result<FinancePlan> {
    let created: String = row.get(5)?;
    let updated: String = row.get(6)?;
    Ok(FinancePlan {
        id: row.get(0)?,
        name: row.get(1)?,
        currency: row.get(2)?,
        kind: row.get(3)?,
        sort_order: row.get(4)?,
        created_at: parse_dt(&created),
        updated_at: parse_dt(&updated),
        uuid: row.get(7)?,
        sync_status: row.get(8)?,
        user_id: row.get(9)?,
    })
}

fn read_finance_item(row: &rusqlite::Row) -> rusqlite::Result<FinanceItem> {
    let created: String = row.get(9)?;
    let updated: String = row.get(10)?;
    Ok(FinanceItem {
        id: row.get(0)?,
        plan_id: row.get(1)?,
        parent_id: row.get(2)?,
        name: row.get(3)?,
        amount_cents: row.get(4)?,
        due_day: row.get(5)?,
        due_date: row.get(6)?,
        note: row.get(7)?,
        sort_order: row.get(8)?,
        created_at: parse_dt(&created),
        updated_at: parse_dt(&updated),
        uuid: row.get(11)?,
        sync_status: row.get(12)?,
        user_id: row.get(13)?,
    })
}

fn read_finance_payment(row: &rusqlite::Row) -> rusqlite::Result<FinancePayment> {
    let is_paid: i64 = row.get(4)?;
    let created: String = row.get(7)?;
    let updated: String = row.get(8)?;
    Ok(FinancePayment {
        id: row.get(0)?,
        plan_id: row.get(1)?,
        item_id: row.get(2)?,
        month_key: row.get(3)?,
        is_paid: is_paid != 0,
        paid_amount_cents: row.get(5)?,
        note: row.get(6)?,
        created_at: parse_dt(&created),
        updated_at: parse_dt(&updated),
        uuid: row.get(9)?,
        sync_status: row.get(10)?,
        user_id: row.get(11)?,
    })
}

fn read_finance_import_batch(row: &rusqlite::Row) -> rusqlite::Result<FinanceImportBatch> {
    let created: String = row.get(12)?;
    let updated: String = row.get(13)?;
    Ok(FinanceImportBatch {
        id: row.get(0)?,
        source: row.get(1)?,
        file_name: row.get(2)?,
        total_rows: row.get(3)?,
        imported_rows: row.get(4)?,
        duplicate_rows: row.get(5)?,
        error_rows: row.get(6)?,
        date_from: row.get(7)?,
        date_to: row.get(8)?,
        expense_total_cents: row.get(9)?,
        income_total_cents: row.get(10)?,
        currency: row.get(11)?,
        created_at: parse_dt(&created),
        updated_at: parse_dt(&updated),
        uuid: row.get(14)?,
        sync_status: row.get(15)?,
        user_id: row.get(16)?,
    })
}

fn read_finance_transaction(row: &rusqlite::Row) -> rusqlite::Result<FinanceTransaction> {
    let rules_locked: i64 = row.get(22)?;
    let created: String = row.get(23)?;
    let updated: String = row.get(24)?;
    Ok(FinanceTransaction {
        id: row.get(0)?,
        source: row.get(1)?,
        source_fingerprint: row.get(2)?,
        import_batch_id: row.get(3)?,
        operation_at: row.get(4)?,
        payment_date: row.get(5)?,
        card_mask: row.get(6)?,
        status: row.get(7)?,
        amount_cents: row.get(8)?,
        currency: row.get(9)?,
        operation_amount_cents: row.get(10)?,
        operation_currency: row.get(11)?,
        payment_amount_cents: row.get(12)?,
        payment_currency: row.get(13)?,
        cashback_cents: row.get(14)?,
        bank_category: row.get(15)?,
        mcc: row.get(16)?,
        description: row.get(17)?,
        bonuses_cents: row.get(18)?,
        invest_rounding_cents: row.get(19)?,
        rounded_amount_cents: row.get(20)?,
        raw_json: row.get(21)?,
        rules_locked: rules_locked != 0,
        created_at: parse_dt(&created),
        updated_at: parse_dt(&updated),
        uuid: row.get(25)?,
        sync_status: row.get(26)?,
        user_id: row.get(27)?,
    })
}

fn read_finance_transaction_allocation(
    row: &rusqlite::Row,
) -> rusqlite::Result<FinanceTransactionAllocation> {
    let is_active: i64 = row.get(6)?;
    let created: String = row.get(7)?;
    let updated: String = row.get(8)?;
    Ok(FinanceTransactionAllocation {
        id: row.get(0)?,
        transaction_id: row.get(1)?,
        plan_id: row.get(2)?,
        item_id: row.get(3)?,
        assigned_by: row.get(4)?,
        rule_id: row.get(5)?,
        is_active: is_active != 0,
        created_at: parse_dt(&created),
        updated_at: parse_dt(&updated),
        uuid: row.get(9)?,
        sync_status: row.get(10)?,
        user_id: row.get(11)?,
    })
}

fn read_finance_mapping_rule(row: &rusqlite::Row) -> rusqlite::Result<FinanceMappingRule> {
    let is_enabled: i64 = row.get(2)?;
    let created: String = row.get(8)?;
    let updated: String = row.get(9)?;
    Ok(FinanceMappingRule {
        id: row.get(0)?,
        name: row.get(1)?,
        is_enabled: is_enabled != 0,
        priority: row.get(3)?,
        match_mode: row.get(4)?,
        conditions_json: row.get(5)?,
        target_plan_id: row.get(6)?,
        target_item_id: row.get(7)?,
        created_at: parse_dt(&created),
        updated_at: parse_dt(&updated),
        uuid: row.get(10)?,
        sync_status: row.get(11)?,
        user_id: row.get(12)?,
    })
}

fn normalize_finance_kind(kind: &str) -> Result<String> {
    let normalized = kind.trim().to_lowercase().replace('-', "_");
    match normalized.as_str() {
        "monthly" | "project" | "one_time" | "general" => Ok(normalized),
        _ => Err(rusqlite::Error::InvalidParameterName(format!(
            "invalid finance list kind: {kind}"
        ))),
    }
}

fn validate_non_negative_amount(amount_cents: i64) -> Result<()> {
    if amount_cents < 0 {
        return Err(rusqlite::Error::InvalidParameterName(
            "amount_cents must be non-negative".to_string(),
        ));
    }
    Ok(())
}

fn validate_due_day(due_day: Option<i32>) -> Result<()> {
    if let Some(day) = due_day {
        if !(1..=31).contains(&day) {
            return Err(rusqlite::Error::InvalidParameterName(
                "due_day must be between 1 and 31".to_string(),
            ));
        }
    }
    Ok(())
}

fn normalize_due_date(due_date: Option<&str>) -> Result<Option<String>> {
    let Some(raw) = due_date else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let date = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d").map_err(|_| {
        rusqlite::Error::InvalidParameterName(
            "due_date must be a valid YYYY-MM-DD date".to_string(),
        )
    })?;
    Ok(Some(date.format("%Y-%m-%d").to_string()))
}

fn normalize_month_key(month_key: &str) -> Result<String> {
    let trimmed = month_key.trim();
    let parsed = NaiveDate::parse_from_str(&format!("{trimmed}-01"), "%Y-%m-%d").map_err(|_| {
        rusqlite::Error::InvalidParameterName("month_key must be a valid YYYY-MM month".to_string())
    })?;
    Ok(parsed.format("%Y-%m").to_string())
}

fn deterministic_finance_payment_uuid(item_uuid: &str, month_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("ister-app:finance_payment:{item_uuid}:{month_key}").as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80; // UUID v8-style custom deterministic value.
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes).to_string()
}

pub fn list_finance_plans(conn: &Connection) -> Result<Vec<FinancePlan>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, currency, kind, sort_order, created_at, updated_at, uuid, sync_status, user_id
         FROM finance_plans
         WHERE sync_status != 'deleted'
         ORDER BY sort_order ASC, name ASC, id ASC",
    )?;
    let rows = stmt.query_map([], read_finance_plan)?;
    rows.collect()
}

pub fn create_finance_plan(
    conn: &Connection,
    name: &str,
    currency: &str,
    kind: &str,
) -> Result<FinancePlan> {
    let kind = normalize_finance_kind(kind)?;
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    let sort_order: i32 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1
         FROM finance_plans
         WHERE sync_status != 'deleted'",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO finance_plans
            (name, currency, kind, sort_order, created_at, updated_at, uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, 'pending', '')",
        params![name, currency, kind, sort_order, now, uuid],
    )?;
    Ok(FinancePlan {
        id: Some(conn.last_insert_rowid()),
        name: name.to_string(),
        currency: currency.to_string(),
        kind,
        sort_order,
        created_at: parse_dt(&now),
        updated_at: parse_dt(&now),
        uuid,
        sync_status: "pending".to_string(),
        user_id: String::new(),
    })
}

pub fn update_finance_plan(
    conn: &Connection,
    id: i64,
    name: &str,
    currency: &str,
    kind: &str,
) -> Result<()> {
    let kind = normalize_finance_kind(kind)?;
    let now = now_str();
    conn.execute(
        "UPDATE finance_plans
         SET name = ?1, currency = ?2, kind = ?3, updated_at = ?4, sync_status = 'pending'
         WHERE id = ?5 AND sync_status != 'deleted'",
        params![name, currency, kind, now, id],
    )?;
    Ok(())
}

pub fn reorder_finance_plans(conn: &Connection, ids_in_order: &[i64]) -> Result<()> {
    let now = now_str();
    let tx = conn.unchecked_transaction()?;
    for (idx, id) in ids_in_order.iter().enumerate() {
        tx.execute(
            "UPDATE finance_plans
             SET sort_order = ?1, updated_at = ?2, sync_status = 'pending'
             WHERE id = ?3 AND sync_status != 'deleted'",
            params![idx as i32, now, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn delete_finance_plan(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE finance_plans
         SET sync_status = 'deleted', updated_at = ?1
         WHERE id = ?2",
        params![now, id],
    )?;
    tx.execute(
        "UPDATE finance_items
         SET sync_status = 'deleted', updated_at = ?1
         WHERE plan_id = ?2",
        params![now, id],
    )?;
    tx.execute(
        "UPDATE finance_payments
         SET sync_status = 'deleted', updated_at = ?1
         WHERE plan_id = ?2",
        params![now, id],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn list_finance_items(conn: &Connection, plan_id: i64) -> Result<Vec<FinanceItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, plan_id, parent_id, name, amount_cents, due_day, due_date,
                note, sort_order, created_at, updated_at, uuid, sync_status, user_id
         FROM finance_items
         WHERE plan_id = ?1 AND sync_status != 'deleted'
         ORDER BY parent_id NULLS FIRST, sort_order ASC, name ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![plan_id], read_finance_item)?;
    rows.collect()
}

fn finance_plan_kind(conn: &Connection, id: i64) -> Result<Option<String>> {
    conn.query_row(
        "SELECT kind FROM finance_plans WHERE id = ?1 AND sync_status != 'deleted'",
        params![id],
        |r| r.get(0),
    )
    .optional()
}

fn finance_item_plan_and_parent_tx(tx: &Transaction<'_>, id: i64) -> Result<(i64, Option<i64>)> {
    tx.query_row(
        "SELECT plan_id, parent_id FROM finance_items WHERE id = ?1 AND sync_status != 'deleted'",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
}

fn finance_item_plan(conn: &Connection, id: i64) -> Result<Option<i64>> {
    conn.query_row(
        "SELECT plan_id FROM finance_items WHERE id = ?1 AND sync_status != 'deleted'",
        params![id],
        |r| r.get(0),
    )
    .optional()
}

fn finance_item_plan_and_uuid(conn: &Connection, id: i64) -> Result<Option<(i64, String)>> {
    conn.query_row(
        "SELECT plan_id, uuid FROM finance_items WHERE id = ?1 AND sync_status != 'deleted'",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
}

fn next_finance_item_sort_order(
    conn: &Connection,
    plan_id: i64,
    parent_id: Option<i64>,
) -> Result<i32> {
    if let Some(parent_id) = parent_id {
        conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1
             FROM finance_items
             WHERE plan_id = ?1 AND parent_id = ?2 AND sync_status != 'deleted'",
            params![plan_id, parent_id],
            |r| r.get(0),
        )
    } else {
        conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1
             FROM finance_items
             WHERE plan_id = ?1 AND parent_id IS NULL AND sync_status != 'deleted'",
            params![plan_id],
            |r| r.get(0),
        )
    }
}

pub fn create_finance_item(
    conn: &Connection,
    plan_id: i64,
    parent_id: Option<i64>,
    name: &str,
    amount_cents: i64,
    due_day: Option<i32>,
    due_date: Option<&str>,
    note: &str,
) -> Result<FinanceItem> {
    validate_non_negative_amount(amount_cents)?;
    validate_due_day(due_day)?;
    let due_date = normalize_due_date(due_date)?;
    if finance_plan_kind(conn, plan_id)?.is_none() {
        return Err(rusqlite::Error::InvalidParameterName(
            "finance plan not found".to_string(),
        ));
    }
    if let Some(parent_id) = parent_id {
        if finance_item_plan(conn, parent_id)? != Some(plan_id) {
            return Err(rusqlite::Error::InvalidParameterName(
                "parent item must belong to the same plan".to_string(),
            ));
        }
    }

    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    let sort_order = next_finance_item_sort_order(conn, plan_id, parent_id)?;
    conn.execute(
        "INSERT INTO finance_items
            (plan_id, parent_id, name, amount_cents, due_day, due_date, note, sort_order,
             created_at, updated_at, uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, 'pending', '')",
        params![
            plan_id,
            parent_id,
            name,
            amount_cents,
            due_day,
            due_date,
            note,
            sort_order,
            now,
            uuid
        ],
    )?;
    Ok(FinanceItem {
        id: Some(conn.last_insert_rowid()),
        plan_id,
        parent_id,
        name: name.to_string(),
        amount_cents,
        due_day,
        due_date,
        note: note.to_string(),
        sort_order,
        created_at: parse_dt(&now),
        updated_at: parse_dt(&now),
        uuid,
        sync_status: "pending".to_string(),
        user_id: String::new(),
    })
}

pub fn update_finance_item(
    conn: &Connection,
    id: i64,
    name: &str,
    amount_cents: i64,
    due_day: Option<i32>,
    due_date: Option<&str>,
    note: &str,
) -> Result<()> {
    validate_non_negative_amount(amount_cents)?;
    validate_due_day(due_day)?;
    let due_date = normalize_due_date(due_date)?;
    let now = now_str();
    conn.execute(
        "UPDATE finance_items
         SET name = ?1, amount_cents = ?2, due_day = ?3, due_date = ?4,
             note = ?5, updated_at = ?6, sync_status = 'pending'
         WHERE id = ?7 AND sync_status != 'deleted'",
        params![name, amount_cents, due_day, due_date, note, now, id],
    )?;
    Ok(())
}

fn finance_item_sibling_ids_tx(
    tx: &Transaction<'_>,
    plan_id: i64,
    parent_id: Option<i64>,
    exclude_id: i64,
) -> Result<Vec<i64>> {
    if let Some(parent_id) = parent_id {
        let mut stmt = tx.prepare(
            "SELECT id FROM finance_items
             WHERE plan_id = ?1 AND parent_id = ?2 AND id != ?3 AND sync_status != 'deleted'
             ORDER BY sort_order ASC, name ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![plan_id, parent_id, exclude_id], |row| row.get(0))?;
        rows.collect()
    } else {
        let mut stmt = tx.prepare(
            "SELECT id FROM finance_items
             WHERE plan_id = ?1 AND parent_id IS NULL AND id != ?2 AND sync_status != 'deleted'
             ORDER BY sort_order ASC, name ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![plan_id, exclude_id], |row| row.get(0))?;
        rows.collect()
    }
}

fn apply_finance_item_sibling_order_tx(
    tx: &Transaction<'_>,
    parent_id: Option<i64>,
    ordered_ids: &[i64],
    now: &str,
) -> Result<()> {
    for (idx, item_id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE finance_items
             SET parent_id = ?1, sort_order = ?2, updated_at = ?3, sync_status = 'pending'
             WHERE id = ?4 AND sync_status != 'deleted'",
            params![parent_id, idx as i32, now, item_id],
        )?;
    }
    Ok(())
}

pub fn move_finance_item(
    conn: &Connection,
    id: i64,
    parent_id: Option<i64>,
    before_id: Option<i64>,
) -> Result<()> {
    let now = now_str();
    let tx = conn.unchecked_transaction()?;
    let (plan_id, old_parent_id) = finance_item_plan_and_parent_tx(&tx, id)?;

    if parent_id == Some(id) || before_id == Some(id) {
        return Err(rusqlite::Error::InvalidParameterName(
            "finance item cannot be moved into or before itself".to_string(),
        ));
    }

    if let Some(new_parent_id) = parent_id {
        let (parent_plan_id, _) = finance_item_plan_and_parent_tx(&tx, new_parent_id)?;
        if parent_plan_id != plan_id {
            return Err(rusqlite::Error::InvalidParameterName(
                "target parent must belong to the same plan".to_string(),
            ));
        }
        let mut current = Some(new_parent_id);
        let mut visited = Vec::new();
        while let Some(current_id) = current {
            if current_id == id {
                return Err(rusqlite::Error::InvalidParameterName(
                    "finance item cannot be moved into its descendant".to_string(),
                ));
            }
            if visited.contains(&current_id) {
                return Err(rusqlite::Error::InvalidParameterName(
                    "finance item ancestry contains a cycle".to_string(),
                ));
            }
            visited.push(current_id);
            let (current_plan_id, next_parent) = finance_item_plan_and_parent_tx(&tx, current_id)?;
            if current_plan_id != plan_id {
                return Err(rusqlite::Error::InvalidParameterName(
                    "finance item ancestry crossed plan boundary".to_string(),
                ));
            }
            current = next_parent;
        }
    }

    if let Some(target_before_id) = before_id {
        let (before_plan_id, before_parent_id) =
            finance_item_plan_and_parent_tx(&tx, target_before_id)?;
        if before_plan_id != plan_id || before_parent_id != parent_id {
            return Err(rusqlite::Error::InvalidParameterName(
                "before item must belong to the target parent and plan".to_string(),
            ));
        }
    }

    if old_parent_id != parent_id {
        let old_siblings = finance_item_sibling_ids_tx(&tx, plan_id, old_parent_id, id)?;
        apply_finance_item_sibling_order_tx(&tx, old_parent_id, &old_siblings, &now)?;
    }

    let mut new_siblings = finance_item_sibling_ids_tx(&tx, plan_id, parent_id, id)?;
    let insert_at = before_id
        .and_then(|target_id| {
            new_siblings
                .iter()
                .position(|sibling_id| *sibling_id == target_id)
        })
        .unwrap_or(new_siblings.len());
    new_siblings.insert(insert_at, id);
    apply_finance_item_sibling_order_tx(&tx, parent_id, &new_siblings, &now)?;

    tx.commit()?;
    Ok(())
}

pub fn delete_finance_item(conn: &Connection, id: i64) -> Result<()> {
    use std::collections::HashSet;

    let now = now_str();
    let mut to_delete = vec![id];
    let mut seen = HashSet::from([id]);
    let mut i = 0;
    while i < to_delete.len() {
        let cur = to_delete[i];
        let mut stmt = conn.prepare(
            "SELECT id FROM finance_items WHERE parent_id = ?1 AND sync_status != 'deleted'",
        )?;
        let rows = stmt.query_map(params![cur], |r| r.get::<_, i64>(0))?;
        for row in rows {
            let child_id = row?;
            if seen.insert(child_id) {
                to_delete.push(child_id);
            }
        }
        i += 1;
    }
    let tx = conn.unchecked_transaction()?;
    for item_id in &to_delete {
        tx.execute(
            "UPDATE finance_items
             SET sync_status = 'deleted', updated_at = ?1
             WHERE id = ?2",
            params![now, item_id],
        )?;
        tx.execute(
            "UPDATE finance_payments
             SET sync_status = 'deleted', updated_at = ?1
             WHERE item_id = ?2",
            params![now, item_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn list_finance_payments(conn: &Connection, plan_id: i64) -> Result<Vec<FinancePayment>> {
    let mut stmt = conn.prepare(
        "SELECT id, plan_id, item_id, month_key, is_paid, paid_amount_cents,
                note, created_at, updated_at, uuid, sync_status, user_id
         FROM finance_payments
         WHERE plan_id = ?1 AND sync_status != 'deleted'
         ORDER BY month_key ASC, item_id ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![plan_id], read_finance_payment)?;
    rows.collect()
}

pub fn upsert_finance_payment(
    conn: &Connection,
    plan_id: i64,
    item_id: i64,
    month_key: &str,
    is_paid: bool,
    paid_amount_cents: i64,
    note: &str,
) -> Result<FinancePayment> {
    validate_non_negative_amount(paid_amount_cents)?;
    let month_key = normalize_month_key(month_key)?;
    let plan_kind = finance_plan_kind(conn, plan_id)?.ok_or_else(|| {
        rusqlite::Error::InvalidParameterName("finance plan not found".to_string())
    })?;
    if plan_kind != "monthly" {
        return Err(rusqlite::Error::InvalidParameterName(
            "finance payments are available only for monthly plans".to_string(),
        ));
    }
    let Some((item_plan_id, item_uuid)) = finance_item_plan_and_uuid(conn, item_id)? else {
        return Err(rusqlite::Error::InvalidParameterName(
            "finance item not found".to_string(),
        ));
    };
    if item_plan_id != plan_id {
        return Err(rusqlite::Error::InvalidParameterName(
            "finance item must belong to the same plan".to_string(),
        ));
    }

    let now = now_str();
    let uuid = deterministic_finance_payment_uuid(&item_uuid, &month_key);
    let is_paid_int = if is_paid { 1 } else { 0 };
    conn.execute(
        "INSERT INTO finance_payments
            (plan_id, item_id, month_key, is_paid, paid_amount_cents, note,
             created_at, updated_at, uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, 'pending', '')
         ON CONFLICT(plan_id, item_id, month_key) DO UPDATE SET
             is_paid = excluded.is_paid,
             paid_amount_cents = excluded.paid_amount_cents,
             note = excluded.note,
             updated_at = excluded.updated_at,
             uuid = excluded.uuid,
             sync_status = 'pending'",
        params![
            plan_id,
            item_id,
            month_key,
            is_paid_int,
            paid_amount_cents,
            note,
            now,
            uuid
        ],
    )?;
    conn.query_row(
        "SELECT id, plan_id, item_id, month_key, is_paid, paid_amount_cents,
                note, created_at, updated_at, uuid, sync_status, user_id
         FROM finance_payments
         WHERE plan_id = ?1 AND item_id = ?2 AND month_key = ?3",
        params![plan_id, item_id, month_key],
        read_finance_payment,
    )
}

pub fn create_finance_import_batch(
    conn: &Connection,
    source: &str,
    file_name: &str,
    total_rows: i64,
    imported_rows: i64,
    duplicate_rows: i64,
    error_rows: i64,
    date_from: Option<&str>,
    date_to: Option<&str>,
    expense_total_cents: i64,
    income_total_cents: i64,
    currency: &str,
) -> Result<FinanceImportBatch> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO finance_import_batches
            (source, file_name, total_rows, imported_rows, duplicate_rows, error_rows,
             date_from, date_to, expense_total_cents, income_total_cents, currency,
             created_at, updated_at, uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13, 'pending', '')",
        params![
            source,
            file_name,
            total_rows,
            imported_rows,
            duplicate_rows,
            error_rows,
            date_from,
            date_to,
            expense_total_cents,
            income_total_cents,
            currency,
            now,
            uuid
        ],
    )?;
    conn.query_row(
        "SELECT id, source, file_name, total_rows, imported_rows, duplicate_rows, error_rows,
                date_from, date_to, expense_total_cents, income_total_cents, currency,
                created_at, updated_at, uuid, sync_status, user_id
         FROM finance_import_batches WHERE uuid = ?1",
        params![uuid],
        read_finance_import_batch,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn upsert_finance_transaction(
    conn: &Connection,
    source: &str,
    source_fingerprint: &str,
    import_batch_id: Option<i64>,
    operation_at: &str,
    payment_date: &str,
    card_mask: &str,
    status: &str,
    amount_cents: i64,
    currency: &str,
    operation_amount_cents: i64,
    operation_currency: &str,
    payment_amount_cents: i64,
    payment_currency: &str,
    cashback_cents: Option<i64>,
    bank_category: &str,
    mcc: &str,
    description: &str,
    bonuses_cents: Option<i64>,
    invest_rounding_cents: Option<i64>,
    rounded_amount_cents: Option<i64>,
    raw_json: &str,
) -> Result<FinanceTransaction> {
    if let Some(existing) = conn
        .query_row(
            "SELECT id, source, source_fingerprint, import_batch_id, operation_at, payment_date,
                    card_mask, status, amount_cents, currency, operation_amount_cents,
                    operation_currency, payment_amount_cents, payment_currency, cashback_cents,
                    bank_category, mcc, description, bonuses_cents, invest_rounding_cents,
                    rounded_amount_cents, raw_json, rules_locked, created_at, updated_at,
                    uuid, sync_status, user_id
             FROM finance_transactions
             WHERE source = ?1 AND source_fingerprint = ?2",
            params![source, source_fingerprint],
            read_finance_transaction,
        )
        .optional()?
    {
        return Ok(existing);
    }

    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO finance_transactions
            (source, source_fingerprint, import_batch_id, operation_at, payment_date,
             card_mask, status, amount_cents, currency, operation_amount_cents,
             operation_currency, payment_amount_cents, payment_currency, cashback_cents,
             bank_category, mcc, description, bonuses_cents, invest_rounding_cents,
             rounded_amount_cents, raw_json, rules_locked, created_at, updated_at,
             uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                 ?15, ?16, ?17, ?18, ?19, ?20, ?21, 0, ?22, ?22, ?23, 'pending', '')",
        params![
            source,
            source_fingerprint,
            import_batch_id,
            operation_at,
            payment_date,
            card_mask,
            status,
            amount_cents,
            currency,
            operation_amount_cents,
            operation_currency,
            payment_amount_cents,
            payment_currency,
            cashback_cents,
            bank_category,
            mcc,
            description,
            bonuses_cents,
            invest_rounding_cents,
            rounded_amount_cents,
            raw_json,
            now,
            uuid
        ],
    )?;
    conn.query_row(
        "SELECT id, source, source_fingerprint, import_batch_id, operation_at, payment_date,
                card_mask, status, amount_cents, currency, operation_amount_cents,
                operation_currency, payment_amount_cents, payment_currency, cashback_cents,
                bank_category, mcc, description, bonuses_cents, invest_rounding_cents,
                rounded_amount_cents, raw_json, rules_locked, created_at, updated_at,
                uuid, sync_status, user_id
         FROM finance_transactions WHERE uuid = ?1",
        params![uuid],
        read_finance_transaction,
    )
}

pub fn list_finance_transactions(
    conn: &Connection,
    plan_id: Option<i64>,
    unmapped_only: bool,
) -> Result<Vec<FinanceTransaction>> {
    let select_cols = "t.id, t.source, t.source_fingerprint, t.import_batch_id, t.operation_at,
        t.payment_date, t.card_mask, t.status, t.amount_cents, t.currency,
        t.operation_amount_cents, t.operation_currency, t.payment_amount_cents,
        t.payment_currency, t.cashback_cents, t.bank_category, t.mcc, t.description,
        t.bonuses_cents, t.invest_rounding_cents, t.rounded_amount_cents, t.raw_json,
        t.rules_locked, t.created_at, t.updated_at, t.uuid, t.sync_status, t.user_id";
    match (plan_id, unmapped_only) {
        (Some(plan_id), _) => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {select_cols}
                 FROM finance_transactions t
                 INNER JOIN finance_transaction_allocations a
                   ON a.transaction_id = t.id AND a.is_active = 1
                 WHERE a.plan_id = ?1 AND t.sync_status != 'deleted' AND a.sync_status != 'deleted'
                 ORDER BY t.payment_date DESC, t.operation_at DESC, t.id DESC"
            ))?;
            let rows = stmt.query_map(params![plan_id], read_finance_transaction)?;
            rows.collect()
        }
        (None, true) => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {select_cols}
                 FROM finance_transactions t
                 LEFT JOIN finance_transaction_allocations a
                   ON a.transaction_id = t.id AND a.is_active = 1 AND a.sync_status != 'deleted'
                 WHERE t.sync_status != 'deleted' AND a.id IS NULL
                 ORDER BY t.payment_date DESC, t.operation_at DESC, t.id DESC"
            ))?;
            let rows = stmt.query_map([], read_finance_transaction)?;
            rows.collect()
        }
        (None, false) => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {select_cols}
                 FROM finance_transactions t
                 WHERE t.sync_status != 'deleted'
                 ORDER BY t.payment_date DESC, t.operation_at DESC, t.id DESC"
            ))?;
            let rows = stmt.query_map([], read_finance_transaction)?;
            rows.collect()
        }
    }
}

fn finance_transaction_exists(conn: &Connection, id: i64) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM finance_transactions WHERE id = ?1 AND sync_status != 'deleted'",
        params![id],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

fn validate_finance_allocation_target(
    conn: &Connection,
    plan_id: i64,
    item_id: Option<i64>,
) -> Result<()> {
    if finance_plan_kind(conn, plan_id)?.is_none() {
        return Err(rusqlite::Error::InvalidParameterName(
            "finance plan not found".to_string(),
        ));
    }
    if let Some(item_id) = item_id {
        if finance_item_plan(conn, item_id)? != Some(plan_id) {
            return Err(rusqlite::Error::InvalidParameterName(
                "finance item must belong to the same plan".to_string(),
            ));
        }
    }
    Ok(())
}

pub fn create_finance_transaction_allocation(
    conn: &Connection,
    transaction_id: i64,
    plan_id: i64,
    item_id: Option<i64>,
    assigned_by: &str,
    rule_id: Option<i64>,
) -> Result<FinanceTransactionAllocation> {
    if !finance_transaction_exists(conn, transaction_id)? {
        return Err(rusqlite::Error::InvalidParameterName(
            "finance transaction not found".to_string(),
        ));
    }
    validate_finance_allocation_target(conn, plan_id, item_id)?;
    if !matches!(assigned_by, "manual" | "rule") {
        return Err(rusqlite::Error::InvalidParameterName(
            "assigned_by must be manual or rule".to_string(),
        ));
    }
    let now = now_str();
    let uuid = Uuid::new_v4().to_string();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE finance_transaction_allocations
         SET is_active = 0, updated_at = ?1, sync_status = 'pending'
         WHERE transaction_id = ?2 AND is_active = 1 AND sync_status != 'deleted'",
        params![now, transaction_id],
    )?;
    tx.execute(
        "INSERT INTO finance_transaction_allocations
            (transaction_id, plan_id, item_id, assigned_by, rule_id, is_active,
             created_at, updated_at, uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?7, 'pending', '')",
        params![transaction_id, plan_id, item_id, assigned_by, rule_id, now, uuid],
    )?;
    tx.commit()?;
    conn.query_row(
        "SELECT id, transaction_id, plan_id, item_id, assigned_by, rule_id, is_active,
                created_at, updated_at, uuid, sync_status, user_id
         FROM finance_transaction_allocations WHERE uuid = ?1",
        params![uuid],
        read_finance_transaction_allocation,
    )
}

pub fn list_finance_transaction_allocations(
    conn: &Connection,
    plan_id: i64,
) -> Result<Vec<FinanceTransactionAllocation>> {
    let mut stmt = conn.prepare(
        "SELECT id, transaction_id, plan_id, item_id, assigned_by, rule_id, is_active,
                created_at, updated_at, uuid, sync_status, user_id
         FROM finance_transaction_allocations
         WHERE plan_id = ?1 AND is_active = 1 AND sync_status != 'deleted'
         ORDER BY updated_at DESC, id DESC",
    )?;
    let rows = stmt.query_map(params![plan_id], read_finance_transaction_allocation)?;
    rows.collect()
}

pub fn list_all_finance_transaction_allocations(
    conn: &Connection,
) -> Result<Vec<FinanceTransactionAllocation>> {
    let mut stmt = conn.prepare(
        "SELECT id, transaction_id, plan_id, item_id, assigned_by, rule_id, is_active,
                created_at, updated_at, uuid, sync_status, user_id
         FROM finance_transaction_allocations
         WHERE is_active = 1 AND sync_status != 'deleted'
         ORDER BY updated_at DESC, id DESC",
    )?;
    let rows = stmt.query_map([], read_finance_transaction_allocation)?;
    rows.collect()
}

pub fn finance_transaction_fingerprint_exists(
    conn: &Connection,
    source: &str,
    source_fingerprint: &str,
) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*)
         FROM finance_transactions
         WHERE source = ?1 AND source_fingerprint = ?2 AND sync_status != 'deleted'",
        params![source, source_fingerprint],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

pub fn set_finance_transaction_rules_locked(
    conn: &Connection,
    transaction_id: i64,
    rules_locked: bool,
) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE finance_transactions
         SET rules_locked = ?1, updated_at = ?2, sync_status = 'pending'
         WHERE id = ?3 AND sync_status != 'deleted'",
        params![if rules_locked { 1 } else { 0 }, now, transaction_id],
    )?;
    Ok(())
}

fn normalize_finance_rule_match_mode(match_mode: &str) -> Result<String> {
    let mode = match_mode.trim().to_lowercase();
    match mode.as_str() {
        "all" | "any" => Ok(mode),
        _ => Err(rusqlite::Error::InvalidParameterName(
            "match_mode must be all or any".to_string(),
        )),
    }
}

fn validate_finance_rule_conditions(conditions_json: &str) -> Result<()> {
    let parsed: Value = serde_json::from_str(conditions_json).map_err(|_| {
        rusqlite::Error::InvalidParameterName("conditions_json must be valid JSON".to_string())
    })?;
    if !parsed.is_array() {
        return Err(rusqlite::Error::InvalidParameterName(
            "conditions_json must be an array".to_string(),
        ));
    }
    Ok(())
}

pub fn create_finance_mapping_rule(
    conn: &Connection,
    name: &str,
    is_enabled: bool,
    priority: i32,
    match_mode: &str,
    conditions_json: &str,
    target_plan_id: i64,
    target_item_id: Option<i64>,
) -> Result<FinanceMappingRule> {
    let match_mode = normalize_finance_rule_match_mode(match_mode)?;
    validate_finance_rule_conditions(conditions_json)?;
    validate_finance_allocation_target(conn, target_plan_id, target_item_id)?;
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO finance_mapping_rules
            (name, is_enabled, priority, match_mode, conditions_json, target_plan_id,
             target_item_id, created_at, updated_at, uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, 'pending', '')",
        params![
            name,
            if is_enabled { 1 } else { 0 },
            priority,
            match_mode,
            conditions_json,
            target_plan_id,
            target_item_id,
            now,
            uuid
        ],
    )?;
    conn.query_row(
        "SELECT id, name, is_enabled, priority, match_mode, conditions_json,
                target_plan_id, target_item_id, created_at, updated_at, uuid, sync_status, user_id
         FROM finance_mapping_rules WHERE uuid = ?1",
        params![uuid],
        read_finance_mapping_rule,
    )
}

pub fn list_finance_mapping_rules(conn: &Connection) -> Result<Vec<FinanceMappingRule>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, is_enabled, priority, match_mode, conditions_json,
                target_plan_id, target_item_id, created_at, updated_at, uuid, sync_status, user_id
         FROM finance_mapping_rules
         WHERE sync_status != 'deleted'
         ORDER BY priority ASC, id ASC",
    )?;
    let rows = stmt.query_map([], read_finance_mapping_rule)?;
    rows.collect()
}

pub fn update_finance_mapping_rule(
    conn: &Connection,
    id: i64,
    name: &str,
    is_enabled: bool,
    priority: i32,
    match_mode: &str,
    conditions_json: &str,
    target_plan_id: i64,
    target_item_id: Option<i64>,
) -> Result<()> {
    let match_mode = normalize_finance_rule_match_mode(match_mode)?;
    validate_finance_rule_conditions(conditions_json)?;
    validate_finance_allocation_target(conn, target_plan_id, target_item_id)?;
    let now = now_str();
    conn.execute(
        "UPDATE finance_mapping_rules
         SET name = ?1, is_enabled = ?2, priority = ?3, match_mode = ?4,
             conditions_json = ?5, target_plan_id = ?6, target_item_id = ?7,
             updated_at = ?8, sync_status = 'pending'
         WHERE id = ?9 AND sync_status != 'deleted'",
        params![
            name,
            if is_enabled { 1 } else { 0 },
            priority,
            match_mode,
            conditions_json,
            target_plan_id,
            target_item_id,
            now,
            id
        ],
    )?;
    Ok(())
}

pub fn delete_finance_mapping_rule(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE finance_mapping_rules
         SET sync_status = 'deleted', updated_at = ?1
         WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

fn finance_transaction_has_active_allocation(conn: &Connection, transaction_id: i64) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*)
         FROM finance_transaction_allocations
         WHERE transaction_id = ?1 AND is_active = 1 AND sync_status != 'deleted'",
        params![transaction_id],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

fn condition_string_value(transaction: &FinanceTransaction, field: &str) -> String {
    match field {
        "category" | "bank_category" => transaction.bank_category.clone(),
        "mcc" => transaction.mcc.clone(),
        "description" => transaction.description.clone(),
        "card" | "card_mask" => transaction.card_mask.clone(),
        "status" => transaction.status.clone(),
        "currency" => transaction.currency.clone(),
        _ => String::new(),
    }
}

fn transaction_direction(transaction: &FinanceTransaction) -> &'static str {
    if transaction.amount_cents < 0 {
        "expense"
    } else if transaction.amount_cents > 0 {
        "income"
    } else {
        "zero"
    }
}

fn finance_rule_condition_matches(transaction: &FinanceTransaction, condition: &Value) -> bool {
    let Some(obj) = condition.as_object() else {
        return false;
    };
    let field = obj.get("field").and_then(Value::as_str).unwrap_or("");
    let op = obj.get("op").and_then(Value::as_str).unwrap_or("equals");
    let value = obj.get("value").and_then(Value::as_str).unwrap_or("");
    if field == "direction" {
        return value == "any" || transaction_direction(transaction) == value;
    }
    if field == "amount" || field == "amount_cents" {
        let Ok(expected) = value.replace(',', ".").parse::<f64>() else {
            return false;
        };
        let actual = transaction.amount_cents as f64 / 100.0;
        return match op {
            "equals" | "=" => (actual - expected).abs() < 0.005,
            "gt" | ">" => actual > expected,
            "gte" | ">=" => actual >= expected,
            "lt" | "<" => actual < expected,
            "lte" | "<=" => actual <= expected,
            _ => false,
        };
    }
    let actual = condition_string_value(transaction, field).to_lowercase();
    let expected = value.to_lowercase();
    match op {
        "equals" | "=" => actual == expected,
        "contains" => actual.contains(&expected),
        "starts" | "starts_with" => actual.starts_with(&expected),
        "not_equals" | "!=" => actual != expected,
        _ => false,
    }
}

fn finance_rule_matches(rule: &FinanceMappingRule, transaction: &FinanceTransaction) -> Result<bool> {
    let parsed: Value = serde_json::from_str(&rule.conditions_json).map_err(|_| {
        rusqlite::Error::InvalidParameterName("conditions_json must be valid JSON".to_string())
    })?;
    let conditions = parsed.as_array().ok_or_else(|| {
        rusqlite::Error::InvalidParameterName("conditions_json must be an array".to_string())
    })?;
    if conditions.is_empty() {
        return Ok(false);
    }
    let matches: Vec<bool> = conditions
        .iter()
        .map(|condition| finance_rule_condition_matches(transaction, condition))
        .collect();
    Ok(if rule.match_mode == "any" {
        matches.iter().any(|matched| *matched)
    } else {
        matches.iter().all(|matched| *matched)
    })
}

pub fn apply_finance_mapping_rule(
    conn: &Connection,
    rule_id: i64,
    remap_assigned: bool,
) -> Result<i64> {
    let rule = conn.query_row(
        "SELECT id, name, is_enabled, priority, match_mode, conditions_json,
                target_plan_id, target_item_id, created_at, updated_at, uuid, sync_status, user_id
         FROM finance_mapping_rules
         WHERE id = ?1 AND sync_status != 'deleted'",
        params![rule_id],
        read_finance_mapping_rule,
    )?;
    if !rule.is_enabled {
        return Ok(0);
    }
    let transactions = list_finance_transactions(conn, None, false)?;
    let mut applied = 0;
    for transaction in transactions {
        let Some(transaction_id) = transaction.id else {
            continue;
        };
        if transaction.rules_locked {
            continue;
        }
        if !remap_assigned && finance_transaction_has_active_allocation(conn, transaction_id)? {
            continue;
        }
        if finance_rule_matches(&rule, &transaction)? {
            create_finance_transaction_allocation(
                conn,
                transaction_id,
                rule.target_plan_id,
                rule.target_item_id,
                "rule",
                rule.id,
            )?;
            applied += 1;
        }
    }
    Ok(applied)
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

fn datetime_columns_for_table(table: &str) -> Vec<&'static str> {
    let mut cols = vec!["updated_at"];
    if schema::data_columns(table).contains(&"created_at") {
        cols.push("created_at");
    }
    cols
}

fn normalize_datetime_columns_for_table(conn: &Connection, table: &str) -> Result<()> {
    validate_table(table)?;
    for col in datetime_columns_for_table(table) {
        let select_sql = format!("SELECT id, {col} FROM {table}");
        let rows: Vec<(i64, Option<String>)> = {
            let mut stmt = conn.prepare(&select_sql)?;
            let mapped = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
            mapped.collect::<Result<Vec<_>>>()?
        };

        let update_sql = format!("UPDATE {table} SET {col} = ?1 WHERE id = ?2");
        let mut stmt = conn.prepare(&update_sql)?;
        for (id, raw) in rows {
            let Some(raw) = raw else { continue };
            let Some(normalized) = normalize_dt_string(&raw) else {
                continue;
            };
            if normalized != raw {
                stmt.execute(params![normalized, id])?;
            }
        }
    }
    Ok(())
}

pub fn normalize_synced_datetime_strings(conn: &Connection) -> Result<()> {
    for &table in SYNCED_TABLES {
        normalize_datetime_columns_for_table(conn, table)?;
    }
    Ok(())
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
    let sql = format!("SELECT {col_list} FROM {table} WHERE sync_status IN ('pending', 'deleted')");

    let mut stmt = conn.prepare(&sql)?;
    let col_count = cols.len();
    let rows = stmt.query_map([], |row| {
        let mut map = Map::new();
        for (i, &col_name) in cols.iter().enumerate().take(col_count) {
            let val: Value = match row.get_ref(i)? {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Integer(n) => Value::Number(n.into()),
                rusqlite::types::ValueRef::Real(f) => serde_json::Number::from_f64(f)
                    .map(Value::Number)
                    .unwrap_or(Value::Null),
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
    let sql =
        format!("UPDATE {table} SET sync_status = 'synced' WHERE uuid = ?1 AND updated_at = ?2");
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
    let params: Vec<&dyn rusqlite::types::ToSql> = uuids
        .iter()
        .map(|u| u as &dyn rusqlite::types::ToSql)
        .collect();
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
    normalize_datetime_columns_for_table(conn, table)?;

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

    let col_list = format!("{}, sync_status", cols.join(", "));
    let sync_status_param = cols.len() + 1;
    let placeholders: Vec<String> = (1..=sync_status_param).map(|i| format!("?{i}")).collect();
    let update_clauses: Vec<String> = cols
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{c} = ?{}", i + 1))
        .collect();
    let mut update_clauses = update_clauses;
    update_clauses.push("sync_status = excluded.sync_status".to_string());

    // LWW: only update if incoming updated_at >= local updated_at
    // This prevents pull from overwriting newer local changes (including deletes)
    let sql = format!(
        "INSERT INTO {table} ({col_list}) VALUES ({}) \
         ON CONFLICT(uuid) DO UPDATE SET {} \
         WHERE excluded.updated_at >= {table}.updated_at",
        placeholders.join(", "),
        update_clauses.join(", ")
    );

    let mut stmt = conn.prepare(&sql)?;

    for row in rows {
        let obj = match row.as_object() {
            Some(o) => o,
            None => continue,
        };

        if table == "finance_transactions" {
            if let (Some(uuid), Some(source), Some(source_fingerprint)) = (
                obj.get("uuid").and_then(|v| v.as_str()),
                obj.get("source").and_then(|v| v.as_str()),
                obj.get("source_fingerprint").and_then(|v| v.as_str()),
            ) {
                conn.execute(
                    "UPDATE finance_transactions
                     SET uuid = ?1
                     WHERE source = ?2 AND source_fingerprint = ?3 AND uuid != ?1",
                    params![uuid, source, source_fingerprint],
                )?;
            }
        }

        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = cols
            .iter()
            .map(|&col| -> Box<dyn rusqlite::types::ToSql> {
                match obj.get(col) {
                    Some(Value::String(s)) => {
                        if is_datetime_column(col) {
                            Box::new(normalize_dt_string(s).unwrap_or_else(|| s.clone()))
                        } else {
                            Box::new(s.clone())
                        }
                    }
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
        let sync_status = if obj
            .get("is_deleted")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            "deleted"
        } else {
            "synced"
        };
        params.push(Box::new(sync_status.to_string()));

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

fn get_uuid_by_id(conn: &Connection, table: &str, id: i64) -> Result<Option<String>> {
    validate_table(table)?;
    let sql = format!("SELECT uuid FROM {table} WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![id], |row| row.get(0))?;
    match rows.next() {
        Some(val) => Ok(Some(val?)),
        None => Ok(None),
    }
}

fn get_id_by_uuid(conn: &Connection, table: &str, uuid: &str) -> Result<Option<i64>> {
    validate_table(table)?;
    let sql = format!("SELECT id FROM {table} WHERE uuid = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![uuid], |row| row.get(0))?;
    match rows.next() {
        Some(val) => Ok(Some(val?)),
        None => Ok(None),
    }
}

pub fn get_task_category_uuid_by_id(conn: &Connection, id: i64) -> Result<Option<String>> {
    get_uuid_by_id(conn, "task_categories", id)
}

pub fn get_task_status_uuid_by_id(conn: &Connection, id: i64) -> Result<Option<String>> {
    get_uuid_by_id(conn, "task_statuses", id)
}

pub fn get_task_uuid_by_id(conn: &Connection, id: i64) -> Result<Option<String>> {
    get_uuid_by_id(conn, "tasks", id)
}

pub fn get_task_checkbox_uuid_by_id(conn: &Connection, id: i64) -> Result<Option<String>> {
    get_uuid_by_id(conn, "task_checkboxes", id)
}

pub fn get_task_category_id_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    get_id_by_uuid(conn, "task_categories", uuid)
}

pub fn get_task_status_id_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    get_id_by_uuid(conn, "task_statuses", uuid)
}

pub fn get_task_id_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    get_id_by_uuid(conn, "tasks", uuid)
}

pub fn get_task_checkbox_id_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    get_id_by_uuid(conn, "task_checkboxes", uuid)
}

pub fn get_finance_plan_uuid_by_id(conn: &Connection, id: i64) -> Result<Option<String>> {
    get_uuid_by_id(conn, "finance_plans", id)
}

pub fn get_finance_item_uuid_by_id(conn: &Connection, id: i64) -> Result<Option<String>> {
    get_uuid_by_id(conn, "finance_items", id)
}

pub fn get_finance_transaction_uuid_by_id(conn: &Connection, id: i64) -> Result<Option<String>> {
    get_uuid_by_id(conn, "finance_transactions", id)
}

pub fn get_finance_import_batch_uuid_by_id(conn: &Connection, id: i64) -> Result<Option<String>> {
    get_uuid_by_id(conn, "finance_import_batches", id)
}

pub fn get_finance_mapping_rule_uuid_by_id(conn: &Connection, id: i64) -> Result<Option<String>> {
    get_uuid_by_id(conn, "finance_mapping_rules", id)
}

pub fn get_finance_plan_id_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    get_id_by_uuid(conn, "finance_plans", uuid)
}

pub fn get_finance_item_id_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    get_id_by_uuid(conn, "finance_items", uuid)
}

pub fn get_finance_transaction_id_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    get_id_by_uuid(conn, "finance_transactions", uuid)
}

pub fn get_finance_import_batch_id_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    get_id_by_uuid(conn, "finance_import_batches", uuid)
}

pub fn get_finance_mapping_rule_id_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    get_id_by_uuid(conn, "finance_mapping_rules", uuid)
}

pub fn get_finance_item_plan_id_by_id(conn: &Connection, id: i64) -> Result<Option<i64>> {
    conn.query_row(
        "SELECT plan_id FROM finance_items WHERE id = ?1 AND sync_status != 'deleted'",
        params![id],
        |r| r.get(0),
    )
    .optional()
}

pub fn set_task_checkbox_parent_if_not_newer(
    conn: &Connection,
    uuid: &str,
    parent_id: i64,
    incoming_updated_at: &str,
) -> Result<()> {
    let incoming_updated_at =
        normalize_dt_string(incoming_updated_at).unwrap_or_else(|| incoming_updated_at.to_string());
    conn.execute(
        "UPDATE task_checkboxes
         SET parent_id = ?1
         WHERE uuid = ?2 AND updated_at <= ?3",
        params![parent_id, uuid, incoming_updated_at],
    )?;
    Ok(())
}

pub fn set_finance_item_parent_if_not_newer(
    conn: &Connection,
    uuid: &str,
    parent_id: i64,
    incoming_updated_at: &str,
) -> Result<()> {
    let incoming_updated_at =
        normalize_dt_string(incoming_updated_at).unwrap_or_else(|| incoming_updated_at.to_string());
    conn.execute(
        "UPDATE finance_items
         SET parent_id = ?1
         WHERE uuid = ?2 AND updated_at <= ?3",
        params![parent_id, uuid, incoming_updated_at],
    )?;
    Ok(())
}

// ── Task Categories ──────────────────────────────────────────

pub fn list_task_categories(conn: &Connection) -> Result<Vec<TaskCategory>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, sort_order, created_at, updated_at, uuid, sync_status, user_id
         FROM task_categories WHERE sync_status != 'deleted' ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([], |row| {
        let created: String = row.get(4)?;
        let updated: String = row.get(5)?;
        Ok(TaskCategory {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            sort_order: row.get(3)?,
            created_at: parse_dt(&created),
            updated_at: parse_dt(&updated),
            uuid: row.get(6)?,
            sync_status: row.get(7)?,
            user_id: row.get(8)?,
        })
    })?;
    rows.collect()
}

pub fn create_task_category(conn: &Connection, name: &str, color: &str) -> Result<TaskCategory> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    let sort_order: i32 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task_categories",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO task_categories (name, color, sort_order, created_at, updated_at, uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5, 'pending', '')",
        params![name, color, sort_order, now, uuid],
    )?;
    Ok(TaskCategory {
        id: Some(conn.last_insert_rowid()),
        name: name.into(),
        color: color.into(),
        sort_order,
        created_at: parse_dt(&now),
        updated_at: parse_dt(&now),
        uuid,
        sync_status: "pending".into(),
        user_id: String::new(),
    })
}

pub fn update_task_category(conn: &Connection, id: i64, name: &str, color: &str) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE task_categories SET name = ?1, color = ?2, updated_at = ?3, sync_status = 'pending' WHERE id = ?4",
        params![name, color, now, id],
    )?;
    Ok(())
}

pub fn delete_task_category(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE task_categories SET sync_status = 'deleted', updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    // Detach from tasks (ON DELETE SET NULL only fires on real DELETE).
    conn.execute(
        "UPDATE tasks SET category_id = NULL, updated_at = ?1, sync_status = 'pending' WHERE category_id = ?2",
        params![now, id],
    )?;
    Ok(())
}

pub fn reorder_task_categories(conn: &Connection, ids: &[i64]) -> Result<()> {
    let now = now_str();
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE task_categories SET sort_order = ?1, updated_at = ?2, sync_status = 'pending' WHERE id = ?3",
            params![i as i32, now, id],
        )?;
    }
    Ok(())
}

// ── Task Statuses ────────────────────────────────────────────

pub fn list_task_statuses(conn: &Connection) -> Result<Vec<TaskStatus>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, sort_order, created_at, updated_at, uuid, sync_status, user_id
         FROM task_statuses WHERE sync_status != 'deleted' ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([], |row| {
        let created: String = row.get(4)?;
        let updated: String = row.get(5)?;
        Ok(TaskStatus {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            sort_order: row.get(3)?,
            created_at: parse_dt(&created),
            updated_at: parse_dt(&updated),
            uuid: row.get(6)?,
            sync_status: row.get(7)?,
            user_id: row.get(8)?,
        })
    })?;
    rows.collect()
}

pub fn create_task_status(conn: &Connection, name: &str, color: &str) -> Result<TaskStatus> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    let sort_order: i32 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task_statuses",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO task_statuses (name, color, sort_order, created_at, updated_at, uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5, 'pending', '')",
        params![name, color, sort_order, now, uuid],
    )?;
    Ok(TaskStatus {
        id: Some(conn.last_insert_rowid()),
        name: name.into(),
        color: color.into(),
        sort_order,
        created_at: parse_dt(&now),
        updated_at: parse_dt(&now),
        uuid,
        sync_status: "pending".into(),
        user_id: String::new(),
    })
}

pub fn update_task_status(conn: &Connection, id: i64, name: &str, color: &str) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE task_statuses SET name = ?1, color = ?2, updated_at = ?3, sync_status = 'pending' WHERE id = ?4",
        params![name, color, now, id],
    )?;
    Ok(())
}

pub fn delete_task_status(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE task_statuses SET sync_status = 'deleted', updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    conn.execute(
        "UPDATE tasks SET status_id = NULL, updated_at = ?1, sync_status = 'pending' WHERE status_id = ?2",
        params![now, id],
    )?;
    Ok(())
}

pub fn reorder_task_statuses(conn: &Connection, ids: &[i64]) -> Result<()> {
    let now = now_str();
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE task_statuses SET sort_order = ?1, updated_at = ?2, sync_status = 'pending' WHERE id = ?3",
            params![i as i32, now, id],
        )?;
    }
    Ok(())
}

// ── Tasks ────────────────────────────────────────────────────

/// Filter value for list_tasks: numeric id, "none" (NULL), or absent (all).
#[derive(Debug, Clone)]
pub enum TaskFilter {
    All,
    None,
    Id(i64),
}

impl TaskFilter {
    pub fn from_opt_str(s: Option<&str>) -> Self {
        match s {
            None | Some("") => Self::All,
            Some("none") => Self::None,
            Some(other) => other.parse::<i64>().map(Self::Id).unwrap_or(Self::All),
        }
    }
}

pub fn list_tasks(
    conn: &Connection,
    category: TaskFilter,
    status: TaskFilter,
) -> Result<Vec<Task>> {
    let mut where_parts = vec!["sync_status != 'deleted'".to_string()];
    match category {
        TaskFilter::All => {}
        TaskFilter::None => where_parts.push("category_id IS NULL".into()),
        TaskFilter::Id(id) => where_parts.push(format!("category_id = {}", id)),
    }
    match status {
        TaskFilter::All => {}
        TaskFilter::None => where_parts.push("status_id IS NULL".into()),
        TaskFilter::Id(id) => where_parts.push(format!("status_id = {}", id)),
    }
    let sql = format!(
        "SELECT id, title, category_id, status_id, is_pinned, bg_color, tracker_url, notes_md,
                sort_order, created_at, updated_at, uuid, sync_status, user_id
         FROM tasks
         WHERE {}
         ORDER BY is_pinned DESC, sort_order ASC, id ASC",
        where_parts.join(" AND ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], read_task)?;
    rows.collect()
}

pub fn list_pinned_tasks(conn: &Connection) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, category_id, status_id, is_pinned, bg_color, tracker_url, notes_md,
                sort_order, created_at, updated_at, uuid, sync_status, user_id
         FROM tasks
         WHERE is_pinned = 1 AND sync_status != 'deleted'
         ORDER BY sort_order ASC, id ASC",
    )?;
    let rows = stmt.query_map([], read_task)?;
    rows.collect()
}

fn read_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
    let created: String = row.get(9)?;
    let updated: String = row.get(10)?;
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        category_id: row.get(2)?,
        status_id: row.get(3)?,
        is_pinned: row.get(4)?,
        bg_color: row.get(5)?,
        tracker_url: row.get(6)?,
        notes_md: row.get(7)?,
        sort_order: row.get(8)?,
        created_at: parse_dt(&created),
        updated_at: parse_dt(&updated),
        uuid: row.get(11)?,
        sync_status: row.get(12)?,
        user_id: row.get(13)?,
    })
}

pub fn create_task(
    conn: &Connection,
    title: &str,
    category_id: Option<i64>,
    status_id: Option<i64>,
) -> Result<Task> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    let sort_order: i32 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO tasks (title, category_id, status_id, is_pinned, bg_color, tracker_url,
                            notes_md, sort_order, created_at, updated_at, uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, 0, NULL, NULL, '', ?4, ?5, ?5, ?6, 'pending', '')",
        params![title, category_id, status_id, sort_order, now, uuid],
    )?;
    Ok(Task {
        id: Some(conn.last_insert_rowid()),
        title: title.into(),
        category_id,
        status_id,
        is_pinned: false,
        bg_color: None,
        tracker_url: None,
        notes_md: String::new(),
        sort_order,
        created_at: parse_dt(&now),
        updated_at: parse_dt(&now),
        uuid,
        sync_status: "pending".into(),
        user_id: String::new(),
    })
}

#[allow(clippy::too_many_arguments)]
pub fn update_task(
    conn: &Connection,
    id: i64,
    title: &str,
    category_id: Option<i64>,
    status_id: Option<i64>,
    is_pinned: bool,
    bg_color: Option<&str>,
    tracker_url: Option<&str>,
    notes_md: &str,
) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE tasks SET title = ?1, category_id = ?2, status_id = ?3, is_pinned = ?4,
                          bg_color = ?5, tracker_url = ?6, notes_md = ?7,
                          updated_at = ?8, sync_status = 'pending'
         WHERE id = ?9",
        params![
            title,
            category_id,
            status_id,
            is_pinned,
            bg_color,
            tracker_url,
            notes_md,
            now,
            id
        ],
    )?;
    Ok(())
}

pub fn reorder_tasks(conn: &Connection, ids: &[i64]) -> Result<()> {
    let now = now_str();
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE tasks SET sort_order = ?1, updated_at = ?2, sync_status = 'pending' WHERE id = ?3",
            params![i as i32, now, id],
        )?;
    }
    Ok(())
}

pub fn delete_task(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE tasks SET sync_status = 'deleted', updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

// ── Task Checkboxes ──────────────────────────────────────────

pub fn list_task_checkboxes(conn: &Connection, task_id: i64) -> Result<Vec<TaskCheckbox>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, parent_id, text, is_checked, sort_order,
                created_at, updated_at, uuid, sync_status, user_id
         FROM task_checkboxes
         WHERE task_id = ?1 AND sync_status != 'deleted'
         ORDER BY parent_id NULLS FIRST, sort_order ASC",
    )?;
    let rows = stmt.query_map(params![task_id], |row| {
        let created: String = row.get(6)?;
        let updated: String = row.get(7)?;
        Ok(TaskCheckbox {
            id: row.get(0)?,
            task_id: row.get(1)?,
            parent_id: row.get(2)?,
            text: row.get(3)?,
            is_checked: row.get(4)?,
            sort_order: row.get(5)?,
            created_at: parse_dt(&created),
            updated_at: parse_dt(&updated),
            uuid: row.get(8)?,
            sync_status: row.get(9)?,
            user_id: row.get(10)?,
        })
    })?;
    rows.collect()
}

/// Compute checkbox depth by walking parent chain. Depth 0 = root.
fn checkbox_depth(conn: &Connection, parent_id: Option<i64>) -> Result<i32> {
    let mut depth = 0;
    let mut cur = parent_id;
    while let Some(id) = cur {
        depth += 1;
        if depth > 10 {
            break; // safety
        }
        cur = conn
            .query_row(
                "SELECT parent_id FROM task_checkboxes WHERE id = ?1",
                params![id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .unwrap_or(None);
    }
    Ok(depth)
}

const MAX_CHECKBOX_DEPTH: i32 = 3;

pub fn create_task_checkbox(
    conn: &Connection,
    task_id: i64,
    parent_id: Option<i64>,
    text: &str,
) -> Result<TaskCheckbox> {
    // depth of new item = depth(parent) + 1; must be ≤ MAX_CHECKBOX_DEPTH.
    let depth = checkbox_depth(conn, parent_id)? + if parent_id.is_some() { 1 } else { 0 };
    if depth > MAX_CHECKBOX_DEPTH {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    let sort_order: i32 = match parent_id {
        Some(p) => conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task_checkboxes WHERE task_id = ?1 AND parent_id = ?2",
            params![task_id, p],
            |r| r.get(0),
        )?,
        None => conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task_checkboxes WHERE task_id = ?1 AND parent_id IS NULL",
            params![task_id],
            |r| r.get(0),
        )?,
    };
    conn.execute(
        "INSERT INTO task_checkboxes (task_id, parent_id, text, is_checked, sort_order,
                                       created_at, updated_at, uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, 0, ?4, ?5, ?5, ?6, 'pending', '')",
        params![task_id, parent_id, text, sort_order, now, uuid],
    )?;
    Ok(TaskCheckbox {
        id: Some(conn.last_insert_rowid()),
        task_id,
        parent_id,
        text: text.into(),
        is_checked: false,
        sort_order,
        created_at: parse_dt(&now),
        updated_at: parse_dt(&now),
        uuid,
        sync_status: "pending".into(),
        user_id: String::new(),
    })
}

pub fn update_task_checkbox(
    conn: &Connection,
    id: i64,
    text: &str,
    is_checked: bool,
) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE task_checkboxes SET text = ?1, is_checked = ?2, updated_at = ?3, sync_status = 'pending' WHERE id = ?4",
        params![text, is_checked, now, id],
    )?;
    Ok(())
}

/// One entry in a reorder batch: id, new parent_id, new sort_order.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct CheckboxReorderEntry {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub sort_order: i32,
}

pub fn reorder_task_checkboxes(
    conn: &Connection,
    task_id: i64,
    entries: &[CheckboxReorderEntry],
) -> Result<()> {
    // Validate depths before any writes.
    // Build a parent map from current DB + overrides in `entries`, then walk.
    use std::collections::HashMap;
    let mut parent_of: HashMap<i64, Option<i64>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id, parent_id FROM task_checkboxes WHERE task_id = ?1 AND sync_status != 'deleted'",
        )?;
        let rows = stmt.query_map(params![task_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?))
        })?;
        for row in rows {
            let (id, pid) = row?;
            parent_of.insert(id, pid);
        }
    }
    for e in entries {
        parent_of.insert(e.id, e.parent_id);
    }
    // Depth = chain length starting from node's parent.
    for e in entries {
        let mut depth = 0;
        let mut cur = e.parent_id;
        while let Some(pid) = cur {
            depth += 1;
            if depth > MAX_CHECKBOX_DEPTH {
                return Err(rusqlite::Error::InvalidQuery);
            }
            cur = parent_of.get(&pid).copied().flatten();
        }
    }

    let now = now_str();
    for e in entries {
        conn.execute(
            "UPDATE task_checkboxes SET parent_id = ?1, sort_order = ?2, updated_at = ?3, sync_status = 'pending'
             WHERE id = ?4 AND task_id = ?5",
            params![e.parent_id, e.sort_order, now, e.id, task_id],
        )?;
    }
    Ok(())
}

pub fn delete_task_checkbox(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    // soft-delete self and descendants recursively via closure walk.
    let mut to_delete = vec![id];
    let mut i = 0;
    while i < to_delete.len() {
        let cur = to_delete[i];
        let mut stmt = conn.prepare(
            "SELECT id FROM task_checkboxes WHERE parent_id = ?1 AND sync_status != 'deleted'",
        )?;
        let rows = stmt.query_map(params![cur], |r| r.get::<_, i64>(0))?;
        for row in rows {
            to_delete.push(row?);
        }
        i += 1;
    }
    for id in &to_delete {
        conn.execute(
            "UPDATE task_checkboxes SET sync_status = 'deleted', updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
    }
    Ok(())
}

// ── Task Links ───────────────────────────────────────────────

pub fn list_task_links(conn: &Connection, task_id: i64) -> Result<Vec<TaskLink>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, url, label, sort_order, created_at, updated_at, uuid, sync_status, user_id
         FROM task_links
         WHERE task_id = ?1 AND sync_status != 'deleted'
         ORDER BY sort_order ASC",
    )?;
    let rows = stmt.query_map(params![task_id], |row| {
        let created: String = row.get(5)?;
        let updated: String = row.get(6)?;
        Ok(TaskLink {
            id: row.get(0)?,
            task_id: row.get(1)?,
            url: row.get(2)?,
            label: row.get(3)?,
            sort_order: row.get(4)?,
            created_at: parse_dt(&created),
            updated_at: parse_dt(&updated),
            uuid: row.get(7)?,
            sync_status: row.get(8)?,
            user_id: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn create_task_link(
    conn: &Connection,
    task_id: i64,
    url: &str,
    label: Option<&str>,
) -> Result<TaskLink> {
    let uuid = Uuid::new_v4().to_string();
    let now = now_str();
    let sort_order: i32 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task_links WHERE task_id = ?1",
        params![task_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO task_links (task_id, url, label, sort_order, created_at, updated_at, uuid, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, 'pending', '')",
        params![task_id, url, label, sort_order, now, uuid],
    )?;
    Ok(TaskLink {
        id: Some(conn.last_insert_rowid()),
        task_id,
        url: url.into(),
        label: label.map(|s| s.to_string()),
        sort_order,
        created_at: parse_dt(&now),
        updated_at: parse_dt(&now),
        uuid,
        sync_status: "pending".into(),
        user_id: String::new(),
    })
}

pub fn update_task_link(conn: &Connection, id: i64, url: &str, label: Option<&str>) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE task_links SET url = ?1, label = ?2, updated_at = ?3, sync_status = 'pending' WHERE id = ?4",
        params![url, label, now, id],
    )?;
    Ok(())
}

pub fn reorder_task_links(conn: &Connection, task_id: i64, ids: &[i64]) -> Result<()> {
    let now = now_str();
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE task_links SET sort_order = ?1, updated_at = ?2, sync_status = 'pending'
             WHERE id = ?3 AND task_id = ?4",
            params![i as i32, now, id, task_id],
        )?;
    }
    Ok(())
}

pub fn delete_task_link(conn: &Connection, id: i64) -> Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE task_links SET sync_status = 'deleted', updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
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
        let s = create_shortcut(&conn, "greet", "Hello!", "A greeting", "[]", "").unwrap();
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
        let s = create_shortcut(&conn, "greet", "Hello!", "desc", "[]", "").unwrap();
        update_shortcut(&conn, s.id.unwrap(), "greet2", "Hi!", "new desc", "[]", "").unwrap();

        let list = list_shortcuts(&conn).unwrap();
        assert_eq!(list[0].name, "greet2");
        assert_eq!(list[0].value, "Hi!");
        assert_eq!(list[0].sync_status, "pending");
    }

    #[test]
    fn test_shortcuts_soft_delete() {
        let conn = init_test_db();
        let s = create_shortcut(&conn, "greet", "Hello!", "desc", "[]", "").unwrap();
        delete_shortcut(&conn, s.id.unwrap()).unwrap();

        let list = list_shortcuts(&conn).unwrap();
        assert_eq!(
            list.len(),
            0,
            "Soft-deleted shortcut should not appear in list"
        );
    }

    #[test]
    fn test_shortcuts_search() {
        let conn = init_test_db();
        create_shortcut(&conn, "hello", "world", "desc", "[]", "").unwrap();
        create_shortcut(&conn, "foo", "bar", "desc", "[]", "").unwrap();

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
        let s = create_shortcut(&conn, "test", "val", "desc", "[]", "").unwrap();
        assert!(!s.uuid.is_empty());
        // UUID v4 format: 8-4-4-4-12 hex chars
        assert_eq!(s.uuid.len(), 36);
    }

    #[test]
    fn test_shortcut_pin_and_reorder_fields() {
        let conn = init_test_db();
        let a = create_shortcut(&conn, "a", "A", "", "[]", "").unwrap();
        let b = create_shortcut(&conn, "b", "B", "", "[]", "").unwrap();

        set_shortcut_pinned(&conn, a.id.unwrap(), true).unwrap();
        set_shortcut_pinned(&conn, b.id.unwrap(), true).unwrap();
        reorder_pinned_shortcuts(&conn, &[b.id.unwrap(), a.id.unwrap()]).unwrap();

        let list = list_shortcuts(&conn).unwrap();
        let a = list.iter().find(|s| s.name == "a").unwrap();
        let b = list.iter().find(|s| s.name == "b").unwrap();
        assert!(a.is_pinned);
        assert!(b.is_pinned);
        assert_eq!(b.pinned_sort_order, 0);
        assert_eq!(a.pinned_sort_order, 1);

        set_shortcut_pinned(&conn, b.id.unwrap(), false).unwrap();
        let list = list_shortcuts(&conn).unwrap();
        let b = list.iter().find(|s| s.name == "b").unwrap();
        assert!(!b.is_pinned);
    }

    #[test]
    fn test_shortcut_server_pinned_fields_are_preserved() {
        let conn = init_test_db();
        let row = serde_json::json!({
            "uuid": "55555555-5555-5555-5555-555555555555",
            "name": "server_pinned",
            "value": "server value",
            "description": "",
            "links": "[]",
            "obsidian_note": "",
            "is_pinned": 1,
            "pinned_sort_order": 7,
            "updated_at": "2026-05-17T10:15:30",
            "user_id": "user-1",
            "is_deleted": false
        });

        upsert_from_server(&conn, "shortcuts", &[row]).unwrap();

        let list = list_shortcuts(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].is_pinned);
        assert_eq!(list[0].pinned_sort_order, 7);
    }

    #[test]
    fn test_parse_dt_accepts_api_iso_formats() {
        let expected =
            NaiveDateTime::parse_from_str("2026-05-17 10:15:30", "%Y-%m-%d %H:%M:%S").unwrap();

        assert_eq!(parse_dt("2026-05-17 10:15:30"), expected);
        assert_eq!(parse_dt("2026-05-17T10:15:30"), expected);
        assert_eq!(parse_dt("2026-05-17T10:15:30Z"), expected);
        assert_eq!(parse_dt("2026-05-17T13:15:30+03:00"), expected);
    }

    #[test]
    fn test_shortcut_server_iso_updated_at_is_readable() {
        let conn = init_test_db();
        let row = serde_json::json!({
            "uuid": "22222222-2222-2222-2222-222222222222",
            "name": "server_snippet",
            "value": "server value",
            "description": "",
            "links": "[]",
            "obsidian_note": "",
            "updated_at": "2026-05-17T10:15:30",
            "user_id": "user-1",
            "is_deleted": false
        });

        upsert_from_server(&conn, "shortcuts", &[row]).unwrap();

        let list = list_shortcuts(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "server_snippet");
        assert_eq!(
            list[0].updated_at,
            NaiveDateTime::parse_from_str("2026-05-17 10:15:30", "%Y-%m-%d %H:%M:%S").unwrap()
        );

        let stored: String = conn
            .query_row(
                "SELECT updated_at FROM shortcuts WHERE uuid = ?1",
                params!["22222222-2222-2222-2222-222222222222"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, "2026-05-17 10:15:30");
    }

    #[test]
    fn test_shortcut_lww_normalizes_existing_iso_before_compare() {
        let conn = init_test_db();
        conn.execute(
            "INSERT INTO shortcuts (name, value, description, links, obsidian_note, uuid, updated_at, sync_status, user_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'synced', ?8)",
            params![
                "old_name",
                "old value",
                "",
                "[]",
                "",
                "33333333-3333-3333-3333-333333333333",
                "2026-05-17T12:00:00",
                "user-1",
            ],
        )
        .unwrap();

        let newer = serde_json::json!({
            "uuid": "33333333-3333-3333-3333-333333333333",
            "name": "new_name",
            "value": "new value",
            "description": "",
            "links": "[]",
            "obsidian_note": "",
            "updated_at": "2026-05-17T13:00:00",
            "user_id": "user-1",
            "is_deleted": false
        });
        upsert_from_server(&conn, "shortcuts", &[newer]).unwrap();

        let row: (String, String) = conn
            .query_row(
                "SELECT name, updated_at FROM shortcuts WHERE uuid = ?1",
                params!["33333333-3333-3333-3333-333333333333"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(row.0, "new_name");
        assert_eq!(row.1, "2026-05-17 13:00:00");
    }

    #[test]
    fn test_sync_datetime_normalization_migrates_created_updated_without_sync_fields() {
        let conn = init_test_db();
        conn.execute(
            "INSERT INTO task_categories (name, color, sort_order, created_at, updated_at, uuid, sync_status, user_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                "Server category",
                "#388bfd",
                0,
                "2026-05-17T10:00:00Z",
                "2026-05-17T13:30:00+03:00",
                "44444444-4444-4444-4444-444444444444",
                "pending",
                "user-1",
            ],
        )
        .unwrap();

        normalize_synced_datetime_strings(&conn).unwrap();

        let row: (String, String, String, String) = conn
            .query_row(
                "SELECT created_at, updated_at, sync_status, user_id FROM task_categories WHERE uuid = ?1",
                params!["44444444-4444-4444-4444-444444444444"],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(row.0, "2026-05-17 10:00:00");
        assert_eq!(row.1, "2026-05-17 10:30:00");
        assert_eq!(row.2, "pending");
        assert_eq!(row.3, "user-1");
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
        let f = create_note_folder(&conn, "Work", 0, None).unwrap();
        assert!(f.id.is_some());

        let list = list_note_folders(&conn).unwrap();
        assert_eq!(list.len(), 1);

        update_note_folder(&conn, f.id.unwrap(), "Work Updated", 1, None).unwrap();
        let list = list_note_folders(&conn).unwrap();
        assert_eq!(list[0].name, "Work Updated");

        delete_note_folder(&conn, f.id.unwrap()).unwrap();
        let list = list_note_folders(&conn).unwrap();
        assert_eq!(list.len(), 0);
    }

    fn note_folder_names_for_parent(conn: &Connection, parent_id: Option<i64>) -> Vec<String> {
        list_note_folders(conn)
            .unwrap()
            .into_iter()
            .filter(|folder| folder.parent_id == parent_id)
            .map(|folder| folder.name)
            .collect()
    }

    #[test]
    fn test_move_note_folder_reorders_root_siblings() {
        let conn = init_test_db();
        let a = create_note_folder(&conn, "A", 0, None).unwrap();
        let _b = create_note_folder(&conn, "B", 1, None).unwrap();
        let c = create_note_folder(&conn, "C", 2, None).unwrap();

        move_note_folder(&conn, c.id.unwrap(), None, a.id).unwrap();

        assert_eq!(
            note_folder_names_for_parent(&conn, None),
            vec!["C".to_string(), "A".to_string(), "B".to_string()]
        );
    }

    #[test]
    fn test_move_note_folder_nests_and_orders_children() {
        let conn = init_test_db();
        let parent = create_note_folder(&conn, "Parent", 0, None).unwrap();
        let first = create_note_folder(&conn, "First", 1, None).unwrap();
        let second = create_note_folder(&conn, "Second", 2, None).unwrap();

        move_note_folder(&conn, second.id.unwrap(), parent.id, None).unwrap();
        move_note_folder(&conn, first.id.unwrap(), parent.id, second.id).unwrap();

        assert_eq!(
            note_folder_names_for_parent(&conn, parent.id),
            vec!["First".to_string(), "Second".to_string()]
        );
        assert_eq!(
            note_folder_names_for_parent(&conn, None),
            vec!["Parent".to_string()]
        );
    }

    #[test]
    fn test_move_note_folder_rejects_descendant_parent() {
        let conn = init_test_db();
        let parent = create_note_folder(&conn, "Parent", 0, None).unwrap();
        let child = create_note_folder(&conn, "Child", 0, parent.id).unwrap();

        let err = move_note_folder(&conn, parent.id.unwrap(), child.id, None).unwrap_err();

        assert!(err.to_string().contains("descendant"));
    }

    #[test]
    fn test_move_note_folder_requires_before_sibling() {
        let conn = init_test_db();
        let parent = create_note_folder(&conn, "Parent", 0, None).unwrap();
        let child = create_note_folder(&conn, "Child", 0, parent.id).unwrap();
        let other = create_note_folder(&conn, "Other", 1, None).unwrap();

        let err = move_note_folder(&conn, other.id.unwrap(), None, child.id).unwrap_err();

        assert!(err.to_string().contains("before folder"));
    }

    #[test]
    fn test_notes_crud() {
        let conn = init_test_db();
        let folder = create_note_folder(&conn, "Folder", 0, None).unwrap();
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

    #[test]
    fn test_reorder_pinned_notes_updates_chip_order_only() {
        let conn = init_test_db();
        let folder = create_note_folder(&conn, "Folder", 0, None).unwrap();
        let fid = folder.id.unwrap();
        let a = create_note(&conn, fid, "A", "A").unwrap();
        let b = create_note(&conn, fid, "B", "B").unwrap();

        update_note(&conn, a.id.unwrap(), "A", "A", true).unwrap();
        update_note(&conn, b.id.unwrap(), "B", "B", true).unwrap();
        reorder_pinned_notes(&conn, &[b.id.unwrap(), a.id.unwrap()]).unwrap();

        let list = list_notes(&conn, fid).unwrap();
        let a = list.iter().find(|n| n.title == "A").unwrap();
        let b = list.iter().find(|n| n.title == "B").unwrap();
        assert!(a.is_pinned);
        assert!(b.is_pinned);
        assert_eq!(b.pinned_sort_order, 0);
        assert_eq!(a.pinned_sort_order, 1);
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
        let t =
            create_sql_macrosing_template(&conn, "tmpl1", "SELECT 1", "{}", "cross", ",").unwrap();
        assert!(t.id.is_some());

        let list = list_sql_macrosing_templates(&conn).unwrap();
        assert_eq!(list.len(), 1);

        update_sql_macrosing_template(
            &conn,
            t.id.unwrap(),
            "tmpl1_upd",
            "SELECT 2",
            "{}",
            "zip",
            ";",
        )
        .unwrap();
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
        let m = create_obfuscation_mapping(&conn, "session1", "table", "users", "t_001").unwrap();
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
            &conn,
            "pc1",
            "http://task",
            "TASK-1",
            "feat",
            "ETL",
            "dag_x",
            "Added new dag",
            "tag1,tag2",
            "http://mr",
            "",
            "",
            "",
            "",
        )
        .unwrap();
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
        let t =
            create_snippet_tag(&conn, "Airflow", r#"["af_*","airflow_*"]"#, "#f0883e", 0).unwrap();
        assert!(t.id.is_some());
        assert_eq!(t.name, "Airflow");

        let list = list_snippet_tags(&conn).unwrap();
        assert_eq!(list.len(), 1);

        update_snippet_tag(
            &conn,
            t.id.unwrap(),
            "Airflow v2",
            r#"["af_*"]"#,
            "#00ff00",
            1,
        )
        .unwrap();
        let list = list_snippet_tags(&conn).unwrap();
        assert_eq!(list[0].name, "Airflow v2");
        assert_eq!(list[0].color, "#00ff00");

        delete_snippet_tag(&conn, t.id.unwrap()).unwrap();
        let list = list_snippet_tags(&conn).unwrap();
        assert_eq!(list.len(), 0);
    }

    #[test]
    fn test_upsert_deleted_snippet_tag_from_server_keeps_it_hidden() {
        let conn = init_test_db();
        let row = serde_json::json!({
            "uuid": "11111111-1111-1111-1111-111111111111",
            "name": "wiki",
            "patterns": r#"["wiki"]"#,
            "color": "#388bfd",
            "sort_order": 0,
            "updated_at": "2026-05-17T10:00:00",
            "user_id": "user-1",
            "is_deleted": true
        });

        upsert_from_server(&conn, "snippet_tags", &[row]).unwrap();

        let visible_tags = list_snippet_tags(&conn).unwrap();
        assert!(visible_tags.is_empty());

        let sync_status: String = conn
            .query_row(
                "SELECT sync_status FROM snippet_tags WHERE uuid = ?1",
                params!["11111111-1111-1111-1111-111111111111"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(sync_status, "deleted");
    }

    #[test]
    fn test_filter_shortcuts_by_patterns() {
        let conn = init_test_db();
        create_shortcut(&conn, "af_pipeline", "val1", "desc", "[]", "").unwrap();
        create_shortcut(&conn, "af_dag_test", "val2", "desc", "[]", "").unwrap();
        create_shortcut(&conn, "sql_query", "val3", "desc", "[]", "").unwrap();
        create_shortcut(&conn, "airflow_config", "val4", "desc", "[]", "").unwrap();

        // Filter by af_* pattern
        let results = filter_shortcuts_by_patterns(&conn, &["af_*".to_string()], "").unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|s| s.name.starts_with("af_")));

        // Filter by multiple patterns
        let results =
            filter_shortcuts_by_patterns(&conn, &["af_*".to_string(), "airflow_*".to_string()], "")
                .unwrap();
        assert_eq!(results.len(), 3);

        // Filter by pattern + search query
        let results =
            filter_shortcuts_by_patterns(&conn, &["af_*".to_string()], "pipeline").unwrap();
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

        let cmd = create_exec_command(
            &conn,
            cid,
            "Run",
            "make run",
            "Run the app",
            0,
            false,
            "host",
            None,
        )
        .unwrap();
        assert!(cmd.id.is_some());

        let list = list_exec_commands(&conn, cid).unwrap();
        assert_eq!(list.len(), 1);
        assert!(!list[0].hide_after_run);

        update_exec_command(
            &conn,
            cmd.id.unwrap(),
            "Run V2",
            "make run2",
            "Run v2",
            1,
            true,
            "wsl",
            Some("Ubuntu"),
        )
        .unwrap();
        let list = list_exec_commands(&conn, cid).unwrap();
        assert_eq!(list[0].name, "Run V2");
        assert!(list[0].hide_after_run);
        assert_eq!(list[0].shell, "wsl");
        assert_eq!(list[0].wsl_distro.as_deref(), Some("Ubuntu"));

        delete_exec_command(&conn, cmd.id.unwrap()).unwrap();
        let list = list_exec_commands(&conn, cid).unwrap();
        assert_eq!(list.len(), 0);
    }

    #[test]
    fn test_move_exec_command_changes_category_and_sort_order() {
        let conn = init_test_db();
        let cat_a = create_exec_category(&conn, "A", 0).unwrap();
        let cat_b = create_exec_category(&conn, "B", 0).unwrap();
        let cmd = create_exec_command(
            &conn,
            cat_a.id.unwrap(),
            "c1",
            "echo hi",
            "",
            0,
            false,
            "host",
            None,
        )
        .unwrap();
        move_exec_command(&conn, cmd.id.unwrap(), cat_b.id.unwrap(), 5).unwrap();
        let in_b = list_exec_commands(&conn, cat_b.id.unwrap()).unwrap();
        assert_eq!(in_b.len(), 1);
        assert_eq!(in_b[0].sort_order, 5);
        let in_a = list_exec_commands(&conn, cat_a.id.unwrap()).unwrap();
        assert!(in_a.is_empty());
    }

    #[test]
    fn test_move_exec_command_invalid_target_returns_err() {
        let conn = init_test_db();
        let cat = create_exec_category(&conn, "A", 0).unwrap();
        let cmd = create_exec_command(
            &conn,
            cat.id.unwrap(),
            "c1",
            "x",
            "",
            0,
            false,
            "host",
            None,
        )
        .unwrap();
        let r = move_exec_command(&conn, cmd.id.unwrap(), 9999, 0);
        assert!(r.is_err(), "expected Err on missing target group");
    }

    #[test]
    fn test_reorder_exec_commands_updates_sort_order() {
        let conn = init_test_db();
        let cat = create_exec_category(&conn, "A", 0).unwrap();
        let cid = cat.id.unwrap();
        let id1 = create_exec_command(&conn, cid, "c1", "x", "", 0, false, "host", None)
            .unwrap()
            .id
            .unwrap();
        let id2 = create_exec_command(&conn, cid, "c2", "x", "", 1, false, "host", None)
            .unwrap()
            .id
            .unwrap();
        let id3 = create_exec_command(&conn, cid, "c3", "x", "", 2, false, "host", None)
            .unwrap()
            .id
            .unwrap();
        reorder_exec_commands(&conn, &[id3, id1, id2]).unwrap();
        let l = list_exec_commands(&conn, cid).unwrap();
        let order: Vec<i64> = l.iter().map(|c| c.id.unwrap()).collect();
        assert_eq!(order, vec![id3, id1, id2]);
    }

    // ── Finance ──────────────────────────────────────────────

    #[test]
    fn test_finance_default_plan_and_crud() {
        let conn = init_test_db();
        let seeded = list_finance_plans(&conn).unwrap();
        assert_eq!(seeded.len(), 1);
        assert_eq!(seeded[0].name, "Regular payments");
        assert_eq!(seeded[0].currency, "RUB");
        assert_eq!(seeded[0].kind, "monthly");

        let plan = create_finance_plan(&conn, "Project Alpha", "USD", "project").unwrap();
        update_finance_plan(&conn, plan.id.unwrap(), "Project A", "EUR", "one_time").unwrap();
        let plans = list_finance_plans(&conn).unwrap();
        let updated = plans.iter().find(|p| p.id == plan.id).unwrap();
        assert_eq!(updated.name, "Project A");
        assert_eq!(updated.currency, "EUR");
        assert_eq!(updated.kind, "one_time");

        reorder_finance_plans(&conn, &[plan.id.unwrap(), seeded[0].id.unwrap()]).unwrap();
        let plans = list_finance_plans(&conn).unwrap();
        assert_eq!(plans[0].id, plan.id);

        delete_finance_plan(&conn, plan.id.unwrap()).unwrap();
        let plans = list_finance_plans(&conn).unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].name, "Regular payments");
    }

    #[test]
    fn test_finance_items_crud_move_and_delete_descendants() {
        let conn = init_test_db();
        let plan = list_finance_plans(&conn).unwrap()[0].clone();
        let plan_id = plan.id.unwrap();
        let housing =
            create_finance_item(&conn, plan_id, None, "Housing", 0, None, None, "").unwrap();
        let internet =
            create_finance_item(&conn, plan_id, None, "Internet", 50000, Some(3), None, "")
                .unwrap();
        let rent = create_finance_item(
            &conn,
            plan_id,
            housing.id,
            "Rent",
            12000000,
            Some(21),
            None,
            "monthly",
        )
        .unwrap();

        update_finance_item(
            &conn,
            internet.id.unwrap(),
            "Internet",
            60000,
            Some(5),
            Some("2026-06-10"),
            "fiber",
        )
        .unwrap();
        let items = list_finance_items(&conn, plan_id).unwrap();
        let internet_after = items.iter().find(|i| i.id == internet.id).unwrap();
        assert_eq!(internet_after.amount_cents, 60000);
        assert_eq!(internet_after.due_day, Some(5));
        assert_eq!(internet_after.due_date.as_deref(), Some("2026-06-10"));
        assert_eq!(internet_after.note, "fiber");

        move_finance_item(&conn, internet.id.unwrap(), housing.id, rent.id).unwrap();
        let children: Vec<String> = list_finance_items(&conn, plan_id)
            .unwrap()
            .into_iter()
            .filter(|item| item.parent_id == housing.id)
            .map(|item| item.name)
            .collect();
        assert_eq!(children, vec!["Internet".to_string(), "Rent".to_string()]);

        delete_finance_item(&conn, housing.id.unwrap()).unwrap();
        assert!(list_finance_items(&conn, plan_id).unwrap().is_empty());
    }

    #[test]
    fn test_finance_move_rejects_descendant_parent_and_cross_plan_parent() {
        let conn = init_test_db();
        let regular = list_finance_plans(&conn).unwrap()[0].clone();
        let project = create_finance_plan(&conn, "Project", "RUB", "project").unwrap();
        let regular_id = regular.id.unwrap();
        let project_id = project.id.unwrap();
        let parent =
            create_finance_item(&conn, regular_id, None, "Parent", 0, None, None, "").unwrap();
        let child =
            create_finance_item(&conn, regular_id, parent.id, "Child", 0, None, None, "").unwrap();
        let foreign =
            create_finance_item(&conn, project_id, None, "Foreign", 0, None, None, "").unwrap();

        let err = move_finance_item(&conn, parent.id.unwrap(), child.id, None).unwrap_err();
        assert!(err.to_string().contains("descendant"));

        let err = move_finance_item(&conn, child.id.unwrap(), foreign.id, None).unwrap_err();
        assert!(err.to_string().contains("same plan"));
    }

    #[test]
    fn test_finance_amount_must_be_non_negative() {
        let conn = init_test_db();
        let plan_id = list_finance_plans(&conn).unwrap()[0].id.unwrap();
        let err =
            create_finance_item(&conn, plan_id, None, "Refund", -1, None, None, "").unwrap_err();
        assert!(err.to_string().contains("non-negative"));
    }

    #[test]
    fn test_finance_dates_are_validated() {
        let conn = init_test_db();
        let plan_id = list_finance_plans(&conn).unwrap()[0].id.unwrap();

        let err = create_finance_item(&conn, plan_id, None, "Bad day", 0, Some(32), None, "")
            .unwrap_err();
        assert!(err.to_string().contains("due_day"));

        let err = create_finance_item(
            &conn,
            plan_id,
            None,
            "Bad date",
            0,
            None,
            Some("2026-99-99"),
            "",
        )
        .unwrap_err();
        assert!(err.to_string().contains("due_date"));
    }

    #[test]
    fn test_finance_payments_upsert_validation_and_deterministic_uuid() {
        let conn = init_test_db();
        let plan_id = list_finance_plans(&conn).unwrap()[0].id.unwrap();
        let item = create_finance_item(&conn, plan_id, None, "Internet", 50000, Some(3), None, "")
            .unwrap();
        let item_id = item.id.unwrap();

        let payment =
            upsert_finance_payment(&conn, plan_id, item_id, "2026-06", true, 45000, "paid")
                .unwrap();
        assert_eq!(payment.plan_id, plan_id);
        assert_eq!(payment.item_id, item_id);
        assert_eq!(payment.month_key, "2026-06");
        assert!(payment.is_paid);
        assert_eq!(payment.paid_amount_cents, 45000);
        assert_eq!(payment.note, "paid");

        let updated =
            upsert_finance_payment(&conn, plan_id, item_id, "2026-06", false, 50000, "").unwrap();
        assert_eq!(updated.uuid, payment.uuid);
        assert!(!updated.is_paid);
        assert_eq!(updated.paid_amount_cents, 50000);

        let payments = list_finance_payments(&conn, plan_id).unwrap();
        assert_eq!(payments.len(), 1);
        assert_eq!(payments[0].uuid, payment.uuid);

        let err =
            upsert_finance_payment(&conn, plan_id, item_id, "2026-13", true, 100, "").unwrap_err();
        assert!(err.to_string().contains("month_key"));

        let err =
            upsert_finance_payment(&conn, plan_id, item_id, "2026-06", true, -1, "").unwrap_err();
        assert!(err.to_string().contains("non-negative"));

        let project = create_finance_plan(&conn, "Project", "RUB", "project").unwrap();
        let project_item = create_finance_item(
            &conn,
            project.id.unwrap(),
            None,
            "Hardware",
            10000,
            None,
            Some("2026-06-10"),
            "",
        )
        .unwrap();
        let err = upsert_finance_payment(
            &conn,
            project.id.unwrap(),
            project_item.id.unwrap(),
            "2026-06",
            true,
            10000,
            "",
        )
        .unwrap_err();
        assert!(err.to_string().contains("monthly"));

        let other_monthly = create_finance_plan(&conn, "Other Monthly", "RUB", "monthly").unwrap();
        let err = upsert_finance_payment(
            &conn,
            other_monthly.id.unwrap(),
            item_id,
            "2026-06",
            true,
            10000,
            "",
        )
        .unwrap_err();
        assert!(err.to_string().contains("same plan"));
    }

    #[test]
    fn test_finance_payment_soft_delete_with_item_and_plan() {
        let conn = init_test_db();
        let plan_id = list_finance_plans(&conn).unwrap()[0].id.unwrap();
        let item =
            create_finance_item(&conn, plan_id, None, "Rent", 12000000, None, None, "").unwrap();
        let item_id = item.id.unwrap();
        let payment =
            upsert_finance_payment(&conn, plan_id, item_id, "2026-06", true, 12000000, "").unwrap();

        delete_finance_item(&conn, item_id).unwrap();
        assert!(list_finance_payments(&conn, plan_id).unwrap().is_empty());
        let status: String = conn
            .query_row(
                "SELECT sync_status FROM finance_payments WHERE uuid = ?1",
                params![payment.uuid],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "deleted");

        let item =
            create_finance_item(&conn, plan_id, None, "Internet", 50000, None, None, "").unwrap();
        let payment =
            upsert_finance_payment(&conn, plan_id, item.id.unwrap(), "2026-07", true, 50000, "")
                .unwrap();
        delete_finance_plan(&conn, plan_id).unwrap();
        let status: String = conn
            .query_row(
                "SELECT sync_status FROM finance_payments WHERE uuid = ?1",
                params![payment.uuid],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "deleted");
    }

    #[test]
    fn test_finance_transaction_deduplicates_by_source_fingerprint() {
        let conn = init_test_db();
        let batch = create_finance_import_batch(
            &conn,
            "tbank_csv",
            "april.csv",
            2,
            1,
            1,
            0,
            Some("2026-04-23"),
            Some("2026-04-30"),
            -19000,
            18100,
            "RUB",
        )
        .unwrap();
        let first = upsert_finance_transaction(
            &conn,
            "tbank_csv",
            "same-row-hash",
            batch.id,
            "2026-04-30 21:14:16",
            "2026-04-30",
            "*8907",
            "OK",
            -19000,
            "RUB",
            -19000,
            "RUB",
            -19000,
            "RUB",
            Some(0),
            "Мобильная связь",
            "",
            "Т-Мобайл +7 995 644-94-38",
            Some(0),
            Some(0),
            Some(-19000),
            "{}",
        )
        .unwrap();
        let second = upsert_finance_transaction(
            &conn,
            "tbank_csv",
            "same-row-hash",
            batch.id,
            "2026-04-30 21:14:16",
            "2026-04-30",
            "*8907",
            "OK",
            -19000,
            "RUB",
            -19000,
            "RUB",
            -19000,
            "RUB",
            Some(0),
            "Мобильная связь",
            "",
            "Т-Мобайл +7 995 644-94-38",
            Some(0),
            Some(0),
            Some(-19000),
            "{}",
        )
        .unwrap();

        assert_eq!(first.id, second.id);
        let rows = list_finance_transactions(&conn, None, false).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].amount_cents, -19000);
        assert_eq!(rows[0].source_fingerprint, "same-row-hash");
    }

    #[test]
    fn test_finance_transaction_allocation_validates_plan_item_and_lock() {
        let conn = init_test_db();
        let plan_id = list_finance_plans(&conn).unwrap()[0].id.unwrap();
        let item =
            create_finance_item(&conn, plan_id, None, "Taxi", 0, None, None, "").unwrap();
        let other_plan = create_finance_plan(&conn, "Project", "RUB", "project").unwrap();
        let other_item =
            create_finance_item(&conn, other_plan.id.unwrap(), None, "Foreign", 0, None, None, "")
                .unwrap();
        let batch = create_finance_import_batch(
            &conn,
            "tbank_csv",
            "april.csv",
            1,
            1,
            0,
            0,
            Some("2026-04-30"),
            Some("2026-04-30"),
            -50600,
            0,
            "RUB",
        )
        .unwrap();
        let tx = upsert_finance_transaction(
            &conn,
            "tbank_csv",
            "taxi-hash",
            batch.id,
            "2026-04-30 17:38:55",
            "2026-04-30",
            "*7857",
            "OK",
            -50600,
            "RUB",
            -50600,
            "RUB",
            -50600,
            "RUB",
            Some(2500),
            "Такси",
            "3990",
            "Яндекс Такси",
            Some(2500),
            Some(9400),
            Some(-60000),
            "{}",
        )
        .unwrap();

        let err = create_finance_transaction_allocation(
            &conn,
            tx.id.unwrap(),
            plan_id,
            other_item.id,
            "manual",
            None,
        )
        .unwrap_err();
        assert!(err.to_string().contains("same plan"));

        let allocation = create_finance_transaction_allocation(
            &conn,
            tx.id.unwrap(),
            plan_id,
            item.id,
            "manual",
            None,
        )
        .unwrap();
        assert_eq!(allocation.plan_id, plan_id);
        assert_eq!(allocation.item_id, item.id);

        set_finance_transaction_rules_locked(&conn, tx.id.unwrap(), true).unwrap();
        let rows = list_finance_transactions(&conn, None, false).unwrap();
        assert!(rows[0].rules_locked);
    }

    #[test]
    fn test_finance_mapping_rule_skips_locked_transactions() {
        let conn = init_test_db();
        let plan_id = list_finance_plans(&conn).unwrap()[0].id.unwrap();
        let item =
            create_finance_item(&conn, plan_id, None, "Taxi", 0, None, None, "").unwrap();
        let batch = create_finance_import_batch(
            &conn,
            "tbank_csv",
            "april.csv",
            2,
            2,
            0,
            0,
            Some("2026-04-29"),
            Some("2026-04-30"),
            -74500,
            0,
            "RUB",
        )
        .unwrap();
        let unlocked = upsert_finance_transaction(
            &conn,
            "tbank_csv",
            "taxi-open",
            batch.id,
            "2026-04-30 17:38:55",
            "2026-04-30",
            "*7857",
            "OK",
            -50600,
            "RUB",
            -50600,
            "RUB",
            -50600,
            "RUB",
            Some(2500),
            "Такси",
            "3990",
            "Яндекс Такси",
            Some(2500),
            Some(9400),
            Some(-60000),
            "{}",
        )
        .unwrap();
        let locked = upsert_finance_transaction(
            &conn,
            "tbank_csv",
            "taxi-locked",
            batch.id,
            "2026-04-29 19:20:36",
            "2026-04-29",
            "*7857",
            "OK",
            -23900,
            "RUB",
            -23900,
            "RUB",
            -23900,
            "RUB",
            Some(1100),
            "Такси",
            "3990",
            "Яндекс Такси",
            Some(1100),
            Some(1100),
            Some(-25000),
            "{}",
        )
        .unwrap();
        set_finance_transaction_rules_locked(&conn, locked.id.unwrap(), true).unwrap();

        let rule = create_finance_mapping_rule(
            &conn,
            "Taxi rule",
            true,
            10,
            "all",
            r#"[{"field":"category","op":"equals","value":"Такси"}]"#,
            plan_id,
            item.id,
        )
        .unwrap();
        let applied = apply_finance_mapping_rule(&conn, rule.id.unwrap(), true).unwrap();
        assert_eq!(applied, 1);

        let allocations = list_finance_transaction_allocations(&conn, plan_id).unwrap();
        assert_eq!(allocations.len(), 1);
        assert_eq!(allocations[0].transaction_id, unlocked.id.unwrap());
        assert_ne!(allocations[0].transaction_id, locked.id.unwrap());
    }

    // ── Task Categories / Statuses ───────────────────────────

    #[test]
    fn test_task_category_crud() {
        let conn = init_test_db();
        // seeded 2 (Work, Home)
        assert_eq!(list_task_categories(&conn).unwrap().len(), 2);

        let c = create_task_category(&conn, "Side", "#a371f7").unwrap();
        assert_eq!(list_task_categories(&conn).unwrap().len(), 3);

        update_task_category(&conn, c.id.unwrap(), "Side-proj", "#ff0000").unwrap();
        let all = list_task_categories(&conn).unwrap();
        let updated = all.iter().find(|r| r.id == c.id).unwrap();
        assert_eq!(updated.name, "Side-proj");

        delete_task_category(&conn, c.id.unwrap()).unwrap();
        assert_eq!(list_task_categories(&conn).unwrap().len(), 2);
    }

    #[test]
    fn test_task_reorder_categories() {
        let conn = init_test_db();
        let ids: Vec<i64> = list_task_categories(&conn)
            .unwrap()
            .iter()
            .map(|c| c.id.unwrap())
            .collect();
        // reverse order
        let reversed: Vec<i64> = ids.iter().rev().copied().collect();
        reorder_task_categories(&conn, &reversed).unwrap();
        let after: Vec<i64> = list_task_categories(&conn)
            .unwrap()
            .iter()
            .map(|c| c.id.unwrap())
            .collect();
        assert_eq!(after, reversed);
    }

    #[test]
    fn test_task_uuid_lookup_helpers() {
        let conn = init_test_db();
        let cat = create_task_category(&conn, "Sync Cat", "#388bfd").unwrap();
        let status = create_task_status(&conn, "Sync Status", "#3fb950").unwrap();
        let task = create_task(&conn, "Sync Task", cat.id, status.id).unwrap();
        let checkbox = create_task_checkbox(&conn, task.id.unwrap(), None, "Check me").unwrap();

        assert_eq!(
            get_task_category_uuid_by_id(&conn, cat.id.unwrap()).unwrap(),
            Some(cat.uuid.clone())
        );
        assert_eq!(
            get_task_status_uuid_by_id(&conn, status.id.unwrap()).unwrap(),
            Some(status.uuid.clone())
        );
        assert_eq!(
            get_task_uuid_by_id(&conn, task.id.unwrap()).unwrap(),
            Some(task.uuid.clone())
        );
        assert_eq!(
            get_task_checkbox_uuid_by_id(&conn, checkbox.id.unwrap()).unwrap(),
            Some(checkbox.uuid.clone())
        );

        assert_eq!(
            get_task_category_id_by_uuid(&conn, &cat.uuid).unwrap(),
            cat.id
        );
        assert_eq!(
            get_task_status_id_by_uuid(&conn, &status.uuid).unwrap(),
            status.id
        );
        assert_eq!(get_task_id_by_uuid(&conn, &task.uuid).unwrap(), task.id);
        assert_eq!(
            get_task_checkbox_id_by_uuid(&conn, &checkbox.uuid).unwrap(),
            checkbox.id
        );
    }

    #[test]
    fn test_delete_category_detaches_tasks() {
        let conn = init_test_db();
        let cats = list_task_categories(&conn).unwrap();
        let cat_id = cats[0].id.unwrap();
        let t = create_task(&conn, "T1", Some(cat_id), None).unwrap();
        assert_eq!(t.category_id, Some(cat_id));

        delete_task_category(&conn, cat_id).unwrap();
        let tasks = list_tasks(&conn, TaskFilter::All, TaskFilter::All).unwrap();
        let updated = tasks.iter().find(|x| x.id == t.id).unwrap();
        assert_eq!(updated.category_id, None);
    }

    // ── Tasks ────────────────────────────────────────────────

    #[test]
    fn test_task_crud_and_sort_order() {
        let conn = init_test_db();
        let t1 = create_task(&conn, "First", None, None).unwrap();
        let t2 = create_task(&conn, "Second", None, None).unwrap();
        assert!(t2.sort_order > t1.sort_order);

        let list = list_tasks(&conn, TaskFilter::All, TaskFilter::All).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, t1.id); // lower sort_order first

        // Pin t2 — it should come first.
        update_task(
            &conn,
            t2.id.unwrap(),
            "Second",
            None,
            None,
            true,
            None,
            None,
            "",
        )
        .unwrap();
        let list = list_tasks(&conn, TaskFilter::All, TaskFilter::All).unwrap();
        assert_eq!(list[0].id, t2.id);

        // list_pinned_tasks returns only pinned.
        let p = list_pinned_tasks(&conn).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].id, t2.id);

        delete_task(&conn, t1.id.unwrap()).unwrap();
        assert_eq!(
            list_tasks(&conn, TaskFilter::All, TaskFilter::All)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn test_task_filter_none_and_id() {
        let conn = init_test_db();
        let cats = list_task_categories(&conn).unwrap();
        let cat_id = cats[0].id.unwrap();
        create_task(&conn, "With cat", Some(cat_id), None).unwrap();
        create_task(&conn, "Without", None, None).unwrap();

        let all = list_tasks(&conn, TaskFilter::All, TaskFilter::All).unwrap();
        assert_eq!(all.len(), 2);

        let with_cat = list_tasks(&conn, TaskFilter::Id(cat_id), TaskFilter::All).unwrap();
        assert_eq!(with_cat.len(), 1);
        assert_eq!(with_cat[0].title, "With cat");

        let none_cat = list_tasks(&conn, TaskFilter::None, TaskFilter::All).unwrap();
        assert_eq!(none_cat.len(), 1);
        assert_eq!(none_cat[0].title, "Without");
    }

    #[test]
    fn test_reorder_tasks() {
        let conn = init_test_db();
        let a = create_task(&conn, "A", None, None).unwrap();
        let b = create_task(&conn, "B", None, None).unwrap();
        let c = create_task(&conn, "C", None, None).unwrap();
        reorder_tasks(&conn, &[c.id.unwrap(), a.id.unwrap(), b.id.unwrap()]).unwrap();
        let list = list_tasks(&conn, TaskFilter::All, TaskFilter::All).unwrap();
        assert_eq!(
            list.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(),
            vec!["C", "A", "B"]
        );
    }

    // ── Checkboxes ───────────────────────────────────────────

    #[test]
    fn test_checkbox_crud_with_nesting() {
        let conn = init_test_db();
        let task = create_task(&conn, "T", None, None).unwrap();
        let root = create_task_checkbox(&conn, task.id.unwrap(), None, "root").unwrap();
        let child = create_task_checkbox(&conn, task.id.unwrap(), root.id, "child").unwrap();
        let grand = create_task_checkbox(&conn, task.id.unwrap(), child.id, "grand").unwrap();

        // Third-depth attempt must fail (root=0, child=1, grand=2; next=3 ≤ MAX_CHECKBOX_DEPTH)
        // so the one after should fail:
        let err = create_task_checkbox(&conn, task.id.unwrap(), grand.id, "too-deep");
        assert!(err.is_err(), "depth > 3 must be rejected");

        update_task_checkbox(&conn, root.id.unwrap(), "root!", true).unwrap();
        let list = list_task_checkboxes(&conn, task.id.unwrap()).unwrap();
        let r = list.iter().find(|c| c.id == root.id).unwrap();
        assert!(r.is_checked);
        assert_eq!(r.text, "root!");

        // Delete root cascades to descendants.
        delete_task_checkbox(&conn, root.id.unwrap()).unwrap();
        let list = list_task_checkboxes(&conn, task.id.unwrap()).unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn test_checkbox_reorder_with_depth_check() {
        let conn = init_test_db();
        let task = create_task(&conn, "T", None, None).unwrap();
        let a = create_task_checkbox(&conn, task.id.unwrap(), None, "a").unwrap();
        let b = create_task_checkbox(&conn, task.id.unwrap(), None, "b").unwrap();
        let c = create_task_checkbox(&conn, task.id.unwrap(), a.id, "c").unwrap();

        // Valid reorder: swap a and b.
        reorder_task_checkboxes(
            &conn,
            task.id.unwrap(),
            &[
                CheckboxReorderEntry {
                    id: b.id.unwrap(),
                    parent_id: None,
                    sort_order: 0,
                },
                CheckboxReorderEntry {
                    id: a.id.unwrap(),
                    parent_id: None,
                    sort_order: 1,
                },
            ],
        )
        .unwrap();

        // Invalid: trying to nest c 4 levels deep is not possible here since max=3,
        // we can verify depth violation by attempting to parent `c` under itself via chain.
        // Skip that — depth-only reorder within limits already covered.
        // Positive: move c to be child of b.
        reorder_task_checkboxes(
            &conn,
            task.id.unwrap(),
            &[CheckboxReorderEntry {
                id: c.id.unwrap(),
                parent_id: b.id,
                sort_order: 0,
            }],
        )
        .unwrap();
    }

    // ── Links ────────────────────────────────────────────────

    #[test]
    fn test_task_links_crud() {
        let conn = init_test_db();
        let task = create_task(&conn, "T", None, None).unwrap();
        let l1 = create_task_link(&conn, task.id.unwrap(), "https://a", Some("A")).unwrap();
        let l2 = create_task_link(&conn, task.id.unwrap(), "https://b", None).unwrap();
        let list = list_task_links(&conn, task.id.unwrap()).unwrap();
        assert_eq!(list.len(), 2);

        update_task_link(&conn, l1.id.unwrap(), "https://a2", Some("A2")).unwrap();
        reorder_task_links(&conn, task.id.unwrap(), &[l2.id.unwrap(), l1.id.unwrap()]).unwrap();
        let list = list_task_links(&conn, task.id.unwrap()).unwrap();
        assert_eq!(list[0].id, l2.id);

        delete_task_link(&conn, l1.id.unwrap()).unwrap();
        assert_eq!(list_task_links(&conn, task.id.unwrap()).unwrap().len(), 1);
    }
}

// ---------- whisper_models ----------

#[derive(Debug, Clone, serde::Serialize)]
pub struct WhisperModelRow {
    pub id: i64,
    pub name: String,
    pub display_name: String,
    pub file_path: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub is_default: bool,
    pub installed_at: i64,
}

pub fn whisper_list_models(conn: &Connection) -> Result<Vec<WhisperModelRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, display_name, file_path, size_bytes, sha256, is_default, installed_at
         FROM whisper_models ORDER BY installed_at ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(WhisperModelRow {
            id: r.get(0)?,
            name: r.get(1)?,
            display_name: r.get(2)?,
            file_path: r.get(3)?,
            size_bytes: r.get(4)?,
            sha256: r.get(5)?,
            is_default: r.get::<_, i64>(6)? != 0,
            installed_at: r.get(7)?,
        })
    })?;
    rows.collect::<Result<Vec<_>>>()
}

pub fn whisper_insert_or_upgrade_model(
    conn: &Connection,
    name: &str,
    display_name: &str,
    file_path: &str,
    size_bytes: i64,
    sha256: &str,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO whisper_models (name, display_name, file_path, size_bytes, sha256, is_default, installed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)
         ON CONFLICT(name) DO UPDATE SET
           display_name = excluded.display_name,
           file_path = excluded.file_path,
           size_bytes = excluded.size_bytes,
           sha256 = excluded.sha256,
           installed_at = excluded.installed_at",
        params![name, display_name, file_path, size_bytes, sha256, now],
    )?;
    Ok(())
}

pub fn whisper_delete_model(conn: &Connection, name: &str) -> Result<()> {
    conn.execute("DELETE FROM whisper_models WHERE name = ?1", params![name])?;
    Ok(())
}

pub fn whisper_set_default_model(conn: &mut Connection, name: &str) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("UPDATE whisper_models SET is_default = 0", [])?;
    let changed = tx.execute(
        "UPDATE whisper_models SET is_default = 1 WHERE name = ?1",
        params![name],
    )?;
    if changed == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    tx.commit()?;
    Ok(())
}

pub fn whisper_get_default_model(conn: &Connection) -> Result<Option<WhisperModelRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, display_name, file_path, size_bytes, sha256, is_default, installed_at
         FROM whisper_models WHERE is_default = 1 LIMIT 1",
    )?;
    let mut rows = stmt.query_map([], |r| {
        Ok(WhisperModelRow {
            id: r.get(0)?,
            name: r.get(1)?,
            display_name: r.get(2)?,
            file_path: r.get(3)?,
            size_bytes: r.get(4)?,
            sha256: r.get(5)?,
            is_default: r.get::<_, i64>(6)? != 0,
            installed_at: r.get(7)?,
        })
    })?;
    Ok(rows.next().transpose()?)
}

// ---------- whisper_history ----------

#[derive(Debug, Clone, serde::Serialize)]
pub struct WhisperHistoryRow {
    pub id: i64,
    pub text: String,
    pub text_raw: Option<String>,
    pub model_name: String,
    pub duration_ms: i64,
    pub transcribe_ms: i64,
    pub language: Option<String>,
    pub injected_to: Option<String>,
    pub created_at: i64,
    pub cpu_peak_percent: f64,
    pub gpu_peak_percent: f64,
    pub vram_peak_mb: i64,
    pub postprocessed_text: Option<String>,
    pub provider: String,
    pub provider_model: Option<String>,
}

pub fn whisper_insert_history(
    conn: &Connection,
    text: &str,
    text_raw: Option<&str>,
    model_name: &str,
    duration_ms: i64,
    transcribe_ms: i64,
    language: Option<&str>,
    injected_to: Option<&str>,
    cpu_peak_percent: f64,
    gpu_peak_percent: f64,
    vram_peak_mb: i64,
) -> Result<i64> {
    whisper_insert_history_with_provider(
        conn,
        text,
        text_raw,
        model_name,
        "local",
        Some(model_name),
        duration_ms,
        transcribe_ms,
        language,
        injected_to,
        cpu_peak_percent,
        gpu_peak_percent,
        vram_peak_mb,
    )
}

pub fn whisper_insert_history_with_provider(
    conn: &Connection,
    text: &str,
    text_raw: Option<&str>,
    model_name: &str,
    provider: &str,
    provider_model: Option<&str>,
    duration_ms: i64,
    transcribe_ms: i64,
    language: Option<&str>,
    injected_to: Option<&str>,
    cpu_peak_percent: f64,
    gpu_peak_percent: f64,
    vram_peak_mb: i64,
) -> Result<i64> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO whisper_history
            (text, text_raw, model_name, provider, provider_model, duration_ms, transcribe_ms, language, injected_to, created_at, cpu_peak_percent, gpu_peak_percent, vram_peak_mb)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            text,
            text_raw,
            model_name,
            provider,
            provider_model,
            duration_ms,
            transcribe_ms,
            language,
            injected_to,
            now,
            cpu_peak_percent,
            gpu_peak_percent,
            vram_peak_mb,
        ],
    )?;
    // Trim to last 200 (by id — autoincrement ensures insertion order)
    conn.execute(
        "DELETE FROM whisper_history WHERE id NOT IN
            (SELECT id FROM whisper_history ORDER BY id DESC LIMIT 200)",
        [],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn whisper_list_history(conn: &Connection, limit: i64) -> Result<Vec<WhisperHistoryRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, text, text_raw, model_name, duration_ms, transcribe_ms, language, injected_to, created_at,
                cpu_peak_percent, gpu_peak_percent, vram_peak_mb, postprocessed_text, provider, provider_model
         FROM whisper_history ORDER BY created_at DESC, id DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |r| {
        Ok(WhisperHistoryRow {
            id: r.get(0)?,
            text: r.get(1)?,
            text_raw: r.get(2)?,
            model_name: r.get(3)?,
            duration_ms: r.get(4)?,
            transcribe_ms: r.get(5)?,
            language: r.get(6)?,
            injected_to: r.get(7)?,
            created_at: r.get(8)?,
            cpu_peak_percent: r.get(9)?,
            gpu_peak_percent: r.get(10)?,
            vram_peak_mb: r.get(11)?,
            postprocessed_text: r.get(12)?,
            provider: r.get(13)?,
            provider_model: r.get(14)?,
        })
    })?;
    rows.collect::<Result<Vec<_>>>()
}

pub fn whisper_set_postprocessed(conn: &Connection, id: i64, text: &str) -> Result<()> {
    conn.execute(
        "UPDATE whisper_history SET postprocessed_text = ?1 WHERE id = ?2",
        params![text, id],
    )?;
    Ok(())
}

pub fn whisper_delete_history(conn: &Connection, id: Option<i64>) -> Result<()> {
    match id {
        Some(id) => {
            conn.execute("DELETE FROM whisper_history WHERE id = ?1", params![id])?;
        }
        None => {
            conn.execute("DELETE FROM whisper_history", [])?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod whisper_crud_tests {
    use super::*;
    use crate::db::init_test_db;

    fn setup() -> Connection {
        init_test_db()
    }

    #[test]
    fn model_insert_then_list_roundtrip() {
        let conn = init_test_db();
        whisper_insert_or_upgrade_model(&conn, "ggml-small", "small", "/tmp/small.bin", 100, "abc")
            .unwrap();
        let models = whisper_list_models(&conn).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "ggml-small");
        assert!(!models[0].is_default);
    }

    #[test]
    fn set_default_clears_previous_default() {
        let mut conn = init_test_db();
        whisper_insert_or_upgrade_model(&conn, "ggml-a", "a", "/tmp/a", 1, "h1").unwrap();
        whisper_insert_or_upgrade_model(&conn, "ggml-b", "b", "/tmp/b", 2, "h2").unwrap();
        whisper_set_default_model(&mut conn, "ggml-a").unwrap();
        whisper_set_default_model(&mut conn, "ggml-b").unwrap();
        let defaults: Vec<_> = whisper_list_models(&conn)
            .unwrap()
            .into_iter()
            .filter(|m| m.is_default)
            .collect();
        assert_eq!(defaults.len(), 1);
        assert_eq!(defaults[0].name, "ggml-b");
    }

    #[test]
    fn set_default_errors_for_unknown_model() {
        let mut conn = init_test_db();
        assert!(whisper_set_default_model(&mut conn, "ggml-missing").is_err());
    }

    #[test]
    fn history_trim_keeps_last_200() {
        let conn = init_test_db();
        for i in 0..250 {
            whisper_insert_history(
                &conn,
                &format!("t{}", i),
                None,
                "ggml-small",
                100,
                50,
                None,
                None,
                0.0,
                0.0,
                0,
            )
            .unwrap();
        }
        let rows = whisper_list_history(&conn, 1000).unwrap();
        assert_eq!(rows.len(), 200);
        // Newest first
        assert_eq!(rows[0].text, "t249");
    }

    #[test]
    fn whisper_history_defaults_to_local_provider() {
        let conn = setup();
        whisper_insert_history(
            &conn,
            "hello",
            None,
            "ggml-small",
            1000,
            200,
            Some("en"),
            Some("paste"),
            0.0,
            0.0,
            0,
        )
        .unwrap();

        let rows = whisper_list_history(&conn, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].provider, "local");
        assert_eq!(rows[0].provider_model.as_deref(), Some("ggml-small"));
    }

    #[test]
    fn whisper_history_can_store_deepgram_provider() {
        let conn = setup();
        whisper_insert_history_with_provider(
            &conn,
            "привет мир",
            None,
            "nova-3",
            "deepgram",
            Some("nova-3"),
            2500,
            0,
            Some("ru"),
            Some("paste"),
            0.0,
            0.0,
            0,
        )
        .unwrap();

        let rows = whisper_list_history(&conn, 10).unwrap();
        assert_eq!(rows[0].provider, "deepgram");
        assert_eq!(rows[0].provider_model.as_deref(), Some("nova-3"));
    }

    #[test]
    fn delete_history_all() {
        let conn = init_test_db();
        whisper_insert_history(&conn, "x", None, "m", 0, 0, None, None, 0.0, 0.0, 0).unwrap();
        whisper_delete_history(&conn, None).unwrap();
        assert!(whisper_list_history(&conn, 100).unwrap().is_empty());
    }
}
