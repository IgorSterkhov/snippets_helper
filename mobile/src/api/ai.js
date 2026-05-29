import { createClient } from './client';

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

export function sendAiChat(baseUrl, apiKey, request) {
  const client = createClient(normalizeBaseUrl(baseUrl), apiKey);
  return client.post('/v1/ai/chat', {
    ...request,
    channel: 'client',
  });
}
