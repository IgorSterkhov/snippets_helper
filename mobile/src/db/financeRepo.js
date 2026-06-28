import { getDB } from './database';
import { uuidv4 } from '../lib/uuid';

export const FINANCE_PLAN_KINDS = ['monthly', 'project', 'one_time', 'general'];
const FINANCE_SYNC_TABLES = new Set([
  'finance_plans',
  'finance_items',
  'finance_transactions',
  'finance_mapping_rules',
  'finance_transaction_allocations',
]);
const PRESERVE_PENDING_SYNC_STATUS_FLAG = '__preserve_pending_sync_status';

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.transaction((tx) => {
      tx.executeSql(sql, params, (_, result) => resolve(result), (_, err) => reject(err));
    });
  });
}

function rowsToArray(result) {
  const arr = [];
  for (let i = 0; i < result.rows.length; i++) {
    arr.push(result.rows.item(i));
  }
  return arr;
}

function nowIso() {
  return new Date().toISOString();
}

function createdAt(row) {
  return row.created_at || row.updated_at || nowIso();
}

function updatedAt(row) {
  return row.updated_at || nowIso();
}

function deletedFlag(row) {
  return row.is_deleted ? 1 : 0;
}

function normalizeKind(value) {
  const kind = String(value || 'monthly').trim().toLowerCase().replace('-', '_');
  return FINANCE_PLAN_KINDS.includes(kind) ? kind : 'monthly';
}

function normalizeCurrency(value) {
  return String(value || 'RUB').trim().toUpperCase() || 'RUB';
}

function normalizeDueDay(value) {
  if (value == null || value === '') return null;
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

function normalizeDueDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeAmountCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount);
}

function normalizeSignedAmountCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount);
}

function normalizeNullableSignedAmountCents(value) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount) : null;
}

function normalizeBool(value, fallback = false) {
  if (value == null) return fallback ? 1 : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value ? 1 : 0;
  const text = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(text) ? 1 : 0;
}

function normalizeSyncStatus(value, fallback = 'synced') {
  const status = String(value || '').trim().toLowerCase();
  return ['pending', 'synced', 'deleted'].includes(status) ? status : fallback;
}

function pendingFinanceSql(table) {
  return `SELECT * FROM ${table} WHERE sync_status IN ('pending', 'deleted') OR updated_at > ?`;
}

function shouldPreservePendingSyncStatus(row) {
  return !!row?.[PRESERVE_PENDING_SYNC_STATUS_FLAG];
}

function financeUpsertSql(table, columns, preservePendingSyncStatus = false) {
  const placeholders = columns.map(() => '?').join(', ');
  if (!preservePendingSyncStatus) {
    return `INSERT OR REPLACE INTO ${table}
          (${columns.join(', ')})
          VALUES (${placeholders})`;
  }
  const updateAssignments = columns
    .filter((column) => column !== 'uuid')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');
  return `INSERT INTO ${table}
          (${columns.join(', ')})
          VALUES (${placeholders})
          ON CONFLICT(uuid) DO UPDATE SET ${updateAssignments}
          WHERE ${table}.sync_status NOT IN ('pending', 'deleted')`;
}

function normalizeMatchMode(value) {
  return String(value || 'all').trim().toLowerCase() === 'any' ? 'any' : 'all';
}

function normalizeAssignedBy(value) {
  return String(value || 'manual').trim().toLowerCase() === 'rule' ? 'rule' : 'manual';
}

function safeJsonText(value, fallback = '[]') {
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return fallback;
    }
  }
  try {
    return JSON.stringify(value ?? JSON.parse(fallback));
  } catch {
    return fallback;
  }
}

function compareRows(a, b) {
  const sortA = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 0;
  const sortB = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 0;
  if (sortA !== sortB) return sortA - sortB;

  const nameCompare = String(a.name || '').localeCompare(String(b.name || ''));
  if (nameCompare !== 0) return nameCompare;

  return String(a.uuid || '').localeCompare(String(b.uuid || ''));
}

function createMoveIndex(items = []) {
  const active = items.filter((item) => item && item.uuid && !item.is_deleted);
  const byUuid = new Map(active.map((item) => [item.uuid, item]));

  const parentUuidOf = (item) => {
    const parentUuid = item && item.parent_uuid ? item.parent_uuid : null;
    return parentUuid && byUuid.has(parentUuid) ? parentUuid : null;
  };

  const sortedSiblings = (planUuid, parentUuid, updates = new Map()) => {
    const normalizedParentUuid = parentUuid || null;
    return active
      .map((item) => updates.get(item.uuid) || item)
      .filter((item) => item.plan_uuid === planUuid && parentUuidOf(item) === normalizedParentUuid)
      .slice()
      .sort(compareRows);
  };

  return { active, byUuid, parentUuidOf, sortedSiblings };
}

