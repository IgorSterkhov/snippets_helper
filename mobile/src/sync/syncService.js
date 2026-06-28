import { syncPull, syncPush } from '../api/endpoints';
import { getLastSyncAt, setLastSyncAt, setLastSyncDebug } from '../db/syncMetaRepo';
import { getDB } from '../db/database';
import { recordSyncHistoryEvents } from '../db/syncHistoryRepo';
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
  buildUpsertFinancePlan, buildUpsertFinanceItem, buildUpsertFinanceTransaction,
  buildUpsertFinanceMappingRule, buildUpsertFinanceTransactionAllocation,
  getModifiedFinancePlansSince, getModifiedFinanceItemsSince,
  getModifiedFinanceTransactionsSince, getModifiedFinanceMappingRulesSince,
  getModifiedFinanceTransactionAllocationsSince, clearSyncedFinanceRows,
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
  finance_transactions: buildUpsertFinanceTransaction,
  finance_mapping_rules: buildUpsertFinanceMappingRule,
  finance_transaction_allocations: buildUpsertFinanceTransactionAllocation,
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
  'finance_transactions',
  'finance_mapping_rules',
  'finance_transaction_allocations',
];
const FINANCE_TABLES = new Set([
  'finance_plans',
  'finance_items',
  'finance_transactions',
  'finance_mapping_rules',
  'finance_transaction_allocations',
]);
const PRESERVE_PENDING_SYNC_STATUS_FLAG = '__preserve_pending_sync_status';

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
  if (table === 'finance_mapping_rules' && !row.target_plan_uuid) {
    return false;
  }
  if (table === 'finance_transaction_allocations' && (!row.transaction_uuid || !row.plan_uuid)) {
    return false;
  }
  return true;
}

function normalizePullEntries(changes) {
  const input = changes || {};
  return TABLE_ORDER
    .filter((table) => Array.isArray(input[table]))
    .map((table) => [table, input[table].filter((row) => shouldApplyPulledRow(table, row))])
    .filter(([, rows]) => rows.length > 0);
}

function rowUuidSet(entries) {
  const result = new Map();
  for (const [table, rows] of entries) {
    result.set(table, new Set(rows.map((row) => row.uuid).filter(Boolean)));
  }
  return result;
}

function countByTable(entriesOrChanges) {
  if (Array.isArray(entriesOrChanges)) {
    return Object.fromEntries(entriesOrChanges.map(([table, rows]) => [table, rows.length]));
  }
  const changes = entriesOrChanges || {};
  const counts = {};
  for (const table of TABLE_ORDER) {
    if (Array.isArray(changes[table]) && changes[table].length) {
      counts[table] = changes[table].length;
    }
  }
  return counts;
}

function changesToEntries(changes = {}) {
  return TABLE_ORDER
    .filter((table) => Array.isArray(changes[table]) && changes[table].length)
    .map((table) => [table, changes[table]]);
}

function rowHistoryEvents(entries, direction, status = 'ok', action = 'upsert') {
  const events = [];
  for (const [table, rows] of entries || []) {
    for (const row of rows || []) {
      events.push({
        status,
        table_name: table,
        row_uuid: row?.uuid || null,
        direction,
        action,
        details_json: JSON.stringify({
          updated_at: row?.updated_at || null,
          sync_status: row?.sync_status || null,
        }),
      });
    }
  }
  return events;
}

function uuidHistoryEvents(uuidMap = {}, direction, status = 'ok', action = 'accepted') {
  const events = [];
  for (const [table, uuids] of Object.entries(uuidMap || {})) {
    for (const uuid of uuids || []) {
      events.push({
        status,
        table_name: table,
        row_uuid: uuid,
        direction,
        action,
      });
    }
  }
  return events;
}

function conflictHistoryEvents(conflicts = [], status = 'warning', actionOverride = null) {
  return (conflicts || []).map((conflict) => ({
    status,
    table_name: conflict.table || conflict.table_name || null,
    row_uuid: conflict.uuid || conflict.row_uuid || null,
    direction: 'conflict',
    action: actionOverride || conflict.resolution || 'conflict',
    details_json: JSON.stringify(conflict),
  }));
}

