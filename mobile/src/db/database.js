import SQLite from 'react-native-sqlite-storage';
import { setLastSyncAt } from './syncMetaRepo';

SQLite.enablePromise(true);

let db = null;

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
      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
  });

  await runMigrations();

  return db;
}
