import { createClient } from './client';

let client = null;

export function initApi(baseUrl, apiKey) {
  client = createClient(baseUrl, apiKey);
}

export function getMe() {
  return client.get('/v1/auth/me');
}

export function syncPush(changes) {
  return client.post('/v1/sync/push', { changes });
}

export function syncPull(lastSyncAt) {
  return client.post('/v1/sync/pull', { last_sync_at: lastSyncAt });
}

export function checkUpdate() {
  return client.get('/v1/mobile/update/check');
}
