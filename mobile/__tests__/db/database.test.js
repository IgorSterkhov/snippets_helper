import { getDB, initDB } from '../../src/db/database';

jest.mock('react-native-sqlite-storage', () => {
  const mockState = {
    syncMetaKeys: new Set(),
    tableColumns: {
      note_folders: new Set(['id']),
      shortcuts: new Set(['is_pinned', 'pinned_sort_order']),
      notes: new Set(['pinned_sort_order']),
    },
  };

  const makeRows = (items = []) => ({
    length: items.length,
    item: (index) => items[index],
  });

  const executeSql = jest.fn((sql, params, success) => {
    let rows = makeRows();
    const text = String(sql);

    const tableInfoMatch = text.match(/^PRAGMA table_info\(([^)]+)\)/);
    if (tableInfoMatch) {
      const columns = mockState.tableColumns[tableInfoMatch[1]] || new Set();
      rows = makeRows([...columns].map(name => ({ name })));
    }

    if (text === 'SELECT value FROM sync_meta WHERE key = ?') {
      const key = params[0];
      rows = mockState.syncMetaKeys.has(key) ? makeRows([{ value: 'done' }]) : makeRows();
    }

    if (success) success({}, { rows });
  });
  return {
    openDatabase: jest.fn(() => ({
      transaction: jest.fn((callback, error, success) => {
        callback({ executeSql });
        if (success) success();
      }),
      executeSql,
    })),
    enablePromise: jest.fn(),
    __mockState: mockState,
    __mockExecuteSql: executeSql,
  };
});

