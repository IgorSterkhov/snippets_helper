import { useEffect, useState } from 'react';
import { subscribeSyncStatus, countPendingChanges } from './syncService';

export function useSyncStatus() {
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    countPendingChanges().then((n) => {
      if (!cancelled) setPending(n);
    }).catch(() => {});

    const unsub = subscribeSyncStatus((evt) => {
      if (evt.type === 'pending') setPending(evt.count);
      else if (evt.type === 'syncing') setSyncing(evt.value);
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  return { pending, syncing };
}
