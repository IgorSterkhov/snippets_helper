import { syncPull, syncPush } from '../api/endpoints';
import { getLastSyncAt, setLastSyncAt } from '../db/syncMetaRepo';
import { getDB } from '../db/database';
import {
  buildUpsertSnippet, buildUpsertTag,
  getModifiedSnippetsSince, getModifiedTagsSince,
} from '../db/snippetRepo';
import {
  buildUpsertNote, buildUpsertFolder,
  getModifiedNotesSince, getModifiedFoldersSince,
} from '../db/noteRepo';

const BUILDERS = {
  shortcuts: buildUpsertSnippet,
  snippet_tags: buildUpsertTag,
  notes: buildUpsertNote,
  note_folders: buildUpsertFolder,
};

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

export function notifyLocalChange() {
  emitPending();
  performSync().catch(() => { /* will retry on next trigger */ });
}

function applyPulledChanges(changes) {
  const entries = Object.entries(changes || {});
  let totalRows = 0;
  for (const [, rows] of entries) totalRows += rows.length;
  if (!totalRows) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const db = getDB();
    db.transaction(
      (tx) => {
        for (const [table, rows] of entries) {
          const build = BUILDERS[table];
          if (!build) continue;
          for (const row of rows) {
            const { sql, params } = build(row);
            tx.executeSql(sql, params);
          }
        }
      },
      (err) => reject(err),
      () => resolve(),
    );
  });
}

export async function performSync() {
  if (syncing) return;
  syncing = true;
  emit({ type: 'syncing', value: true });

  try {
    const lastSync = await getLastSyncAt();

    // 1. Pull server changes and apply them in a single transaction.
    const pullResult = await syncPull(lastSync);
    await applyPulledChanges(pullResult.changes);

    // 2. Push local changes.
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

    // 3. Update last sync time and emit pending count.
    await setLastSyncAt(pullResult.server_time);
    await emitPending();
  } finally {
    syncing = false;
    emit({ type: 'syncing', value: false });
  }
}