async function recordHistory(events) {
  try {
    await recordSyncHistoryEvents(events);
  } catch (e) {
    // History is diagnostic only; never fail sync because recording failed.
  }
}

function maxTimestamp(baseTimestamp, entriesOrChanges) {
  let max = baseTimestamp || null;
  const visit = (row) => {
    const value = row?.updated_at;
    if (value && (!max || String(value) > String(max))) max = String(value);
  };
  if (Array.isArray(entriesOrChanges)) {
    for (const [, rows] of entriesOrChanges) rows.forEach(visit);
  } else {
    const changes = entriesOrChanges || {};
    for (const rows of Object.values(changes)) {
      if (Array.isArray(rows)) rows.forEach(visit);
    }
  }
  return max;
}

function filterPulledRows(rows, pulledUuids) {
  if (!pulledUuids || pulledUuids.size === 0) return rows;
  return rows.filter((row) => !row?.uuid || !pulledUuids.has(row.uuid));
}

function hasPushWarnings(result) {
  const rejected = result?.rejected_uuids || {};
  const conflicts = result?.conflicts || [];
  return Object.values(rejected).some((rows) => Array.isArray(rows) && rows.length > 0)
    || (Array.isArray(conflicts) && conflicts.length > 0);
}

function hasRejectedUuids(rejected = {}) {
  return Object.values(rejected || {}).some((rows) => Array.isArray(rows) && rows.length > 0);
}

function isResolvedFinanceAllocationServerWinsConflict(conflict) {
  return String(conflict?.table || conflict?.table_name || '') === 'finance_transaction_allocations'
    && String(conflict?.resolution || '') === 'server_wins'
    && Boolean(conflict?.uuid || conflict?.row_uuid);
}

