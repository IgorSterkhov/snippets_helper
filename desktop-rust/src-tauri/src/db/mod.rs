pub mod models;
pub mod queries;

use rusqlite::Connection;
use std::sync::Mutex;

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

pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS shortcuts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            value           TEXT NOT NULL DEFAULT '',
            description     TEXT NOT NULL DEFAULT '',
            uuid            TEXT NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS note_folders (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            uuid            TEXT NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS notes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id       INTEGER NOT NULL REFERENCES note_folders(id),
            title           TEXT NOT NULL DEFAULT '',
            content         TEXT NOT NULL DEFAULT '',
            created_at      TIMESTAMP NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            is_pinned       INTEGER NOT NULL DEFAULT 0,
            uuid            TEXT NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS sql_table_analyzer_templates (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            template_text   TEXT NOT NULL DEFAULT '',
            uuid            TEXT NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS sql_macrosing_templates (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            template_name   TEXT NOT NULL DEFAULT '',
            template_text   TEXT NOT NULL DEFAULT '',
            placeholders_config TEXT NOT NULL DEFAULT '',
            combination_mode TEXT NOT NULL DEFAULT '',
            separator       TEXT NOT NULL DEFAULT '',
            uuid            TEXT NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS obfuscation_mappings (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            session_name    TEXT NOT NULL DEFAULT '',
            entity_type     TEXT NOT NULL DEFAULT '',
            original_value  TEXT NOT NULL DEFAULT '',
            obfuscated_value TEXT NOT NULL DEFAULT '',
            created_at      TIMESTAMP NOT NULL,
            uuid            TEXT NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            computer_id     TEXT NOT NULL,
            setting_key     TEXT NOT NULL,
            setting_value   TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (computer_id, setting_key)
        );

        CREATE TABLE IF NOT EXISTS superset_settings (
            computer_id     TEXT NOT NULL,
            setting_key     TEXT NOT NULL,
            setting_value   TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (computer_id, setting_key)
        );

        CREATE TABLE IF NOT EXISTS commit_tags (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            computer_id     TEXT NOT NULL DEFAULT '',
            tag_name        TEXT NOT NULL DEFAULT '',
            is_default      INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS commit_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            computer_id     TEXT NOT NULL DEFAULT '',
            created_at      TIMESTAMP NOT NULL,
            task_link       TEXT NOT NULL DEFAULT '',
            task_id         TEXT NOT NULL DEFAULT '',
            commit_type     TEXT NOT NULL DEFAULT '',
            object_category TEXT NOT NULL DEFAULT '',
            object_value    TEXT NOT NULL DEFAULT '',
            message         TEXT NOT NULL DEFAULT '',
            selected_tags   TEXT NOT NULL DEFAULT '',
            mr_link         TEXT NOT NULL DEFAULT '',
            test_report     TEXT NOT NULL DEFAULT '',
            prod_report     TEXT NOT NULL DEFAULT '',
            transfer_connect TEXT NOT NULL DEFAULT '',
            test_dag        TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS exec_categories (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL DEFAULT '',
            sort_order      INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS exec_commands (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id     INTEGER NOT NULL,
            name            TEXT NOT NULL DEFAULT '',
            command         TEXT NOT NULL DEFAULT '',
            description     TEXT NOT NULL DEFAULT '',
            sort_order      INTEGER NOT NULL DEFAULT 0,
            hide_after_run  INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS snippet_tags (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL DEFAULT '',
            patterns        TEXT NOT NULL DEFAULT '[]',
            color           TEXT NOT NULL DEFAULT '#388bfd',
            sort_order      INTEGER NOT NULL DEFAULT 0,
            uuid            TEXT UNIQUE NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS task_categories (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL DEFAULT '',
            color           TEXT NOT NULL DEFAULT '#8b949e',
            sort_order      INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMP NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            uuid            TEXT UNIQUE NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS task_statuses (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL DEFAULT '',
            color           TEXT NOT NULL DEFAULT '#8b949e',
            sort_order      INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMP NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            uuid            TEXT UNIQUE NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            title           TEXT NOT NULL DEFAULT '',
            category_id     INTEGER REFERENCES task_categories(id) ON DELETE SET NULL,
            status_id       INTEGER REFERENCES task_statuses(id)   ON DELETE SET NULL,
            is_pinned       INTEGER NOT NULL DEFAULT 0,
            bg_color        TEXT,
            tracker_url     TEXT,
            notes_md        TEXT NOT NULL DEFAULT '',
            sort_order      INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMP NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            uuid            TEXT UNIQUE NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS task_checkboxes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            parent_id       INTEGER REFERENCES task_checkboxes(id) ON DELETE CASCADE,
            text            TEXT NOT NULL DEFAULT '',
            is_checked      INTEGER NOT NULL DEFAULT 0,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMP NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            uuid            TEXT UNIQUE NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS task_links (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            url             TEXT NOT NULL DEFAULT '',
            label           TEXT,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMP NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            uuid            TEXT UNIQUE NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_sort      ON tasks(is_pinned DESC, sort_order ASC);
        CREATE INDEX IF NOT EXISTS idx_tasks_category  ON tasks(category_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status_id);
        CREATE INDEX IF NOT EXISTS idx_checkboxes_task ON task_checkboxes(task_id, parent_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_links_task      ON task_links(task_id, sort_order);
        ",
    )?;

    // Migration: add links column to shortcuts (may already exist)
    conn.execute_batch("ALTER TABLE shortcuts ADD COLUMN links TEXT NOT NULL DEFAULT '[]'").ok();

    // Migration: add obsidian_note column to shortcuts (may already exist)
    conn.execute_batch("ALTER TABLE shortcuts ADD COLUMN obsidian_note TEXT NOT NULL DEFAULT ''").ok();

    // Migration: add parent_id column to note_folders (may already exist)
    conn.execute_batch("ALTER TABLE note_folders ADD COLUMN parent_id INTEGER DEFAULT NULL").ok();

    // Seed Tasks module defaults on a fresh DB. Idempotent — only inserts
    // when tables are empty, so existing users' custom sets aren't clobbered.
    seed_task_defaults(conn).ok();

    Ok(())
}

fn seed_task_defaults(conn: &Connection) -> Result<(), rusqlite::Error> {
    use chrono::Utc;
    // Same format as queries.rs `now_str()` so parse_dt round-trips cleanly.
    let now = Utc::now().naive_utc().format("%Y-%m-%d %H:%M:%S%.f").to_string();

    let cat_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM task_categories", [], |r| r.get(0))?;
    if cat_count == 0 {
        let defaults = [
            ("Work", "#388bfd", 0_i64),
            ("Home", "#3fb950", 1),
        ];
        for (name, color, ord) in defaults {
            conn.execute(
                "INSERT INTO task_categories (name, color, sort_order, created_at, updated_at, uuid, sync_status, user_id)
                 VALUES (?1, ?2, ?3, ?4, ?4, ?5, 'pending', '')",
                rusqlite::params![name, color, ord, &now, uuid::Uuid::new_v4().to_string()],
            )?;
        }
    }

    let st_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM task_statuses", [], |r| r.get(0))?;
    if st_count == 0 {
        let defaults = [
            ("Open",        "#8b949e", 0_i64),
            ("In progress", "#d29922", 1),
            ("Blocked",     "#f85149", 2),
            ("Done",        "#3fb950", 3),
        ];
        for (name, color, ord) in defaults {
            conn.execute(
                "INSERT INTO task_statuses (name, color, sort_order, created_at, updated_at, uuid, sync_status, user_id)
                 VALUES (?1, ?2, ?3, ?4, ?4, ?5, 'pending', '')",
                rusqlite::params![name, color, ord, &now, uuid::Uuid::new_v4().to_string()],
            )?;
        }
    }

    Ok(())
}

#[cfg(test)]
pub fn init_test_db() -> Connection {
    let conn = Connection::open_in_memory().expect("Failed to open in-memory DB");
    run_migrations(&conn).expect("Failed to run migrations");
    conn
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrations_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap(); // second run must not fail
    }

    #[test]
    fn test_all_tables_exist() {
        let conn = init_test_db();

        let tables: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let expected = vec![
            "app_settings",
            "commit_history",
            "commit_tags",
            "exec_categories",
            "exec_commands",
            "note_folders",
            "notes",
            "obfuscation_mappings",
            "shortcuts",
            "snippet_tags",
            "sql_macrosing_templates",
            "sql_table_analyzer_templates",
            "superset_settings",
            "task_categories",
            "task_checkboxes",
            "task_links",
            "task_statuses",
            "tasks",
        ];

        for table_name in &expected {
            assert!(
                tables.contains(&table_name.to_string()),
                "Missing table: {}",
                table_name
            );
        }
        assert_eq!(tables.len(), expected.len(), "Unexpected extra tables");
    }

    #[test]
    fn test_task_defaults_seeded() {
        let conn = init_test_db();
        let cats: Vec<String> = conn
            .prepare("SELECT name FROM task_categories ORDER BY sort_order")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(cats, vec!["Work", "Home"]);

        let sts: Vec<String> = conn
            .prepare("SELECT name FROM task_statuses ORDER BY sort_order")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(sts, vec!["Open", "In progress", "Blocked", "Done"]);
    }

    #[test]
    fn test_task_seed_idempotent() {
        let conn = init_test_db();
        // Running migrations again must not duplicate seed rows.
        run_migrations(&conn).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_categories", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2);
    }
}
