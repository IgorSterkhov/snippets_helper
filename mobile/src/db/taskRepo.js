import { getDB } from './database';

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

function deletedFlag(row) {
  return row.is_deleted ? 1 : 0;
}

function createdAt(row) {
  return row.created_at || row.updated_at || nowIso();
}

function updatedAt(row) {
  return row.updated_at || nowIso();
}

// --- Categories ---

export async function getAllTaskCategories() {
  const result = await query(
    'SELECT * FROM task_categories WHERE is_deleted = 0 ORDER BY sort_order, name COLLATE NOCASE',
    [],
  );
  return rowsToArray(result);
}

export function buildUpsertTaskCategory(c) {
  return {
    sql: `INSERT OR REPLACE INTO task_categories (uuid, name, color, sort_order, created_at, updated_at, is_deleted)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [
      c.uuid,
      c.name || '',
      c.color || '#8b949e',
      c.sort_order || 0,
      createdAt(c),
      updatedAt(c),
      deletedFlag(c),
    ],
  };
}

export async function upsertTaskCategory(c) {
  const { sql, params } = buildUpsertTaskCategory(c);
  await query(sql, params);
}

export async function deleteTaskCategory(uuid) {
  const now = nowIso();
  await query('UPDATE task_categories SET is_deleted = 1, updated_at = ? WHERE uuid = ?', [now, uuid]);
  await query('UPDATE tasks SET category_uuid = NULL, updated_at = ? WHERE category_uuid = ?', [now, uuid]);
}

export async function getModifiedTaskCategoriesSince(since) {
  const sql = since ? 'SELECT * FROM task_categories WHERE updated_at > ?' : 'SELECT * FROM task_categories';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

// --- Statuses ---

export async function getAllTaskStatuses() {
  const result = await query(
    'SELECT * FROM task_statuses WHERE is_deleted = 0 ORDER BY sort_order, name COLLATE NOCASE',
    [],
  );
  return rowsToArray(result);
}

export function buildUpsertTaskStatus(s) {
  return {
    sql: `INSERT OR REPLACE INTO task_statuses (uuid, name, color, sort_order, created_at, updated_at, is_deleted)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [
      s.uuid,
      s.name || '',
      s.color || '#8b949e',
      s.sort_order || 0,
      createdAt(s),
      updatedAt(s),
      deletedFlag(s),
    ],
  };
}

export async function upsertTaskStatus(s) {
  const { sql, params } = buildUpsertTaskStatus(s);
  await query(sql, params);
}

export async function deleteTaskStatus(uuid) {
  const now = nowIso();
  await query('UPDATE task_statuses SET is_deleted = 1, updated_at = ? WHERE uuid = ?', [now, uuid]);
  await query('UPDATE tasks SET status_uuid = NULL, updated_at = ? WHERE status_uuid = ?', [now, uuid]);
}

