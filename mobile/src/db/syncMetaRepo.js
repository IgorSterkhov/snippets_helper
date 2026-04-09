import { getDB } from './database';

export function getLastSyncAt() {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.transaction((tx) => {
      tx.executeSql(
        'SELECT value FROM sync_meta WHERE key = ?',
        ['last_sync_at'],
        (_, result) => {
          if (result.rows.length > 0) {
            resolve(result.rows.item(0).value);
          } else {
            resolve(null);
          }
        },
        (_, error) => reject(error),
      );
    });
  });
}

export function setLastSyncAt(timestamp) {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.transaction((tx) => {
      tx.executeSql(
        'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
        ['last_sync_at', timestamp],
        () => resolve(),
        (_, error) => reject(error),
      );
    });
  });
}
