import { syncPull, syncPush } from '../api/endpoints';
import { getLastSyncAt, setLastSyncAt } from '../db/syncMetaRepo';
import { upsertSnippet, getModifiedSnippetsSince, upsertTag, getModifiedTagsSince } from '../db/snippetRepo';
import { upsertNote, getModifiedNotesSince, upsertFolder, getModifiedFoldersSince } from '../db/noteRepo';

let syncing = false;
const listeners = new Set();

export function subscribeSyncStatus(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(payload) {
  for (const cb of listeners) {
    try { cb(payload); } catch (e) { /* ignore */ }
  }
}

export async function countPendingChanges() {
  const since = await getLastSyncAt();
  const [s, t, n, f] = await Promise.all([
    getModifiedSnippetsSince(since),
    getModifiedTagsSince(since),
    getModifiedNotesSince(since),
    getModifiedFoldersSince(since),
  ]);
  return s.length + t.length + n.length + f.length;
}

async function emitPending() {
  try {
    const count = await countPendingChanges();
    emit({ type: 'pending', count });
  } catch (e) { /* ignore */ }
}

/**
 * Notify the sync subsystem that a local change has been made.
 * Updates pending counter immediately, then tries to sync in background.
 */
export function notifyLocalChange() {
  emitPending();
  performSync().catch(() => { /* will retry on next trigger */ });
}

export async function performSync() {
  if (syncing) return;
  syncing = true;
  emit({ type: 'syncing', value: true });

  try {
    const lastSync = await getLastSyncAt();

    // 1. Pull server changes
    const pullResult = await syncPull(lastSync);

    const applyMap = {
      shortcuts: upsertSnippet,
      snippet_tags: upsertTag,
      notes: upsertNote,
      note_folders: upsertFolder,
    };

    for (const [table, rows] of Object.entries(pullResult.changes || {})) {
      const upsert = applyMap[table];
      if (!upsert) continue;
      for (const row of rows) {
        await upsert(row);
      }
    }

    // 2. Push local changes
    const changes = {};

    const localSnippets = await getModifiedSnippetsSince(lastSync);
    if (localSnippets.length) changes.shortcuts = localSnippets;

    const localTags = await getModifiedTagsSince(lastSync);
    if (localTags.length) changes.snippet_tags = localTags;

    const localNotes = await getModifiedNotesSince(lastSync);
    if (localNotes.length) changes.notes = localNotes;

    const localFolders = await getModifiedFoldersSince(lastSync);
    if (localFolders.length) changes.note_folders = localFolders;

    if (Object.keys(changes).length > 0) {
      await syncPush(changes);
    }

    // 3. Update last sync time
    await setLastSyncAt(pullResult.server_time);
    await emitPending();
  } finally {
    syncing = false;
    emit({ type: 'syncing', value: false });
  }
}
