import NetInfo from '@react-native-community/netinfo';
import { performSync } from './syncService';
import { AppState } from 'react-native';

let unsubscribeNet = null;
let appStateSubscription = null;

export function startNetworkListener() {
  // Sync when network comes back online
  let wasOffline = false;
  unsubscribeNet = NetInfo.addEventListener((state) => {
    if (state.isConnected && wasOffline) {
      performSync().catch(console.warn);
    }
    wasOffline = !state.isConnected;
  });

  // Sync when app returns from background
  appStateSubscription = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      performSync().catch(console.warn);
    }
  });
}

export function stopNetworkListener() {
  if (unsubscribeNet) unsubscribeNet();
  if (appStateSubscription) appStateSubscription.remove();
}
