# Keyboard Helper Rust Edition — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Keyboard Helper desktop app from Python/Tkinter to Rust/Tauri with modern WebView UI, native hotkeys, and optimized battery usage.

**Architecture:** Tauri v2 app with Rust backend (SQLite, sync, hotkeys, system tray) and vanilla HTML/CSS/JS frontend. Frontend uses lazy tab loading — only the active tab's HTML+JS is loaded. Communication via Tauri IPC (`invoke`).

**Tech Stack:** Rust, Tauri v2, rusqlite, reqwest, serde, tauri-plugin-global-shortcut, vanilla JS/CSS

**Spec:** `.workflow/specs/2026-04-02-keyboard-helper-rust-design.md`

**Project location:** `/home/aster/dev/keyboard_helper_rust/`

---

## File Structure

### Rust backend (`src-tauri/src/`)

| File | Responsibility |
|------|---------------|
| `main.rs` | Entry point (minimal, calls `lib::run()`) |
| `lib.rs` | Tauri builder: plugins, commands, setup (tray, hotkey, sync events) |
| `db/mod.rs` | SQLite connection pool, migration runner |
| `db/models.rs` | All data structs (Snippet, Note, NoteFolder, etc.) with Serialize/Deserialize |
| `db/queries.rs` | CRUD functions for all tables |
| `commands/shortcuts.rs` | IPC commands: list, search, create, update, delete shortcuts |
| `commands/notes.rs` | IPC commands: folders CRUD, notes CRUD |
| `commands/sql_tools.rs` | IPC commands: parse, analyze, macros, format, obfuscate |
| `commands/superset.rs` | IPC commands: export, validate, parse SQL from YAML |
| `commands/commits.rs` | IPC commands: history CRUD, tags CRUD, message generation |
| `commands/exec.rs` | IPC commands: categories/commands CRUD, run/stop subprocess |
| `commands/settings.rs` | IPC commands: get/set settings, get/set superset settings |
| `commands/sync_cmd.rs` | IPC commands: trigger push, trigger pull, get sync status |
| `sync/client.rs` | HTTP client: push pending records, pull updates from API |
| `sync/schema.rs` | List of synced tables, sync field definitions |
| `handlers/sql_parser.rs` | Extract table names from SQL (port from Python) |
| `handlers/sql_formatter.rs` | Format SQL with Jinja2 awareness (port from Python) |
| `handlers/sql_obfuscator.rs` | Obfuscate table/column names in SQL (port from Python) |
| `hotkey/mod.rs` | Hotkey trait + factory (native vs polling) |
| `hotkey/native.rs` | Global shortcut via tauri-plugin-global-shortcut |
| `hotkey/polling.rs` | Keyboard hook for double-shift/double-ctrl |
| `tray.rs` | System tray icon + menu (Open, Autostart, Exit) |
| `clipboard.rs` | Read/write system clipboard |
| `autostart.rs` | LaunchAgent (macOS), Startup shortcut (Windows), autostart (Linux) |

### Web frontend (`src/`)

| File | Responsibility |
|------|---------------|
| `index.html` | App shell: sidebar/tab-bar, tab content containers |
| `main.js` | Tab router, lazy loader, Tauri event listeners |
| `styles.css` | Dark theme (GitHub Dark inspired), layout, components |
| `tauri-api.js` | Thin wrapper around `invoke()` with error handling |
| `components/tab-container.js` | Reusable lazy tab container (used for SQL, Superset sub-tabs too) |
| `components/search-bar.js` | Reusable search input component |
| `components/modal.js` | Reusable modal dialog |
| `components/toast.js` | Notification toasts |
| `tabs/shortcuts.js` | Shortcuts tab: list, search, CRUD, copy-on-enter |
| `tabs/shortcuts.html` | Shortcuts tab HTML template |
| `tabs/notes.js` | Notes tab: folder tree, editor, markdown preview |
| `tabs/notes.html` | Notes tab HTML template |
| `tabs/sql/sql-main.js` | SQL tab container + lazy sub-tab loading |
| `tabs/sql/parser.js` | SQL Parser sub-tab |
| `tabs/sql/analyzer.js` | Table Analyzer sub-tab |
| `tabs/sql/macrosing.js` | Macrosing sub-tab |
| `tabs/sql/formatter.js` | SQL Formatter sub-tab |
| `tabs/sql/obfuscator.js` | SQL Obfuscator sub-tab |
| `tabs/superset/superset-main.js` | Superset tab container + lazy sub-tab loading |
| `tabs/superset/export.js` | Export report sub-tab |
| `tabs/superset/validate.js` | Validate report sub-tab |
| `tabs/superset/sql.js` | Superset SQL sub-tab |
| `tabs/commits.js` | Commits tab: form, history, tag management |
| `tabs/commits.html` | Commits tab HTML template |
| `tabs/exec.js` | Exec tab: categories, commands, subprocess output |
| `tabs/exec.html` | Exec tab HTML template |
| `tabs/settings.js` | Settings modal/window with sub-tabs |
| `tabs/settings.html` | Settings HTML template |

---

## Chunk 1: Project Setup, DB Layer, Frontend Shell

### Task 1: Tauri Project Scaffolding

**Files:**
- Create: `keyboard_helper_rust/package.json`
- Create: `keyboard_helper_rust/src-tauri/Cargo.toml`
- Create: `keyboard_helper_rust/src-tauri/tauri.conf.json`
- Create: `keyboard_helper_rust/src-tauri/build.rs`
- Create: `keyboard_helper_rust/src-tauri/src/main.rs`
- Create: `keyboard_helper_rust/src-tauri/src/lib.rs`
- Create: `keyboard_helper_rust/src-tauri/capabilities/default.json`
- Create: `keyboard_helper_rust/src/index.html`
- Create: `keyboard_helper_rust/.gitignore`

- [ ] **Step 1: Create project directory and initialize git**

```bash
mkdir -p /home/aster/dev/keyboard_helper_rust
cd /home/aster/dev/keyboard_helper_rust
git init
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "keyboard-helper",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "echo 'no build step needed for vanilla JS'",
    "build": "echo 'no build step needed for vanilla JS'"
  }
}
```

- [ ] **Step 3: Create Cargo.toml with all dependencies**

File: `src-tauri/Cargo.toml`

