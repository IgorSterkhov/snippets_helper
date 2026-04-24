// Entry for Whisper tab. Routes to onboarding (no models) or main tab.

import { whisperApi } from './whisper-api.js';

export async function init(container) {
  container.innerHTML = '';
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;height:100%;overflow:hidden;padding:0';

  const loading = document.createElement('div');
  loading.textContent = 'Loading…';
  loading.style.cssText = 'padding:24px;color:var(--text-muted,#8b949e)';
  container.appendChild(loading);

  let models = [];
  try {
    models = await whisperApi.listModels();
  } catch (e) {
    console.error('[whisper] listModels failed', e);
  }

  container.innerHTML = '';
  if (!models || models.length === 0) {
    const { initOnboarding } = await import('./whisper-onboarding.js');
    await initOnboarding(container, { onInstalled: () => init(container) });
  } else {
    const { initTab } = await import('./whisper-tab.js');
    await initTab(container);
  }
}