function emptyMove(items) {
  return { items, changed: [], parentToExpand: null };
}

export function getFinanceItemMoveAvailability(items = [], uuid) {
  const { byUuid, parentUuidOf, sortedSiblings } = createMoveIndex(items);
  const item = byUuid.get(uuid);
  if (!item) {
    return { up: false, down: false, left: false, right: false };
  }

  const parentUuid = parentUuidOf(item);
  const siblings = sortedSiblings(item.plan_uuid, parentUuid);
  const index = siblings.findIndex((sibling) => sibling.uuid === uuid);

  return {
    up: index > 0,
    down: index >= 0 && index < siblings.length - 1,
    left: !!parentUuid,
    right: index > 0,
  };
}

export function moveFinanceItemInTree(items = [], uuid, direction, updatedAt = nowIso()) {
  const { active, byUuid } = createMoveIndex(items);
  const moving = byUuid.get(uuid);
  if (!moving) return emptyMove(items);

  const updates = new Map();
  const currentRow = (row) => updates.get(row.uuid) || row;
  const parentUuidOf = (row) => {
    const parentUuid = row && row.parent_uuid ? row.parent_uuid : null;
    return parentUuid && byUuid.has(parentUuid) ? parentUuid : null;
  };
  const sortedSiblings = (planUuid, parentUuid) => {
    const normalizedParentUuid = parentUuid || null;
    return active
      .map((item) => currentRow(item))
      .filter((item) => item.plan_uuid === planUuid && parentUuidOf(item) === normalizedParentUuid)
      .slice()
      .sort(compareRows);
  };
  const stageOrder = (planUuid, parentUuid, orderedRows) => {
    const normalizedParentUuid = parentUuid || null;
    orderedRows.forEach((row, index) => {
      const current = currentRow(row);
      const currentParentUuid = current.parent_uuid || null;
      const currentSortOrder = Number.isFinite(Number(current.sort_order)) ? Number(current.sort_order) : 0;
      if (currentParentUuid !== normalizedParentUuid || currentSortOrder !== index) {
        updates.set(current.uuid, {
          ...current,
          parent_uuid: normalizedParentUuid,
          parent_id: null,
          sort_order: index,
          updated_at: updatedAt,
        });
      }
    });
  };

  let parentToExpand = null;
  const parentUuid = parentUuidOf(moving);
  const siblings = sortedSiblings(moving.plan_uuid, parentUuid);
  const index = siblings.findIndex((sibling) => sibling.uuid === uuid);
  if (index < 0) return emptyMove(items);

  if (direction === 'up') {
    if (index === 0) return emptyMove(items);
    const ordered = siblings.slice();
    [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]];
    stageOrder(moving.plan_uuid, parentUuid, ordered);
  } else if (direction === 'down') {
    if (index >= siblings.length - 1) return emptyMove(items);
    const ordered = siblings.slice();
    [ordered[index], ordered[index + 1]] = [ordered[index + 1], ordered[index]];
    stageOrder(moving.plan_uuid, parentUuid, ordered);
  } else if (direction === 'right') {
    if (index === 0) return emptyMove(items);
    const newParent = siblings[index - 1];
    const oldGroup = siblings.filter((sibling) => sibling.uuid !== uuid);
    const childGroup = sortedSiblings(moving.plan_uuid, newParent.uuid);
    const moved = { ...currentRow(moving), parent_uuid: newParent.uuid, parent_id: null };
    stageOrder(moving.plan_uuid, parentUuid, oldGroup);
    stageOrder(moving.plan_uuid, newParent.uuid, [...childGroup, moved]);
    parentToExpand = newParent.uuid;
  } else if (direction === 'left') {
    if (!parentUuid) return emptyMove(items);
    const parent = byUuid.get(parentUuid);
    if (!parent) return emptyMove(items);
    const newParentUuid = parentUuidOf(parent);
    const oldGroup = siblings.filter((sibling) => sibling.uuid !== uuid);
    const targetGroup = sortedSiblings(moving.plan_uuid, newParentUuid);
    const parentIndex = targetGroup.findIndex((sibling) => sibling.uuid === parent.uuid);
    if (parentIndex < 0) return emptyMove(items);
    const moved = { ...currentRow(moving), parent_uuid: newParentUuid, parent_id: null };
    const orderedTarget = [
      ...targetGroup.slice(0, parentIndex + 1),
      moved,
      ...targetGroup.slice(parentIndex + 1),
    ];
    stageOrder(moving.plan_uuid, parentUuid, oldGroup);
    stageOrder(moving.plan_uuid, newParentUuid, orderedTarget);
  } else {
    return emptyMove(items);
  }

  if (updates.size === 0) return emptyMove(items);

  const nextItems = items.map((item) => updates.get(item.uuid) || item);
  const changed = nextItems.filter((item) => updates.has(item.uuid));
  return { items: nextItems, changed, parentToExpand };
}

