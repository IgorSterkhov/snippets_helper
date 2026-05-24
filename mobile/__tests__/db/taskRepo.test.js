import {
  buildUpsertTask,
  buildUpsertTaskCategory,
  buildUpsertTaskStatus,
  buildUpsertTaskCheckbox,
  buildUpsertTaskLink,
  flattenCheckboxTree,
} from '../../src/db/taskRepo';

describe('taskRepo', () => {
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
});
