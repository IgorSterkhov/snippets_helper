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

export async function getAiAgentSettings() {
  return call('get_ai_agent_settings');
}

export async function saveAiAgentSettings(customInstructions) {
  return call('save_ai_agent_settings', {
    customInstructions,
  });
}

export async function getAiCapabilities() {
  return call('get_ai_capabilities');
}

export async function previewAiPrompt({ mode = 'command', channel = 'client', message, context = {} }) {
  return call('preview_ai_prompt', {
    request: {
      mode,
      channel,
      message,
      context,
    },
  });
}
