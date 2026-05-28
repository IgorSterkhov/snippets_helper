// Thin wrapper over Tauri invoke for whisper commands + event listen.

import { call } from '../../tauri-api.js';

export const whisperApi = {
  // catalog / models
  listCatalog: () => call('whisper_list_catalog'),
  listModels: () => call('whisper_list_models'),
  installModel: (name) => call('whisper_install_model', { name }),
  deleteModel: (name) => call('whisper_delete_model', { name }),
  setDefaultModel: (name) => call('whisper_set_default_model', { name }),

  // recording
  startRecording: () => call('whisper_start_recording'),
  stopRecording: () => call('whisper_stop_recording'),
  cancelRecording: () => call('whisper_cancel_recording'),
  stopActive: () => call('whisper_stop_active'),
  cancelActive: () => call('whisper_cancel_active'),
  status: () => call('whisper_status'),
  startLive: () => call('whisper_live_start'),
  stopLive: () => call('whisper_live_stop'),
  cancelLive: () => call('whisper_live_cancel'),
  liveStatus: () => call('whisper_live_status'),
  unloadNow: () => call('whisper_unload_now'),
  injectText: (text, method) => call('whisper_inject_text', { text, method }),

  // history
  getHistory: (limit = 200) => call('whisper_get_history', { limit }),
  deleteHistory: (id = null) => call('whisper_delete_history', { id }),
  setPostprocessed: (id, text) => call('whisper_set_postprocessed', { id, text }),

  // diagnostics
  listMics: () => call('whisper_list_mics'),
  gpuInfo: () => call('whisper_gpu_info'),
  detectWhisperBin: () => call('whisper_detect_whisper_bin'),

  // settings (via existing get_setting/set_setting commands)
  getSetting: (key) => call('get_setting', { key }),
  setSetting: (key, value) => call('set_setting', { key, value: String(value) }),
};

const EVENTS = {
  stateChanged: 'whisper:state-changed',
  level: 'whisper:level',
  modelDownload: 'whisper:model-download',
  transcribed: 'whisper:transcribed',
  error: 'whisper:error',
  liveStateChanged: 'whisper:live-state-changed',
  liveLevel: 'whisper:live-level',
  liveInterim: 'whisper:live-interim',
  liveFinal: 'whisper:live-final',
  liveError: 'whisper:live-error',
};

export async function onWhisperEvent(name, handler) {
  const listen = window.__TAURI__?.event?.listen;
  if (!listen) {
    console.warn('[whisper-api] no event listener available');
    return () => {};
  }
  const event = EVENTS[name] || name;
  const unlisten = await listen(event, (e) => handler(e.payload));
  return unlisten;
}