describe('database', () => {
  beforeEach(() => {
    const SQLite = require('react-native-sqlite-storage');
    jest.clearAllMocks();
    SQLite.__mockState.syncMetaKeys = new Set();
    SQLite.__mockState.tableColumns = {
      note_folders: new Set(['id']),
      shortcuts: new Set(['is_pinned', 'pinned_sort_order']),
      notes: new Set(['pinned_sort_order']),
    };
  });

  test('initDB opens database and creates tables', async () => {
    const SQLite = require('react-native-sqlite-storage');
    await initDB();
    const db = getDB();
    expect(db).toBeDefined();
    expect(SQLite.openDatabase).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'snippets_helper.db' })
    );
    expect(db.transaction).toHaveBeenCalled();

    const calls = db.executeSql.mock.calls;
    const sql = calls.map((c) => c[0]).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS task_categories');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS task_statuses');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS tasks');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS task_checkboxes');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS task_links');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS finance_plans');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS finance_items');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS finance_transactions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS finance_mapping_rules');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS finance_transaction_allocations');
  });

  test('initDB resets sync cursor when task backfill marker is missing', async () => {
    const SQLite = require('react-native-sqlite-storage');

    await initDB();

    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['last_sync_at', null],
      expect.any(Function),
      expect.any(Function),
    );
    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['tasks_initial_sync_backfill_v3', expect.any(String)],
      expect.any(Function),
      expect.any(Function),
    );
    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['finance_sync_enabled_backfill_v2', expect.any(String)],
      expect.any(Function),
      expect.any(Function),
    );
    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['finance_sync_cursor_repair_backfill_v1', expect.any(String)],
      expect.any(Function),
      expect.any(Function),
    );
    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['finance_facts_sync_backfill_v1', expect.any(String)],
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('initDB keeps sync cursor when task backfill marker exists', async () => {
    const SQLite = require('react-native-sqlite-storage');
    SQLite.__mockState.syncMetaKeys = new Set([
      'tasks_initial_sync_backfill_v3',
      'pinned_snippets_sync_backfill_v1',
      'finance_sync_enabled_backfill_v2',
      'finance_sync_cursor_repair_backfill_v1',
      'finance_facts_sync_backfill_v1',
      'finance_facts_sync_repair_backfill_v2',
    ]);

    await initDB();

    expect(SQLite.__mockExecuteSql).not.toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['last_sync_at', null],
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('initDB resets sync cursor when finance facts repair marker is missing', async () => {
    const SQLite = require('react-native-sqlite-storage');
    SQLite.__mockState.syncMetaKeys = new Set([
      'tasks_initial_sync_backfill_v3',
      'pinned_snippets_sync_backfill_v1',
      'finance_sync_enabled_backfill_v2',
      'finance_sync_cursor_repair_backfill_v1',
      'finance_facts_sync_backfill_v1',
    ]);

    await initDB();

    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['last_sync_at', null],
      expect.any(Function),
      expect.any(Function),
    );
    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['finance_facts_sync_repair_backfill_v2', expect.any(String)],
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('initDB resets sync cursor when pinned snippets backfill marker is missing', async () => {
    const SQLite = require('react-native-sqlite-storage');
    SQLite.__mockState.syncMetaKeys = new Set([
      'tasks_initial_sync_backfill_v3',
      'finance_sync_enabled_backfill_v2',
      'finance_sync_cursor_repair_backfill_v1',
      'finance_facts_sync_backfill_v1',
      'finance_facts_sync_repair_backfill_v2',
    ]);

    await initDB();

    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['last_sync_at', null],
      expect.any(Function),
      expect.any(Function),
    );
    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['pinned_snippets_sync_backfill_v1', expect.any(String)],
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('initDB adds pinned snippet and note columns for old databases', async () => {
    const SQLite = require('react-native-sqlite-storage');
    SQLite.__mockState.syncMetaKeys = new Set([
      'tasks_initial_sync_backfill_v3',
      'finance_sync_enabled_backfill_v2',
      'finance_sync_cursor_repair_backfill_v1',
      'finance_facts_sync_backfill_v1',
      'finance_facts_sync_repair_backfill_v2',
    ]);
    SQLite.__mockState.tableColumns = {
      note_folders: new Set(['id']),
      shortcuts: new Set(),
      notes: new Set(),
    };

    await initDB();

    const sql = SQLite.__mockExecuteSql.mock.calls.map(call => call[0]);
    expect(sql).toContain('ALTER TABLE shortcuts ADD COLUMN is_pinned INTEGER DEFAULT 0');
    expect(sql).toContain('ALTER TABLE shortcuts ADD COLUMN pinned_sort_order INTEGER DEFAULT 0');
    expect(sql).toContain('ALTER TABLE notes ADD COLUMN pinned_sort_order INTEGER DEFAULT 0');
  });

  test('initDB resets sync cursor when only the old task backfill marker exists', async () => {
    const SQLite = require('react-native-sqlite-storage');
    SQLite.__mockState.syncMetaKeys = new Set(['tasks_initial_sync_backfill_v2']);

    await initDB();

    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['last_sync_at', null],
      expect.any(Function),
      expect.any(Function),
    );
    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['tasks_initial_sync_backfill_v3', expect.any(String)],
      expect.any(Function),
      expect.any(Function),
    );
    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['finance_sync_enabled_backfill_v2', expect.any(String)],
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('initDB resets sync cursor when finance cursor repair marker is missing', async () => {
    const SQLite = require('react-native-sqlite-storage');
    SQLite.__mockState.syncMetaKeys = new Set([
      'tasks_initial_sync_backfill_v3',
      'pinned_snippets_sync_backfill_v1',
      'finance_sync_enabled_backfill_v2',
    ]);

    await initDB();

    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['last_sync_at', null],
      expect.any(Function),
      expect.any(Function),
    );
    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['finance_sync_cursor_repair_backfill_v1', expect.any(String)],
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('initDB resets sync cursor when finance facts marker is missing', async () => {
    const SQLite = require('react-native-sqlite-storage');
    SQLite.__mockState.syncMetaKeys = new Set([
      'tasks_initial_sync_backfill_v3',
      'pinned_snippets_sync_backfill_v1',
      'finance_sync_enabled_backfill_v2',
      'finance_sync_cursor_repair_backfill_v1',
    ]);

    await initDB();

    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['last_sync_at', null],
      expect.any(Function),
      expect.any(Function),
    );
    expect(SQLite.__mockExecuteSql).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      ['finance_facts_sync_backfill_v1', expect.any(String)],
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('getDB returns null before init', () => {
    jest.resetModules();
    const { getDB: freshGetDB } = require('../../src/db/database');
    expect(freshGetDB()).toBeNull();
  });
});
