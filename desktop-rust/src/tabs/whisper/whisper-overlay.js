'use strict';

async function waitForTauriInvoke(timeoutMs = 2500) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke === 'function') return invoke;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Tauri IPC bridge is not available in this window');
}

async function call(command, args = {}) {
  const invoke = await waitForTauriInvoke();
  return await invoke(command, args);
}

const whisperApi = {
  status: () => call('whisper_status'),
  stopActive: () => call('whisper_stop_active'),
  cancelActive: () => call('whisper_cancel_active'),
  liveStatus: () => call('whisper_live_status'),
};

const EVENTS = {
  stateChanged: 'whisper:state-changed',
  level: 'whisper:level',
  transcribed: 'whisper:transcribed',
  liveStateChanged: 'whisper:live-state-changed',
  liveLevel: 'whisper:live-level',
  liveInterim: 'whisper:live-interim',
  liveFinal: 'whisper:live-final',
  liveError: 'whisper:live-error',
};

async function waitForEventListen(timeoutMs = 2500) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const listen = window.__TAURI__?.event?.listen;
    if (typeof listen === 'function') return listen;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

async function onWhisperEvent(name, handler) {
  const listen = await waitForEventListen();
  if (!listen) {
    console.warn('[whisper-overlay] no event listener available');
    return () => {};
  }
  const event = EVENTS[name] || name;
  const unlisten = await listen(event, (e) => handler(e.payload));
  return unlisten;
}

const dot = document.getElementById('dot');
const titleEl = document.getElementById('title');
const statusEl = document.getElementById('status');
const timer = document.getElementById('timer');
const bars = document.getElementById('bars');
const progress = document.getElementById('progress');
const progressBar = progress.querySelector('span');
const sub = document.getElementById('sub');
const tickerText = document.getElementById('tickerText');
const errorEl = document.getElementById('error');
const stopBtn = document.getElementById('stop');
const cancelBtn = document.getElementById('cancel');

let startedAt = 0;
let timerIv = null;
let activeMode = 'local';
let currentLiveState = 'idle';
let currentLiveProvider = 'deepgram';
let liveCommittedText = '';
let pendingAction = false;

function setStatus(text) {
  statusEl.textContent = text || '';
}

function setTicker(text, fallback = 'Ready') {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  tickerText.textContent = compact || fallback;
  tickerText.classList.toggle('marquee', compact.length > 46);
}

function setOverlayError(message) {
  const text = String(message || '').trim();
  errorEl.textContent = text;
  errorEl.style.display = text ? 'block' : 'none';
}

function setButtonsBusy(busy) {
  stopBtn.disabled = busy;
  cancelBtn.disabled = busy;
}

function showProgress(percent) {
  bars.style.display = 'none';
  progress.style.display = 'block';
  progressBar.style.width = `${percent}%`;
}

function setMode(state) {
  activeMode = 'local';
  bars.style.display = 'none';
  progress.style.display = 'none';
  sub.textContent = '';
  setOverlayError('');
  dot.classList.remove('rec');
  if (state === 'warming') {
    titleEl.textContent = 'Loading model…';
    setStatus('Local · warming up');
    setTicker('', 'Preparing local Whisper');
    showProgress(40);
  } else if (state === 'recording') {
    titleEl.textContent = 'Recording';
    setStatus('Local · capturing microphone');
    setTicker('', 'Listening for speech');
    bars.style.display = 'flex';
    dot.classList.add('rec');
    startedAt = performance.now();
    if (timerIv) clearInterval(timerIv);
    timerIv = setInterval(updateTimer, 200);
    updateTimer();
  } else if (state === 'transcribing') {
    titleEl.textContent = 'Transcribing…';
    setStatus('Local · processing audio');
    setTicker('', 'Converting speech to text');
    showProgress(70);
    if (timerIv) { clearInterval(timerIv); timerIv = null; }
    timer.textContent = '';
  } else {
    titleEl.textContent = 'Whisper';
    setStatus('Idle');
    setTicker('', 'Ready');
    timer.textContent = '';
    if (timerIv) { clearInterval(timerIv); timerIv = null; }
  }
}

function liveProviderLabel(provider = currentLiveProvider) {
  return provider === 'yandex' ? 'Yandex SpeechKit' : 'Deepgram';
}

function setLiveMode(state, provider) {
  currentLiveState = state || 'idle';
  if (provider) currentLiveProvider = provider;
  const providerLabel = liveProviderLabel();
  activeMode = state === 'idle' ? 'local' : 'live';
  bars.style.display = 'none';
  progress.style.display = 'none';
  sub.textContent = '';
  setOverlayError('');
  dot.classList.remove('rec');
  if (state === 'connecting') {
    titleEl.textContent = 'Connecting live…';
    setStatus(`${providerLabel} · opening stream`);
    setTicker('', `Connecting to ${providerLabel}`);
    showProgress(35);
  } else if (state === 'streaming') {
    titleEl.textContent = 'Live dictation';
    setStatus(`${providerLabel} · streaming`);
    setTicker(liveCommittedText, 'Listening for speech');
    bars.style.display = 'flex';
    dot.classList.add('rec');
    progressBar.style.width = '0%';
    startedAt = performance.now();
    if (timerIv) clearInterval(timerIv);
    timerIv = setInterval(updateTimer, 200);
    updateTimer();
  } else if (state === 'stopping') {
    titleEl.textContent = 'Stopping live…';
    setStatus(`${providerLabel} · finalizing`);
    setTicker(liveCommittedText, 'Waiting for final transcript');
    showProgress(80);
    if (timerIv) { clearInterval(timerIv); timerIv = null; }
  } else if (state === 'error') {
    titleEl.textContent = 'Live error';
    setStatus(`${providerLabel} · error`);
    if (timerIv) { clearInterval(timerIv); timerIv = null; }
    timer.textContent = '';
  } else {
    activeMode = 'local';
    setMode('idle');
  }
}

