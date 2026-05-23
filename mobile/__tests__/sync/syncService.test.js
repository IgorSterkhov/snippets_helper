import { performSync } from '../../src/sync/syncService';
import * as endpoints from '../../src/api/endpoints';
import * as snippetRepo from '../../src/db/snippetRepo';
import * as noteRepo from '../../src/db/noteRepo';
import * as taskRepo from '../../src/db/taskRepo';
import * as syncMeta from '../../src/db/syncMetaRepo';
import { getDB } from '../../src/db/database';

jest.mock('../../src/api/endpoints');
jest.mock('../../src/db/snippetRepo');
jest.mock('../../src/db/noteRepo');
jest.mock('../../src/db/taskRepo');
jest.mock('../../src/db/syncMetaRepo');
jest.mock('../../src/db/database', () => ({
  getDB: jest.fn(),
}));

describe('syncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDB.mockReturnValue({
      transaction: jest.fn((callback, error, success) => {
        callback({ executeSql: jest.fn() });
        if (success) success();
      }),
    });
    snippetRepo.buildUpsertSnippet.mockImplementation((row) => ({ sql: 'upsert shortcut', params: [row.uuid] }));
    snippetRepo.buildUpsertTag.mockImplementation((row) => ({ sql: 'upsert tag', params: [row.uuid] }));
    noteRepo.buildUpsertNote.mockImplementation((row) => ({ sql: 'upsert note', params: [row.uuid] }));
    noteRepo.buildUpsertFolder.mockImplementation((row) => ({ sql: 'upsert folder', params: [row.uuid] }));
    taskRepo.buildUpsertTaskCategory.mockImplementation((row) => ({ sql: 'upsert task category', params: [row.uuid] }));
    taskRepo.buildUpsertTaskStatus.mockImplementation((row) => ({ sql: 'upsert task status', params: [row.uuid] }));
    taskRepo.buildUpsertTask.mockImplementation((row) => ({ sql: 'upsert task', params: [row.uuid] }));
    taskRepo.buildUpsertTaskCheckbox.mockImplementation((row) => ({ sql: 'upsert task checkbox', params: [row.uuid] }));
    taskRepo.buildUpsertTaskLink.mockImplementation((row) => ({ sql: 'upsert task link', params: [row.uuid] }));
    taskRepo.getModifiedTaskCategoriesSince.mockResolvedValue([]);
    taskRepo.getModifiedTaskStatusesSince.mockResolvedValue([]);
    taskRepo.getModifiedTasksSince.mockResolvedValue([]);
    taskRepo.getModifiedTaskCheckboxesSince.mockResolvedValue([]);
    taskRepo.getModifiedTaskLinksSince.mockResolvedValue([]);
  });

  test('pull applies server changes to local DB', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue(null);
    endpoints.syncPull.mockResolvedValue({
      changes: {
        shortcuts: [{ uuid: 's1', name: 'test', value: 'val', updated_at: '2026-01-01', is_deleted: false }],
        notes: [],
        note_folders: [],
        snippet_tags: [],
      },
      server_time: '2026-01-01T12:00:00',
    });
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 0, conflicts: [] });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);

    await performSync();

    expect(snippetRepo.buildUpsertSnippet).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 's1', name: 'test' }),
    );
    expect(syncMeta.setLastSyncAt).toHaveBeenCalledWith('2026-01-01T12:00:00');
  });

  test('push sends local changes to server', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue('2026-01-01');
    endpoints.syncPull.mockResolvedValue({ changes: {}, server_time: '2026-01-02' });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([
      { uuid: 's2', name: 'local', value: 'v', updated_at: '2026-01-01T06:00:00', is_deleted: 0 },
    ]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 1, conflicts: [] });

    await performSync();

    expect(endpoints.syncPush).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: expect.arrayContaining([expect.objectContaining({ uuid: 's2' })]),
      }),
    );
  });

  test('sync includes task tables in pull and push', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue('2026-05-23T09:00:00');
    endpoints.syncPull.mockResolvedValue({
      changes: {
        task_categories: [{ uuid: 'cat-1', name: 'Work', updated_at: '2026-05-23T10:00:00', is_deleted: false }],
        task_statuses: [],
        tasks: [{ uuid: 'task-1', title: 'Task', updated_at: '2026-05-23T10:00:00', is_deleted: false }],
        task_checkboxes: [],
        task_links: [],
      },
      server_time: '2026-05-23T10:00:00',
    });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    taskRepo.getModifiedTasksSince.mockResolvedValue([
      { uuid: 'task-local', title: 'Local', updated_at: '2026-05-23T09:30:00' },
    ]);
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 1, conflicts: [] });

    await performSync();

    expect(taskRepo.buildUpsertTaskCategory).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'cat-1' }),
    );
    expect(taskRepo.buildUpsertTask).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'task-1' }),
    );
    expect(endpoints.syncPush).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: expect.arrayContaining([expect.objectContaining({ uuid: 'task-local' })]),
      }),
    );
  });

  test('pull skips task child rows without task_uuid', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue(null);
    endpoints.syncPull.mockResolvedValue({
      changes: {
        tasks: [{ uuid: 'task-1', title: 'Task', updated_at: '2026-05-23T10:00:00', is_deleted: false }],
        task_checkboxes: [
          { uuid: 'checkbox-valid', task_uuid: 'task-1', text: 'valid', updated_at: '2026-05-23T10:00:00' },
          { uuid: 'checkbox-invalid', task_uuid: null, text: 'invalid', updated_at: '2026-05-23T10:00:00' },
        ],
        task_links: [
          { uuid: 'link-valid', task_uuid: 'task-1', url: 'https://example.invalid', updated_at: '2026-05-23T10:00:00' },
          { uuid: 'link-invalid', task_uuid: null, url: 'https://example.invalid', updated_at: '2026-05-23T10:00:00' },
        ],
      },
      server_time: '2026-05-23T10:00:00',
    });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 0, conflicts: [] });

    await performSync();

    expect(taskRepo.buildUpsertTaskCheckbox).toHaveBeenCalledTimes(1);
    expect(taskRepo.buildUpsertTaskCheckbox).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'checkbox-valid' }),
    );
    expect(taskRepo.buildUpsertTaskLink).toHaveBeenCalledTimes(1);
    expect(taskRepo.buildUpsertTaskLink).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'link-valid' }),
    );
  });
});