export function buildFinanceTree(items = []) {
  const active = items.filter((item) => item && item.uuid && !item.is_deleted);
  const byUuid = new Map(active.map((item) => [item.uuid, item]));
  const children = new Map();
  const roots = [];

  for (const item of active) {
    children.set(item.uuid, []);
  }

  for (const item of active) {
    if (item.parent_uuid && byUuid.has(item.parent_uuid)) {
      children.get(item.parent_uuid).push(item);
    } else {
      roots.push(item);
    }
  }

  roots.sort(compareRows);
  for (const list of children.values()) list.sort(compareRows);
  return { roots, children, byUuid };
}

export function flattenFinanceTree(items = [], options = {}) {
  const collapsedIds = options.collapsedIds || new Set();
  const { roots, children } = buildFinanceTree(items);
  const result = [];
  const visited = new Set();

  function countDescendants(item, stack = new Set()) {
    if (!item || stack.has(item.uuid)) return 0;
    const nextStack = new Set(stack);
    nextStack.add(item.uuid);
    let count = 0;
    for (const child of children.get(item.uuid) || []) {
      count += 1 + countDescendants(child, nextStack);
    }
    return count;
  }

  function markDescendantsVisited(item, stack = new Set()) {
    if (!item || stack.has(item.uuid)) return;
    const nextStack = new Set(stack);
    nextStack.add(item.uuid);
    for (const child of children.get(item.uuid) || []) {
      visited.add(child.uuid);
      markDescendantsVisited(child, nextStack);
    }
  }

  function visit(item, depth, stack) {
    if (!item || visited.has(item.uuid) || stack.has(item.uuid)) return;
    visited.add(item.uuid);
    const rowChildren = children.get(item.uuid) || [];
    const isCollapsed = collapsedIds.has(item.uuid);
    result.push({
      item,
      depth,
      hasChildren: rowChildren.length > 0,
      hiddenDescendantCount: isCollapsed ? countDescendants(item) : 0,
    });
    if (isCollapsed) {
      markDescendantsVisited(item, stack);
      return;
    }
    const nextStack = new Set(stack);
    nextStack.add(item.uuid);
    for (const child of rowChildren) visit(child, depth + 1, nextStack);
  }

  for (const root of roots) visit(root, 0, new Set());
  return result;
}

export function computeFinanceTotals(items = []) {
  const { roots, children } = buildFinanceTree(items);
  const totals = new Map();

  function visit(item, stack = new Set()) {
    if (!item || stack.has(item.uuid)) return 0;
    const nextStack = new Set(stack);
    nextStack.add(item.uuid);
    let total = normalizeAmountCents(item.amount_cents);
    for (const child of children.get(item.uuid) || []) total += visit(child, nextStack);
    totals.set(item.uuid, total);
    return total;
  }

  let grandTotal = 0;
  for (const root of roots) grandTotal += visit(root);
  return { totals, grandTotal };
}

export function maxVisibleFinanceDepth(flatRows = []) {
  return flatRows.reduce((max, row) => Math.max(max, Number(row.depth) || 0), 0);
}

export function maxFinanceTreeDepth(items = []) {
  const { roots, children } = buildFinanceTree(items);
  let maxDepth = 0;

  function visit(item, depth, stack = new Set()) {
    if (!item || stack.has(item.uuid)) return;
    maxDepth = Math.max(maxDepth, depth);
    const nextStack = new Set(stack);
    nextStack.add(item.uuid);
    for (const child of children.get(item.uuid) || []) {
      visit(child, depth + 1, nextStack);
    }
  }

  for (const root of roots) visit(root, 0);
  return maxDepth;
}

