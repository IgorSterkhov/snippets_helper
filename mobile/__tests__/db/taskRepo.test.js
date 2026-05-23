import {
  buildUpsertTask,
  buildUpsertTaskCategory,
  buildUpsertTaskStatus,
  buildUpsertTaskCheckbox,
  buildUpsertTaskLink,
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
});
