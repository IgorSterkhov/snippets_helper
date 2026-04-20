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

// --- Snippets ---

export async function getAllSnippets() {
  const result = await query('SELECT * FROM shortcuts WHERE is_deleted = 0 ORDER BY name COLLATE NOCASE', []);
  return rowsToArray(result);
}

export async function searchSnippets(q) {
  const result = await query(
    'SELECT * FROM shortcuts WHERE is_deleted = 0 AND (name LIKE ? OR value LIKE ? OR description LIKE ?) ORDER BY name COLLATE NOCASE',
    [`%${q}%`, `%${q}%`, `%${q}%`],
  );
  return rowsToArray(result);
}

export function buildUpsertSnippet(s) {
  return {
    sql: `INSERT OR REPLACE INTO shortcuts (uuid, name, value, description, links, obsidian_note, updated_at, is_deleted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [s.uuid, s.name, s.value, s.description || '', s.links || '[]', s.obsidian_note || '', s.updated_at, s.is_deleted ? 1 : 0],
  };
}

export async function upsertSnippet(s) {
  const { sql, params } = buildUpsertSnippet(s);
  await query(sql, params);
}

export async function deleteSnippet(uuid) {
  const now = new Date().toISOString();
  await query('UPDATE shortcuts SET is_deleted = 1, updated_at = ? WHERE uuid = ?', [now, uuid]);
}

export async function getModifiedSnippetsSince(since) {
  const sql = since
    ? 'SELECT * FROM shortcuts WHERE updated_at > ?'
    : 'SELECT * FROM shortcuts';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

// --- Tags ---

export async function getAllTags() {
  const result = await query('SELECT * FROM snippet_tags WHERE is_deleted = 0 ORDER BY sort_order', []);
  return rowsToArray(result);
}

export function buildUpsertTag(t) {
  return {
    sql: `INSERT OR REPLACE INTO snippet_tags (uuid, name, patterns, color, sort_order, updated_at, is_deleted)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [t.uuid, t.name, t.patterns || '[]', t.color || '#388bfd', t.sort_order || 0, t.updated_at, t.is_deleted ? 1 : 0],
  };
}

export async function upsertTag(t) {
  const { sql, params } = buildUpsertTag(t);
  await query(sql, params);
}

export async function getModifiedTagsSince(since) {
  const sql = since
    ? 'SELECT * FROM snippet_tags WHERE updated_at > ?'
    : 'SELECT * FROM snippet_tags';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}
