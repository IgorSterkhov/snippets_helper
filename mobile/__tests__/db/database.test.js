import { getDB, initDB } from '../../src/db/database';

jest.mock('react-native-sqlite-storage', () => {
  const executeSql = jest.fn((sql, params, success) => {
    if (success) success({}, { rows: { length: 0, item: () => ({}) } });
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
  };
});

describe('database', () => {
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
  });

  test('getDB returns null before init', () => {
    jest.resetModules();
    const { getDB: freshGetDB } = require('../../src/db/database');
    expect(freshGetDB()).toBeNull();
  });
});
