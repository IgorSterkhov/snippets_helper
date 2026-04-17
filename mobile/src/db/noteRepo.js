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

// --- Folders ---

export async function getAllFolders() {
  const result = await query('SELECT * FROM note_folders WHERE is_deleted = 0 ORDER BY sort_order', []);
  return rowsToArray(result);
}

export async function upsertFolder(f) {
  await query(
    `INSERT OR REPLACE INTO note_folders (uuid, id, name, sort_order, parent_id, updated_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [f.uuid, f.id ?? null, f.name, f.sort_order || 0, f.parent_id || null, f.updated_at, f.is_deleted ? 1 : 0],
  );
}

export async function deleteFolder(uuid) {
  const now = new Date().toISOString();
  await query('UPDATE note_folders SET is_deleted = 1, updated_at = ? WHERE uuid = ?', [now, uuid]);
}

export async function getModifiedFoldersSince(since) {
  const sql = since
    ? 'SELECT * FROM note_folders WHERE updated_at > ?'
    : 'SELECT * FROM note_folders';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

// --- Notes ---

export async function getNotesByFolder(folderUuid) {
  const result = await query(
    'SELECT * FROM notes WHERE folder_uuid = ? AND is_deleted = 0 ORDER BY is_pinned DESC, updated_at DESC',
    [folderUuid],
  );
  return rowsToArray(result);
}

export async function getAllNotes() {
  const result = await query('SELECT * FROM notes WHERE is_deleted = 0 ORDER BY updated_at DESC', []);
  return rowsToArray(result);
}

export async function searchNotes(q) {
  const result = await query(
    'SELECT * FROM notes WHERE is_deleted = 0 AND (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC',
    [`%${q}%`, `%${q}%`],
  );
  return rowsToArray(result);
}

export async function upsertNote(n) {
  await query(
    `INSERT OR REPLACE INTO notes (uuid, folder_uuid, title, content, created_at, updated_at, is_pinned, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [n.uuid, n.folder_uuid || null, n.title, n.content || '', n.created_at || new Date().toISOString(), n.updated_at, n.is_pinned || 0, n.is_deleted ? 1 : 0],
  );
}

export async function deleteNote(uuid) {
  const now = new Date().toISOString();
  await query('UPDATE notes SET is_deleted = 1, updated_at = ? WHERE uuid = ?', [now, uuid]);
}

export async function getModifiedNotesSince(since) {
  const sql = since
    ? 'SELECT * FROM notes WHERE updated_at > ?'
    : 'SELECT * FROM notes';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}