function conflictUuidsByTable(conflicts = []) {
  const result = {};
  for (const conflict of conflicts || []) {
    const table = conflict?.table || conflict?.table_name;
    const uuid = conflict?.uuid || conflict?.row_uuid;
    if (!table || !uuid) continue;
    if (!result[table]) result[table] = [];
    result[table].push(uuid);
  }
  return result;
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

async function saveSyncDebug(debug) {
  await setLastSyncDebug(debug).catch(() => {});
  emit({ type: 'debug', debug });
}

export async function countPendingChanges() {
  const since = await getLastSyncAt();
  const [s, t, n, f, tc, ts, task, cb, links, fp, fi, ft, fr, fa] = await Promise.all([
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
    getModifiedFinanceTransactionsSince(since),
    getModifiedFinanceMappingRulesSince(since),
    getModifiedFinanceTransactionAllocationsSince(since),
  ]);
  return s.length + t.length + n.length + f.length + tc.length + ts.length + task.length + cb.length + links.length + fp.length + fi.length + ft.length + fr.length + fa.length;
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
  const entries = normalizePullEntries(changes);
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
            const rowForBuild = FINANCE_TABLES.has(table)
              ? { ...row, [PRESERVE_PENDING_SYNC_STATUS_FLAG]: true }
              : row;
            const { sql, params } = build(rowForBuild);
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
      const pullEntries = normalizePullEntries(pullResult.changes);
      const pulledUuids = rowUuidSet(pullEntries);
      await applyPulledChanges(pullResult.changes);

      // 2. Push local changes.
      const changes = {};
      const localSnippets = filterPulledRows(await getModifiedSnippetsSince(lastSync), pulledUuids.get('shortcuts'));
      if (localSnippets.length) changes.shortcuts = localSnippets;
      const localTags = filterPulledRows(await getModifiedTagsSince(lastSync), pulledUuids.get('snippet_tags'));
      if (localTags.length) changes.snippet_tags = localTags;
      const localNotes = filterPulledRows(await getModifiedNotesSince(lastSync), pulledUuids.get('notes'));
      if (localNotes.length) changes.notes = localNotes;
      const localFolders = filterPulledRows(await getModifiedFoldersSince(lastSync), pulledUuids.get('note_folders'));
      if (localFolders.length) changes.note_folders = localFolders;
      const localTaskCategories = filterPulledRows(await getModifiedTaskCategoriesSince(lastSync), pulledUuids.get('task_categories'));
      if (localTaskCategories.length) changes.task_categories = localTaskCategories;
      const localTaskStatuses = filterPulledRows(await getModifiedTaskStatusesSince(lastSync), pulledUuids.get('task_statuses'));
      if (localTaskStatuses.length) changes.task_statuses = localTaskStatuses;
      const localTasks = filterPulledRows(await getModifiedTasksSince(lastSync), pulledUuids.get('tasks'));
      if (localTasks.length) changes.tasks = localTasks;
      const localTaskCheckboxes = filterPulledRows(await getModifiedTaskCheckboxesSince(lastSync), pulledUuids.get('task_checkboxes'));
      if (localTaskCheckboxes.length) changes.task_checkboxes = localTaskCheckboxes;
      const localTaskLinks = filterPulledRows(await getModifiedTaskLinksSince(lastSync), pulledUuids.get('task_links'));
      if (localTaskLinks.length) changes.task_links = localTaskLinks;
      const localFinancePlans = filterPulledRows(await getModifiedFinancePlansSince(lastSync), pulledUuids.get('finance_plans'));
      if (localFinancePlans.length) changes.finance_plans = localFinancePlans;
      const localFinanceItems = filterPulledRows(await getModifiedFinanceItemsSince(lastSync), pulledUuids.get('finance_items'));
      if (localFinanceItems.length) changes.finance_items = localFinanceItems;
      const localFinanceTransactions = filterPulledRows(await getModifiedFinanceTransactionsSince(lastSync), pulledUuids.get('finance_transactions'));
      if (localFinanceTransactions.length) changes.finance_transactions = localFinanceTransactions;
      const localFinanceMappingRules = filterPulledRows(await getModifiedFinanceMappingRulesSince(lastSync), pulledUuids.get('finance_mapping_rules'));
      if (localFinanceMappingRules.length) changes.finance_mapping_rules = localFinanceMappingRules;
      const localFinanceTransactionAllocations = filterPulledRows(
        await getModifiedFinanceTransactionAllocationsSince(lastSync),
        pulledUuids.get('finance_transaction_allocations'),
      );
      if (localFinanceTransactionAllocations.length) changes.finance_transaction_allocations = localFinanceTransactionAllocations;

      let pushResult = null;
      let resolvedConflicts = [];
      let unresolvedConflicts = [];
      if (Object.keys(changes).length > 0) {
        pushResult = await syncPush(changes);
        if (hasPushWarnings(pushResult)) {
          const rejectedUuids = pushResult.rejected_uuids || {};
          const pushConflicts = pushResult.conflicts || [];
          resolvedConflicts = pushConflicts.filter(isResolvedFinanceAllocationServerWinsConflict);
          unresolvedConflicts = pushConflicts.filter((conflict) => !isResolvedFinanceAllocationServerWinsConflict(conflict));
          const resolvedByTable = conflictUuidsByTable(resolvedConflicts);
          for (const [table, uuids] of Object.entries(resolvedByTable)) {
            if (FINANCE_TABLES.has(table) && uuids.length) {
              await clearSyncedFinanceRows(table, uuids);
            }
          }
          const debug = {
            status: hasRejectedUuids(rejectedUuids) || unresolvedConflicts.length ? 'warning' : 'ok',
            timestamp: new Date().toISOString(),
            pulled_counts: countByTable(pullEntries),
            pushed_counts: countByTable(changes),
            rejected_uuids: rejectedUuids,
            conflicts: unresolvedConflicts,
            resolved_conflicts: resolvedConflicts,
          };
          await recordHistory([
            ...rowHistoryEvents(pullEntries, 'pull', 'ok', 'upsert'),
            ...rowHistoryEvents(changesToEntries(changes), 'push', debug.status === 'warning' ? 'warning' : 'ok', 'send'),
            ...uuidHistoryEvents(debug.rejected_uuids, 'push_reject', 'warning', 'rejected'),
            ...conflictHistoryEvents(debug.conflicts),
            ...conflictHistoryEvents(debug.resolved_conflicts, 'ok', 'server_wins_resolved'),
          ]);
          if (debug.status === 'warning') {
            await saveSyncDebug(debug);
            const warningError = new Error(`Sync rejected rows or conflicts: ${JSON.stringify({
              rejected_uuids: debug.rejected_uuids,
              conflicts: debug.conflicts,
            })}`);
            warningError.syncWarning = true;
            throw warningError;
          }
        }
        const acceptedUuids = pushResult?.accepted_uuids || {};
        for (const table of FINANCE_TABLES) {
          const acceptedRows = acceptedUuids[table] || [];
          if (acceptedRows.length) {
            await clearSyncedFinanceRows(table, acceptedRows);
          }
        }
      }

      // 3. Update last sync time and emit pending count.
      const nextSyncAt = maxTimestamp(maxTimestamp(pullResult.server_time, pullEntries), changes);
      await setLastSyncAt(nextSyncAt || pullResult.server_time);
      await recordHistory([
        ...rowHistoryEvents(pullEntries, 'pull', 'ok', 'upsert'),
        ...rowHistoryEvents(changesToEntries(changes), 'push', 'ok', 'send'),
        ...uuidHistoryEvents(pushResult?.accepted_uuids || {}, 'push_accept', 'ok', 'accepted'),
      ]);
      await saveSyncDebug({
        status: 'ok',
        timestamp: new Date().toISOString(),
        last_sync_at: nextSyncAt || pullResult.server_time,
        pulled_counts: countByTable(pullEntries),
        pushed_counts: countByTable(changes),
        accepted_uuids: pushResult?.accepted_uuids || {},
        rejected_uuids: pushResult?.rejected_uuids || {},
        conflicts: unresolvedConflicts,
        resolved_conflicts: resolvedConflicts,
      });
      await emitPending();
    } catch (error) {
      if (!error?.syncWarning) {
        const debug = {
          status: 'error',
          timestamp: new Date().toISOString(),
          error: String(error?.message || error),
        };
        await recordHistory([{
          status: 'error',
          direction: 'sync',
          action: 'error',
          details_json: JSON.stringify(debug),
        }]);
        await saveSyncDebug(debug);
      }
      throw error;
    } finally {
      syncing = false;
      currentSyncPromise = null;
      emit({ type: 'syncing', value: false });
    }
  })();

  return currentSyncPromise;
}