export function financeBandSlotForDepth(depth, maxDepth, fillOrder = 'strong_first') {
  if (!Number.isFinite(depth) || !Number.isFinite(maxDepth) || maxDepth <= 0) return null;
  if (depth >= maxDepth) return null;
  if (fillOrder === 'soft_first') {
    const levelsAboveNeutral = maxDepth - depth;
    if (levelsAboveNeutral >= 3) return 0;
    if (levelsAboveNeutral === 2) return 1;
    return 2;
  }
  return Math.min(2, depth);
}

export async function getFinancePlans() {
  const result = await query(
    'SELECT * FROM finance_plans WHERE is_deleted = 0 ORDER BY sort_order, name COLLATE NOCASE',
    [],
  );
  return rowsToArray(result);
}

export function buildUpsertFinancePlan(plan) {
  const columns = ['uuid', 'id', 'name', 'currency', 'kind', 'sort_order', 'created_at', 'updated_at', 'sync_status', 'is_deleted'];
  return {
    sql: financeUpsertSql('finance_plans', columns, shouldPreservePendingSyncStatus(plan)),
    params: [
      plan.uuid,
      plan.id ?? null,
      plan.name || 'Untitled list',
      normalizeCurrency(plan.currency),
      normalizeKind(plan.kind),
      plan.sort_order || 0,
      createdAt(plan),
      updatedAt(plan),
      normalizeSyncStatus(plan.sync_status, 'synced'),
      deletedFlag(plan),
    ],
  };
}

export async function upsertFinancePlan(plan) {
  const { sql, params } = buildUpsertFinancePlan({ ...plan, sync_status: 'pending' });
  await query(sql, params);
}

export async function deleteFinancePlan(uuid) {
  const now = nowIso();
  await query(
    'UPDATE finance_plans SET is_deleted = 1, updated_at = ?, sync_status = ? WHERE uuid = ?',
    [now, 'deleted', uuid],
  );
  await query(
    'UPDATE finance_items SET is_deleted = 1, updated_at = ?, sync_status = ? WHERE plan_uuid = ?',
    [now, 'deleted', uuid],
  );
}

