import { whisperApi, onWhisperEvent } from './whisper-api.js';
import { gemmaApi, onGemmaEvent } from './gemma-api.js';
import { openSettingsModal } from './whisper-settings.js';
import { showErrorDialog } from '../../components/error-dialog.js';
import { call } from '../../tauri-api.js';
import { helpButton } from '../sql/sql-help.js';
import { WHISPER_HELP_HTML } from './help-content.js';

const GEMMA_NO_MODELS_VALUE = '__open_settings__';

export async function initTab(container) {
  container.innerHTML = '';
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;height:100%;overflow:hidden;padding:0';

  const state = {
    recording: false,
    currentState: 'idle',
    selectedId: null,
    history: [],
    cleanup: [],
    activeTab: 'whisper',          // 'whisper' | 'postprocessed'
    gemmaState: 'idle',
    whisperTimerId: null,
    whisperStartedAt: 0,
    gemmaProgressHideId: null,
    liveDictate: false,
    liveState: 'idle',
    liveModel: 'nova-3',
    liveProvider: 'deepgram',
    liveCommittedText: '',
    liveInterimText: '',
  };

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border,#30363d);background:var(--bg-secondary,#161b22);flex-shrink:0;flex-wrap:wrap';
  header.innerHTML = `
    <span style="font-weight:600;color:var(--text,#c9d1d9)">🎤 Whisper</span>
    <span id="state-chip" style="padding:2px 8px;background:var(--bg,#0d1117);border-radius:10px;font-size:11px;color:var(--text-muted,#8b949e)">○ idle</span>
    <span style="margin-left:8px;color:var(--text-muted,#8b949e);font-size:11px">Whisper:</span>
    <select id="model-select" title="Active Whisper model (switching unloads the warmed server)" style="padding:3px 6px;background:var(--bg,#0d1117);color:var(--text,#c9d1d9);border:1px solid var(--border,#30363d);border-radius:4px;font-size:11px;cursor:pointer;max-width:220px"></select>
    <span style="color:var(--text-muted,#8b949e);font-size:11px">Gemma:</span>
    <select id="gemma-model-select" title="Gemma post-processing model" style="padding:3px 6px;background:var(--bg,#0d1117);color:var(--text,#c9d1d9);border:1px solid var(--border,#30363d);border-radius:4px;font-size:11px;cursor:pointer;max-width:220px"></select>
    <label id="live-dictate-label" title="Live dictate streams audio through the selected cloud provider and pastes finalized chunks into the active app" style="display:flex;align-items:center;gap:5px;padding:3px 8px;background:var(--bg,#0d1117);border:1px solid var(--border,#30363d);border-radius:4px;color:var(--text,#c9d1d9);font-size:11px;cursor:pointer;user-select:none">
      <input id="live-dictate-toggle" type="checkbox" style="margin:0;accent-color:var(--accent,#388bfd)">
      <span>Live dictate</span>
    </label>
    <select id="live-provider-select" title="Live dictation cloud provider" style="padding:3px 6px;background:var(--bg,#0d1117);color:var(--text,#c9d1d9);border:1px solid var(--border,#30363d);border-radius:4px;font-size:11px;cursor:pointer">
      <option value="deepgram">Deepgram</option>
      <option value="yandex">Yandex SpeechKit</option>
    </select>
    <span style="flex:1"></span>
    <button id="cancel-btn" title="Cancel without transcribing (Esc)" style="padding:5px 10px;background:transparent;color:var(--red,#f85149);border:1px solid var(--red,#f85149);border-radius:4px;cursor:pointer;font-weight:500;display:none">✕ Cancel</button>
    <button id="record-btn" style="padding:5px 14px;background:var(--accent,#388bfd);color:#fff;border:0;border-radius:4px;cursor:pointer;font-weight:600">🎤 Record</button>
    <button id="settings-btn" style="padding:5px 10px;background:transparent;color:var(--text-muted,#8b949e);border:1px solid var(--border,#30363d);border-radius:4px;cursor:pointer">⚙</button>
  `;
  const help = helpButton('Whisper — справка', WHISPER_HELP_HTML);
  help.title = 'Whisper help';
  header.appendChild(help);
  container.appendChild(header);

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex:1;overflow:hidden';
  container.appendChild(body);

  const left = document.createElement('div');
  left.style.cssText = 'width:38%;min-width:240px;border-right:1px solid var(--border,#30363d);overflow-y:auto';
  body.appendChild(left);

  const right = document.createElement('div');
  right.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';
  body.appendChild(right);

  // ── Tab bar ─────────────────────────────────────────────────────────────
  const tabBar = document.createElement('div');
  tabBar.style.cssText = 'display:flex;border-bottom:1px solid var(--border,#30363d);flex-shrink:0;background:var(--bg,#0d1117)';
  tabBar.innerHTML = `
    <button data-tab="whisper" class="ws-tab" style="padding:8px 14px;background:transparent;border:0;border-bottom:2px solid transparent;color:var(--text,#c9d1d9);cursor:pointer;font-size:12px;font-weight:500">Whisper output</button>
    <button data-tab="postprocessed" class="ws-tab" style="padding:8px 14px;background:transparent;border:0;border-bottom:2px solid transparent;color:var(--text-muted,#8b949e);cursor:pointer;font-size:12px;font-weight:500">Post-processed <span class="pp-dot" style="display:none;color:var(--green,#3fb950);margin-left:4px">●</span></button>
  `;
  right.appendChild(tabBar);

  // ── Detail (panes) ─────────────────────────────────────────────────────
  const detail = document.createElement('div');
  detail.style.cssText = 'flex:1;padding:14px;overflow:auto;display:flex;flex-direction:column;gap:10px';
  right.appendChild(detail);

  // Two textareas — only the active one is visible. We keep both mounted so
  // their cursor/selection survive a tab switch.
  const whisperPane = document.createElement('div');
  whisperPane.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:10px;min-height:0';
  detail.appendChild(whisperPane);

  const postPane = document.createElement('div');
  postPane.style.cssText = 'flex:1;display:none;flex-direction:column;gap:10px;min-height:0';
  detail.appendChild(postPane);

  const whisperTextarea = document.createElement('textarea');
  whisperTextarea.style.cssText = 'width:100%;min-height:200px;flex:1;padding:10px;background:var(--bg,#0d1117);border:1px solid var(--border,#30363d);color:var(--text,#c9d1d9);border-radius:4px;font-family:inherit;font-size:13px;line-height:1.55;resize:vertical';
  whisperPane.appendChild(whisperTextarea);

  const meta = document.createElement('div');
  meta.style.cssText = 'font-size:11px;color:var(--text-muted,#8b949e)';
  whisperPane.appendChild(meta);

  const postTextarea = document.createElement('textarea');
  postTextarea.placeholder = 'Post-process не запускался. Перейдите в Whisper output и нажмите ✨ Post-process.';
  postTextarea.style.cssText = 'width:100%;min-height:200px;flex:1;padding:10px;background:var(--bg,#0d1117);border:1px solid var(--border,#30363d);color:var(--text,#c9d1d9);border-radius:4px;font-family:inherit;font-size:13px;line-height:1.55;resize:vertical';
  postPane.appendChild(postTextarea);

  // ── Status strip ────────────────────────────────────────────────────────
  const statusStrip = document.createElement('div');
  statusStrip.id = 'status-strip';
  statusStrip.style.cssText = 'display:none;position:relative;padding:5px 12px;border-top:1px solid var(--border,#30363d);border-bottom:1px solid var(--border,#30363d);font-size:11px;color:var(--text-muted,#8b949e);background:var(--bg,#0d1117);overflow:hidden;flex-shrink:0';
  // Fill bar (absolute, behind text). Width is set dynamically.
  const stripFill = document.createElement('div');
  stripFill.style.cssText = 'position:absolute;inset:0 auto 0 0;width:0%;background:rgba(56,139,253,0.18);transition:width 120ms linear;pointer-events:none';
  statusStrip.appendChild(stripFill);
  const stripText = document.createElement('span');
  stripText.style.cssText = 'position:relative;z-index:1';
  statusStrip.appendChild(stripText);
  right.appendChild(statusStrip);

  // ── Actions ─────────────────────────────────────────────────────────────
  const actions = document.createElement('div');
  actions.style.cssText = 'padding:10px;border-top:1px solid var(--border,#30363d);display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0';
  right.appendChild(actions);

  const chip = header.querySelector('#state-chip');
  const modelSelect = header.querySelector('#model-select');
  const gemmaSelect = header.querySelector('#gemma-model-select');
  const liveToggle = header.querySelector('#live-dictate-toggle');
  const liveLabel = header.querySelector('#live-dictate-label');
  const providerSelect = header.querySelector('#live-provider-select');
  const recordBtn = header.querySelector('#record-btn');
  const cancelBtn = header.querySelector('#cancel-btn');

  // Cached last-committed default name. Used to revert the dropdown if the
  // backend rejects the change. We also use it to suppress the change
  // handler when we repopulate the <select> programmatically.
  let committedDefault = null;
  let programmaticSelect = false;
  let committedGemmaDefault = null;
  let programmaticGemmaSelect = false;
  let activeHistoryRef = null;
  let ppBtnRef = null;

  function setChip(st) {
    state.currentState = st;
    renderControls();
  }

  function setLiveState(st, model, provider) {
    state.liveState = st || 'idle';
    if (model) state.liveModel = model;
    if (provider) {
      state.liveProvider = provider;
      providerSelect.value = provider;
    }
    renderControls();
  }

  function renderControls() {
    const localMap = {
      idle:         { label: '○ idle',           color: 'var(--text-muted,#8b949e)' },
      warming:      { label: '⏳ warming up',    color: 'var(--warn,#f0883e)' },
      ready:        { label: '● ready',          color: 'var(--green,#3fb950)' },
      recording:    { label: '🔴 recording',     color: 'var(--red,#f85149)' },
      transcribing: { label: '💭 transcribing',  color: 'var(--blue,#58a6ff)' },
      unloading:    { label: '… unloading',      color: 'var(--text-muted,#8b949e)' },
    };
    const liveMap = {
      idle:       { label: '○ live idle',       color: 'var(--text-muted,#8b949e)' },
      connecting: { label: '⏳ live connecting', color: 'var(--warn,#f0883e)' },
      streaming:  { label: '● live streaming',  color: 'var(--green,#3fb950)' },
      stopping:   { label: '… live stopping',   color: 'var(--blue,#58a6ff)' },
      error:      { label: '⚠ live error',      color: 'var(--red,#f85149)' },
    };
    const localBusy = isLocalBusy();
    const liveBusy = isLiveBusy();
    const showLive = state.liveDictate || liveBusy;
    const m = showLive ? (liveMap[state.liveState] || liveMap.idle) : (localMap[state.currentState] || localMap.idle);
    chip.textContent = m.label;
    chip.style.color = m.color;

    if (showLive) {
      if (state.liveState === 'streaming') {
        setRecordButton('⏹ Stop live', 'live-stop', false);
      } else if (state.liveState === 'connecting') {
        setRecordButton('⏳ Connecting…', 'noop', true);
      } else if (state.liveState === 'stopping') {
        setRecordButton('… Stopping…', 'noop', true);
      } else {
        setRecordButton('🎙 Start live', 'live-start', localBusy);
      }
    } else if (state.currentState === 'recording') {
      setRecordButton('⏹ Stop', 'stop', false);
    } else if (state.currentState === 'warming' || state.currentState === 'transcribing' || state.currentState === 'unloading') {
      const label = state.currentState === 'warming' ? '⏳ Warming…'
                  : state.currentState === 'transcribing' ? '💭 Transcribing…'
                  : '… Unloading';
      setRecordButton(label, 'noop', true);
    } else {
      setRecordButton('🎤 Record', 'start', false);
    }

    const lock = localBusy || liveBusy;
    modelSelect.disabled = lock;
    modelSelect.style.opacity = lock ? '0.55' : '1';
    modelSelect.style.cursor = lock ? 'not-allowed' : 'pointer';

    liveToggle.disabled = lock;
    liveLabel.style.opacity = lock ? '0.55' : '1';
    liveLabel.style.cursor = lock ? 'not-allowed' : 'pointer';
    providerSelect.disabled = lock;
    providerSelect.style.opacity = lock ? '0.55' : '1';
    providerSelect.style.cursor = lock ? 'not-allowed' : 'pointer';

    cancelBtn.style.display = lock ? '' : 'none';

    if (state.currentState === 'transcribing') {
      startWhisperElapsedTimer();
    } else {
      stopWhisperElapsedTimer();
    }
  }

  function setRecordButton(label, mode, disabled) {
    recordBtn.textContent = label;
    recordBtn.dataset.mode = mode;
    recordBtn.disabled = disabled;
    recordBtn.style.opacity = disabled ? '0.55' : '1';
    recordBtn.style.cursor = disabled ? 'not-allowed' : 'pointer';
  }

  function isLocalBusy(st = state.currentState) {
    return st === 'warming' || st === 'recording' || st === 'transcribing' || st === 'unloading';
  }

  function isLiveBusy(st = state.liveState) {
    return st === 'connecting' || st === 'streaming' || st === 'stopping';
  }

  recordBtn.onclick = async () => {
    if (recordBtn.disabled || recordBtn.dataset.mode === 'noop') return;
    try {
      if (recordBtn.dataset.mode === 'live-stop') {
        await whisperApi.stopLive();
        state.liveInterimText = '';
        await reloadHistory();
      } else if (recordBtn.dataset.mode === 'live-start') {
        state.liveCommittedText = '';
        state.liveInterimText = '';
        renderLivePreview();
        await whisperApi.startLive();
      } else if (recordBtn.dataset.mode === 'stop') {
        await whisperApi.stopRecording();
        await reloadHistory();
      } else {
        await whisperApi.startRecording();
      }
    } catch (e) {
      showWhisperError(
        'Whisper action failed',
        formatErrorMessage(e, 'The requested Whisper action failed.'),
        e,
        { action: recordBtn.dataset.mode || null }
      );
    }
  };
  cancelBtn.onclick = async () => {
    try {
      if (isLiveBusy()) {
        await whisperApi.cancelLive();
        state.liveCommittedText = '';
        state.liveInterimText = '';
        renderLivePreview();
      } else {
        await whisperApi.cancelRecording();
      }
      toast('Cancelled');
    } catch (e) {
      showWhisperError('Whisper cancel failed', formatErrorMessage(e, 'The active Whisper action could not be cancelled.'), e, {
        action: isLiveBusy() ? 'live_cancel' : 'local_cancel',
      });
    }
  };
  liveToggle.onchange = async () => {
    const prev = state.liveDictate;
    state.liveDictate = liveToggle.checked;
    renderControls();
    try {
      await whisperApi.setSetting('whisper.live_dictate', state.liveDictate ? 'true' : 'false');
    } catch (e) {
      state.liveDictate = prev;
      liveToggle.checked = prev;
      renderControls();
      showWhisperError('Live dictate setting failed', formatErrorMessage(e, 'The Live dictate setting could not be saved.'), e, {
        setting: 'whisper.live_dictate',
        attempted_value: state.liveDictate,
      });
    }
  };
  providerSelect.onchange = async () => {
    const prev = state.liveProvider;
    state.liveProvider = providerSelect.value || 'deepgram';
    try {
      await whisperApi.setSetting('whisper.live_provider', state.liveProvider);
      renderLivePreview();
    } catch (e) {
      state.liveProvider = prev;
      providerSelect.value = prev;
      showWhisperError('Live provider setting failed', formatErrorMessage(e, 'The live provider setting could not be saved.'), e, {
        setting: 'whisper.live_provider',
        attempted_value: state.liveProvider,
      });
    }
  };
  header.querySelector('#settings-btn').onclick = () => openSettingsModal();

  // Ctrl+Space as in-tab shortcut, Esc cancels.
  const onKey = (e) => {
    if (e.ctrlKey && e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      recordBtn.click();
    } else if (e.key === 'Escape' && !e.repeat && cancelBtn.style.display !== 'none') {
      if (document.querySelector('.modal-overlay')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelBtn.click();
    }
  };
  document.addEventListener('keydown', onKey, true);
  state.cleanup.push(() => document.removeEventListener('keydown', onKey, true));

  const offState = await onWhisperEvent('stateChanged', (p) => {
    setChip(p.state);
    if (p.model) {
      selectModelInDropdown(p.model);
    } else if (p.state === 'idle') {
      refreshModelSelect();
    }
  });
  state.cleanup.push(offState);

  // Gemma state — drives the gemma dropdown lock.
  const offGemmaState = await onGemmaEvent('stateChanged', (p) => {
    state.gemmaState = p.state || 'idle';
    const lock = state.gemmaState === 'warming'
              || state.gemmaState === 'busy'
              || state.gemmaState === 'unloading';
    gemmaSelect.disabled = lock;
    gemmaSelect.style.opacity = lock ? '0.55' : '1';
    gemmaSelect.style.cursor = lock ? 'not-allowed' : 'pointer';
  });
  state.cleanup.push(offGemmaState);

  // Gemma post-process progress — drives the status strip.
  const offGemmaProgress = await onGemmaEvent('postprocessProgress', (p) => {
    if (p.done) {
      // Final emit — fade out shortly after.
      stripFill.style.width = '100%';
      if (state.gemmaProgressHideId) clearTimeout(state.gemmaProgressHideId);
      state.gemmaProgressHideId = setTimeout(() => hideStatusStrip(), 350);
      return;
    }
    if (state.gemmaProgressHideId) {
      clearTimeout(state.gemmaProgressHideId);
      state.gemmaProgressHideId = null;
    }
    const total = Math.max(1, p.n_predict || 1);
    const pct = Math.min(100, Math.round((p.tokens_done || 0) / total * 100));
    const elapsedSec = ((p.elapsed_ms || 0) / 1000).toFixed(1);
    showStatusStrip();
    stripFill.style.width = pct + '%';
    stripText.textContent = `✨ ${pct}% · ${p.tokens_done || 0}/${p.n_predict || 0} tok · ${elapsedSec}s`;
  });
  state.cleanup.push(offGemmaProgress);

  async function refreshModelSelect() {
    try {
      const ms = await whisperApi.listModels();
      const def = ms.find(m => m.is_default);
      const current = def ? def.name : (ms[0] ? ms[0].name : null);
      committedDefault = current;
      programmaticSelect = true;
      modelSelect.innerHTML = '';
      if (!ms.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '(no models installed)';
        modelSelect.appendChild(opt);
        modelSelect.disabled = true;
        modelSelect.style.opacity = '0.55';
      } else {
        for (const m of ms) {
          const opt = document.createElement('option');
          opt.value = m.name;
          opt.textContent = m.display_name + (m.is_default ? '  · default' : '');
          if (m.name === current) opt.selected = true;
          modelSelect.appendChild(opt);
        }
      }
      programmaticSelect = false;
    } catch (e) { /* ignore */ }
  }

  function selectModelInDropdown(name) {
    if (!name) return;
    const hasOption = Array.from(modelSelect.options).some(o => o.value === name);
    if (!hasOption) {
      refreshModelSelect();
      return;
    }
    programmaticSelect = true;
    modelSelect.value = name;
    programmaticSelect = false;
  }

  modelSelect.onchange = async () => {
    if (programmaticSelect) return;
    const newName = modelSelect.value;
    if (!newName || newName === committedDefault) return;
    if (state.currentState !== 'idle' && state.currentState !== 'ready') {
      selectModelInDropdown(committedDefault);
      return;
    }
    const prev = committedDefault;
    modelSelect.disabled = true;
    modelSelect.style.opacity = '0.55';
    modelSelect.style.cursor = 'not-allowed';
    try {
      await whisperApi.setDefaultModel(newName);
      try { await whisperApi.unloadNow(); } catch (_) { /* non-fatal */ }
      committedDefault = newName;
      window.dispatchEvent(new CustomEvent('whisper:settings-changed'));
      toast(`Whisper: ${newName}`);
    } catch (e) {
      showWhisperError('Whisper model switch failed', formatErrorMessage(e, 'The default Whisper model could not be changed.'), e, {
        previous_model: prev,
        requested_model: newName,
      });
      selectModelInDropdown(prev);
    } finally {
      setChip(state.currentState);
    }
  };

  // ── Gemma combobox ──────────────────────────────────────────────────────
  async function refreshGemmaSelect() {
    try {
      const installed = await gemmaApi.listModels();
      programmaticGemmaSelect = true;
      gemmaSelect.innerHTML = '';
      if (!installed.length) {
        // Empty state: single entry that opens Settings on the Gemma block.
        const opt = document.createElement('option');
        opt.value = GEMMA_NO_MODELS_VALUE;
        opt.textContent = '(no models — open Settings)';
        gemmaSelect.appendChild(opt);
        committedGemmaDefault = GEMMA_NO_MODELS_VALUE;
      } else {
        const def = installed.find(m => m.is_default);
        const current = def ? def.name : installed[0].name;
        committedGemmaDefault = current;
        for (const m of installed) {
          const opt = document.createElement('option');
          opt.value = m.name;
          opt.textContent = m.display_name + (m.is_default ? '  · default' : '');
          if (m.name === current) opt.selected = true;
          gemmaSelect.appendChild(opt);
        }
      }
      programmaticGemmaSelect = false;
    } catch (e) { /* ignore */ }
  }

  gemmaSelect.onchange = async () => {
    if (programmaticGemmaSelect) return;
    const v = gemmaSelect.value;
    if (v === GEMMA_NO_MODELS_VALUE) {
      // Clicking the empty-state pseudo-entry opens Settings on the Gemma
      // section. The select snaps back via the next refresh.
      openSettingsModal({ scrollTo: 'gemma' });
      programmaticGemmaSelect = true;
      gemmaSelect.value = GEMMA_NO_MODELS_VALUE;
      programmaticGemmaSelect = false;
      return;
    }
    if (!v || v === committedGemmaDefault) return;
    if (state.gemmaState === 'warming' || state.gemmaState === 'busy' || state.gemmaState === 'unloading') {
      programmaticGemmaSelect = true;
      gemmaSelect.value = committedGemmaDefault;
      programmaticGemmaSelect = false;
      return;
    }
    const prev = committedGemmaDefault;
    gemmaSelect.disabled = true;
    gemmaSelect.style.opacity = '0.55';
    gemmaSelect.style.cursor = 'not-allowed';
    try {
      await gemmaApi.setDefaultModel(v);
      try { await gemmaApi.unloadNow(); } catch (_) { /* non-fatal */ }
      committedGemmaDefault = v;
      toast(`Gemma: ${v}`);
    } catch (e) {
      showWhisperError('Gemma model switch failed', formatErrorMessage(e, 'The default Gemma model could not be changed.'), e, {
        previous_model: prev,
        requested_model: v,
      });
      programmaticGemmaSelect = true;
      gemmaSelect.value = prev;
      programmaticGemmaSelect = false;
    } finally {
      gemmaSelect.disabled = false;
      gemmaSelect.style.opacity = '1';
      gemmaSelect.style.cursor = 'pointer';
    }
  };

  const onSettingsChanged = () => { refreshModelSelect(); refreshGemmaSelect(); loadLiveSettings().then(renderControls); };
  window.addEventListener('whisper:settings-changed', onSettingsChanged);
  state.cleanup.push(() => window.removeEventListener('whisper:settings-changed', onSettingsChanged));

  const offTranscribed = await onWhisperEvent('transcribed', async () => {
    await reloadHistory();
  });
  state.cleanup.push(offTranscribed);

  const offError = await onWhisperEvent('error', (p) => {
    showWhisperError(
      'Whisper error',
      p.message || p.code || 'Unknown Whisper error.',
      p.message || p.code || 'unknown error',
      { event: 'whisper:error', payload: p }
    );
    console.error('[whisper error]', p);
  });
  state.cleanup.push(offError);

  const offLiveState = await onWhisperEvent('liveStateChanged', (p) => {
    setLiveState(p.state, p.model, p.provider);
    if (p.state === 'idle') {
      state.liveInterimText = '';
    }
  });
  state.cleanup.push(offLiveState);

  const offLiveInterim = await onWhisperEvent('liveInterim', (p) => {
    if (p.provider) state.liveProvider = p.provider;
    state.liveInterimText = p.text || '';
    renderLivePreview();
  });
  state.cleanup.push(offLiveInterim);

  const offLiveFinal = await onWhisperEvent('liveFinal', (p) => {
    if (p.provider) state.liveProvider = p.provider;
    state.liveCommittedText = p.committed_text || ((state.liveCommittedText || '') + (p.chunk || ''));
    state.liveInterimText = '';
    renderLivePreview();
  });
  state.cleanup.push(offLiveFinal);

  const offLiveError = await onWhisperEvent('liveError', (p) => {
    const providerLabel = liveProviderLabel(p.provider || state.liveProvider);
    showWhisperError(
      `${providerLabel} live dictation failed`,
      p.message || `Unknown ${providerLabel} live dictation error.`,
      p.message || 'unknown error',
      { event: 'whisper:live-error', payload: p }
    );
    console.error('[whisper live error]', p);
  });
  state.cleanup.push(offLiveError);

  await loadLiveSettings();
  await refreshModelSelect();
  await refreshGemmaSelect();
  setChip('idle');

  // ── Tabs ────────────────────────────────────────────────────────────────
  function setActiveTab(name) {
    state.activeTab = name;
    const tabs = tabBar.querySelectorAll('.ws-tab');
    tabs.forEach(t => {
      const isActive = t.dataset.tab === name;
      t.style.borderBottom = isActive ? '2px solid var(--accent,#388bfd)' : '2px solid transparent';
      t.style.color = isActive ? 'var(--text,#c9d1d9)' : 'var(--text-muted,#8b949e)';
    });
    whisperPane.style.display = name === 'whisper' ? 'flex' : 'none';
    postPane.style.display = name === 'postprocessed' ? 'flex' : 'none';
    // Post-process button is meaningless on the postprocessed tab.
    if (ppBtnRef) {
      const disabled = name === 'postprocessed';
      ppBtnRef.disabled = disabled;
      ppBtnRef.style.opacity = disabled ? '0.55' : '1';
      ppBtnRef.style.cursor = disabled ? 'not-allowed' : 'pointer';
    }
  }
  tabBar.querySelectorAll('.ws-tab').forEach(t => {
    t.addEventListener('click', () => setActiveTab(t.dataset.tab));
  });

  // ── Status strip helpers ────────────────────────────────────────────────
  function showStatusStrip() { statusStrip.style.display = ''; }
  function hideStatusStrip() {
    statusStrip.style.display = 'none';
    stripFill.style.width = '0%';
    stripText.textContent = '';
  }
  function startWhisperElapsedTimer() {
    if (state.whisperTimerId) return;
    state.whisperStartedAt = Date.now();
    showStatusStrip();
    stripFill.style.width = '0%'; // no fill for whisper — only spinner-text
    const tick = () => {
      const elapsed = ((Date.now() - state.whisperStartedAt) / 1000).toFixed(1);
      stripText.textContent = `💭 Transcribing… ${elapsed}s`;
    };
    tick();
    state.whisperTimerId = setInterval(tick, 100);
  }
  function stopWhisperElapsedTimer() {
    if (!state.whisperTimerId) return;
    clearInterval(state.whisperTimerId);
    state.whisperTimerId = null;
    // Don't hide the strip if gemma is currently running.
    if (state.gemmaState !== 'busy') hideStatusStrip();
  }

  async function loadLiveSettings() {
    try {
      state.liveDictate = (await whisperApi.getSetting('whisper.live_dictate')) === 'true';
      liveToggle.checked = state.liveDictate;
    } catch {
      state.liveDictate = false;
      liveToggle.checked = false;
    }
    try {
      state.liveProvider = (await whisperApi.getSetting('whisper.live_provider')) || 'deepgram';
      if (!['deepgram', 'yandex'].includes(state.liveProvider)) state.liveProvider = 'deepgram';
      providerSelect.value = state.liveProvider;
    } catch {
      state.liveProvider = 'deepgram';
      providerSelect.value = 'deepgram';
    }
  }

  function renderLivePreview() {
    const committed = state.liveCommittedText || '';
    const interim = state.liveInterimText || '';
    const glue = committed && interim && !/\s$/.test(committed) ? ' ' : '';
    const text = committed + glue + interim;
    activeHistoryRef = null;
    actions.innerHTML = '';
    ppBtnRef = null;
    whisperTextarea.placeholder = state.liveState === 'streaming' ? 'Listening…' : '';
    whisperTextarea.value = text;
    postTextarea.value = '';
    tabBar.querySelector('.pp-dot').style.display = 'none';
    const committedWords = committed.trim().split(/\s+/).filter(Boolean).length;
    const interimWords = interim.trim().split(/\s+/).filter(Boolean).length;
    const parts = [`${liveProviderLabel(state.liveProvider)} live`, state.liveModel || liveProviderDefaultModel(state.liveProvider)];
    if (committedWords) parts.push(`${committedWords} committed words`);
    if (interimWords) parts.push(`${interimWords} interim words`);
    meta.textContent = parts.join(' · ');
    setActiveTab('whisper');
  }

  // ── History list ────────────────────────────────────────────────────────
  async function reloadHistory() {
    state.history = await whisperApi.getHistory(200);
    left.innerHTML = '';
    if (state.history.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'Нет записей. Нажмите Record.';
      empty.style.cssText = 'padding:14px;color:var(--text-muted,#8b949e);font-size:12px';
      left.appendChild(empty);
      renderDetail(null);
      return;
    }
    for (const h of state.history) {
      left.appendChild(renderHistoryRow(h, (id) => {
        state.selectedId = id;
        Array.from(left.children).forEach(c => c.style.background = '');
        const sel = Array.from(left.children).find(c => c.dataset.id === String(id));
        if (sel) sel.style.background = 'var(--bg-secondary,#161b22)';
        const row = state.history.find(r => r.id === id);
        renderDetail(row);
      }));
    }
    state.selectedId = state.history[0].id;
    Array.from(left.children).forEach(c => c.style.background = '');
    if (left.children[0]) left.children[0].style.background = 'var(--bg-secondary,#161b22)';
    renderDetail(state.history[0]);
  }

  function renderHistoryRow(h, onClick) {
    const row = document.createElement('div');
    row.dataset.id = String(h.id);
    row.dataset.provider = h.provider || 'local';
    row.style.cssText = 'padding:8px 10px;border-bottom:1px solid var(--border,#30363d);cursor:pointer;position:relative';
    const when = formatRelativeTime(h.created_at);
    const text = (h.text || '').trim();
    const isBlank = text === '' || text === '[BLANK_AUDIO]';
    const textStyle = isBlank
      ? 'color:var(--text-muted,#8b949e);font-size:12px;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
      : 'color:var(--text,#c9d1d9);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const display = isBlank ? '(empty / no speech)' : escapeHtml(h.text.slice(0, 120));
    const words = text.split(/\s+/).filter(Boolean).length;
    const ppMark = h.postprocessed_text ? ' <span title="Has post-processed text" style="color:var(--green,#3fb950);font-size:10px">●</span>' : '';
    const provider = historyProviderLabel(h.provider);
    row.innerHTML = `
      <div style="padding-right:22px">
        <div style="${textStyle}">${display}</div>
        <div style="color:var(--text-muted,#8b949e);font-size:10px;margin-top:2px">${when} · ${provider} · ${h.model_name} · ${words} words${ppMark}</div>
      </div>
      <button class="row-del" title="Delete" style="position:absolute;top:6px;right:6px;width:22px;height:22px;padding:0;background:transparent;border:0;color:var(--text-muted,#8b949e);cursor:pointer;font-size:14px;line-height:1;opacity:0;transition:opacity 120ms ease">🗑</button>
    `;
    row.onmouseenter = () => { row.querySelector('.row-del').style.opacity = '0.75'; };
    row.onmouseleave = () => { row.querySelector('.row-del').style.opacity = '0'; };
    row.querySelector('.row-del').onclick = async (e) => {
      e.stopPropagation();
      try {
        await whisperApi.deleteHistory(h.id);
        await reloadHistory();
      } catch (err) {
        showWhisperError('Whisper history delete failed', formatErrorMessage(err, 'The history entry could not be deleted.'), err, {
          history_id: h.id,
        });
      }
    };
    row.onclick = (e) => {
      if (e.target.closest('.row-del')) return;
      onClick(h.id);
    };
    return row;
  }

  // Re-rendered every time a row is selected; we keep refs so the action
  // handlers can read the live values without DOM re-mount.

  function renderDetail(h) {
    activeHistoryRef = h;
    actions.innerHTML = '';
    ppBtnRef = null;

    if (!h) {
      whisperTextarea.value = '';
      whisperTextarea.placeholder = 'Выберите запись слева или сделайте новую.';
      postTextarea.value = '';
      meta.textContent = '';
      tabBar.querySelector('.pp-dot').style.display = 'none';
      setActiveTab('whisper');
      return;
    }
    whisperTextarea.placeholder = '';
    whisperTextarea.value = h.text || '';
    postTextarea.value = h.postprocessed_text || '';
    tabBar.querySelector('.pp-dot').style.display = h.postprocessed_text ? '' : 'none';

    const perfParts = [];
    if (h.cpu_peak_percent > 0) perfParts.push(`CPU ${h.cpu_peak_percent.toFixed(0)}%`);
    if (h.gpu_peak_percent > 0) perfParts.push(`GPU ${h.gpu_peak_percent.toFixed(0)}%`);
    if (h.vram_peak_mb > 0)     perfParts.push(`VRAM ${h.vram_peak_mb} MB`);
    const perfStr = perfParts.length ? `  ·  ${perfParts.join(' · ')}` : '';
    const provider = historyProviderLabel(h.provider);
    const providerModel = h.provider_model || h.model_name;
    meta.innerHTML = `${formatRelativeTime(h.created_at)} · ${provider} · ${escapeHtml(providerModel)} · ${h.language || 'auto'} · duration ${h.duration_ms}ms · transcribe <b>${h.transcribe_ms}ms</b>${perfStr}${h.injected_to ? ' · ' + h.injected_to : ''}`;

    actions.appendChild(btn('📋 Copy', async () => { await whisperApi.injectText(getActiveText(), 'copy'); toast('Скопировано'); }));
    actions.appendChild(btn('⎘ Paste', async () => { await whisperApi.injectText(getActiveText(), 'paste'); toast('Вставлено'); }));
    actions.appendChild(btn('Type', async () => { await whisperApi.injectText(getActiveText(), 'type'); toast('Напечатано'); }));
    const ppBtn = btn('✨ Post-process', async () => {
      const src = (whisperTextarea.value || '').trim();
      if (!src) { toast('Nothing to post-process', { kind: 'warn' }); return; }
      const origLabel = ppBtn.textContent;
      ppBtn.textContent = '✨ Processing…';
      ppBtn.disabled = true;
      ppBtn.style.opacity = '0.6';
      try {
        const cleaned = await gemmaApi.postprocess(src);
        // Persist + cache update unconditionally — user expects completed
        // work to be saved even if they navigated to another row mid-flight.
        try {
          await whisperApi.setPostprocessed(h.id, cleaned);
          h.postprocessed_text = cleaned;
          const idx = state.history.findIndex(r => r.id === h.id);
          if (idx !== -1) state.history[idx].postprocessed_text = cleaned;
          // Refresh the row's UI marker (small green dot) without
          // rebuilding the entire history.
          const rowEl = Array.from(left.children).find(c => c.dataset.id === String(h.id));
          if (rowEl) {
            const sub = rowEl.querySelector('div > div:nth-child(2)');
            if (sub && !sub.innerHTML.includes('●')) {
              sub.innerHTML += ' <span title="Has post-processed text" style="color:var(--green,#3fb950);font-size:10px">●</span>';
            }
          }
        } catch (e) {
          console.error('persist postprocessed_text', e);
        }
        // Visual switch only if user is still on the same row. Otherwise
        // the dot in the history list is the only feedback they get.
        if (activeHistoryRef && activeHistoryRef.id === h.id) {
          postTextarea.value = cleaned;
          tabBar.querySelector('.pp-dot').style.display = cleaned ? '' : 'none';
          setActiveTab('postprocessed');
        }
        toast('Post-processed');
      } catch (e) {
        showWhisperError('Post-process failed', formatErrorMessage(e, 'Gemma could not post-process this transcript.'), e, {
          history_id: h.id,
          source_chars: src.length,
        });
        // Make sure the strip doesn't get stuck if backend errored before
        // emitting `done:true`.
        hideStatusStrip();
      } finally {
        ppBtn.textContent = origLabel;
        ppBtn.disabled = state.activeTab === 'postprocessed';
        ppBtn.style.opacity = state.activeTab === 'postprocessed' ? '0.55' : '1';
      }
    });
    actions.appendChild(ppBtn);
    ppBtnRef = ppBtn;
    actions.appendChild(btn('🗑 Delete', async () => {
      if (!confirm('Удалить эту запись?')) return;
      await whisperApi.deleteHistory(h.id);
      await reloadHistory();
    }, true));

    // Reset to whisper tab on selection change so the "default view" is
    // always the raw transcript.
    setActiveTab('whisper');
  }

  function getActiveText() {
    return state.activeTab === 'postprocessed'
      ? (postTextarea.value || '')
      : (whisperTextarea.value || '');
  }

  function btn(label, onClick, danger = false) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `padding:5px 10px;background:var(--bg-secondary,#161b22);border:1px solid var(--border,#30363d);color:${danger ? 'var(--red,#f85149)' : 'var(--text,#c9d1d9)'};border-radius:4px;cursor:pointer;font-size:12px`;
    b.onclick = async () => {
      try {
        await onClick();
      } catch (err) {
        showWhisperError(`${label.replace(/^[^\p{L}\p{N}]+/u, '').trim() || 'Action'} failed`, formatErrorMessage(err), err, {
          action_label: label,
          history_id: activeHistoryRef?.id ?? null,
        });
      }
    };
    return b;
  }

  function toast(msg, opts = {}) {
    const { kind = 'info', durationMs } = opts;
    const defaultDur = kind === 'error' ? 8000 : 1500;
    const ms = durationMs !== undefined ? durationMs : defaultDur;
    const borderColor = kind === 'error' ? 'var(--red,#f85149)'
                      : kind === 'warn'  ? 'var(--warn,#f0883e)'
                      : 'var(--border,#30363d)';
    const t = document.createElement('div');
    t.textContent = msg + (kind === 'error' ? '  ·  click to dismiss' : '');
    t.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);max-width:80vw;background:var(--bg-secondary,#161b22);border:1px solid ${borderColor};color:var(--text,#c9d1d9);padding:8px 16px;border-radius:4px;z-index:2000;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,.3);cursor:${kind === 'error' ? 'pointer' : 'default'};white-space:pre-wrap`;
    t.onclick = () => t.remove();
    document.body.appendChild(t);
    if (ms > 0) setTimeout(() => t.remove(), ms);
  }

  function showWhisperError(title, message, err, extra = {}) {
    void (async () => {
      const details = await buildWhisperErrorDetails(title, message, err, extra);
      showErrorDialog({ title, message, details });
    })();
  }

  async function buildWhisperErrorDetails(title, message, err, extra) {
    const [frontendVersion, updateInfo, liveStatus] = await Promise.all([
      safeCommand('get_frontend_version', {}, 800),
      safeCommand('check_for_update', {}, 1200),
      safeCommand('whisper_live_status', {}, 800),
    ]);
    return {
      title,
      message,
      timestamp: new Date().toISOString(),
      frontend_version: frontendVersion.ok ? frontendVersion.value : `unavailable: ${frontendVersion.error}`,
      native_version: updateInfo.ok ? (updateInfo.value?.current_version || null) : `unavailable: ${updateInfo.error}`,
      latest_native_version: updateInfo.ok ? (updateInfo.value?.latest_version || null) : null,
      update_build_in_progress: updateInfo.ok ? !!updateInfo.value?.build_in_progress : null,
      error: formatErrorMessage(err),
      current_state: state.currentState,
      live_dictate: state.liveDictate,
      live_state: state.liveState,
      live_model: state.liveModel,
      live_provider: state.liveProvider,
      active_tab: state.activeTab,
      selected_history_id: activeHistoryRef?.id ?? state.selectedId ?? null,
      live_status: liveStatus.ok ? liveStatus.value : `unavailable: ${liveStatus.error}`,
      extra,
    };
  }

  async function safeCommand(command, args = {}, timeoutMs = 1000) {
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: `${command} timed out after ${timeoutMs}ms` }), timeoutMs);
    });
    const request = call(command, args)
      .then((value) => ({ ok: true, value }))
      .catch((err) => ({ ok: false, error: formatErrorMessage(err) }));
    const result = await Promise.race([request, timeout]);
    if (timer) clearTimeout(timer);
    return result;
  }

  await reloadHistory();
}

function formatErrorMessage(err, fallback = 'Unknown error.') {
  const msg = String(err?.message || err || '').trim();
  return msg || fallback;
}

function formatRelativeTime(unixSec) {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - Number(unixSec);
  if (diff < 60) return `${diff} sec ago`;
  if (diff < 3600) return `${Math.floor(diff/60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)} hours ago`;
  return new Date(Number(unixSec) * 1000).toLocaleDateString();
}
function liveProviderLabel(provider) {
  return provider === 'yandex' ? 'Yandex SpeechKit' : 'Deepgram';
}
function liveProviderDefaultModel(provider) {
  return provider === 'yandex' ? 'general' : 'nova-3';
}
function historyProviderLabel(provider) {
  if (provider === 'deepgram') return 'Deepgram';
  if (provider === 'yandex') return 'Yandex';
  return 'Local';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
