import { whisperApi, onWhisperEvent } from './whisper-api.js';

const dot = document.getElementById('dot');
const titleEl = document.getElementById('title');
const timer = document.getElementById('timer');
const bars = document.getElementById('bars');
const progress = document.getElementById('progress');
const progressBar = progress.querySelector('span');
const sub = document.getElementById('sub');
const stopBtn = document.getElementById('stop');
const cancelBtn = document.getElementById('cancel');

let startedAt = 0;
let timerIv = null;
let activeMode = 'local';
let liveCommittedText = '';

function setMode(state) {
  bars.style.display = 'none';
  progress.style.display = 'none';
  sub.textContent = '';
  dot.classList.remove('rec');
  if (state === 'warming') {
    titleEl.textContent = 'Loading model…';
    progress.style.display = 'block';
    progressBar.style.width = '40%';
  } else if (state === 'recording') {
    titleEl.textContent = 'Recording';
    bars.style.display = 'flex';
    dot.classList.add('rec');
    startedAt = performance.now();
    if (timerIv) clearInterval(timerIv);
    timerIv = setInterval(updateTimer, 200);
    updateTimer();
  } else if (state === 'transcribing') {
    titleEl.textContent = 'Transcribing…';
    progress.style.display = 'block';
    progressBar.style.width = '70%';
    if (timerIv) { clearInterval(timerIv); timerIv = null; }
    timer.textContent = '';
  } else {
    titleEl.textContent = 'Whisper';
    timer.textContent = '';
    if (timerIv) { clearInterval(timerIv); timerIv = null; }
  }
}

function setLiveMode(state) {
  activeMode = state === 'idle' ? 'local' : 'live';
  bars.style.display = 'none';
  progress.style.display = 'none';
  sub.textContent = '';
  dot.classList.remove('rec');
  if (state === 'connecting') {
    titleEl.textContent = 'Connecting live…';
    progress.style.display = 'block';
    progressBar.style.width = '35%';
  } else if (state === 'streaming') {
    titleEl.textContent = 'Live dictation';
    bars.style.display = 'flex';
    dot.classList.add('rec');
    progressBar.style.width = '0%';
    startedAt = performance.now();
    if (timerIv) clearInterval(timerIv);
    timerIv = setInterval(updateTimer, 200);
    updateTimer();
  } else if (state === 'stopping') {
    titleEl.textContent = 'Stopping live…';
    progress.style.display = 'block';
    progressBar.style.width = '80%';
    if (timerIv) { clearInterval(timerIv); timerIv = null; }
  } else if (state === 'error') {
    titleEl.textContent = 'Live error';
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
  await onWhisperEvent('stateChanged', (p) => setMode(p.state));
  await onWhisperEvent('level', (p) => {
    const h = Math.max(10, Math.min(100, p.rms * 140));
    barArr[barIdx % barArr.length].style.height = h + '%';
    barIdx++;
  });
  await onWhisperEvent('transcribed', (p) => {
    titleEl.textContent = 'Inserted';
    dot.classList.remove('rec');
    const words = (p.text || '').trim().split(/\s+/).filter(Boolean).length;
    const perf = [];
    if (p.transcribe_ms) perf.push(`${p.transcribe_ms}ms`);
    if (p.cpu_peak_percent > 0) perf.push(`CPU ${Math.round(p.cpu_peak_percent)}%`);
    if (p.gpu_peak_percent > 0) perf.push(`GPU ${Math.round(p.gpu_peak_percent)}%`);
    if (p.vram_peak_mb > 0) perf.push(`${p.vram_peak_mb} MB VRAM`);
    sub.textContent = `${words} words${perf.length ? ' · ' + perf.join(' · ') : ''}`;
    // Rust side will hide the window ~1s later
  });
  await onWhisperEvent('liveStateChanged', (p) => setLiveMode(p.state));
  await onWhisperEvent('liveLevel', (p) => {
    const h = Math.max(10, Math.min(100, p.rms * 140));
    barArr[barIdx % barArr.length].style.height = h + '%';
    barIdx++;
  });
  await onWhisperEvent('liveInterim', (p) => {
    sub.textContent = p.text || '';
  });
  await onWhisperEvent('liveFinal', (p) => {
    liveCommittedText = p.committed_text || liveCommittedText;
    const words = liveCommittedText.trim().split(/\s+/).filter(Boolean).length;
    sub.textContent = `${words} committed words`;
  });
  await onWhisperEvent('liveError', (p) => {
    titleEl.textContent = 'Live error';
    sub.textContent = p.message || '';
  });
}

stopBtn.onclick = async () => {
  try {
    if (activeMode === 'live') await whisperApi.stopLive();
    else await whisperApi.stopRecording();
  } catch (e) { console.error(e); }
};
cancelBtn.onclick = async () => {
  try {
    if (activeMode === 'live') await whisperApi.cancelLive();
    else await whisperApi.cancelRecording();
  } catch (e) { console.error(e); }
};

initEvents();
setMode('idle');
