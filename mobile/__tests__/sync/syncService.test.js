import { performSync } from '../../src/sync/syncService';
import * as endpoints from '../../src/api/endpoints';
import * as snippetRepo from '../../src/db/snippetRepo';
import * as noteRepo from '../../src/db/noteRepo';
import * as syncMeta from '../../src/db/syncMetaRepo';

jest.mock('../../src/api/endpoints');
jest.mock('../../src/db/snippetRepo');
jest.mock('../../src/db/noteRepo');
jest.mock('../../src/db/syncMetaRepo');

describe('syncService', () => {
  beforeEach(() => jest.clearAllMocks());

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

    expect(snippetRepo.upsertSnippet).toHaveBeenCalledWith(
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
});