```toml
[package]
name = "keyboard-helper"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-global-shortcut = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"
tokio = { version = "1", features = ["full"] }
rusqlite = { version = "0.31", features = ["bundled"] }
reqwest = { version = "0.12", features = ["json"] }
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
arboard = "3"
dirs = "5"
hostname = "0.4"
zip = "2"
log = "0.4"
env_logger = "0.11"

[build-dependencies]
tauri-build = "2"
```

- [ ] **Step 4: Create build.rs**

File: `src-tauri/build.rs`

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 5: Create tauri.conf.json**

File: `src-tauri/tauri.conf.json`

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Keyboard Helper",
  "version": "0.1.0",
  "identifier": "com.keyboard-helper.app",
  "build": {
    "frontendDist": "../src"
  },
  "app": {
    "windows": [
      {
        "title": "Keyboard Helper",
        "width": 900,
        "height": 600,
        "visible": false,
        "resizable": true,
        "decorations": true,
        "alwaysOnTop": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "global-shortcut": {}
  }
}
```

- [ ] **Step 6: Create capabilities/default.json**

File: `src-tauri/capabilities/default.json`

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-set-focus",
    "core:window:allow-is-visible",
    "core:window:allow-set-size",
    "core:window:allow-set-position",
    "core:window:allow-center",
    "global-shortcut:default"
  ]
}
```

- [ ] **Step 7: Create main.rs and lib.rs**

File: `src-tauri/src/main.rs`

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    keyboard_helper::run();
}
```

File: `src-tauri/src/lib.rs`

```rust
mod db;

