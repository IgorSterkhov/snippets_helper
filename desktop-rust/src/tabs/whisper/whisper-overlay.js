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
    sub.textContent = `"${(p.text || '').slice(0, 40)}${p.text.length > 40 ? '…' : ''}" · ${words} words`;
    // Rust side will hide the window ~1s later
  });
}

stopBtn.onclick = async () => {
  try { await whisperApi.stopRecording(); } catch (e) { console.error(e); }
};
cancelBtn.onclick = async () => {
  try { await whisperApi.cancelRecording(); } catch (e) { console.error(e); }
};

initEvents();
setMode('idle');