export async function performFullPullFromServer() {
  if (currentSyncPromise) return currentSyncPromise;

  currentSyncPromise = (async () => {
    syncing = true;
    emit({ type: 'syncing', value: true });

    try {
      const pending = await countPendingChanges();
      if (pending > 0) {
        throw new Error(`Full pull blocked: ${pending} pending local changes. Run normal sync first.`);
      }

      const pullResult = await syncPull(null);
      const pullEntries = normalizePullEntries(pullResult.changes);
      await applyPulledChanges(pullResult.changes);

      const nextSyncAt = maxTimestamp(pullResult.server_time, pullEntries);
      await setLastSyncAt(nextSyncAt || pullResult.server_time);
      await recordHistory(rowHistoryEvents(pullEntries, 'full_pull', 'ok', 'upsert'));
      await saveSyncDebug({
        status: 'ok',
        timestamp: new Date().toISOString(),
        last_sync_at: nextSyncAt || pullResult.server_time,
        forced_full_pull: true,
        pulled_counts: countByTable(pullEntries),
        pushed_counts: {},
        accepted_uuids: {},
        rejected_uuids: {},
        conflicts: [],
      });
      await emitPending();
    } catch (error) {
      const debug = {
        status: 'error',
        timestamp: new Date().toISOString(),
        forced_full_pull: true,
        error: String(error?.message || error),
      };
      await recordHistory([{
        status: 'error',
        direction: 'full_pull',
        action: 'error',
        details_json: JSON.stringify(debug),
      }]);
      await saveSyncDebug(debug);
      throw error;
    } finally {
      syncing = false;
      currentSyncPromise = null;
      emit({ type: 'syncing', value: false });
    }
  })();

  return currentSyncPromise;
}
