// Thin wrapper over Tauri invoke for Gemma local-LLM post-processing.
//
// Mirrors the structure of whisper-api.js. All calls are lazy — first
// postprocess() triggers model warm-up; server idle-unloads after 5 min.

import { call } from '../../tauri-api.js';

export const gemmaApi = {
  listCatalog: () => call('gemma_list_catalog'),
  listModels: () => call('gemma_list_models'),
  installModel: (name) => call('gemma_install_model', { name }),
  deleteModel: (name) => call('gemma_delete_model', { name }),
  setDefaultModel: (name) => call('gemma_set_default_model', { name }),
  postprocess: (text) => call('gemma_postprocess', { text }),
  unloadNow: () => call('gemma_unload_now'),
};

const EVENTS = {
  stateChanged: 'gemma:state-changed',
  modelDownload: 'gemma:model-download',
};

export async function onGemmaEvent(name, handler) {
  const listen = window.__TAURI__?.event?.listen;
  if (!listen) return () => {};
  const event = EVENTS[name] || name;
  const unlisten = await listen(event, (e) => handler(e.payload));
  return unlisten;
}