export async function getModifiedFinancePlansSince(since) {
  const sql = since ? pendingFinanceSql('finance_plans') : 'SELECT * FROM finance_plans';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

export async function getFinanceItems(planUuid) {
  const result = await query(
    'SELECT * FROM finance_items WHERE plan_uuid = ? AND is_deleted = 0 ORDER BY parent_uuid, sort_order, name COLLATE NOCASE',
    [planUuid],
  );
  return rowsToArray(result);
}

export async function getAllFinanceItems() {
  const result = await query(
    'SELECT * FROM finance_items WHERE is_deleted = 0 ORDER BY plan_uuid, parent_uuid, sort_order, name COLLATE NOCASE',
    [],
  );
  return rowsToArray(result);
}

export function buildUpsertFinanceItem(item) {
  const columns = [
    'uuid', 'id', 'plan_id', 'plan_uuid', 'parent_id', 'parent_uuid', 'name', 'amount_cents',
    'due_day', 'due_date', 'note', 'sort_order', 'created_at', 'updated_at', 'sync_status', 'is_deleted',
  ];
  return {
    sql: financeUpsertSql('finance_items', columns, shouldPreservePendingSyncStatus(item)),
    params: [
      item.uuid,
      item.id ?? null,
      item.plan_id ?? null,
      item.plan_uuid,
      item.parent_id ?? null,
      item.parent_uuid || null,
      item.name || '',
      normalizeAmountCents(item.amount_cents),
      normalizeDueDay(item.due_day),
      normalizeDueDate(item.due_date),
      item.note || '',
      item.sort_order || 0,
      createdAt(item),
      updatedAt(item),
      normalizeSyncStatus(item.sync_status, 'synced'),
      deletedFlag(item),
    ],
  };
}

export async function upsertFinanceItem(item) {
  const { sql, params } = buildUpsertFinanceItem({ ...item, sync_status: 'pending' });
  await query(sql, params);
}

export async function upsertFinanceItems(items = []) {
  for (const item of items) {
    await upsertFinanceItem(item);
  }
}

export async function deleteFinanceItem(uuid) {
  const now = nowIso();
  const toDelete = new Set([uuid]);
  const queue = [uuid];
  while (queue.length) {
    const current = queue.shift();
    const result = await query(
      'SELECT uuid FROM finance_items WHERE parent_uuid = ? AND is_deleted = 0',
      [current],
    );
    for (const row of rowsToArray(result)) {
      if (!toDelete.has(row.uuid)) {
        toDelete.add(row.uuid);
        queue.push(row.uuid);
      }
    }
  }
  for (const itemUuid of toDelete) {
    await query(
      'UPDATE finance_items SET is_deleted = 1, updated_at = ?, sync_status = ? WHERE uuid = ?',
      [now, 'deleted', itemUuid],
    );
  }
}

export async function getModifiedFinanceItemsSince(since) {
  const sql = since ? pendingFinanceSql('finance_items') : 'SELECT * FROM finance_items';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

export function buildUpsertFinanceTransaction(transaction) {
  const columns = [
    'uuid', 'id', 'source', 'source_fingerprint', 'import_batch_id', 'import_batch_uuid',
    'operation_at', 'payment_date', 'card_mask', 'status', 'amount_cents', 'currency',
    'operation_amount_cents', 'operation_currency', 'payment_amount_cents', 'payment_currency',
    'cashback_cents', 'bank_category', 'mcc', 'description', 'bonuses_cents',
    'invest_rounding_cents', 'rounded_amount_cents', 'raw_json', 'rules_locked',
    'created_at', 'updated_at', 'sync_status', 'is_deleted',
  ];
  return {
    sql: financeUpsertSql('finance_transactions', columns, shouldPreservePendingSyncStatus(transaction)),
    params: [
      transaction.uuid,
      transaction.id ?? null,
      transaction.source || 'tbank_csv',
      transaction.source_fingerprint || '',
      transaction.import_batch_id ?? null,
      transaction.import_batch_uuid || null,
      transaction.operation_at || '',
      transaction.payment_date || '',
      transaction.card_mask || '',
      transaction.status || '',
      normalizeSignedAmountCents(transaction.amount_cents),
      normalizeCurrency(transaction.currency),
      normalizeSignedAmountCents(transaction.operation_amount_cents),
      normalizeCurrency(transaction.operation_currency || transaction.currency),
      normalizeSignedAmountCents(transaction.payment_amount_cents),
      normalizeCurrency(transaction.payment_currency || transaction.currency),
      normalizeNullableSignedAmountCents(transaction.cashback_cents),
      transaction.bank_category || '',
      transaction.mcc || '',
      transaction.description || '',
      normalizeNullableSignedAmountCents(transaction.bonuses_cents),
      normalizeNullableSignedAmountCents(transaction.invest_rounding_cents),
      normalizeNullableSignedAmountCents(transaction.rounded_amount_cents),
      safeJsonText(transaction.raw_json, '{}'),
      normalizeBool(transaction.rules_locked, false),
      createdAt(transaction),
      updatedAt(transaction),
      normalizeSyncStatus(transaction.sync_status, 'synced'),
      deletedFlag(transaction),
    ],
  };
}

export function buildUpsertFinanceMappingRule(rule) {
  const columns = [
    'uuid', 'id', 'name', 'is_enabled', 'priority', 'match_mode', 'conditions_json',
    'target_plan_id', 'target_plan_uuid', 'target_item_id', 'target_item_uuid',
    'created_at', 'updated_at', 'sync_status', 'is_deleted',
  ];
  return {
    sql: financeUpsertSql('finance_mapping_rules', columns, shouldPreservePendingSyncStatus(rule)),
    params: [
      rule.uuid,
      rule.id ?? null,
      rule.name || 'New mapping rule',
      normalizeBool(rule.is_enabled, true),
      Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 0,
      normalizeMatchMode(rule.match_mode),
      safeJsonText(rule.conditions_json || rule.conditions || []),
      rule.target_plan_id ?? rule.targetPlan?.id ?? null,
      rule.target_plan_uuid || rule.targetPlan?.uuid || null,
      rule.target_item_id ?? rule.targetItem?.id ?? null,
      rule.target_item_uuid || rule.targetItem?.uuid || null,
      createdAt(rule),
      updatedAt(rule),
      normalizeSyncStatus(rule.sync_status, 'synced'),
      deletedFlag(rule),
    ],
  };
}

export function buildUpsertFinanceTransactionAllocation(allocation) {
  const columns = [
    'uuid', 'id', 'transaction_id', 'transaction_uuid', 'plan_id', 'plan_uuid',
    'item_id', 'item_uuid', 'assigned_by', 'rule_id', 'rule_uuid', 'is_active',
    'created_at', 'updated_at', 'is_deleted', 'sync_dirty', 'sync_status',
  ];
  return {
    sql: financeUpsertSql('finance_transaction_allocations', columns, shouldPreservePendingSyncStatus(allocation)),
    params: [
      allocation.uuid,
      allocation.id ?? null,
      allocation.transaction_id ?? allocation.transaction?.id ?? null,
      allocation.transaction_uuid || allocation.transaction?.uuid || null,
      allocation.plan_id ?? allocation.plan?.id ?? null,
      allocation.plan_uuid || allocation.plan?.uuid || null,
      allocation.item_id ?? allocation.item?.id ?? null,
      allocation.item_uuid || allocation.item?.uuid || null,
      normalizeAssignedBy(allocation.assigned_by),
      allocation.rule_id ?? allocation.rule?.id ?? null,
      allocation.rule_uuid || allocation.rule?.uuid || null,
      normalizeBool(allocation.is_active, true),
      createdAt(allocation),
      updatedAt(allocation),
      deletedFlag(allocation),
      normalizeBool(allocation.sync_dirty, false),
      normalizeSyncStatus(allocation.sync_status, 'synced'),
    ],
  };
}

export async function getModifiedFinanceTransactionsSince(since) {
  const sql = since ? pendingFinanceSql('finance_transactions') : 'SELECT * FROM finance_transactions';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

export async function getModifiedFinanceMappingRulesSince(since) {
  const sql = since ? pendingFinanceSql('finance_mapping_rules') : 'SELECT * FROM finance_mapping_rules';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

export async function getModifiedFinanceTransactionAllocationsSince(since) {
  const sql = since
    ? `SELECT * FROM finance_transaction_allocations
       WHERE sync_status IN ('pending', 'deleted') OR sync_dirty = 1 OR updated_at > ?`
    : 'SELECT * FROM finance_transaction_allocations';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

export async function clearSyncedFinanceRows(table, uuids = []) {
  if (!FINANCE_SYNC_TABLES.has(table)) {
    throw new Error(`Unsupported finance sync table: ${table}`);
  }
  const cleanUuids = uuids.filter(Boolean);
  if (!cleanUuids.length) return;
  const placeholders = cleanUuids.map(() => '?').join(', ');
  const setClause = table === 'finance_transaction_allocations'
    ? "sync_status = 'synced', sync_dirty = 0"
    : "sync_status = 'synced'";
  await query(
    `UPDATE ${table}
     SET ${setClause}
     WHERE uuid IN (${placeholders})`,
    cleanUuids,
  );
}

export async function clearSyncedFinanceTransactionAllocations(uuids = []) {
  await clearSyncedFinanceRows('finance_transaction_allocations', uuids);
}

export async function getFinanceTransactions(options = {}) {
  const where = ['t.is_deleted = 0'];
  const params = [];
  if (options.unmappedOnly) {
    where.push(`NOT EXISTS (
      SELECT 1 FROM finance_transaction_allocations a
      WHERE a.transaction_uuid = t.uuid
        AND a.is_active = 1
        AND a.is_deleted = 0
    )`);
  }
  if (options.lockedOnly) {
    where.push('t.rules_locked = 1');
  }
  if (options.month && /^\d{4}-\d{2}$/.test(options.month)) {
    where.push('t.payment_date LIKE ?');
    params.push(`${options.month}-%`);
  }
  if (options.year && /^\d{4}$/.test(options.year)) {
    where.push('t.payment_date LIKE ?');
    params.push(`${options.year}-%`);
  }
  const result = await query(
    `SELECT t.* FROM finance_transactions t
     WHERE ${where.join(' AND ')}
     ORDER BY t.payment_date DESC, t.operation_at DESC, t.id DESC`,
    params,
  );
  return rowsToArray(result);
}

export async function getFinanceTransactionAllocations(options = {}) {
  const where = ['is_deleted = 0', 'is_active = 1'];
  const params = [];
  if (options.planUuid) {
    where.push('plan_uuid = ?');
    params.push(options.planUuid);
  }
  const result = await query(
    `SELECT * FROM finance_transaction_allocations
     WHERE ${where.join(' AND ')}
     ORDER BY updated_at DESC, id DESC`,
    params,
  );
  return rowsToArray(result);
}

export async function getFinanceMappingRules() {
  const result = await query(
    'SELECT * FROM finance_mapping_rules WHERE is_deleted = 0 ORDER BY priority ASC, id ASC, name COLLATE NOCASE',
    [],
  );
  return rowsToArray(result);
}

function conditionStringValue(transaction, field) {
  switch (field) {
    case 'category':
    case 'bank_category':
      return transaction.bank_category || '';
    case 'mcc':
      return transaction.mcc || '';
    case 'description':
      return transaction.description || '';
    case 'card':
    case 'card_mask':
      return transaction.card_mask || '';
    case 'status':
      return transaction.status || '';
    case 'currency':
      return transaction.currency || '';
    default:
      return '';
  }
}

function transactionDirection(transaction) {
  const amount = Number(transaction?.amount_cents) || 0;
  if (amount < 0) return 'expense';
  if (amount > 0) return 'income';
  return 'zero';
}

function financeRuleConditionMatches(transaction, condition) {
  if (!condition || typeof condition !== 'object') return false;
  const field = String(condition.field || '');
  const op = String(condition.op || 'equals').toLowerCase();
  const value = String(condition.value ?? '');
  if (field === 'direction') {
    return value === 'any' || transactionDirection(transaction) === value;
  }
  if (field === 'amount' || field === 'amount_cents') {
    const expected = Number(value.replace(',', '.'));
    if (!Number.isFinite(expected)) return false;
    const actual = (Number(transaction?.amount_cents) || 0) / 100;
    if (op === 'equals' || op === '=') return Math.abs(actual - expected) < 0.005;
    if (op === 'gt' || op === '>') return actual > expected;
    if (op === 'gte' || op === '>=') return actual >= expected;
    if (op === 'lt' || op === '<') return actual < expected;
    if (op === 'lte' || op === '<=') return actual <= expected;
    return false;
  }
  const actual = conditionStringValue(transaction, field).toLowerCase();
  const expected = value.toLowerCase();
  if (op === 'equals' || op === '=') return actual === expected;
  if (op === 'contains') return actual.includes(expected);
  if (op === 'starts' || op === 'starts_with') return actual.startsWith(expected);
  if (op === 'not_equals' || op === '!=') return actual !== expected;
  return false;
}

export function financeRuleMatches(rule, transaction) {
  let conditions = [];
  try {
    const parsed = JSON.parse(rule?.conditions_json || '[]');
    conditions = Array.isArray(parsed) ? parsed : [];
  } catch {
    conditions = [];
  }
  if (!conditions.length) return false;
  const results = conditions.map((condition) => financeRuleConditionMatches(transaction, condition));
  return normalizeMatchMode(rule?.match_mode) === 'any'
    ? results.some(Boolean)
    : results.every(Boolean);
}

export async function createFinanceTransactionAllocation({
  transaction,
  plan,
  item,
  assignedBy = 'manual',
  rule = null,
  rulesLocked,
}) {
  if (!transaction?.uuid) throw new Error('Finance transaction UUID is required');
  if (!plan?.uuid) throw new Error('Finance plan UUID is required');
  const now = nowIso();
  await query(
    `UPDATE finance_transaction_allocations
     SET is_active = 0, updated_at = ?, sync_dirty = 1, sync_status = 'pending'
     WHERE transaction_uuid = ? AND is_active = 1 AND is_deleted = 0`,
    [now, transaction.uuid],
  );
  const allocation = {
    uuid: uuidv4(),
    id: null,
    transaction_id: transaction.id ?? null,
    transaction_uuid: transaction.uuid,
    plan_id: plan.id ?? null,
    plan_uuid: plan.uuid,
    item_id: item?.id ?? null,
    item_uuid: item?.uuid || null,
    assigned_by: normalizeAssignedBy(assignedBy),
    rule_id: rule?.id ?? null,
    rule_uuid: rule?.uuid || null,
    is_active: 1,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
    sync_dirty: 1,
    sync_status: 'pending',
  };
  const { sql, params } = buildUpsertFinanceTransactionAllocation(allocation);
  await query(sql, params);
  if (rulesLocked !== undefined) {
    await setFinanceTransactionRulesLocked(transaction.uuid, rulesLocked);
  }
  return allocation;
}

export async function setFinanceTransactionRulesLocked(transactionUuid, rulesLocked) {
  await query(
    'UPDATE finance_transactions SET rules_locked = ?, updated_at = ?, sync_status = ? WHERE uuid = ?',
    [normalizeBool(rulesLocked, false), nowIso(), 'pending', transactionUuid],
  );
}

async function financeTransactionHasActiveAllocation(transactionUuid) {
  const result = await query(
    `SELECT uuid FROM finance_transaction_allocations
     WHERE transaction_uuid = ? AND is_active = 1 AND is_deleted = 0
     LIMIT 1`,
    [transactionUuid],
  );
  return result.rows.length > 0;
}

export async function applyFinanceMappingRule(rule, options = {}) {
  if (!normalizeBool(rule?.is_enabled, true)) return 0;
  if (!rule?.target_plan_uuid) throw new Error('Mapping rule target plan UUID is required');
  const transactions = await getFinanceTransactions();
  let appliedCount = 0;
  for (const transaction of transactions) {
    if (normalizeBool(transaction.rules_locked, false)) continue;
    if (!options.remapAssigned && await financeTransactionHasActiveAllocation(transaction.uuid)) continue;
    if (!financeRuleMatches(rule, transaction)) continue;
    await createFinanceTransactionAllocation({
      transaction,
      plan: { uuid: rule.target_plan_uuid, id: rule.target_plan_id ?? null },
      item: rule.target_item_uuid ? { uuid: rule.target_item_uuid, id: rule.target_item_id ?? null } : null,
      assignedBy: 'rule',
      rule,
    });
    appliedCount += 1;
  }
  return appliedCount;
}

export async function createFinanceMappingRule({
  name,
  isEnabled = true,
  priority = 0,
  matchMode = 'all',
  conditions = [],
  conditionsJson,
  targetPlan,
  targetItem,
  applyExisting = false,
  remapAssigned = false,
}) {
  if (!targetPlan?.uuid) throw new Error('Target finance list is required');
  const now = nowIso();
  const rule = {
    uuid: uuidv4(),
    id: null,
    name: name || 'New mapping rule',
    is_enabled: normalizeBool(isEnabled, true),
    priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
    match_mode: normalizeMatchMode(matchMode),
    conditions_json: conditionsJson || safeJsonText(conditions),
    target_plan_id: targetPlan.id ?? null,
    target_plan_uuid: targetPlan.uuid,
    target_item_id: targetItem?.id ?? null,
    target_item_uuid: targetItem?.uuid || null,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
    sync_status: 'pending',
  };
  const { sql, params } = buildUpsertFinanceMappingRule(rule);
  await query(sql, params);
  const appliedCount = applyExisting
    ? await applyFinanceMappingRule(rule, { remapAssigned })
    : 0;
  return { rule, appliedCount };
}

export async function updateFinanceMappingRule({
  uuid,
  id,
  name,
  isEnabled = true,
  priority = 0,
  matchMode = 'all',
  conditions = [],
  conditionsJson,
  targetPlan,
  targetItem,
  applyExisting = false,
  remapAssigned = false,
}) {
  if (!uuid && id == null) throw new Error('Mapping rule id is required');
  if (!targetPlan?.uuid) throw new Error('Target finance list is required');
  const existingResult = uuid
    ? await query('SELECT * FROM finance_mapping_rules WHERE uuid = ? LIMIT 1', [uuid])
    : await query('SELECT * FROM finance_mapping_rules WHERE id = ? LIMIT 1', [id]);
  const existing = rowsToArray(existingResult)[0] || {};
  const now = nowIso();
  const rule = {
    uuid: uuid || existing.uuid || uuidv4(),
    id: id ?? existing.id ?? null,
    name: name || existing.name || 'New mapping rule',
    is_enabled: normalizeBool(isEnabled, true),
    priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
    match_mode: normalizeMatchMode(matchMode),
    conditions_json: conditionsJson || safeJsonText(conditions),
    target_plan_id: targetPlan.id ?? existing.target_plan_id ?? null,
    target_plan_uuid: targetPlan.uuid,
    target_item_id: targetItem?.id ?? existing.target_item_id ?? null,
    target_item_uuid: targetItem?.uuid || existing.target_item_uuid || null,
    created_at: existing.created_at || now,
    updated_at: now,
    is_deleted: 0,
    sync_status: 'pending',
  };
  const { sql, params } = buildUpsertFinanceMappingRule(rule);
  await query(sql, params);
  const appliedCount = applyExisting
    ? await applyFinanceMappingRule(rule, { remapAssigned })
    : 0;
  return { rule, appliedCount };
}

export async function getNextFinancePlanSortOrder() {
  const result = await query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM finance_plans WHERE is_deleted = 0',
    [],
  );
  return result.rows.item(0).next_order || 0;
}

export async function getNextFinanceItemSortOrder(planUuid, parentUuid = null) {
  const where = ['plan_uuid = ?', 'is_deleted = 0'];
  const params = [planUuid];
  if (parentUuid) {
    where.push('parent_uuid = ?');
    params.push(parentUuid);
  } else {
    where.push('parent_uuid IS NULL');
  }
  const result = await query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM finance_items WHERE ${where.join(' AND ')}`,
    params,
  );
  return result.rows.item(0).next_order || 0;
}
