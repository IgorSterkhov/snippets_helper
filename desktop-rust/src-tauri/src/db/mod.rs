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
        ",
    )?;

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
    fn test_all_12_tables_exist() {
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
            "sql_macrosing_templates",
            "sql_table_analyzer_templates",
            "superset_settings",
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
}
