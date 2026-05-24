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

export function getShareLink(itemType, itemUuid) {
  const type = encodeURIComponent(itemType);
  const uuid = encodeURIComponent(itemUuid);
  return client.get(`/v1/share-links?item_type=${type}&item_uuid=${uuid}`);
}

export function createShareLink(itemType, itemUuid) {
  return client.post('/v1/share-links', { item_type: itemType, item_uuid: itemUuid });
}

export function revokeShareLink(token) {
  return client.delete(`/v1/share-links/${encodeURIComponent(token)}`);
}
