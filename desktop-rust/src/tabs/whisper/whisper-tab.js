import { whisperApi, onWhisperEvent } from './whisper-api.js';
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
    <span id="default-model" style="margin-left:8px;font-size:11px;color:var(--text-muted,#8b949e)"></span>
    <span style="flex:1"></span>
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
  const modelLabel = header.querySelector('#default-model');
  const recordBtn = header.querySelector('#record-btn');

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
  header.querySelector('#settings-btn').onclick = () => openSettingsModal();

  // Ctrl+Space as in-tab shortcut (different from global hotkey)
  const onKey = (e) => {
    if (e.ctrlKey && e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      recordBtn.click();
    }
  };
  document.addEventListener('keydown', onKey);
  state.cleanup.push(() => document.removeEventListener('keydown', onKey));

  const offState = await onWhisperEvent('stateChanged', (p) => {
    setChip(p.state);
    if (p.model) modelLabel.textContent = p.model;
  });
  state.cleanup.push(offState);

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

  const models = await whisperApi.listModels();
  const def = models.find(m => m.is_default);
  if (def) modelLabel.textContent = def.display_name;
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
    row.style.cssText = 'padding:8px 10px;border-bottom:1px solid var(--border,#30363d);cursor:pointer';
    const when = formatRelativeTime(h.created_at);
    row.innerHTML = `
      <div style="color:var(--text,#c9d1d9);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml((h.text || '').slice(0, 120))}</div>
      <div style="color:var(--text-muted,#8b949e);font-size:10px;margin-top:2px">${when} · ${h.model_name} · ${(h.text || '').trim().split(/\s+/).filter(Boolean).length} words</div>
    `;
    row.onclick = () => onClick(h.id);
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
    meta.textContent = `${formatRelativeTime(h.created_at)} · ${h.model_name} · ${h.language || 'auto'} · duration ${h.duration_ms}ms · transcribe ${h.transcribe_ms}ms${h.injected_to ? ' · ' + h.injected_to : ''}`;
    detail.appendChild(meta);

    actions.appendChild(btn('📋 Copy', async () => { await whisperApi.injectText(textarea.value, 'copy'); toast('Скопировано'); }));
    actions.appendChild(btn('⎘ Paste', async () => { await whisperApi.injectText(textarea.value, 'paste'); toast('Вставлено'); }));
    actions.appendChild(btn('Type', async () => { await whisperApi.injectText(textarea.value, 'type'); toast('Напечатано'); }));
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