function updateTimer() {
  const sec = Math.floor((performance.now() - startedAt) / 1000);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  timer.textContent = `${mm}:${ss}`;
}

const barArr = Array.from(bars.querySelectorAll('span'));
let barIdx = 0;
async function initEvents() {
  await onWhisperEvent('stateChanged', (p) => {
    if (currentLiveState !== 'idle') return;
    setMode(p.state);
  });
  await onWhisperEvent('level', (p) => {
    const h = Math.max(10, Math.min(100, p.rms * 140));
    barArr[barIdx % barArr.length].style.height = h + '%';
    barIdx++;
  });
  await onWhisperEvent('transcribed', (p) => {
    titleEl.textContent = 'Inserted';
    setStatus('Local · inserted into active app');
    dot.classList.remove('rec');
    const words = (p.text || '').trim().split(/\s+/).filter(Boolean).length;
    const perf = [];
    if (p.transcribe_ms) perf.push(`${p.transcribe_ms}ms`);
    if (p.cpu_peak_percent > 0) perf.push(`CPU ${Math.round(p.cpu_peak_percent)}%`);
    if (p.gpu_peak_percent > 0) perf.push(`GPU ${Math.round(p.gpu_peak_percent)}%`);
    if (p.vram_peak_mb > 0) perf.push(`${p.vram_peak_mb} MB VRAM`);
    sub.textContent = `${words} words${perf.length ? ' · ' + perf.join(' · ') : ''}`;
    setTicker(p.text || '', 'Inserted transcript');
    // Rust side will hide the window ~1s later
  });
  await onWhisperEvent('liveStateChanged', (p) => setLiveMode(p.state, p.provider));
  await onWhisperEvent('liveLevel', (p) => {
    const h = Math.max(10, Math.min(100, p.rms * 140));
    barArr[barIdx % barArr.length].style.height = h + '%';
    barIdx++;
  });
  await onWhisperEvent('liveInterim', (p) => {
    activeMode = 'live';
    if (p.provider) currentLiveProvider = p.provider;
    setStatus(`${liveProviderLabel()} · interim text`);
    setTicker(p.text || '', 'Listening for speech');
    sub.textContent = 'Interim';
  });
  await onWhisperEvent('liveFinal', (p) => {
    if (p.provider) currentLiveProvider = p.provider;
    liveCommittedText = p.committed_text || liveCommittedText;
    const words = liveCommittedText.trim().split(/\s+/).filter(Boolean).length;
    setStatus(`${liveProviderLabel()} · ${words} committed words`);
    setTicker(liveCommittedText || p.chunk || '', 'Final text committed');
    sub.textContent = `${words} committed words`;
  });
  await onWhisperEvent('liveError', (p) => {
    if (p.provider) currentLiveProvider = p.provider;
    titleEl.textContent = 'Live error';
    setStatus(`${liveProviderLabel()} · error`);
    setOverlayError(p.message || 'Live dictation failed');
    sub.textContent = 'Open Whisper tab for details';
  });
}

async function bootstrapState() {
  try {
    const live = await whisperApi.liveStatus();
    if (live && live.state && live.state !== 'idle') {
      liveCommittedText = live.committed_text || '';
      setLiveMode(live.state, live.provider);
      return;
    }
  } catch (e) {
    console.warn('[whisper-overlay] live status bootstrap failed', e);
  }

  try {
    const local = await whisperApi.status();
    setMode((local && local.state) || 'idle');
  } catch (e) {
    console.warn('[whisper-overlay] local status bootstrap failed', e);
    setMode('idle');
  }
}

function formatError(e) {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  return e.message || JSON.stringify(e);
}

async function runOverlayAction(action) {
  if (pendingAction) return;
  pendingAction = true;
  setButtonsBusy(true);
  setOverlayError('');
  try {
    if (action === 'stop') {
      titleEl.textContent = activeMode === 'live' ? 'Stopping live…' : 'Stopping…';
      setStatus(activeMode === 'live' ? `${liveProviderLabel()} · finalizing` : 'Local · finalizing');
      setTicker(liveCommittedText, 'Waiting for final transcript');
      showProgress(activeMode === 'live' ? 80 : 70);
      await whisperApi.stopActive();
    } else {
      titleEl.textContent = 'Cancelling…';
      setStatus(activeMode === 'live' ? `${liveProviderLabel()} · cancelling` : 'Local · cancelling');
      showProgress(60);
      await whisperApi.cancelActive();
    }
  } catch (e) {
    titleEl.textContent = 'Action failed';
    setStatus('Whisper · error');
    setOverlayError(formatError(e));
    console.error(e);
  } finally {
    pendingAction = false;
    setButtonsBusy(false);
  }
}

function bindOverlayButton(btn, action) {
  let lastPointerTs = 0;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    lastPointerTs = performance.now();
    runOverlayAction(action);
  });
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (performance.now() - lastPointerTs > 500) runOverlayAction(action);
  });
}

bindOverlayButton(stopBtn, 'stop');
bindOverlayButton(cancelBtn, 'cancel');

window.__WHISPER_OVERLAY_READY__ = true;
setStatus('Overlay JS ready');
setTicker('', 'Overlay JS ready');

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    runOverlayAction('cancel');
  } else if (e.key === 'Enter') {
    runOverlayAction('stop');
  }
});

initEvents()
  .then(bootstrapState)
  .catch((e) => {
    console.error('[whisper-overlay] init failed', e);
    setMode('idle');
    setOverlayError(formatError(e));
  });
