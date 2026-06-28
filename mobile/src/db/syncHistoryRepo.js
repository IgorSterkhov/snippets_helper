import { getDB } from './database';

const DEFAULT_LIMIT = 100;
const RETENTION_LIMIT = 200;

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

function detailsText(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function recordSyncHistoryEvents(events = []) {
  const cleanEvents = (events || []).filter(Boolean);
  if (!cleanEvents.length) return;
  await new Promise((resolve, reject) => {
    const db = getDB();
    db.transaction(
      (tx) => {
        for (const event of cleanEvents) {
          tx.executeSql(
            `INSERT INTO sync_history (
              created_at, status, table_name, row_uuid, direction, action, details_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              event.created_at || new Date().toISOString(),
              event.status || 'ok',
              event.table_name || event.table || null,
              event.row_uuid || event.uuid || null,
              event.direction || '',
              event.action || '',
              detailsText(event.details_json ?? event.details),
            ],
          );
        }
        tx.executeSql(
          `DELETE FROM sync_history
           WHERE id NOT IN (
             SELECT id FROM sync_history ORDER BY id DESC LIMIT ?
           )`,
          [RETENTION_LIMIT],
        );
      },
      (err) => reject(err),
      () => resolve(),
    );
  });
}

export async function getRecentSyncHistory(limit = DEFAULT_LIMIT) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, RETENTION_LIMIT));
  const result = await query(
    `SELECT id, created_at, status, table_name, row_uuid, direction, action, details_json
     FROM sync_history
     ORDER BY id DESC
     LIMIT ?`,
    [safeLimit],
  );
  return rowsToArray(result);
}
