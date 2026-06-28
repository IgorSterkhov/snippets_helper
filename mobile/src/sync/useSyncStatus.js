import { useEffect, useState } from 'react';
import { subscribeSyncStatus, countPendingChanges } from './syncService';
import { getLastSyncDebug } from '../db/syncMetaRepo';
import { getRecentSyncHistory } from '../db/syncHistoryRepo';

export function useSyncStatus() {
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastDebug, setLastDebug] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const refreshDetails = () => {
      countPendingChanges().then((n) => {
        if (!cancelled) setPending(n);
      }).catch(() => {});
      getLastSyncDebug().then((debug) => {
        if (!cancelled) setLastDebug(debug);
      }).catch(() => {});
      getRecentSyncHistory(80).then((rows) => {
        if (!cancelled) setHistory(rows);
      }).catch(() => {});
    };
    refreshDetails();

    const unsub = subscribeSyncStatus((evt) => {
      if (evt.type === 'pending') setPending(evt.count);
      else if (evt.type === 'syncing') {
        setSyncing(evt.value);
        if (!evt.value) refreshDetails();
      } else if (evt.type === 'debug') {
        setLastDebug(evt.debug || null);
        getRecentSyncHistory(80).then((rows) => {
          if (!cancelled) setHistory(rows);
        }).catch(() => {});
      }
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  return { pending, syncing, lastDebug, history };
}
