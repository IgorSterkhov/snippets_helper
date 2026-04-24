import { whisperApi, onWhisperEvent } from './whisper-api.js';
import { gemmaApi } from './gemma-api.js';
import { openSettingsModal } from './whisper-settings.js';

export async function initTab(container) {
  container.innerHTML = '';
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;height:100%;overflow:hidden;padding:0';

  const state = {
    recording: false,
    currentState: 'idle',
    selectedId: null,
    history: [],
    cleanup: [],
  };

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border,#30363d);background:var(--bg-secondary,#161b22);flex-shrink:0';
  header.innerHTML = `
    <span style="font-weight:600;color:var(--text,#c9d1d9)">🎤 Whisper</span>
    <span id="state-chip" style="padding:2px 8px;background:var(--bg,#0d1117);border-radius:10px;font-size:11px;color:var(--text-muted,#8b949e)">○ idle</span>
    <select id="model-select" title="Active model (switching unloads the warmed server)" style="margin-left:8px;padding:3px 6px;background:var(--bg,#0d1117);color:var(--text,#c9d1d9);border:1px solid var(--border,#30363d);border-radius:4px;font-size:11px;cursor:pointer;max-width:240px"></select>
    <span style="flex:1"></span>
    <button id="cancel-btn" title="Cancel without transcribing (Esc)" style="padding:5px 10px;background:transparent;color:var(--red,#f85149);border:1px solid var(--red,#f85149);border-radius:4px;cursor:pointer;font-weight:500;display:none">✕ Cancel</button>
    <button id="record-btn" style="padding:5px 14px;background:var(--accent,#388bfd);color:#fff;border:0;border-radius:4px;cursor:pointer;font-weight:600">🎤 Record</button>
    <button id="settings-btn" style="padding:5px 10px;background:transparent;color:var(--text-muted,#8b949e);border:1px solid var(--border,#30363d);border-radius:4px;cursor:pointer">⚙</button>
  `;
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

  const detail = document.createElement('div');
  detail.style.cssText = 'flex:1;padding:14px;overflow:auto;display:flex;flex-direction:column;gap:10px';
  right.appendChild(detail);

  const actions = document.createElement('div');
  actions.style.cssText = 'padding:10px;border-top:1px solid var(--border,#30363d);display:flex;gap:6px;flex-wrap:wrap';
  right.appendChild(actions);

  const chip = header.querySelector('#state-chip');
  const modelSelect = header.querySelector('#model-select');
  const recordBtn = header.querySelector('#record-btn');
  const cancelBtn = header.querySelector('#cancel-btn');

  // Cached last-committed default name. Used to revert the dropdown if the
  // backend rejects the change. We also use it to suppress the change
  // handler when we repopulate the <select> programmatically (e.g. after
  // a Settings-modal save).
  let committedDefault = null;
  let programmaticSelect = false;

  function setChip(st) {
    const stateMap = {
      idle:         { label: '○ idle',           color: 'var(--text-muted,#8b949e)' },
      warming:      { label: '⏳ warming up',    color: 'var(--warn,#f0883e)' },
      ready:        { label: '● ready',          color: 'var(--green,#3fb950)' },
      recording:    { label: '🔴 recording',     color: 'var(--red,#f85149)' },
      transcribing: { label: '💭 transcribing',  color: 'var(--blue,#58a6ff)' },
      unloading:    { label: '… unloading',      color: 'var(--text-muted,#8b949e)' },
    };
    const m = stateMap[st] || stateMap.idle;
    chip.textContent = m.label;
    chip.style.color = m.color;
    state.currentState = st;
    // Button behavior per state:
    //   idle / ready     → "🎤 Record"  (start)
    //   recording        → "⏹ Stop"    (stop — user decides when to end)
    //   warming          → "⏳ Warming…" disabled (recorder is already running,
    //                      stop-during-warm is allowed via Rust pending_stop,
    //                      but UI hides it to avoid confusion)
    //   transcribing     → "💭 …"       disabled
    //   unloading        → "…"          disabled
    if (st === 'recording') {
      recordBtn.textContent = '⏹ Stop';
      recordBtn.dataset.mode = 'stop';
      recordBtn.disabled = false;
      recordBtn.style.opacity = '1';
      recordBtn.style.cursor = 'pointer';
    } else if (st === 'warming' || st === 'transcribing' || st === 'unloading') {
      const label = st === 'warming' ? '⏳ Warming…'
                  : st === 'transcribing' ? '💭 Transcribing…'
                  : '… Unloading';
      recordBtn.textContent = label;
      recordBtn.dataset.mode = 'noop';
      recordBtn.disabled = true;
      recordBtn.style.opacity = '0.55';
      recordBtn.style.cursor = 'not-allowed';
    } else { // idle, ready
      recordBtn.textContent = '🎤 Record';
      recordBtn.dataset.mode = 'start';
      recordBtn.disabled = false;
      recordBtn.style.opacity = '1';
      recordBtn.style.cursor = 'pointer';
    }

    // Lock the model switcher while the service is doing something —
    // switching mid-record/transcribe would kill the warm server and
    // throw away the in-flight work.
    const lock = st === 'warming' || st === 'recording'
              || st === 'transcribing' || st === 'unloading';
    modelSelect.disabled = lock;
    modelSelect.style.opacity = lock ? '0.55' : '1';
    modelSelect.style.cursor = lock ? 'not-allowed' : 'pointer';

    // Show Cancel while the service is in any active state; it drops the
    // in-flight audio and any transcription pending for it.
    cancelBtn.style.display = lock ? '' : 'none';
  }

  recordBtn.onclick = async () => {
    if (recordBtn.disabled || recordBtn.dataset.mode === 'noop') return;
    try {
      if (recordBtn.dataset.mode === 'stop') {
        await whisperApi.stopRecording();
        await reloadHistory();
      } else {
        await whisperApi.startRecording();
      }
    } catch (e) {
      alert(`Whisper error: ${e}`);
    }
  };
  cancelBtn.onclick = async () => {
    try {
      await whisperApi.cancelRecording();
      toast('Cancelled');
    } catch (e) {
      toast(`Cancel failed: ${e}`, { kind: 'error' });
    }
  };
  header.querySelector('#settings-btn').onclick = () => openSettingsModal();

  // Ctrl+Space as in-tab shortcut (different from global hotkey).
  // Esc during active states cancels without saving — registered on
  // capture phase so we beat main.js's Esc → hide_and_sync handler.
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
    // `p.model` is the name of the model currently active in the service
    // (server warmed with it). If the header select hasn't caught up
    // (user just switched), align it — but don't fire our change handler.
    if (p.model) {
      selectModelInDropdown(p.model);
    } else if (p.state === 'idle') {
      // Post-unload: no model is active; show the configured default.
      refreshModelSelect();
    }
  });
  state.cleanup.push(offState);

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
      // The model isn't in our cached list (someone installed a new one
      // from Settings). Re-fetch the list in full.
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
    // Don't allow switching mid-action (also guarded by disabled).
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
      // Drop the warmed server so the next record uses the newly-selected
      // model. Same double-call the Settings modal does.
      try { await whisperApi.unloadNow(); } catch (_) { /* non-fatal */ }
      committedDefault = newName;
      window.dispatchEvent(new CustomEvent('whisper:settings-changed'));
      toast(`Model: ${newName}`);
    } catch (e) {
      toast(`Switch failed: ${e}`, { kind: 'error' });
      selectModelInDropdown(prev);
    } finally {
      // Re-evaluate lock from current state.
      setChip(state.currentState);
    }
  };

  const onSettingsChanged = () => { refreshModelSelect(); };
  window.addEventListener('whisper:settings-changed', onSettingsChanged);
  state.cleanup.push(() => window.removeEventListener('whisper:settings-changed', onSettingsChanged));

  const offTranscribed = await onWhisperEvent('transcribed', async () => {
    await reloadHistory();
  });
  state.cleanup.push(offTranscribed);

  const offError = await onWhisperEvent('error', (p) => {
    // Surface whisper-server spawn failures, inference errors, mic-permission
    // refusals etc. Previously these went nowhere — users saw only the state
    // bounce back to idle with no diagnostic.
    toast(`Whisper: ${p.message || p.code || 'unknown error'}`, { kind: 'error' });
    console.error('[whisper error]', p);
  });
  state.cleanup.push(offError);

  await refreshModelSelect();
  setChip('idle');

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
    row.style.cssText = 'padding:8px 10px;border-bottom:1px solid var(--border,#30363d);cursor:pointer;position:relative';
    const when = formatRelativeTime(h.created_at);
    const text = (h.text || '').trim();
    const isBlank = text === '' || text === '[BLANK_AUDIO]';
    const textStyle = isBlank
      ? 'color:var(--text-muted,#8b949e);font-size:12px;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
      : 'color:var(--text,#c9d1d9);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const display = isBlank ? '(empty / no speech)' : escapeHtml(h.text.slice(0, 120));
    const words = text.split(/\s+/).filter(Boolean).length;
    row.innerHTML = `
      <div style="padding-right:22px">
        <div style="${textStyle}">${display}</div>
        <div style="color:var(--text-muted,#8b949e);font-size:10px;margin-top:2px">${when} · ${h.model_name} · ${words} words</div>
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
        toast(`Delete failed: ${err}`, { kind: 'error' });
      }
    };
    row.onclick = (e) => {
      if (e.target.closest('.row-del')) return;
      onClick(h.id);
    };
    return row;
  }

  function renderDetail(h) {
    detail.innerHTML = '';
    actions.innerHTML = '';
    if (!h) {
      const empty = document.createElement('div');
      empty.textContent = 'Выберите запись слева или сделайте новую.';
      empty.style.cssText = 'color:var(--text-muted,#8b949e);font-size:12px';
      detail.appendChild(empty);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = h.text;
    textarea.style.cssText = 'width:100%;min-height:220px;flex:1;padding:10px;background:var(--bg,#0d1117);border:1px solid var(--border,#30363d);color:var(--text,#c9d1d9);border-radius:4px;font-family:inherit;font-size:13px;line-height:1.55;resize:vertical';
    detail.appendChild(textarea);

    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:11px;color:var(--text-muted,#8b949e)';
    const perfParts = [];
    if (h.cpu_peak_percent > 0) perfParts.push(`CPU ${h.cpu_peak_percent.toFixed(0)}%`);
    if (h.gpu_peak_percent > 0) perfParts.push(`GPU ${h.gpu_peak_percent.toFixed(0)}%`);
    if (h.vram_peak_mb > 0)     perfParts.push(`VRAM ${h.vram_peak_mb} MB`);
    const perfStr = perfParts.length ? `  ·  ${perfParts.join(' · ')}` : '';
    meta.innerHTML = `${formatRelativeTime(h.created_at)} · ${escapeHtml(h.model_name)} · ${h.language || 'auto'} · duration ${h.duration_ms}ms · transcribe <b>${h.transcribe_ms}ms</b>${perfStr}${h.injected_to ? ' · ' + h.injected_to : ''}`;
    detail.appendChild(meta);

    actions.appendChild(btn('📋 Copy', async () => { await whisperApi.injectText(textarea.value, 'copy'); toast('Скопировано'); }));
    actions.appendChild(btn('⎘ Paste', async () => { await whisperApi.injectText(textarea.value, 'paste'); toast('Вставлено'); }));
    actions.appendChild(btn('Type', async () => { await whisperApi.injectText(textarea.value, 'type'); toast('Напечатано'); }));
    // Gemma post-processing: rewrite current textarea contents in place.
    // The first run warms the llama-server sidecar (~30-60s on CPU), later
    // runs reuse it. Error if no model installed — user is nudged to Settings.
    const ppBtn = btn('✨ Post-process', async () => {
      const src = textarea.value.trim();
      if (!src) { toast('Nothing to post-process', { kind: 'warn' }); return; }
      const origLabel = ppBtn.textContent;
      ppBtn.textContent = '✨ Processing…';
      ppBtn.disabled = true;
      ppBtn.style.opacity = '0.6';
      try {
        const cleaned = await gemmaApi.postprocess(src);
        textarea.value = cleaned;
        toast('Post-processed');
      } catch (e) {
        toast(`Post-process failed: ${e}`, { kind: 'error' });
      } finally {
        ppBtn.textContent = origLabel;
        ppBtn.disabled = false;
        ppBtn.style.opacity = '1';
      }
    });
    actions.appendChild(ppBtn);
    actions.appendChild(btn('🗑 Delete', async () => {
      if (!confirm('Удалить эту запись?')) return;
      await whisperApi.deleteHistory(h.id);
      await reloadHistory();
    }, true));
  }

  function btn(label, onClick, danger = false) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `padding:5px 10px;background:var(--bg-secondary,#161b22);border:1px solid var(--border,#30363d);color:${danger ? 'var(--red,#f85149)' : 'var(--text,#c9d1d9)'};border-radius:4px;cursor:pointer;font-size:12px`;
    b.onclick = onClick;
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

  await reloadHistory();
}

function formatRelativeTime(unixSec) {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - Number(unixSec);
  if (diff < 60) return `${diff} sec ago`;
  if (diff < 3600) return `${Math.floor(diff/60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)} hours ago`;
  return new Date(Number(unixSec) * 1000).toLocaleDateString();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