export async function getModifiedTaskStatusesSince(since) {
  const sql = since ? 'SELECT * FROM task_statuses WHERE updated_at > ?' : 'SELECT * FROM task_statuses';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

// --- Tasks ---

export async function getAllTasks() {
  const result = await query(
    'SELECT * FROM tasks WHERE is_deleted = 0 ORDER BY is_pinned DESC, sort_order, updated_at DESC',
    [],
  );
  return rowsToArray(result);
}

export async function getTasksByFilters(categoryUuid = null, statusUuid = null, search = '') {
  const where = ['is_deleted = 0'];
  const params = [];
  if (categoryUuid) {
    where.push('category_uuid = ?');
    params.push(categoryUuid);
  }
  if (statusUuid) {
    where.push('status_uuid = ?');
    params.push(statusUuid);
  }
  if (search) {
    where.push('(title LIKE ? OR notes_md LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const result = await query(
    `SELECT * FROM tasks WHERE ${where.join(' AND ')}
     ORDER BY is_pinned DESC, sort_order, updated_at DESC`,
    params,
  );
  return rowsToArray(result);
}

export function buildUpsertTask(t) {
  return {
    sql: `INSERT OR REPLACE INTO tasks (uuid, title, category_uuid, status_uuid, is_pinned, bg_color,
          tracker_url, notes_md, sort_order, created_at, updated_at, is_deleted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      t.uuid,
      t.title || '',
      t.category_uuid || null,
      t.status_uuid || null,
      t.is_pinned ? 1 : 0,
      t.bg_color || null,
      t.tracker_url || null,
      t.notes_md || '',
      t.sort_order || 0,
      createdAt(t),
      updatedAt(t),
      deletedFlag(t),
    ],
  };
}

export async function upsertTask(t) {
  const { sql, params } = buildUpsertTask(t);
  await query(sql, params);
}

export async function deleteTask(uuid) {
  const now = nowIso();
  await query('UPDATE tasks SET is_deleted = 1, updated_at = ? WHERE uuid = ?', [now, uuid]);
  await query('UPDATE task_checkboxes SET is_deleted = 1, updated_at = ? WHERE task_uuid = ?', [now, uuid]);
  await query('UPDATE task_links SET is_deleted = 1, updated_at = ? WHERE task_uuid = ?', [now, uuid]);
}

export async function getModifiedTasksSince(since) {
  const sql = since ? 'SELECT * FROM tasks WHERE updated_at > ?' : 'SELECT * FROM tasks';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

// --- Checkboxes ---

export async function getTaskCheckboxes(taskUuid) {
  const result = await query(
    'SELECT * FROM task_checkboxes WHERE task_uuid = ? AND is_deleted = 0 ORDER BY parent_uuid, sort_order',
    [taskUuid],
  );
  return rowsToArray(result);
}

export function buildUpsertTaskCheckbox(c) {
  return {
    sql: `INSERT OR REPLACE INTO task_checkboxes (uuid, task_uuid, parent_uuid, text, is_checked,
          sort_order, created_at, updated_at, is_deleted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      c.uuid,
      c.task_uuid,
      c.parent_uuid || null,
      c.text || '',
      c.is_checked ? 1 : 0,
      c.sort_order || 0,
      createdAt(c),
      updatedAt(c),
      deletedFlag(c),
    ],
  };
}

export async function upsertTaskCheckbox(c) {
  const { sql, params } = buildUpsertTaskCheckbox(c);
  await query(sql, params);
}

export async function deleteTaskCheckbox(uuid) {
  const now = nowIso();
  const toDelete = new Set([uuid]);
  const queue = [uuid];
  while (queue.length) {
    const current = queue.shift();
    const result = await query(
      'SELECT uuid FROM task_checkboxes WHERE parent_uuid = ? AND is_deleted = 0',
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
    await query('UPDATE task_checkboxes SET is_deleted = 1, updated_at = ? WHERE uuid = ?', [now, itemUuid]);
  }
}

export async function getModifiedTaskCheckboxesSince(since) {
  const sql = since ? 'SELECT * FROM task_checkboxes WHERE updated_at > ?' : 'SELECT * FROM task_checkboxes';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

// --- Links ---

export async function getTaskLinks(taskUuid) {
  const result = await query(
    'SELECT * FROM task_links WHERE task_uuid = ? AND is_deleted = 0 ORDER BY sort_order',
    [taskUuid],
  );
  return rowsToArray(result);
}

export function buildUpsertTaskLink(l) {
  return {
    sql: `INSERT OR REPLACE INTO task_links (uuid, task_uuid, url, label, sort_order, created_at, updated_at, is_deleted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      l.uuid,
      l.task_uuid,
      l.url || '',
      l.label || null,
      l.sort_order || 0,
      createdAt(l),
      updatedAt(l),
      deletedFlag(l),
    ],
  };
}

export async function upsertTaskLink(l) {
  const { sql, params } = buildUpsertTaskLink(l);
  await query(sql, params);
}

export async function deleteTaskLink(uuid) {
  const now = nowIso();
  await query('UPDATE task_links SET is_deleted = 1, updated_at = ? WHERE uuid = ?', [now, uuid]);
}

export async function getModifiedTaskLinksSince(since) {
  const sql = since ? 'SELECT * FROM task_links WHERE updated_at > ?' : 'SELECT * FROM task_links';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

export async function getNextTaskSortOrder(table = 'tasks', whereColumn = null, whereValue = null) {
  const allowed = new Set(['task_categories', 'task_statuses', 'tasks', 'task_checkboxes', 'task_links']);
  if (!allowed.has(table)) return 0;
  let sql = `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM ${table} WHERE is_deleted = 0`;
  const params = [];
  if (whereColumn && whereValue) {
    const allowedColumns = new Set(['task_uuid', 'parent_uuid', 'category_uuid', 'status_uuid']);
    if (!allowedColumns.has(whereColumn)) return 0;
    sql += ` AND ${whereColumn} = ?`;
    params.push(whereValue);
  }
  const result = await query(sql, params);
  return result.rows.item(0).next_order || 0;
}
