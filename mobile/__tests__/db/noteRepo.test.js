import { getAllFolders, upsertFolder, getNotesByFolder, getAllNotes, searchNotes, upsertNote, getModifiedNotesSince, getModifiedFoldersSince } from '../../src/db/noteRepo';
import { getDB } from '../../src/db/database';

jest.mock('../../src/db/database');

describe('noteRepo', () => {
  const mockExecuteSql = jest.fn();
  const mockTx = { executeSql: mockExecuteSql };

  beforeEach(() => {
    jest.clearAllMocks();
    getDB.mockReturnValue({
      transaction: jest.fn((cb) => cb(mockTx)),
    });
  });

  test('getAllFolders selects non-deleted ordered by sort_order', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 0, item: () => ({}) } });
    });
    const result = await getAllFolders();
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('is_deleted = 0'),
      expect.anything(),
      expect.any(Function),
      expect.any(Function),
    );
    expect(result).toEqual([]);
  });

  test('getNotesByFolder filters by folder_uuid', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 0, item: () => ({}) } });
    });
    await getNotesByFolder('folder-uuid-1');
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('folder_uuid = ?'),
      expect.arrayContaining(['folder-uuid-1']),
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('upsertNote calls INSERT OR REPLACE', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      if (success) success(mockTx, { rows: { length: 0 } });
    });
    await upsertNote({ uuid: 'n1', folder_uuid: 'f1', title: 'Test', content: 'body', created_at: '2026-01-01', updated_at: '2026-01-01', is_pinned: 0, is_deleted: 0 });
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE'),
      expect.arrayContaining(['n1', 'f1', 'Test']),
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('searchNotes filters by LIKE on title and content', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 0, item: () => ({}) } });
    });
    await searchNotes('test');
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('LIKE'),
      expect.arrayContaining(['%test%']),
      expect.any(Function),
      expect.any(Function),
    );
  });
});
