import {
  getLastSyncAt,
  getLastSyncDebug,
  setLastSyncAt,
  setLastSyncDebug,
} from '../../src/db/syncMetaRepo';
import { getDB } from '../../src/db/database';

jest.mock('../../src/db/database');

describe('syncMetaRepo', () => {
  const mockExecuteSql = jest.fn();
  const mockTx = { executeSql: mockExecuteSql };

  beforeEach(() => {
    jest.clearAllMocks();
    getDB.mockReturnValue({
      transaction: jest.fn((cb) => cb(mockTx)),
    });
  });

  test('getLastSyncAt returns null when no record', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 0, item: () => ({}) } });
    });
    const result = await getLastSyncAt();
    expect(result).toBeNull();
  });

  test('getLastSyncAt returns stored timestamp', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 1, item: () => ({ value: '2026-01-01T00:00:00' }) } });
    });
    const result = await getLastSyncAt();
    expect(result).toBe('2026-01-01T00:00:00');
  });

  test('setLastSyncAt stores timestamp', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      if (success) success(mockTx, { rows: { length: 0 } });
    });
    await setLastSyncAt('2026-01-01T00:00:00');
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE'),
      expect.arrayContaining(['last_sync_at', '2026-01-01T00:00:00']),
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('setLastSyncDebug stores JSON diagnostics', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      if (success) success(mockTx, { rows: { length: 0 } });
    });

    await setLastSyncDebug({ status: 'ok', pulled_counts: { finance_transactions: 2 } });

    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE'),
      [
        'last_sync_debug',
        JSON.stringify({ status: 'ok', pulled_counts: { finance_transactions: 2 } }),
      ],
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('getLastSyncDebug parses stored diagnostics', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, {
        rows: {
          length: 1,
          item: () => ({ value: '{"status":"warning","rejected_uuids":{"finance_transactions":["tx-1"]}}' }),
        },
      });
    });

    const result = await getLastSyncDebug();

    expect(result).toEqual({
      status: 'warning',
      rejected_uuids: { finance_transactions: ['tx-1'] },
    });
  });
});
