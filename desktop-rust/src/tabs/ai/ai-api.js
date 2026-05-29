import { call } from '../../tauri-api.js';

export async function sendAiChat({ mode, message, context = {} }) {
  return call('ai_chat', {
    request: {
      mode,
      channel: 'client',
      message,
      context,
    },
  });
}
