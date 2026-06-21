pub mod models;
pub mod queries;

use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard};

pub struct DbState(pub Mutex<Connection>);

impl DbState {
    /// Lock the DB mutex, recovering from poisoning. SQLite transactions
    /// are atomic, so a prior panic can't leave the DB in an inconsistent
    /// state — only the Rust-level guard flag is set. Recovering is safe
    /// and lets the app keep working instead of wedging every command
    /// with "poisoned lock" for the rest of the session.
    pub fn lock_recover(&self) -> MutexGuard<'_, Connection> {
        match self.0.lock() {
            Ok(g) => g,
            Err(poison) => {
                eprintln!("[db] recovered from poisoned mutex");
                poison.into_inner()
            }
        }
    }
}

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
            is_pinned       INTEGER NOT NULL DEFAULT 0,
            pinned_sort_order INTEGER NOT NULL DEFAULT 0,
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
            pinned_sort_order INTEGER NOT NULL DEFAULT 0,
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

        CREATE TABLE IF NOT EXISTS finance_plans (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL DEFAULT '',
            currency        TEXT NOT NULL DEFAULT 'RUB',
            kind            TEXT NOT NULL DEFAULT 'monthly' CHECK (kind IN ('monthly', 'project', 'one_time', 'general')),
            sort_order      INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMP NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            uuid            TEXT UNIQUE NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS finance_items (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id         INTEGER NOT NULL REFERENCES finance_plans(id) ON DELETE CASCADE,
            parent_id       INTEGER REFERENCES finance_items(id) ON DELETE CASCADE,
            name            TEXT NOT NULL DEFAULT '',
            amount_cents    INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
            due_day         INTEGER DEFAULT NULL CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31)),
            due_date        TEXT DEFAULT NULL,
            note            TEXT NOT NULL DEFAULT '',
            sort_order      INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMP NOT NULL,
            updated_at      TIMESTAMP NOT NULL,
            uuid            TEXT UNIQUE NOT NULL,
            sync_status     TEXT NOT NULL DEFAULT 'pending',
            user_id         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS finance_payments (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id           INTEGER NOT NULL REFERENCES finance_plans(id) ON DELETE CASCADE,
            item_id           INTEGER NOT NULL REFERENCES finance_items(id) ON DELETE CASCADE,
            month_key         TEXT NOT NULL CHECK (
                month_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
                AND substr(month_key, 6, 2) BETWEEN '01' AND '12'
            ),
            is_paid           INTEGER NOT NULL DEFAULT 0 CHECK (is_paid IN (0, 1)),
            paid_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_cents >= 0),
            note              TEXT NOT NULL DEFAULT '',
            created_at        TIMESTAMP NOT NULL,
            updated_at        TIMESTAMP NOT NULL,
            uuid              TEXT UNIQUE NOT NULL,
            sync_status       TEXT NOT NULL DEFAULT 'pending',
            user_id           TEXT NOT NULL DEFAULT '',
            UNIQUE(plan_id, item_id, month_key)
        );

        CREATE TABLE IF NOT EXISTS clickhouse_doc_pages (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            source_url      TEXT UNIQUE NOT NULL,
            public_url      TEXT NOT NULL DEFAULT '',
            category        TEXT NOT NULL DEFAULT '',
            title           TEXT NOT NULL DEFAULT '',
            markdown        TEXT NOT NULL DEFAULT '',
            content_hash    TEXT NOT NULL DEFAULT '',
            updated_at      TIMESTAMP NOT NULL
        );

        CREATE TABLE IF NOT EXISTS clickhouse_doc_sections (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id         INTEGER NOT NULL REFERENCES clickhouse_doc_pages(id) ON DELETE CASCADE,
            category        TEXT NOT NULL DEFAULT '',
            page_title      TEXT NOT NULL DEFAULT '',
            title           TEXT NOT NULL DEFAULT '',
            slug            TEXT NOT NULL DEFAULT '',
            section_path    TEXT NOT NULL DEFAULT '',
            level           INTEGER NOT NULL DEFAULT 2,
            body            TEXT NOT NULL DEFAULT '',
            normalized_search_text TEXT NOT NULL DEFAULT '',
            content_hash    TEXT NOT NULL DEFAULT '',
            sort_order      INTEGER NOT NULL DEFAULT 0,
            UNIQUE(page_id, section_path)
        );

        CREATE TABLE IF NOT EXISTS clickhouse_doc_update_runs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at      TIMESTAMP NOT NULL,
            finished_at     TIMESTAMP NOT NULL,
            status          TEXT NOT NULL DEFAULT '',
            pages_checked   INTEGER NOT NULL DEFAULT 0,
            pages_updated   INTEGER NOT NULL DEFAULT 0,
            sections_added  INTEGER NOT NULL DEFAULT 0,
            sections_changed INTEGER NOT NULL DEFAULT 0,
            sections_removed INTEGER NOT NULL DEFAULT 0,
            failed_urls     INTEGER NOT NULL DEFAULT 0,
            summary         TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS clickhouse_doc_changes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id          INTEGER NOT NULL REFERENCES clickhouse_doc_update_runs(id) ON DELETE CASCADE,
            change_type     TEXT NOT NULL DEFAULT '',
            item_type       TEXT NOT NULL DEFAULT '',
            title           TEXT NOT NULL DEFAULT '',
            source_url      TEXT NOT NULL DEFAULT '',
            details         TEXT NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_sort      ON tasks(is_pinned DESC, sort_order ASC);
        CREATE INDEX IF NOT EXISTS idx_tasks_category  ON tasks(category_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status_id);
        CREATE INDEX IF NOT EXISTS idx_checkboxes_task ON task_checkboxes(task_id, parent_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_links_task      ON task_links(task_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_finance_plans_sort ON finance_plans(sort_order, name);
        CREATE INDEX IF NOT EXISTS idx_finance_items_plan ON finance_items(plan_id, parent_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_finance_payments_plan_month ON finance_payments(plan_id, month_key, item_id);
        CREATE INDEX IF NOT EXISTS idx_finance_payments_item ON finance_payments(item_id, month_key);
        CREATE INDEX IF NOT EXISTS idx_clickhouse_doc_pages_category ON clickhouse_doc_pages(category, title);
        CREATE INDEX IF NOT EXISTS idx_clickhouse_doc_sections_page ON clickhouse_doc_sections(page_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_clickhouse_doc_sections_title ON clickhouse_doc_sections(title);
        CREATE INDEX IF NOT EXISTS idx_clickhouse_doc_sections_slug ON clickhouse_doc_sections(slug);
        CREATE INDEX IF NOT EXISTS idx_clickhouse_doc_sections_search ON clickhouse_doc_sections(normalized_search_text);
        CREATE INDEX IF NOT EXISTS idx_clickhouse_doc_changes_run ON clickhouse_doc_changes(run_id);

        CREATE TABLE IF NOT EXISTS whisper_models (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL UNIQUE,
            display_name    TEXT NOT NULL,
            file_path       TEXT NOT NULL,
            size_bytes      INTEGER NOT NULL,
            sha256          TEXT NOT NULL,
            is_default      INTEGER NOT NULL DEFAULT 0,
            installed_at    INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS whisper_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            text            TEXT NOT NULL,
            text_raw        TEXT,
            model_name      TEXT NOT NULL,
            duration_ms     INTEGER NOT NULL,
            transcribe_ms   INTEGER NOT NULL,
            language        TEXT,
            injected_to     TEXT,
            created_at      INTEGER NOT NULL
        );
        ",
    )?;

    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_whisper_history_created ON whisper_history(created_at DESC);",
    )?;

    // Migration (v1.17.0): local ClickHouse documentation browser metadata.
    conn.execute_batch("ALTER TABLE clickhouse_doc_pages ADD COLUMN public_url TEXT NOT NULL DEFAULT ''")
        .ok();
    conn.execute_batch("ALTER TABLE clickhouse_doc_sections ADD COLUMN section_path TEXT NOT NULL DEFAULT ''")
        .ok();
    conn.execute_batch("ALTER TABLE clickhouse_doc_sections ADD COLUMN normalized_search_text TEXT NOT NULL DEFAULT ''")
        .ok();

    // Migration: add links column to shortcuts (may already exist)
    conn.execute_batch("ALTER TABLE shortcuts ADD COLUMN links TEXT NOT NULL DEFAULT '[]'")
        .ok();

    // Migration: add obsidian_note column to shortcuts (may already exist)
    conn.execute_batch("ALTER TABLE shortcuts ADD COLUMN obsidian_note TEXT NOT NULL DEFAULT ''")
        .ok();

    // Migration (v1.3.31): synced pinned snippets and pinned chip ordering.
    conn.execute_batch("ALTER TABLE shortcuts ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0")
        .ok();
    conn.execute_batch("ALTER TABLE shortcuts ADD COLUMN pinned_sort_order INTEGER NOT NULL DEFAULT 0")
        .ok();
    conn.execute_batch("ALTER TABLE notes ADD COLUMN pinned_sort_order INTEGER NOT NULL DEFAULT 0")
        .ok();

    // Migration: add parent_id column to note_folders (may already exist)
    conn.execute_batch("ALTER TABLE note_folders ADD COLUMN parent_id INTEGER DEFAULT NULL")
        .ok();

    // Migration (v1.3.16): per-transcription performance metrics.
    conn.execute_batch(
        "ALTER TABLE whisper_history ADD COLUMN cpu_peak_percent REAL NOT NULL DEFAULT 0",
    )
    .ok();
    conn.execute_batch(
        "ALTER TABLE whisper_history ADD COLUMN gpu_peak_percent REAL NOT NULL DEFAULT 0",
    )
    .ok();
    conn.execute_batch(
        "ALTER TABLE whisper_history ADD COLUMN vram_peak_mb    INTEGER NOT NULL DEFAULT 0",
    )
    .ok();

    // Migration (v1.3.24): Whisper post-processed text persisted alongside raw transcript.
    // Nullable — old rows stay NULL until user runs ✨ Post-process on them.
    conn.execute_batch("ALTER TABLE whisper_history ADD COLUMN postprocessed_text TEXT")
        .ok();

    // Migration (v1.3.37): provider metadata for local/cloud Whisper history rows.
    conn.execute_batch(
        "ALTER TABLE whisper_history ADD COLUMN provider TEXT NOT NULL DEFAULT 'local'",
    )
    .ok();
    conn.execute_batch("ALTER TABLE whisper_history ADD COLUMN provider_model TEXT")
        .ok();
    conn.execute_batch(
        "UPDATE whisper_history
         SET provider_model = model_name
         WHERE provider_model IS NULL OR provider_model = ''",
    )
    .ok();

    // Migration (v1.11.0): Finance list types and optional row dates.
    conn.execute_batch(
        "ALTER TABLE finance_plans ADD COLUMN kind TEXT NOT NULL DEFAULT 'monthly'",
    )
    .ok();
    conn.execute_batch("ALTER TABLE finance_items ADD COLUMN due_day INTEGER DEFAULT NULL")
        .ok();
    conn.execute_batch("ALTER TABLE finance_items ADD COLUMN due_date TEXT DEFAULT NULL")
        .ok();

    // Migration (v1.3.20): per-command shell selector for Exec tab.
    // 'host'  → cmd /c (Win) or sh -c (mac/linux)
    // 'wsl'   → wsl.exe [-d distro] -- bash -lc <cmd>  (Windows only)
    conn.execute_batch("ALTER TABLE exec_commands ADD COLUMN shell TEXT NOT NULL DEFAULT 'host'")
        .ok();
    conn.execute_batch("ALTER TABLE exec_commands ADD COLUMN wsl_distro TEXT")
        .ok();

    // Migration (v1.3.30): normalize API-pulled ISO datetime strings to the
    // canonical desktop SQLite format so UI queries and SQL LWW comparisons
    // read `updated_at` / `created_at` consistently.
    queries::normalize_synced_datetime_strings(conn)?;

    // Seed Tasks module defaults on a fresh DB. Idempotent — only inserts
    // when tables are empty, so existing users' custom sets aren't clobbered.
    seed_task_defaults(conn).ok();
    mark_existing_tasks_pending_for_initial_sync(conn).ok();
    seed_finance_defaults(conn).ok();

    Ok(())
}

fn mark_existing_tasks_pending_for_initial_sync(conn: &Connection) -> Result<(), rusqlite::Error> {
    const COMPUTER_ID: &str = "__global__";
    const MARKER: &str = "tasks_sync_backfill_v1";

    let done: i64 = conn.query_row(
        "SELECT COUNT(*) FROM app_settings WHERE computer_id = ?1 AND setting_key = ?2",
        rusqlite::params![COMPUTER_ID, MARKER],
        |r| r.get(0),
    )?;
    if done > 0 {
        return Ok(());
    }

    for table in [
        "task_categories",
        "task_statuses",
        "tasks",
        "task_checkboxes",
        "task_links",
    ] {
        let sql =
            format!("UPDATE {table} SET sync_status = 'pending' WHERE sync_status != 'deleted'");
        conn.execute(&sql, [])?;
    }

    conn.execute(
        "INSERT OR REPLACE INTO app_settings (computer_id, setting_key, setting_value)
         VALUES (?1, ?2, '1')",
        rusqlite::params![COMPUTER_ID, MARKER],
    )?;

    Ok(())
}

fn seed_task_defaults(conn: &Connection) -> Result<(), rusqlite::Error> {
    use chrono::Utc;
    // Same format as queries.rs `now_str()` so parse_dt round-trips cleanly.
    let now = Utc::now()
        .naive_utc()
        .format("%Y-%m-%d %H:%M:%S%.f")
        .to_string();

    let cat_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM task_categories", [], |r| r.get(0))?;
    if cat_count == 0 {
        let defaults = [("Work", "#388bfd", 0_i64), ("Home", "#3fb950", 1)];
        for (name, color, ord) in defaults {
            conn.execute(
                "INSERT INTO task_categories (name, color, sort_order, created_at, updated_at, uuid, sync_status, user_id)
                 VALUES (?1, ?2, ?3, ?4, ?4, ?5, 'pending', '')",
                rusqlite::params![name, color, ord, &now, uuid::Uuid::new_v4().to_string()],
            )?;
        }
    }

    let st_count: i64 = conn.query_row("SELECT COUNT(*) FROM task_statuses", [], |r| r.get(0))?;
    if st_count == 0 {
        let defaults = [
            ("Open", "#8b949e", 0_i64),
            ("In progress", "#d29922", 1),
            ("Blocked", "#f85149", 2),
            ("Done", "#3fb950", 3),
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

fn seed_finance_defaults(conn: &Connection) -> Result<(), rusqlite::Error> {
    use chrono::Utc;
    let now = Utc::now()
        .naive_utc()
        .format("%Y-%m-%d %H:%M:%S%.f")
        .to_string();

    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM finance_plans WHERE sync_status != 'deleted'",
        [],
        |r| r.get(0),
    )?;
    if count == 0 {
        conn.execute(
            "INSERT INTO finance_plans
                (name, currency, kind, sort_order, created_at, updated_at, uuid, sync_status, user_id)
             VALUES ('Regular payments', 'RUB', 'monthly', 0, ?1, ?1, ?2, 'pending', '')",
            rusqlite::params![&now, uuid::Uuid::new_v4().to_string()],
        )?;
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
            "clickhouse_doc_changes",
            "clickhouse_doc_pages",
            "clickhouse_doc_sections",
            "clickhouse_doc_update_runs",
            "commit_history",
            "commit_tags",
            "exec_categories",
            "exec_commands",
            "finance_payments",
            "finance_items",
            "finance_plans",
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
            "whisper_history",
            "whisper_models",
        ];

        for table_name in &expected {
            assert!(
                tables.contains(&table_name.to_string()),
                "Missing table: {}",
                table_name
            );
        }
        assert_eq!(
            tables.len(),
            expected.len(),
            "Unexpected extra tables: {:?}",
            tables
        );
    }

    #[test]
    fn whisper_history_index_created() {
        let conn = init_test_db();
        let indexes: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='whisper_history'",
            )
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(
            indexes.iter().any(|n| n == "idx_whisper_history_created"),
            "indexes on whisper_history: {:?}",
            indexes,
        );
    }

    #[test]
    fn whisper_provider_migration_backfills_existing_history() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE whisper_history (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                text            TEXT NOT NULL,
                text_raw        TEXT,
                model_name      TEXT NOT NULL,
                duration_ms     INTEGER NOT NULL,
                transcribe_ms   INTEGER NOT NULL,
                language        TEXT,
                injected_to     TEXT,
                created_at      INTEGER NOT NULL
            );

            INSERT INTO whisper_history
                (text, text_raw, model_name, duration_ms, transcribe_ms, language, injected_to, created_at)
            VALUES
                ('hello', NULL, 'ggml-small', 1000, 200, 'en', 'paste', 1710000000);
            ",
        )
        .unwrap();

        run_migrations(&conn).unwrap();

        let rows = queries::whisper_list_history(&conn, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].provider, "local");
        assert_eq!(rows[0].provider_model.as_deref(), Some("ggml-small"));
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

    #[test]
    fn test_finance_default_plan_seeded_once() {
        let conn = init_test_db();
        run_migrations(&conn).unwrap();
        let plans: Vec<(String, String, String)> = conn
            .prepare("SELECT name, currency, kind FROM finance_plans WHERE sync_status != 'deleted' ORDER BY sort_order")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(
            plans,
            vec![(
                "Regular payments".to_string(),
                "RUB".to_string(),
                "monthly".to_string()
            )]
        );
    }

    #[test]
    fn test_task_sync_backfill_marks_existing_rows_pending_once() {
        let conn = init_test_db();

        conn.execute(
            "DELETE FROM app_settings WHERE computer_id = '__global__' AND setting_key = 'tasks_sync_backfill_v1'",
            [],
        )
        .unwrap();
        conn.execute("UPDATE task_categories SET sync_status = 'synced'", [])
            .unwrap();
        conn.execute("UPDATE task_statuses SET sync_status = 'synced'", [])
            .unwrap();

        run_migrations(&conn).unwrap();

        let pending_categories: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_categories WHERE sync_status = 'pending'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let pending_statuses: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_statuses WHERE sync_status = 'pending'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pending_categories, 2);
        assert_eq!(pending_statuses, 4);

        conn.execute("UPDATE task_categories SET sync_status = 'synced'", [])
            .unwrap();
        run_migrations(&conn).unwrap();
        let pending_after_marker: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_categories WHERE sync_status = 'pending'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pending_after_marker, 0);
    }
}
