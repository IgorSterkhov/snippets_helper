import { getAllSnippets, upsertSnippet, searchSnippets, getAllTags, upsertTag, getModifiedSnippetsSince, getModifiedTagsSince } from '../../src/db/snippetRepo';
import { getDB } from '../../src/db/database';

jest.mock('../../src/db/database');

describe('snippetRepo', () => {
  const mockExecuteSql = jest.fn();
  const mockTx = { executeSql: mockExecuteSql };

  beforeEach(() => {
    jest.clearAllMocks();
    getDB.mockReturnValue({
      transaction: jest.fn((cb) => cb(mockTx)),
    });
  });

  test('getAllSnippets selects non-deleted ordered by name', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 0, item: () => ({}) } });
    });
    const result = await getAllSnippets();
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('is_deleted = 0'),
      expect.anything(),
      expect.any(Function),
      expect.any(Function),
    );
    expect(result).toEqual([]);
  });

  test('upsertSnippet calls INSERT OR REPLACE', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      if (success) success(mockTx, { rows: { length: 0 } });
    });
    await upsertSnippet({ uuid: 'abc', name: 'test', value: 'val', description: '', links: '[]', obsidian_note: '', updated_at: '2026-01-01', is_deleted: 0 });
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE'),
      expect.arrayContaining(['abc', 'test', 'val']),
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('searchSnippets filters by LIKE', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 0, item: () => ({}) } });
    });
    await searchSnippets('hello');
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('LIKE'),
      expect.arrayContaining(['%hello%']),
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('getAllTags selects non-deleted ordered by sort_order', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 0, item: () => ({}) } });
    });
    await getAllTags();
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('snippet_tags'),
      expect.anything(),
      expect.any(Function),
      expect.any(Function),
    );
  });
});
