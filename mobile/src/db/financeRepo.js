import { getDB } from './database';

export const FINANCE_PLAN_KINDS = ['monthly', 'project', 'one_time', 'general'];

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
  return {
    sql: `INSERT OR REPLACE INTO finance_plans
          (uuid, id, name, currency, kind, sort_order, created_at, updated_at, is_deleted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      plan.uuid,
      plan.id ?? null,
      plan.name || 'Untitled list',
      normalizeCurrency(plan.currency),
      normalizeKind(plan.kind),
      plan.sort_order || 0,
      createdAt(plan),
      updatedAt(plan),
      deletedFlag(plan),
    ],
  };
}

export async function upsertFinancePlan(plan) {
  const { sql, params } = buildUpsertFinancePlan(plan);
  await query(sql, params);
}

export async function deleteFinancePlan(uuid) {
  const now = nowIso();
  await query('UPDATE finance_plans SET is_deleted = 1, updated_at = ? WHERE uuid = ?', [now, uuid]);
  await query('UPDATE finance_items SET is_deleted = 1, updated_at = ? WHERE plan_uuid = ?', [now, uuid]);
}

export async function getModifiedFinancePlansSince(since) {
  const sql = since ? 'SELECT * FROM finance_plans WHERE updated_at > ?' : 'SELECT * FROM finance_plans';
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

export function buildUpsertFinanceItem(item) {
  return {
    sql: `INSERT OR REPLACE INTO finance_items
          (uuid, id, plan_id, plan_uuid, parent_id, parent_uuid, name, amount_cents,
           due_day, due_date, note, sort_order, created_at, updated_at, is_deleted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      deletedFlag(item),
    ],
  };
}

export async function upsertFinanceItem(item) {
  const { sql, params } = buildUpsertFinanceItem(item);
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
    await query('UPDATE finance_items SET is_deleted = 1, updated_at = ? WHERE uuid = ?', [now, itemUuid]);
  }
}

export async function getModifiedFinanceItemsSince(since) {
  const sql = since ? 'SELECT * FROM finance_items WHERE updated_at > ?' : 'SELECT * FROM finance_items';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
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