pub fn run() {
    let db = db::init_db().expect("Failed to initialize database");

    tauri::Builder::default()
        .manage(db)
        .plugin(tauri_plugin_global_shortcut::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 8: Create minimal index.html**

File: `src/index.html`

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keyboard Helper</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app">
    <h1>Keyboard Helper</h1>
    <p>Loading...</p>
  </div>
</body>
</html>
```

- [ ] **Step 9: Create .gitignore**

```
/node_modules
/src-tauri/target
```

- [ ] **Step 10: Verify build compiles**

```bash
cd /home/aster/dev/keyboard_helper_rust
npm install
cd src-tauri && cargo build 2>&1 | tail -5
```

Expected: successful compilation (warnings OK)

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "init Tauri v2 project scaffold"
```

---

### Task 2: SQLite Database Layer

**Files:**
- Create: `src-tauri/src/db/mod.rs`
- Create: `src-tauri/src/db/models.rs`
- Create: `src-tauri/src/db/queries.rs`

- [ ] **Step 1: Write DB model tests**

File: `src-tauri/src/db/models.rs`

```rust
use serde::{Deserialize, Serialize};
use chrono::NaiveDateTime;

// === Sync-enabled tables ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shortcut {
    pub id: Option<i64>,
    pub name: String,
    pub value: String,
    pub description: String,
    // sync fields
    pub uuid: String,
    pub updated_at: NaiveDateTime,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteFolder {
    pub id: Option<i64>,
    pub name: String,
    pub sort_order: i32,
    pub uuid: String,
    pub updated_at: NaiveDateTime,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: Option<i64>,
    pub folder_id: i64,
    pub title: String,
    pub content: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub is_pinned: bool,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlTableAnalyzerTemplate {
    pub id: Option<i64>,
    pub template_text: String,
    pub uuid: String,
    pub updated_at: NaiveDateTime,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlMacrosingTemplate {
    pub id: Option<i64>,
    pub template_name: String,
    pub template_text: String,
    pub placeholders_config: String,
    pub combination_mode: String,
    pub separator: String,
    pub uuid: String,
    pub updated_at: NaiveDateTime,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObfuscationMapping {
    pub id: Option<i64>,
    pub session_name: String,
    pub entity_type: String,
    pub original_value: String,
    pub obfuscated_value: String,
    pub created_at: NaiveDateTime,
    pub uuid: String,
    pub updated_at: NaiveDateTime,
    pub sync_status: String,
    pub user_id: String,
}

// === Local-only tables ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSetting {
    pub computer_id: String,
    pub setting_key: String,
    pub setting_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupersetSetting {
    pub computer_id: String,
    pub setting_key: String,
    pub setting_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitTag {
    pub id: Option<i64>,
    pub computer_id: String,
    pub tag_name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitHistory {
    pub id: Option<i64>,
    pub computer_id: String,
    pub created_at: NaiveDateTime,
    pub task_link: String,
    pub task_id: String,
    pub commit_type: String,
    pub object_category: String,
    pub object_value: String,
    pub message: String,
    pub selected_tags: String,
    pub mr_link: String,
    pub test_report: String,
    pub prod_report: String,
    pub transfer_connect: String,
    pub test_dag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecCategory {
    pub id: Option<i64>,
    pub name: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecCommand {
    pub id: Option<i64>,
    pub category_id: i64,
    pub name: String,
    pub command: String,
    pub description: String,
    pub sort_order: i32,
    pub hide_after_run: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn test_shortcut_serialization() {
        let s = Shortcut {
            id: Some(1),
            name: "test".into(),
            value: "value".into(),
            description: "desc".into(),
            uuid: "abc-123".into(),
            updated_at: Utc::now().naive_utc(),
            sync_status: "pending".into(),
            user_id: "user1".into(),
        };
        let json = serde_json::to_string(&s).unwrap();
        let deserialized: Shortcut = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "test");
    }
}
```

- [ ] **Step 2: Run model tests**

```bash
cd /home/aster/dev/keyboard_helper_rust/src-tauri
cargo test db::models::tests -- --nocapture
```

Expected: PASS

- [ ] **Step 3: Write DB init and migrations**

File: `src-tauri/src/db/mod.rs`

```rust
pub mod models;
pub mod queries;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

pub struct DbState(pub Mutex<Connection>);

pub fn init_db() -> Result<DbState, rusqlite::Error> {
    let db_path = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("keyboard-helper")
        .join("keyboard_helper.db");

    std::fs::create_dir_all(db_path.parent().unwrap()).ok();

    let conn = Connection::open(&db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    run_migrations(&conn)?;
    Ok(DbState(Mutex::new(conn)))
}

fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS shortcuts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            value TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            uuid TEXT UNIQUE NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            sync_status TEXT NOT NULL DEFAULT 'pending',
            user_id TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS note_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            uuid TEXT UNIQUE NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            sync_status TEXT NOT NULL DEFAULT 'pending',
            user_id TEXT NOT NULL DEFAULT ''
        );

        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL REFERENCES note_folders(id),
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            is_pinned INTEGER NOT NULL DEFAULT 0,
            uuid TEXT UNIQUE NOT NULL,
            sync_status TEXT NOT NULL DEFAULT 'pending',
            user_id TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS sql_table_analyzer_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_text TEXT NOT NULL DEFAULT '',
            uuid TEXT UNIQUE NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            sync_status TEXT NOT NULL DEFAULT 'pending',
            user_id TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS sql_macrosing_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_name TEXT NOT NULL DEFAULT '',
            template_text TEXT NOT NULL DEFAULT '',
            placeholders_config TEXT NOT NULL DEFAULT '',
            combination_mode TEXT NOT NULL DEFAULT '',
            separator TEXT NOT NULL DEFAULT '',
            uuid TEXT UNIQUE NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            sync_status TEXT NOT NULL DEFAULT 'pending',
            user_id TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS obfuscation_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_name TEXT NOT NULL DEFAULT '',
            entity_type TEXT NOT NULL DEFAULT '',
            original_value TEXT NOT NULL DEFAULT '',
            obfuscated_value TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL,
            uuid TEXT UNIQUE NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            sync_status TEXT NOT NULL DEFAULT 'pending',
            user_id TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            computer_id TEXT NOT NULL,
            setting_key TEXT NOT NULL,
            setting_value TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (computer_id, setting_key)
        );

        CREATE TABLE IF NOT EXISTS superset_settings (
            computer_id TEXT NOT NULL,
            setting_key TEXT NOT NULL,
            setting_value TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (computer_id, setting_key)
        );

        CREATE TABLE IF NOT EXISTS commit_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            computer_id TEXT NOT NULL DEFAULT '',
            tag_name TEXT NOT NULL DEFAULT '',
            is_default INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS commit_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            computer_id TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL,
            task_link TEXT NOT NULL DEFAULT '',
            task_id TEXT NOT NULL DEFAULT '',
            commit_type TEXT NOT NULL DEFAULT '',
            object_category TEXT NOT NULL DEFAULT '',
            object_value TEXT NOT NULL DEFAULT '',
            message TEXT NOT NULL DEFAULT '',
            selected_tags TEXT NOT NULL DEFAULT '',
            mr_link TEXT NOT NULL DEFAULT '',
            test_report TEXT NOT NULL DEFAULT '',
            prod_report TEXT NOT NULL DEFAULT '',
            transfer_connect TEXT NOT NULL DEFAULT '',
            test_dag TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS exec_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS exec_commands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            command TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            hide_after_run INTEGER NOT NULL DEFAULT 0
        );
    ")?;
    Ok(())
}

#[cfg(test)]
pub fn init_test_db() -> DbState {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    DbState(Mutex::new(conn))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrations_run_twice_without_error() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap(); // idempotent
    }

    #[test]
    fn test_all_tables_exist() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        let expected = vec![
            "app_settings", "commit_history", "commit_tags",
            "exec_categories", "exec_commands", "note_folders",
            "notes", "obfuscation_mappings", "shortcuts",
            "sql_macrosing_templates", "sql_table_analyzer_templates",
            "superset_settings",
        ];
        for t in &expected {
            assert!(tables.contains(&t.to_string()), "Missing table: {}", t);
        }
    }
}
```

- [ ] **Step 4: Run migration tests**

```bash
cargo test db::tests -- --nocapture
```

Expected: PASS (both tests)

- [ ] **Step 5: Write queries module with tests (shortcuts CRUD as example)**

File: `src-tauri/src/db/queries.rs`

```rust
use rusqlite::{params, Connection};
use chrono::Utc;
use uuid::Uuid;
use super::models::*;

// === Shortcuts ===

pub fn list_shortcuts(conn: &Connection) -> Result<Vec<Shortcut>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, value, description, uuid, updated_at, sync_status, user_id
         FROM shortcuts WHERE sync_status != 'deleted' ORDER BY name"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Shortcut {
            id: row.get(0)?,
            name: row.get(1)?,
            value: row.get(2)?,
            description: row.get(3)?,
            uuid: row.get(4)?,
            updated_at: row.get(5)?,
            sync_status: row.get(6)?,
            user_id: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn search_shortcuts(conn: &Connection, query: &str) -> Result<Vec<Shortcut>, rusqlite::Error> {
    let pattern = format!("%{}%", query.to_lowercase());
    let mut stmt = conn.prepare(
        "SELECT id, name, value, description, uuid, updated_at, sync_status, user_id
         FROM shortcuts WHERE sync_status != 'deleted' AND LOWER(name) LIKE ?1 ORDER BY name"
    )?;
    let rows = stmt.query_map(params![pattern], |row| {
        Ok(Shortcut {
            id: row.get(0)?,
            name: row.get(1)?,
            value: row.get(2)?,
            description: row.get(3)?,
            uuid: row.get(4)?,
            updated_at: row.get(5)?,
            sync_status: row.get(6)?,
            user_id: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn create_shortcut(conn: &Connection, name: &str, value: &str, description: &str, user_id: &str) -> Result<Shortcut, rusqlite::Error> {
    let uuid = Uuid::new_v4().to_string();
    let now = Utc::now().naive_utc();
    conn.execute(
        "INSERT INTO shortcuts (name, value, description, uuid, updated_at, sync_status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)",
        params![name, value, description, uuid, now, user_id],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Shortcut {
        id: Some(id), name: name.into(), value: value.into(), description: description.into(),
        uuid, updated_at: now, sync_status: "pending".into(), user_id: user_id.into(),
    })
}

pub fn update_shortcut(conn: &Connection, id: i64, name: &str, value: &str, description: &str) -> Result<(), rusqlite::Error> {
    let now = Utc::now().naive_utc();
    conn.execute(
        "UPDATE shortcuts SET name=?1, value=?2, description=?3, updated_at=?4, sync_status='pending' WHERE id=?5",
        params![name, value, description, now, id],
    )?;
    Ok(())
}

pub fn delete_shortcut(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    let now = Utc::now().naive_utc();
    conn.execute(
        "UPDATE shortcuts SET sync_status='deleted', updated_at=?1 WHERE id=?2",
        params![now, id],
    )?;
    Ok(())
}

// === App Settings ===

pub fn get_setting(conn: &Connection, computer_id: &str, key: &str) -> Result<Option<String>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT setting_value FROM app_settings WHERE computer_id=?1 AND setting_key=?2"
    )?;
    let mut rows = stmt.query_map(params![computer_id, key], |row| row.get(0))?;
    match rows.next() {
        Some(Ok(val)) => Ok(Some(val)),
        _ => Ok(None),
    }
}

pub fn set_setting(conn: &Connection, computer_id: &str, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO app_settings (computer_id, setting_key, setting_value) VALUES (?1, ?2, ?3)
         ON CONFLICT(computer_id, setting_key) DO UPDATE SET setting_value=?3",
        params![computer_id, key, value],
    )?;
    Ok(())
}

// Remaining CRUD functions (note_folders, notes, commit_history, commit_tags,
// exec_categories, exec_commands, superset_settings, sql_*_templates,
// obfuscation_mappings) follow the same pattern as shortcuts above.
// Each has: list, create, update, delete (soft-delete for sync tables, hard-delete for local).

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn test_shortcut_crud() {
        let db = init_test_db();
        let conn = db.0.lock().unwrap();

        // Create
        let s = create_shortcut(&conn, "test", "SELECT 1", "desc", "user1").unwrap();
        assert_eq!(s.name, "test");
        assert!(s.id.is_some());

        // List
        let list = list_shortcuts(&conn).unwrap();
        assert_eq!(list.len(), 1);

        // Search
        let found = search_shortcuts(&conn, "tes").unwrap();
        assert_eq!(found.len(), 1);
        let not_found = search_shortcuts(&conn, "zzz").unwrap();
        assert_eq!(not_found.len(), 0);

        // Update
        update_shortcut(&conn, s.id.unwrap(), "updated", "SELECT 2", "new desc").unwrap();
        let list = list_shortcuts(&conn).unwrap();
        assert_eq!(list[0].name, "updated");
        assert_eq!(list[0].sync_status, "pending");

        // Delete (soft)
        delete_shortcut(&conn, s.id.unwrap()).unwrap();
        let list = list_shortcuts(&conn).unwrap();
        assert_eq!(list.len(), 0); // filtered out deleted
    }

    #[test]
    fn test_settings_crud() {
        let db = init_test_db();
        let conn = db.0.lock().unwrap();

        assert_eq!(get_setting(&conn, "pc1", "hotkey").unwrap(), None);

        set_setting(&conn, "pc1", "hotkey", "alt_space").unwrap();
        assert_eq!(get_setting(&conn, "pc1", "hotkey").unwrap(), Some("alt_space".into()));

        set_setting(&conn, "pc1", "hotkey", "ctrl_space").unwrap();
        assert_eq!(get_setting(&conn, "pc1", "hotkey").unwrap(), Some("ctrl_space".into()));
    }
}
```

- [ ] **Step 6: Run query tests**

```bash
cargo test db::queries::tests -- --nocapture
```

Expected: PASS

- [ ] **Step 7: Commit DB layer**

```bash
git add -A
git commit -m "add SQLite DB layer: models, migrations, queries"
```

---

### Task 3: Frontend Shell with Dark Theme and Lazy Tab Loading

**Files:**
- Create: `src/index.html`
- Create: `src/styles.css`
- Create: `src/main.js`
- Create: `src/tauri-api.js`
- Create: `src/components/tab-container.js`

- [ ] **Step 1: Create dark theme CSS**

File: `src/styles.css` — complete dark theme inspired by GitHub Dark:
- CSS variables for colors (`--bg-primary: #0d1117`, `--bg-secondary: #161b22`, `--border: #21262d`, `--text: #c9d1d9`, `--text-muted: #8b949e`, `--accent: #388bfd`)
- Base styles (body, inputs, buttons, scrollbars)
- Layout: sidebar (48px icon bar) + main content area
- Tab system: active tab highlight, content area
- Component styles: search-bar, list-item, modal, toast
- Responsive: min-width 600px

- [ ] **Step 2: Create tab-container.js (lazy loading engine)**

File: `src/components/tab-container.js`

```javascript
export class TabContainer {
  constructor(containerEl, tabs) {
    this.container = containerEl;
    this.tabs = tabs; // [{id, label, icon, loader}]
    this.loaded = new Set();
    this.activeTab = null;
    this.render();
  }

  render() {
    this.tabBar = document.createElement('div');
    this.tabBar.className = 'tab-bar';
    this.contentArea = document.createElement('div');
    this.contentArea.className = 'tab-content';

    this.tabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.dataset.tabId = tab.id;
      btn.innerHTML = `<span class="tab-icon">${tab.icon}</span><span class="tab-label">${tab.label}</span>`;
      btn.addEventListener('click', () => this.activate(tab.id));
      this.tabBar.appendChild(btn);

      const panel = document.createElement('div');
      panel.className = 'tab-panel';
      panel.dataset.tabId = tab.id;
      panel.style.display = 'none';
      this.contentArea.appendChild(panel);
    });

    this.container.appendChild(this.tabBar);
    this.container.appendChild(this.contentArea);
  }

  async activate(tabId) {
    if (this.activeTab === tabId) return;

    // Hide current
    if (this.activeTab) {
      this.container.querySelector(`.tab-panel[data-tab-id="${this.activeTab}"]`).style.display = 'none';
      this.container.querySelector(`.tab-btn[data-tab-id="${this.activeTab}"]`).classList.remove('active');
    }

    // Show target
    const panel = this.container.querySelector(`.tab-panel[data-tab-id="${tabId}"]`);
    const btn = this.container.querySelector(`.tab-btn[data-tab-id="${tabId}"]`);
    panel.style.display = '';
    btn.classList.add('active');
    this.activeTab = tabId;

    // Lazy load if first time
    if (!this.loaded.has(tabId)) {
      const tab = this.tabs.find(t => t.id === tabId);
      panel.innerHTML = '<div class="loading">Loading...</div>';
      await tab.loader(panel);
      this.loaded.add(tabId);
    }
  }
}
```

- [ ] **Step 3: Create reusable components (search-bar, modal, toast)**

File: `src/components/search-bar.js` — exports `createSearchBar(onInput)` that returns a styled input element with debounced `oninput` handler (300ms).

File: `src/components/modal.js` — exports `showModal({ title, body, onConfirm, onCancel })` that creates an overlay with a dialog box. Used for CRUD forms.

File: `src/components/toast.js` — exports `showToast(message, type)` that shows a temporary notification (auto-dismiss after 3s).

- [ ] **Step 4: Create tauri-api.js**

File: `src/tauri-api.js`

```javascript
const { invoke } = window.__TAURI__.core;

export async function call(command, args = {}) {
  try {
    return await invoke(command, args);
  } catch (err) {
    console.error(`IPC error [${command}]:`, err);
    throw err;
  }
}
```

- [ ] **Step 5: Create main.js with tab routing and Escape handler**

File: `src/main.js`

```javascript
import { TabContainer } from './components/tab-container.js';
import { call } from './tauri-api.js';

const TABS = [
  { id: 'shortcuts', label: 'Shortcuts', icon: '📋', loader: (el) => import('./tabs/shortcuts.js').then(m => m.init(el)) },
  { id: 'notes',     label: 'Notes',     icon: '📝', loader: (el) => import('./tabs/notes.js').then(m => m.init(el)) },
  { id: 'sql',       label: 'SQL',       icon: '🗃', loader: (el) => import('./tabs/sql/sql-main.js').then(m => m.init(el)) },
  { id: 'superset',  label: 'Superset',  icon: '📊', loader: (el) => import('./tabs/superset/superset-main.js').then(m => m.init(el)) },
  { id: 'commits',   label: 'Commits',   icon: '💾', loader: (el) => import('./tabs/commits.js').then(m => m.init(el)) },
  { id: 'exec',      label: 'Exec',      icon: '⚡', loader: (el) => import('./tabs/exec.js').then(m => m.init(el)) },
];

async function main() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  const tabContainer = new TabContainer(app, TABS);

  // Load last active tab from settings, default to 'shortcuts'
  let lastTab = 'shortcuts';
  try {
    const saved = await call('get_setting', { key: 'last_active_tab' });
    if (saved) lastTab = saved;
  } catch {}

  await tabContainer.activate(lastTab);

  // Save active tab on switch
  const origActivate = tabContainer.activate.bind(tabContainer);
  tabContainer.activate = async (tabId) => {
    await origActivate(tabId);
    call('set_setting', { key: 'last_active_tab', value: tabId }).catch(() => {});
  };
}

// Escape key hides the window
document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    await call('hide_and_sync');
  }
});

document.addEventListener('DOMContentLoaded', main);
```

- [ ] **Step 6: Create index.html with app shell**

File: `src/index.html` (replace Step 8 from Task 1)

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keyboard Helper</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="main.js"></script>
</body>
</html>
```

- [ ] **Step 7: Create placeholder tab loaders**

Create stub files so the app runs without errors:

File: `src/tabs/shortcuts.js`
```javascript
export function init(container) { container.innerHTML = '<h2>Shortcuts</h2><p>Coming soon</p>'; }
```

(Same pattern for `notes.js`, `sql/sql-main.js`, `superset/superset-main.js`, `commits.js`, `exec.js`)

- [ ] **Step 8: Add settings and window IPC commands to Rust**

File: `src-tauri/src/commands/settings.rs`

```rust
use tauri::State;
use crate::db::{DbState, queries};

#[tauri::command]
pub fn get_setting(state: State<DbState>, key: String) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let computer_id = hostname::get().unwrap_or_default().to_string_lossy().to_string();
    queries::get_setting(&conn, &computer_id, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(state: State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let computer_id = hostname::get().unwrap_or_default().to_string_lossy().to_string();
    queries::set_setting(&conn, &computer_id, &key, &value).map_err(|e| e.to_string())
}

/// Called from frontend on Escape key — hides window and triggers sync push
#[tauri::command]
pub async fn hide_and_sync(window: tauri::Window, state: State<'_, DbState>) -> Result<(), String> {
    let _ = window.hide();
    // Trigger sync push in background (non-blocking)
    // sync::trigger_push(state) — implemented in Task 6
    Ok(())
}
```

Update `lib.rs` to register commands:
```rust
mod commands;
// ...
.invoke_handler(tauri::generate_handler![
    commands::settings::get_setting,
    commands::settings::set_setting,
    commands::settings::hide_and_sync,
])
```

- [ ] **Step 9: Verify app launches with tab shell**

```bash
cd /home/aster/dev/keyboard_helper_rust
cargo tauri dev
```

Expected: window opens with dark theme, sidebar with 6 tab icons, clicking tabs shows placeholder content.

- [ ] **Step 10: Commit frontend shell**

```bash
git add -A
git commit -m "add frontend shell with lazy tab loading and dark theme"
```

---

## Chunk 2: Core Features — Shortcuts Tab, OS Integration, Sync

### Task 4: Shortcuts Tab (Full End-to-End)

**Files:**
- Create: `src-tauri/src/commands/shortcuts.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` — register shortcuts commands
- Create: `src/tabs/shortcuts.js`
- Create: `src/tabs/shortcuts.html`

- [ ] **Step 1: Write shortcuts command tests**

File: `src-tauri/src/commands/shortcuts.rs`

```rust
use tauri::State;
use crate::db::{DbState, models::Shortcut, queries};

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
    let user_id = ""; // populated by sync
    queries::create_shortcut(&conn, &name, &value, &description, user_id).map_err(|e| e.to_string())
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
```

- [ ] **Step 2: Register commands in lib.rs**

Add to `invoke_handler`:
```rust
commands::shortcuts::list_shortcuts,
commands::shortcuts::search_shortcuts,
commands::shortcuts::create_shortcut,
commands::shortcuts::update_shortcut,
commands::shortcuts::delete_shortcut,
```

- [ ] **Step 3: Implement shortcuts.js frontend**

File: `src/tabs/shortcuts.js` — full implementation:
- Search bar at top with debounced input (300ms)
- Scrollable list of shortcut cards (name, truncated value, description)
- Click on card → copy value to clipboard via IPC, close window
- Enter key → same behavior on selected card
- Add/Edit/Delete buttons → modal dialog with form
- Arrow keys navigate the list

- [ ] **Step 4: Test end-to-end manually**

```bash
cargo tauri dev
```

Test: add a shortcut, search for it, click to copy, verify clipboard content.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "add Shortcuts tab: CRUD, search, copy to clipboard"
```

---

### Task 5: OS Integration — Hotkey, Tray, Clipboard, Window Toggle

**Files:**
- Create: `src-tauri/src/hotkey/mod.rs`
- Create: `src-tauri/src/hotkey/native.rs`
- Create: `src-tauri/src/tray.rs`
- Create: `src-tauri/src/clipboard.rs`
- Modify: `src-tauri/src/lib.rs` — integrate hotkey, tray, clipboard

- [ ] **Step 1: Implement clipboard module**

File: `src-tauri/src/clipboard.rs`

```rust
use arboard::Clipboard;

#[tauri::command]
pub fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_clipboard() -> Result<String, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Implement native hotkey**

File: `src-tauri/src/hotkey/native.rs`

Register global shortcut via `tauri-plugin-global-shortcut` in `lib.rs` setup:

```rust
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

pub fn register_hotkey(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    app.global_shortcut().on_shortcut(shortcut, |app, _scut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            if let Some(window) = app.get_webview_window("main") {
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
    })?;
    Ok(())
}
```

- [ ] **Step 3: Implement system tray**

File: `src-tauri/src/tray.rs`

```rust
use tauri::tray::TrayIconBuilder;
use tauri::menu::{Menu, MenuItem};
use tauri::Manager;

pub fn create_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Открыть", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::new()
        .menu(&menu)
        .icon(app.default_window_icon().unwrap().clone())
        .menu_on_left_click(false)
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
```

- [ ] **Step 4: Wire everything in lib.rs setup**

```rust
pub fn run() {
    let db = db::init_db().expect("Failed to initialize database");

    tauri::Builder::default()
        .manage(db)
        .plugin(tauri_plugin_global_shortcut::init())
        .invoke_handler(tauri::generate_handler![/* all commands */])
        .setup(|app| {
            tray::create_tray(app)?;
            hotkey::native::register_hotkey(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Test hotkey and tray**

```bash
cargo tauri dev
```

Test: Alt+Space toggles window. Tray icon shows menu. "Открыть" shows window. "Выход" quits.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "add hotkey, system tray, clipboard integration"
```

---

### Task 6: Sync Client

**Files:**
- Create: `src-tauri/src/sync/client.rs`
- Create: `src-tauri/src/sync/schema.rs`
- Create: `src-tauri/src/sync/mod.rs`
- Create: `src-tauri/src/commands/sync_cmd.rs`
- Modify: `src-tauri/src/lib.rs` — sync on window show/hide events

- [ ] **Step 1: Define sync schema**

File: `src-tauri/src/sync/schema.rs`

```rust
pub const SYNCED_TABLES: &[&str] = &[
    "shortcuts",
    "sql_table_analyzer_templates",
    "sql_macrosing_templates",
    "note_folders",
    "notes",
    "obfuscation_mappings",
];

pub const SYNC_FIELDS: &[&str] = &["uuid", "updated_at", "sync_status", "user_id"];
```

- [ ] **Step 2: Implement sync client**

File: `src-tauri/src/sync/client.rs`

```rust
use reqwest::Client;
use rusqlite::Connection;
use serde_json::Value;

pub struct SyncClient {
    client: Client,
    api_url: String,
    api_key: String,
}

impl SyncClient {
    pub fn new(api_url: &str, api_key: &str) -> Self {
        Self {
            client: Client::new(),
            api_url: api_url.to_string(),
            api_key: api_key.to_string(),
        }
    }

    pub async fn push(&self, conn: &Connection) -> Result<(), String> {
        // For each table in SYNCED_TABLES:
        //   1. SELECT * FROM {table} WHERE sync_status = 'pending'
        //   2. Serialize rows to JSON array
        //   3. POST /v1/sync/push with body:
        //      {"table": "shortcuts", "rows": [...], "api_key": "..."}
        //   4. On 200 OK: UPDATE {table} SET sync_status='synced' WHERE uuid IN (pushed_uuids)
        //   5. On error: log and continue to next table
        for table in SYNCED_TABLES {
            let rows = queries::get_pending_rows(conn, table).map_err(|e| e.to_string())?;
            if rows.is_empty() { continue; }
            let payload = serde_json::json!({
                "table": table,
                "rows": rows,
                "api_key": self.api_key,
            });
            let resp = self.client.post(format!("{}/v1/sync/push", self.api_url))
                .json(&payload)
                .send().await.map_err(|e| e.to_string())?;
            if resp.status().is_success() {
                let uuids: Vec<String> = rows.iter().map(|r| r["uuid"].as_str().unwrap_or("").to_string()).collect();
                queries::mark_synced(conn, table, &uuids).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub async fn pull(&self, conn: &Connection) -> Result<(), String> {
        // 1. Read last_sync_at from app_settings (or "1970-01-01" for first run)
        // 2. POST /v1/sync/pull with body: {"last_sync_at": timestamp, "api_key": "..."}
        // 3. Response: {"table_name": [rows...], ...}
        // 4. For each table+row: UPSERT by uuid (INSERT OR REPLACE)
        //    Set sync_status='synced' on upserted rows
        // 5. Update last_sync_at in app_settings
        let last_sync = queries::get_setting(conn, &self.computer_id(), "last_sync_at")
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| "1970-01-01T00:00:00".to_string());
        let payload = serde_json::json!({
            "last_sync_at": last_sync,
            "api_key": self.api_key,
        });
        let resp = self.client.post(format!("{}/v1/sync/pull", self.api_url))
            .json(&payload)
            .send().await.map_err(|e| e.to_string())?;
        let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(obj) = data.as_object() {
            for (table, rows) in obj {
                if let Some(arr) = rows.as_array() {
                    queries::upsert_synced_rows(conn, table, arr).map_err(|e| e.to_string())?;
                }
            }
        }
        let now = chrono::Utc::now().naive_utc().to_string();
        queries::set_setting(conn, &self.computer_id(), "last_sync_at", &now).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn computer_id(&self) -> String {
        hostname::get().unwrap_or_default().to_string_lossy().to_string()
    }
}
```

Required additions to `db/queries.rs`:
- `get_pending_rows(conn, table) -> Vec<serde_json::Value>` — dynamic query across synced tables
- `mark_synced(conn, table, uuids)` — UPDATE sync_status='synced' WHERE uuid IN (...)
- `upsert_synced_rows(conn, table, rows)` — INSERT OR REPLACE by uuid for pulled rows

SSL/CA certificate support: if `sync_ca_cert` setting is set, use `reqwest::ClientBuilder::add_root_certificate()` when creating the HTTP client.

- [ ] **Step 3: Wire sync to window show/hide events**

Sync is triggered by two actions:
1. **Window shown** (hotkey toggle or tray "Open") → push pending + pull fresh data
2. **Window hidden** (Escape key or hotkey toggle) → push pending

Both go through explicit Rust commands (not `WindowEvent::Focused` which fires too often):

In `hotkey/native.rs` — when toggling window to visible:
```rust
if !window.is_visible().unwrap_or(false) {
    let _ = window.show();
    let _ = window.set_focus();
    // Trigger sync in background
    let handle = app.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        sync::trigger_push_pull(&handle).await;
    });
}
```

In `commands/settings.rs::hide_and_sync` — called from frontend on Escape:
```rust
pub async fn hide_and_sync(window: tauri::Window, state: State<'_, DbState>) -> Result<(), String> {
    let _ = window.hide();
    let handle = window.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        sync::trigger_push(&handle).await;
    });
    Ok(())
}
```

Note: use `tauri::async_runtime::spawn` (not `tokio::spawn`) to ensure compatibility with Tauri's runtime.

- [ ] **Step 4: Add sync IPC commands**

File: `src-tauri/src/commands/sync_cmd.rs`

```rust
#[tauri::command]
pub async fn trigger_sync(state: State<'_, DbState>) -> Result<String, String> {
    // Manual sync trigger from frontend
    // push then pull
}

#[tauri::command]
pub fn get_sync_status(state: State<DbState>) -> Result<String, String> {
    // Return current sync state: "idle", "syncing", "error: ..."
}
```

- [ ] **Step 5: Test sync with existing API**

```bash
cargo tauri dev
```

Test: configure sync URL/key in settings, open window → data pulls from server, make changes → close window → changes push to server.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "add sync client: push/pull on window show/hide"
```

---

## Chunk 3: Remaining Modules

### Task 7: Notes Tab

**Files:**
- Create: `src-tauri/src/commands/notes.rs`
- Add CRUD queries to: `src-tauri/src/db/queries.rs`
- Create: `src/tabs/notes.js`
- Create: `src/tabs/notes.html`

- [ ] **Step 1: Add note_folders and notes CRUD to queries.rs**

Same pattern as shortcuts: `list_note_folders`, `create_note_folder`, `update_note_folder`, `delete_note_folder`, `list_notes(folder_id)`, `create_note`, `update_note`, `delete_note`. With tests.

- [ ] **Step 2: Write notes IPC commands**

File: `src-tauri/src/commands/notes.rs` — commands for folder and note CRUD.

- [ ] **Step 3: Implement notes.js frontend**

- Left panel: folder tree with add/rename/delete
- Right panel: note list (top) + editor (bottom)
- Markdown preview using `marked.js` bundled locally in `src/lib/marked.min.js` (CSP blocks CDN scripts)
- Pin/unpin notes

- [ ] **Step 4: Run backend tests**

```bash
cargo test db::queries::tests -- --nocapture
```

Expected: all note_folders and notes CRUD tests pass.

- [ ] **Step 5: Test manually and commit**

```bash
cargo tauri dev
# test: create folder, create note, edit markdown, preview
git add -A && git commit -m "add Notes tab: folders, markdown editor, preview"
```

---

### Task 8: SQL Tools Tabs (5 Sub-tabs)

**Files:**
- Create: `src-tauri/src/handlers/sql_parser.rs`
- Create: `src-tauri/src/handlers/sql_formatter.rs`
- Create: `src-tauri/src/handlers/sql_obfuscator.rs`
- Create: `src-tauri/src/commands/sql_tools.rs`
- Create: `src/tabs/sql/sql-main.js`
- Create: `src/tabs/sql/parser.js`
- Create: `src/tabs/sql/analyzer.js`
- Create: `src/tabs/sql/macrosing.js`
- Create: `src/tabs/sql/formatter.js`
- Create: `src/tabs/sql/obfuscator.js`

- [ ] **Step 1: Port SQL parser from Python**

File: `src-tauri/src/handlers/sql_parser.rs`

Port the logic from `handlers/sql_parser.py`: extract table names from SQL statements (SELECT, INSERT INTO, JOIN, CTE, TRUNCATE). Handle 3-part names (`db.schema.table`), exclude Python imports. Write unit tests with SQL examples from the Python test cases.

- [ ] **Step 2: Port SQL formatter from Python**

File: `src-tauri/src/handlers/sql_formatter.rs`

Port from `handlers/sql_formatter.py`: format SQL with Jinja2 template awareness (protect `{{ }}` and `{% %}` blocks). Support custom ClickHouse function names. Write tests.

Note: Python version uses `shandy-sqlfmt`. In Rust, use a simpler approach: regex-based Jinja2 protection + sqlformat crate (or manual formatting). The exact formatting library to use should be evaluated during implementation.

- [ ] **Step 3: Port SQL obfuscator from Python**

File: `src-tauri/src/handlers/sql_obfuscator.rs`

Port from `handlers/sql_obfuscator.py` (~489 lines): replace table/column names with generated aliases, maintain consistent mappings within a session. Store mappings in DB. Write tests.

- [ ] **Step 4: Write SQL tools IPC commands**

File: `src-tauri/src/commands/sql_tools.rs`

Commands: `parse_sql_tables`, `format_sql`, `obfuscate_sql`, `list_analyzer_templates`, `create_analyzer_template`, `delete_analyzer_template`, `analyze_ddl`, `list_macrosing_templates`, `create_macrosing_template`, `delete_macrosing_template`, `generate_macros`.

- [ ] **Step 5: Implement sql-main.js with lazy sub-tabs**

File: `src/tabs/sql/sql-main.js` — reuse `TabContainer` for sub-tabs:

```javascript
import { TabContainer } from '../../components/tab-container.js';

export function init(container) {
  const tabs = [
    { id: 'parser',     label: 'Parser',     icon: '🔍', loader: (el) => import('./parser.js').then(m => m.init(el)) },
    { id: 'analyzer',   label: 'Analyzer',   icon: '📊', loader: (el) => import('./analyzer.js').then(m => m.init(el)) },
    { id: 'macrosing',  label: 'Macrosing',  icon: '🔄', loader: (el) => import('./macrosing.js').then(m => m.init(el)) },
    { id: 'formatter',  label: 'Format',     icon: '✨', loader: (el) => import('./formatter.js').then(m => m.init(el)) },
    { id: 'obfuscator', label: 'Obfuscation',icon: '🔒', loader: (el) => import('./obfuscator.js').then(m => m.init(el)) },
  ];
  const tc = new TabContainer(container, tabs);
  tc.activate('parser');
}
```

- [ ] **Step 6: Implement each sub-tab frontend (parser.js, analyzer.js, macrosing.js, formatter.js, obfuscator.js)**

Each sub-tab: textarea for SQL input, action button, result area. Template-based tabs (analyzer, macrosing) also have template management (list, add, delete).

- [ ] **Step 7: Test all SQL sub-tabs and commit**

```bash
cargo test handlers -- --nocapture
cargo tauri dev
# test each sub-tab
git add -A && git commit -m "add SQL Tools: parser, analyzer, macrosing, formatter, obfuscator"
```

---

### Task 9: Superset, Commits, Exec Tabs

**Files:**
- Create: `src-tauri/src/commands/superset.rs`
- Create: `src-tauri/src/commands/commits.rs`
- Create: `src-tauri/src/commands/exec.rs`
- Create: `src/tabs/superset/superset-main.js`, `export.js`, `validate.js`, `sql.js`
- Create: `src/tabs/commits.js`, `src/tabs/commits.html`
- Create: `src/tabs/exec.js`, `src/tabs/exec.html`

- [ ] **Step 1: Implement Superset tab**

Backend commands:
- `extract_zip` — extract Superset export zip, return file list
- `validate_report` — validate YAML structure and file naming
- `parse_superset_sql` — extract SQL from YAML dataset files

Frontend: 3 lazy sub-tabs using TabContainer (same pattern as SQL).

- [ ] **Step 2: Implement Commits tab**

Backend commands:
- `list_commit_history`, `save_commit_history`, `delete_commit_history`
- `list_commit_tags`, `create_commit_tag`, `delete_commit_tag`
- `generate_commit_message` — build message from form fields

Frontend: form with all fields (task_link, task_id, commit_type, object_category, object_value, message), conditional fields, history dropdown with restore, tag selector, copy buttons for commit message and chat message.

Add CRUD queries for `commit_history` and `commit_tags` to `queries.rs`.

- [ ] **Step 3: Implement Exec tab**

Backend commands:
- `list_exec_categories`, `create_exec_category`, `update_exec_category`, `delete_exec_category`
- `list_exec_commands`, `create_exec_command`, `update_exec_command`, `delete_exec_command`
- `run_command` — spawn subprocess, stream output via Tauri events
- `stop_command` — kill running subprocess

Frontend: left panel with categories, right panel with commands list, bottom panel with output console. Run/Stop buttons.

Add CRUD queries for `exec_categories` and `exec_commands` to `queries.rs`.

- [ ] **Step 4: Run backend tests**

```bash
cargo test db::queries::tests -- --nocapture
cargo test commands -- --nocapture
```

Expected: all CRUD tests for commit_history, commit_tags, exec_categories, exec_commands pass.

- [ ] **Step 5: Test all tabs manually and commit**

```bash
cargo tauri dev
# test each tab
git add -A && git commit -m "add Superset, Commits, Exec tabs"
```

---

### Task 10: Settings, Autostart, First-Run

**Files:**
- Create: `src-tauri/src/autostart.rs`
- Create: `src/tabs/settings.js`
- Create: `src/tabs/settings.html`
- Modify: `src-tauri/src/lib.rs` — first-run detection + initial sync

- [ ] **Step 1: Implement settings modal**

Frontend: modal window with 6 sub-tabs (using TabContainer):
- General: window size, hotkey selector, font size, autostart toggle
- Shortcuts: font size, left panel width
- SQL Table Analyzer: format vertical toggle, template management
- Commits: tag management
- SQL Formatter: ClickHouse functions textarea
- Sync: URL, CA cert path, API key, registration, enable/disable

Each setting reads/writes via `get_setting`/`set_setting` IPC commands.

Settings button in the app header/sidebar.

- [ ] **Step 2: Implement autostart**

File: `src-tauri/src/autostart.rs`

```rust
#[cfg(target_os = "macos")]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    // Write/remove LaunchAgent plist to ~/Library/LaunchAgents/com.keyboard-helper.plist
}

#[cfg(target_os = "windows")]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    // Create/remove shortcut in Startup folder
}

#[cfg(target_os = "linux")]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    // Write/remove .desktop file to ~/.config/autostart/
}
```

IPC command: `set_autostart(enabled: bool)`, `get_autostart() -> bool`

- [ ] **Step 3: First-run experience**

In `lib.rs` setup:
- Check if `app_settings` has any data
- If empty (first run), show a setup dialog in frontend: enter Sync API URL + API key
- Trigger full pull from server
- Save settings

- [ ] **Step 4: Test full flow and commit**

```bash
cargo tauri dev
# test: settings modal, autostart toggle, first-run sync
git add -A && git commit -m "add Settings, autostart, first-run setup"
```

---

### Task 11: Polling Hotkey Mode (Optional)

**Files:**
- Create: `src-tauri/src/hotkey/polling.rs`
- Modify: `src-tauri/src/hotkey/mod.rs` — mode selection

- [ ] **Step 1: Implement keyboard polling**

File: `src-tauri/src/hotkey/polling.rs`

Low-level keyboard hook for detecting double-shift / double-ctrl sequences. Platform-specific:
- macOS: CGEventTap
- Windows: SetWindowsHookEx
- Linux: /dev/input or X11 events

This is the "battery-expensive" mode — document the tradeoff in settings UI.

- [ ] **Step 2: Implement mode switching in hotkey/mod.rs**

```rust
pub enum HotkeyMode {
    Native,  // tauri-plugin-global-shortcut
    Polling, // keyboard hook
}

pub fn setup_hotkey(app: &tauri::App, mode: HotkeyMode) -> Result<(), Box<dyn std::error::Error>> {
    match mode {
        HotkeyMode::Native => native::register_hotkey(app),
        HotkeyMode::Polling => polling::start_polling(app),
    }
}
```

Read mode from settings on startup.

- [ ] **Step 3: Test and commit**

```bash
cargo tauri dev
# test: switch between native and polling modes in settings
git add -A && git commit -m "add polling hotkey mode (double shift/ctrl)"
```
