import {
  buildUpsertTask,
  buildUpsertTaskCategory,
  buildUpsertTaskStatus,
  buildUpsertTaskCheckbox,
  buildUpsertTaskLink,
  flattenCheckboxTree,
  getCheckboxMoveAvailability,
  moveCheckboxInTree,
  setTaskCheckboxChecked,
} from '../../src/db/taskRepo';
import { getDB } from '../../src/db/database';

jest.mock('../../src/db/database');

describe('taskRepo', () => {
  const mockExecuteSql = jest.fn();
  const mockTx = { executeSql: mockExecuteSql };

  beforeEach(() => {
    jest.clearAllMocks();
    getDB.mockReturnValue({
      transaction: jest.fn((cb) => cb(mockTx)),
    });
    mockExecuteSql.mockImplementation((sql, params, success) => {
      if (success) success(mockTx, { rows: { length: 0, item: () => ({}) } });
    });
  });

  test('buildUpsertTask writes UUID relationships', () => {
    const { sql, params } = buildUpsertTask({
      uuid: 'task-1',
      title: 'Task',
      category_uuid: 'cat-1',
      status_uuid: 'status-1',
      updated_at: '2026-05-23T10:00:00',
      is_deleted: false,
    });

    expect(sql).toContain('category_uuid');
    expect(sql).toContain('status_uuid');
    expect(params).toContain('cat-1');
    expect(params).toContain('status-1');
  });

  test('buildUpsertTaskCheckbox writes task and parent UUIDs', () => {
    const { sql, params } = buildUpsertTaskCheckbox({
      uuid: 'cb-1',
      task_uuid: 'task-1',
      parent_uuid: 'cb-parent',
      text: 'Check',
      updated_at: '2026-05-23T10:00:00',
    });

    expect(sql).toContain('task_uuid');
    expect(sql).toContain('parent_uuid');
    expect(params).toContain('task-1');
    expect(params).toContain('cb-parent');
  });

  test('setTaskCheckboxChecked persists checked state immediately', async () => {
    const updated = await setTaskCheckboxChecked({
      uuid: 'cb-1',
      task_uuid: 'task-1',
      parent_uuid: null,
      text: 'Check',
      is_checked: 0,
      sort_order: 0,
      created_at: '2026-05-23T10:00:00',
      updated_at: '2026-05-23T10:00:00',
      is_deleted: 0,
    }, true);

    expect(updated).toEqual(expect.objectContaining({
      uuid: 'cb-1',
      is_checked: 1,
      updated_at: expect.any(String),
    }));
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO task_checkboxes'),
      expect.arrayContaining(['cb-1', 'task-1', 1]),
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('category and status builders write sync fields', () => {
    expect(buildUpsertTaskCategory({
      uuid: 'cat-1',
      name: 'Work',
      updated_at: '2026-05-23T10:00:00',
    }).sql).toContain('task_categories');

    expect(buildUpsertTaskStatus({
      uuid: 'status-1',
      name: 'Open',
      updated_at: '2026-05-23T10:00:00',
    }).sql).toContain('task_statuses');
  });

  test('buildUpsertTaskLink writes task UUID', () => {
    const { sql, params } = buildUpsertTaskLink({
      uuid: 'link-1',
      task_uuid: 'task-1',
      url: 'https://example.test/TASK-1',
      updated_at: '2026-05-23T10:00:00',
    });

    expect(sql).toContain('task_uuid');
    expect(params).toContain('task-1');
  });

  test('flattenCheckboxTree returns depth-first hierarchy with depths', () => {
    const rows = [
      { uuid: 'child-2', parent_uuid: 'root-1', text: 'B', sort_order: 1, is_deleted: 0 },
      { uuid: 'root-2', parent_uuid: null, text: 'Root 2', sort_order: 1, is_deleted: 0 },
      { uuid: 'grandchild-1', parent_uuid: 'child-1', text: 'AA', sort_order: 0, is_deleted: 0 },
      { uuid: 'root-1', parent_uuid: null, text: 'Root 1', sort_order: 0, is_deleted: 0 },
      { uuid: 'child-1', parent_uuid: 'root-1', text: 'A', sort_order: 0, is_deleted: 0 },
    ];

    expect(flattenCheckboxTree(rows).map(({ item, depth }) => [item.uuid, depth])).toEqual([
      ['root-1', 0],
      ['child-1', 1],
      ['grandchild-1', 2],
      ['child-2', 1],
      ['root-2', 0],
    ]);
  });

  test('flattenCheckboxTree renders orphans once at root level', () => {
    const rows = [
      { uuid: 'orphan', parent_uuid: 'missing', text: 'Orphan', sort_order: 1, is_deleted: 0 },
      { uuid: 'root', parent_uuid: null, text: 'Root', sort_order: 0, is_deleted: 0 },
    ];

    expect(flattenCheckboxTree(rows).map(({ item, depth }) => [item.uuid, depth])).toEqual([
      ['root', 0],
      ['orphan', 0],
    ]);
  });

  test('flattenCheckboxTree skips deleted rows and avoids cycles', () => {
    const rows = [
      { uuid: 'deleted', parent_uuid: null, text: 'Deleted', sort_order: 0, is_deleted: 1 },
      { uuid: 'a', parent_uuid: 'b', text: 'A', sort_order: 0, is_deleted: 0 },
      { uuid: 'b', parent_uuid: 'a', text: 'B', sort_order: 0, is_deleted: 0 },
    ];

    expect(flattenCheckboxTree(rows).map(({ item, depth }) => [item.uuid, depth])).toEqual([
      ['a', 0],
      ['b', 0],
    ]);
  });

  test('flattenCheckboxTree hides descendants of collapsed rows', () => {
    const rows = [
      { uuid: 'root', parent_uuid: null, text: 'Root', sort_order: 0, is_deleted: 0 },
      { uuid: 'child', parent_uuid: 'root', text: 'Child', sort_order: 0, is_deleted: 0 },
      { uuid: 'grandchild', parent_uuid: 'child', text: 'Grandchild', sort_order: 0, is_deleted: 0 },
      { uuid: 'sibling', parent_uuid: null, text: 'Sibling', sort_order: 1, is_deleted: 0 },
    ];

    const result = flattenCheckboxTree(rows, { collapsedIds: new Set(['root']) });

    expect(result.map(({ item, depth, hasChildren, hiddenDescendantCount }) => [
      item.uuid,
      depth,
      hasChildren,
      hiddenDescendantCount,
    ])).toEqual([
      ['root', 0, true, 2],
      ['sibling', 0, false, 0],
    ]);
  });

  test('flattenCheckboxTree hides checked leaves when hideDone is enabled', () => {
    const rows = [
      { uuid: 'root', parent_uuid: null, text: 'Root', sort_order: 0, is_checked: 0, is_deleted: 0 },
      { uuid: 'done', parent_uuid: 'root', text: 'Done', sort_order: 0, is_checked: 1, is_deleted: 0 },
      { uuid: 'open', parent_uuid: 'root', text: 'Open', sort_order: 1, is_checked: 0, is_deleted: 0 },
    ];

    expect(flattenCheckboxTree(rows, { hideDone: true }).map(({ item, depth }) => [item.uuid, depth])).toEqual([
      ['root', 0],
      ['open', 1],
    ]);
  });

  test('flattenCheckboxTree keeps checked parent with unchecked descendants when hideDone is enabled', () => {
    const rows = [
      { uuid: 'root', parent_uuid: null, text: 'Root', sort_order: 0, is_checked: 1, is_deleted: 0 },
      { uuid: 'open-child', parent_uuid: 'root', text: 'Open child', sort_order: 0, is_checked: 0, is_deleted: 0 },
      { uuid: 'done-root', parent_uuid: null, text: 'Done root', sort_order: 1, is_checked: 1, is_deleted: 0 },
    ];

    expect(flattenCheckboxTree(rows, { hideDone: true }).map(({ item, depth }) => [item.uuid, depth])).toEqual([
      ['root', 0],
      ['open-child', 1],
    ]);
  });

  test('getCheckboxMoveAvailability exposes possible reorder directions', () => {
    const rows = [
      { uuid: 'root', parent_uuid: null, text: 'Root', sort_order: 0, is_deleted: 0 },
      { uuid: 'a', parent_uuid: 'root', text: 'A', sort_order: 0, is_deleted: 0 },
      { uuid: 'b', parent_uuid: 'root', text: 'B', sort_order: 1, is_deleted: 0 },
      { uuid: 'c', parent_uuid: 'root', text: 'C', sort_order: 2, is_deleted: 0 },
    ];

    expect(getCheckboxMoveAvailability(rows, 'b')).toEqual({
      up: true,
      down: true,
      left: true,
      right: true,
    });
    expect(getCheckboxMoveAvailability(rows, 'a')).toEqual({
      up: false,
      down: true,
      left: true,
      right: false,
    });
    expect(getCheckboxMoveAvailability(rows, 'missing')).toEqual({
      up: false,
      down: false,
      left: false,
      right: false,
    });
  });

  test('moveCheckboxInTree moves a sibling up and keeps its subtree attached', () => {
    const rows = [
      { uuid: 'root', parent_uuid: null, text: 'Root', sort_order: 0, is_deleted: 0 },
      { uuid: 'a', parent_uuid: 'root', text: 'A', sort_order: 0, is_deleted: 0 },
      { uuid: 'b', parent_uuid: 'root', text: 'B', sort_order: 1, is_deleted: 0 },
      { uuid: 'grand', parent_uuid: 'b', text: 'Grand', sort_order: 0, is_deleted: 0 },
      { uuid: 'c', parent_uuid: 'root', text: 'C', sort_order: 2, is_deleted: 0 },
    ];

    const result = moveCheckboxInTree(rows, 'b', 'up', '2026-05-24T12:00:00');

    expect(flattenCheckboxTree(result.items).map(({ item, depth }) => [item.uuid, depth])).toEqual([
      ['root', 0],
      ['b', 1],
      ['grand', 2],
      ['a', 1],
      ['c', 1],
    ]);
    expect(result.changed.map((item) => [item.uuid, item.parent_uuid, item.sort_order, item.updated_at])).toEqual([
      ['a', 'root', 1, '2026-05-24T12:00:00'],
      ['b', 'root', 0, '2026-05-24T12:00:00'],
    ]);
  });

  test('moveCheckboxInTree indents a row under the previous sibling', () => {
    const rows = [
      { uuid: 'root', parent_uuid: null, text: 'Root', sort_order: 0, is_deleted: 0 },
      { uuid: 'a', parent_uuid: 'root', text: 'A', sort_order: 0, is_deleted: 0 },
      { uuid: 'b', parent_uuid: 'root', text: 'B', sort_order: 1, is_deleted: 0 },
      { uuid: 'grand', parent_uuid: 'b', text: 'Grand', sort_order: 0, is_deleted: 0 },
      { uuid: 'c', parent_uuid: 'root', text: 'C', sort_order: 2, is_deleted: 0 },
    ];

    const result = moveCheckboxInTree(rows, 'b', 'right', '2026-05-24T12:01:00');

    expect(result.parentToExpand).toBe('a');
    expect(flattenCheckboxTree(result.items).map(({ item, depth }) => [item.uuid, depth])).toEqual([
      ['root', 0],
      ['a', 1],
      ['b', 2],
      ['grand', 3],
      ['c', 1],
    ]);
    expect(result.changed.map((item) => [item.uuid, item.parent_uuid, item.sort_order, item.updated_at])).toEqual([
      ['b', 'a', 0, '2026-05-24T12:01:00'],
      ['c', 'root', 1, '2026-05-24T12:01:00'],
    ]);
  });

  test('moveCheckboxInTree outdents a row immediately after its parent', () => {
    const rows = [
      { uuid: 'root', parent_uuid: null, text: 'Root', sort_order: 0, is_deleted: 0 },
      { uuid: 'a', parent_uuid: 'root', text: 'A', sort_order: 0, is_deleted: 0 },
      { uuid: 'b', parent_uuid: 'root', text: 'B', sort_order: 1, is_deleted: 0 },
      { uuid: 'grand', parent_uuid: 'b', text: 'Grand', sort_order: 0, is_deleted: 0 },
      { uuid: 'c', parent_uuid: 'root', text: 'C', sort_order: 2, is_deleted: 0 },
    ];

    const result = moveCheckboxInTree(rows, 'grand', 'left', '2026-05-24T12:02:00');

    expect(flattenCheckboxTree(result.items).map(({ item, depth }) => [item.uuid, depth])).toEqual([
      ['root', 0],
      ['a', 1],
      ['b', 1],
      ['grand', 1],
      ['c', 1],
    ]);
    expect(result.changed.map((item) => [item.uuid, item.parent_uuid, item.sort_order, item.updated_at])).toEqual([
      ['grand', 'root', 2, '2026-05-24T12:02:00'],
      ['c', 'root', 3, '2026-05-24T12:02:00'],
    ]);
  });

  test('moveCheckboxInTree leaves impossible boundary moves unchanged', () => {
    const rows = [
      { uuid: 'root', parent_uuid: null, text: 'Root', sort_order: 0, is_deleted: 0 },
      { uuid: 'a', parent_uuid: 'root', text: 'A', sort_order: 0, is_deleted: 0 },
    ];

    expect(moveCheckboxInTree(rows, 'a', 'up', '2026-05-24T12:03:00')).toEqual({
      items: rows,
      changed: [],
      parentToExpand: null,
    });
    expect(moveCheckboxInTree(rows, 'root', 'left', '2026-05-24T12:03:00')).toEqual({
      items: rows,
      changed: [],
      parentToExpand: null,
    });
  });
});
