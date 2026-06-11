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
import {
  buildUpsertTaskCategory, buildUpsertTaskStatus, buildUpsertTask,
  buildUpsertTaskCheckbox, buildUpsertTaskLink,
  getModifiedTaskCategoriesSince, getModifiedTaskStatusesSince, getModifiedTasksSince,
  getModifiedTaskCheckboxesSince, getModifiedTaskLinksSince,
} from '../db/taskRepo';
import {
  buildUpsertFinancePlan, buildUpsertFinanceItem,
  getModifiedFinancePlansSince, getModifiedFinanceItemsSince,
} from '../db/financeRepo';

const BUILDERS = {
  shortcuts: buildUpsertSnippet,
  snippet_tags: buildUpsertTag,
  notes: buildUpsertNote,
  note_folders: buildUpsertFolder,
  task_categories: buildUpsertTaskCategory,
  task_statuses: buildUpsertTaskStatus,
  tasks: buildUpsertTask,
  task_checkboxes: buildUpsertTaskCheckbox,
  task_links: buildUpsertTaskLink,
  finance_plans: buildUpsertFinancePlan,
  finance_items: buildUpsertFinanceItem,
};

const TABLE_ORDER = [
  'shortcuts',
  'snippet_tags',
  'note_folders',
  'notes',
  'task_categories',
  'task_statuses',
  'tasks',
  'task_checkboxes',
  'task_links',
  'finance_plans',
  'finance_items',
];

function shouldApplyPulledRow(table, row) {
  if (!row || typeof row !== 'object') {
    return false;
  }
  if ((table === 'task_checkboxes' || table === 'task_links') && !row.task_uuid) {
    return false;
  }
  if (table === 'finance_items' && !row.plan_uuid) {
    return false;
  }
  return true;
}

let syncing = false;
let currentSyncPromise = null;
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
  const [s, t, n, f, tc, ts, task, cb, links, fp, fi] = await Promise.all([
    getModifiedSnippetsSince(since),
    getModifiedTagsSince(since),
    getModifiedNotesSince(since),
    getModifiedFoldersSince(since),
    getModifiedTaskCategoriesSince(since),
    getModifiedTaskStatusesSince(since),
    getModifiedTasksSince(since),
    getModifiedTaskCheckboxesSince(since),
    getModifiedTaskLinksSince(since),
    getModifiedFinancePlansSince(since),
    getModifiedFinanceItemsSince(since),
  ]);
  return s.length + t.length + n.length + f.length + tc.length + ts.length + task.length + cb.length + links.length + fp.length + fi.length;
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
  const input = changes || {};
  const entries = TABLE_ORDER
    .filter((table) => Array.isArray(input[table]))
    .map((table) => [table, input[table].filter((row) => shouldApplyPulledRow(table, row))])
    .filter(([, rows]) => rows.length > 0);
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
  if (currentSyncPromise) return currentSyncPromise;

  currentSyncPromise = (async () => {
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
      const localTaskCategories = await getModifiedTaskCategoriesSince(lastSync);
      if (localTaskCategories.length) changes.task_categories = localTaskCategories;
      const localTaskStatuses = await getModifiedTaskStatusesSince(lastSync);
      if (localTaskStatuses.length) changes.task_statuses = localTaskStatuses;
      const localTasks = await getModifiedTasksSince(lastSync);
      if (localTasks.length) changes.tasks = localTasks;
      const localTaskCheckboxes = await getModifiedTaskCheckboxesSince(lastSync);
      if (localTaskCheckboxes.length) changes.task_checkboxes = localTaskCheckboxes;
      const localTaskLinks = await getModifiedTaskLinksSince(lastSync);
      if (localTaskLinks.length) changes.task_links = localTaskLinks;
      const localFinancePlans = await getModifiedFinancePlansSince(lastSync);
      if (localFinancePlans.length) changes.finance_plans = localFinancePlans;
      const localFinanceItems = await getModifiedFinanceItemsSince(lastSync);
      if (localFinanceItems.length) changes.finance_items = localFinanceItems;

      if (Object.keys(changes).length > 0) {
        await syncPush(changes);
      }

      // 3. Update last sync time and emit pending count.
      await setLastSyncAt(pullResult.server_time);
      await emitPending();
    } finally {
      syncing = false;
      currentSyncPromise = null;
      emit({ type: 'syncing', value: false });
    }
  })();

  return currentSyncPromise;
}
