import SQLite from 'react-native-sqlite-storage';
import { setLastSyncAt } from './syncMetaRepo';

SQLite.enablePromise(true);

let db = null;
const TASKS_INITIAL_SYNC_BACKFILL_KEY = 'tasks_initial_sync_backfill_v1';

export function getDB() {
  return db;
}

function exec(tx, sql, params = []) {
  return new Promise((resolve, reject) => {
    tx.executeSql(sql, params, (_, result) => resolve(result), (_, err) => reject(err));
  });
}

async function columnExists(db, table, column) {
  return new Promise((resolve) => {
    db.transaction((tx) => {
      tx.executeSql(
        `PRAGMA table_info(${table})`,
        [],
        (_, result) => {
          for (let i = 0; i < result.rows.length; i++) {
            if (result.rows.item(i).name === column) return resolve(true);
          }
          resolve(false);
        },
        () => resolve(false),
      );
    });
  });
}

async function syncMetaKeyExists(db, key) {
  return new Promise((resolve) => {
    db.transaction((tx) => {
      tx.executeSql(
        'SELECT value FROM sync_meta WHERE key = ?',
        [key],
        (_, result) => resolve(result.rows.length > 0),
        () => resolve(false),
      );
    });
  });
}

async function setSyncMetaValue(key, value) {
  return new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
        [key, value],
        () => resolve(),
        (_, error) => reject(error),
      );
    });
  });
}

async function runMigrations() {
  // Migration: note_folders needs integer `id` to resolve parent_id (int) hierarchy
  const hasId = await columnExists(db, 'note_folders', 'id');
  if (!hasId) {
    await new Promise((resolve) => {
      db.transaction(
        (tx) => { tx.executeSql('ALTER TABLE note_folders ADD COLUMN id INTEGER'); },
        () => resolve(),
        () => resolve(),
      );
    });
    // Trigger full re-sync so that `id` fields are pulled from the server.
    await setLastSyncAt(null).catch(() => {});
  }

  const hasTaskBackfill = await syncMetaKeyExists(db, TASKS_INITIAL_SYNC_BACKFILL_KEY);
  if (!hasTaskBackfill) {
    // Existing installs can have Tasks tables from OTA 1.0.6 but an old
    // last_sync_at. Force one full pull so server tasks are backfilled.
    await setLastSyncAt(null).catch(() => {});
    await setSyncMetaValue(TASKS_INITIAL_SYNC_BACKFILL_KEY, new Date().toISOString()).catch(() => {});
  }
}

export async function initDB() {
  db = await SQLite.openDatabase({ name: 'snippets_helper.db', location: 'default' });

  await db.transaction((tx) => {
    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS shortcuts (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        description TEXT,
        links TEXT DEFAULT '[]',
        obsidian_note TEXT DEFAULT '',
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS snippet_tags (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        patterns TEXT NOT NULL DEFAULT '[]',
        color TEXT NOT NULL DEFAULT '#388bfd',
        sort_order INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS note_folders (
        uuid TEXT PRIMARY KEY,
        id INTEGER,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        parent_id INTEGER,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS notes (
        uuid TEXT PRIMARY KEY,
        folder_uuid TEXT,
        title TEXT NOT NULL,
        content TEXT,
        created_at TEXT,
        updated_at TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS task_categories (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#8b949e',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS task_statuses (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#8b949e',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS tasks (
        uuid TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category_uuid TEXT,
        status_uuid TEXT,
        is_pinned INTEGER DEFAULT 0,
        bg_color TEXT,
        tracker_url TEXT,
        notes_md TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS task_checkboxes (
        uuid TEXT PRIMARY KEY,
        task_uuid TEXT NOT NULL,
        parent_uuid TEXT,
        text TEXT NOT NULL DEFAULT '',
        is_checked INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS task_links (
        uuid TEXT PRIMARY KEY,
        task_uuid TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '',
        label TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
  });

  await runMigrations();

  return db;
}
