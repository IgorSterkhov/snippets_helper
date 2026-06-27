import SQLite from 'react-native-sqlite-storage';
import { setLastSyncAt } from './syncMetaRepo';

SQLite.enablePromise(true);

let db = null;
const TASKS_INITIAL_SYNC_BACKFILL_KEY = 'tasks_initial_sync_backfill_v3';
const PINNED_SNIPPETS_SYNC_BACKFILL_KEY = 'pinned_snippets_sync_backfill_v1';
const FINANCE_SYNC_ENABLED_BACKFILL_KEY = 'finance_sync_enabled_backfill_v2';
const FINANCE_SYNC_CURSOR_REPAIR_BACKFILL_KEY = 'finance_sync_cursor_repair_backfill_v1';
const FINANCE_FACTS_SYNC_BACKFILL_KEY = 'finance_facts_sync_backfill_v1';
const FINANCE_FACTS_SYNC_REPAIR_BACKFILL_KEY = 'finance_facts_sync_repair_backfill_v2';

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
  let needsPinnedBackfill = false;

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

  const hasShortcutPinned = await columnExists(db, 'shortcuts', 'is_pinned');
  if (!hasShortcutPinned) {
    await new Promise((resolve) => {
      db.transaction(
        (tx) => { tx.executeSql('ALTER TABLE shortcuts ADD COLUMN is_pinned INTEGER DEFAULT 0'); },
        () => resolve(),
        () => resolve(),
      );
    });
    needsPinnedBackfill = true;
  }

  const hasShortcutPinnedOrder = await columnExists(db, 'shortcuts', 'pinned_sort_order');
  if (!hasShortcutPinnedOrder) {
    await new Promise((resolve) => {
      db.transaction(
        (tx) => { tx.executeSql('ALTER TABLE shortcuts ADD COLUMN pinned_sort_order INTEGER DEFAULT 0'); },
        () => resolve(),
        () => resolve(),
      );
    });
    needsPinnedBackfill = true;
  }

  const hasNotePinnedOrder = await columnExists(db, 'notes', 'pinned_sort_order');
  if (!hasNotePinnedOrder) {
    await new Promise((resolve) => {
      db.transaction(
        (tx) => { tx.executeSql('ALTER TABLE notes ADD COLUMN pinned_sort_order INTEGER DEFAULT 0'); },
        () => resolve(),
        () => resolve(),
      );
    });
    needsPinnedBackfill = true;
  }

  const hasPinnedBackfill = await syncMetaKeyExists(db, PINNED_SNIPPETS_SYNC_BACKFILL_KEY);
  if (needsPinnedBackfill || !hasPinnedBackfill) {
    // Existing installs need one full pull so synced pin/order fields are
    // fetched for snippets and notes even if their content is otherwise older.
    await setLastSyncAt(null).catch(() => {});
    await setSyncMetaValue(PINNED_SNIPPETS_SYNC_BACKFILL_KEY, new Date().toISOString()).catch(() => {});
  }

  const hasTaskBackfill = await syncMetaKeyExists(db, TASKS_INITIAL_SYNC_BACKFILL_KEY);
  if (!hasTaskBackfill) {
    // Existing installs can have Tasks tables from OTA 1.0.6 but an old
    // last_sync_at. Force one full pull so server tasks are backfilled.
    await setLastSyncAt(null).catch(() => {});
    await setSyncMetaValue(TASKS_INITIAL_SYNC_BACKFILL_KEY, new Date().toISOString()).catch(() => {});
  }

  const hasFinanceBackfill = await syncMetaKeyExists(db, FINANCE_SYNC_ENABLED_BACKFILL_KEY);
  if (!hasFinanceBackfill) {
    // Finance sync was added after the mobile sync cursor already existed.
    // Force one full pull so existing server Finance rows are fetched.
    await setLastSyncAt(null).catch(() => {});
    await setSyncMetaValue(FINANCE_SYNC_ENABLED_BACKFILL_KEY, new Date().toISOString()).catch(() => {});
  }

  const hasFinanceCursorRepairBackfill = await syncMetaKeyExists(db, FINANCE_SYNC_CURSOR_REPAIR_BACKFILL_KEY);
  if (!hasFinanceCursorRepairBackfill) {
    // Server-side Finance rows could previously keep old client updated_at
    // values while mobile advanced last_sync_at to server_time. Force one full
    // pull after the cursor repair so already-skipped Finance rows are fetched.
    await setLastSyncAt(null).catch(() => {});
    await setSyncMetaValue(FINANCE_SYNC_CURSOR_REPAIR_BACKFILL_KEY, new Date().toISOString()).catch(() => {});
  }

  const hasFinanceFactsBackfill = await syncMetaKeyExists(db, FINANCE_FACTS_SYNC_BACKFILL_KEY);
  if (!hasFinanceFactsBackfill) {
    // Finance facts/rules/allocations were added after Finance lists. Force a
    // full pull so desktop-imported facts are visible on existing installs.
    await setLastSyncAt(null).catch(() => {});
    await setSyncMetaValue(FINANCE_FACTS_SYNC_BACKFILL_KEY, new Date().toISOString()).catch(() => {});
  }

  const hasFinanceFactsRepairBackfill = await syncMetaKeyExists(db, FINANCE_FACTS_SYNC_REPAIR_BACKFILL_KEY);
  if (!hasFinanceFactsRepairBackfill) {
    // OTA 1.0.29 could mark the Finance facts backfill before the sync cursor
    // loop was fixed. Force one more full pull for already-updated devices.
    await setLastSyncAt(null).catch(() => {});
    await setSyncMetaValue(FINANCE_FACTS_SYNC_REPAIR_BACKFILL_KEY, new Date().toISOString()).catch(() => {});
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
        is_pinned INTEGER DEFAULT 0,
        pinned_sort_order INTEGER DEFAULT 0,
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
        pinned_sort_order INTEGER DEFAULT 0,
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
      CREATE TABLE IF NOT EXISTS finance_plans (
        uuid TEXT PRIMARY KEY,
        id INTEGER,
        name TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'RUB',
        kind TEXT NOT NULL DEFAULT 'monthly',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS finance_items (
        uuid TEXT PRIMARY KEY,
        id INTEGER,
        plan_id INTEGER,
        plan_uuid TEXT NOT NULL,
        parent_id INTEGER,
        parent_uuid TEXT,
        name TEXT NOT NULL DEFAULT '',
        amount_cents INTEGER NOT NULL DEFAULT 0,
        due_day INTEGER,
        due_date TEXT,
        note TEXT NOT NULL DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS finance_transactions (
        uuid TEXT PRIMARY KEY,
        id INTEGER,
        source TEXT NOT NULL DEFAULT 'tbank_csv',
        source_fingerprint TEXT NOT NULL DEFAULT '',
        import_batch_id INTEGER,
        import_batch_uuid TEXT,
        operation_at TEXT NOT NULL DEFAULT '',
        payment_date TEXT NOT NULL DEFAULT '',
        card_mask TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        amount_cents INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'RUB',
        operation_amount_cents INTEGER NOT NULL DEFAULT 0,
        operation_currency TEXT NOT NULL DEFAULT 'RUB',
        payment_amount_cents INTEGER NOT NULL DEFAULT 0,
        payment_currency TEXT NOT NULL DEFAULT 'RUB',
        cashback_cents INTEGER,
        bank_category TEXT NOT NULL DEFAULT '',
        mcc TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        bonuses_cents INTEGER,
        invest_rounding_cents INTEGER,
        rounded_amount_cents INTEGER,
        raw_json TEXT NOT NULL DEFAULT '{}',
        rules_locked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS finance_mapping_rules (
        uuid TEXT PRIMARY KEY,
        id INTEGER,
        name TEXT NOT NULL DEFAULT '',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0,
        match_mode TEXT NOT NULL DEFAULT 'all',
        conditions_json TEXT NOT NULL DEFAULT '[]',
        target_plan_id INTEGER,
        target_plan_uuid TEXT NOT NULL,
        target_item_id INTEGER,
        target_item_uuid TEXT,
        created_at TEXT,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS finance_transaction_allocations (
        uuid TEXT PRIMARY KEY,
        id INTEGER,
        transaction_id INTEGER,
        transaction_uuid TEXT NOT NULL,
        plan_id INTEGER,
        plan_uuid TEXT NOT NULL,
        item_id INTEGER,
        item_uuid TEXT,
        assigned_by TEXT NOT NULL DEFAULT 'manual',
        rule_id INTEGER,
        rule_uuid TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql('CREATE INDEX IF NOT EXISTS idx_mobile_finance_transactions_payment_date ON finance_transactions(payment_date, operation_at)');
    tx.executeSql('CREATE INDEX IF NOT EXISTS idx_mobile_finance_transactions_source_fingerprint ON finance_transactions(source, source_fingerprint)');
    tx.executeSql('CREATE INDEX IF NOT EXISTS idx_mobile_finance_allocations_transaction ON finance_transaction_allocations(transaction_uuid, is_active)');
    tx.executeSql('CREATE INDEX IF NOT EXISTS idx_mobile_finance_allocations_plan_item ON finance_transaction_allocations(plan_uuid, item_uuid)');
    tx.executeSql('CREATE INDEX IF NOT EXISTS idx_mobile_finance_mapping_rules_sort ON finance_mapping_rules(is_enabled, priority)');

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
