import { showToast } from '../../components/toast.js';
import { showErrorDialog } from '../../components/error-dialog.js';
import { whisperApi } from '../whisper/whisper-api.js';
import { aiCSS } from './ai-css.js';
import { sendAiChat } from './ai-api.js';
import { executeAiCommands } from './ai-dispatcher.js';

const state = {
  root: null,
  mode: 'command',
  busy: false,
  voiceBusy: false,
  voiceRecording: false,
  reply: '',
  logs: [],
};

export async function init(container) {
  state.root = container;
  container.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = aiCSS();
  container.appendChild(style);
  container.appendChild(buildLayout());
  renderModeButtons();
  renderResponse();
  renderLog();
}

function buildLayout() {
  const wrap = el('div', { class: 'ai-agent-wrap' });

  const header = el('div', { class: 'ai-agent-header' });
  header.appendChild(el('h2', { text: 'AI' }));
  header.appendChild(el('div', {
    class: 'ai-status-pill',
    text: 'DeepSeek via server',
  }));
  wrap.appendChild(header);

  const body = el('div', { class: 'ai-agent-body' });

  const chatPane = el('div', { class: 'ai-chat-pane' });
  chatPane.appendChild(el('div', { class: 'ai-pane-title', text: 'Conversation' }));
  chatPane.appendChild(el('div', { class: 'ai-response empty', text: 'Ready' }));
  chatPane.appendChild(buildComposer());

  const logPane = el('div', { class: 'ai-log-pane' });
  logPane.appendChild(el('div', { class: 'ai-pane-title', text: 'Execution log' }));
  logPane.appendChild(el('div', { class: 'ai-execution-log empty', text: 'No commands yet' }));

  body.appendChild(chatPane);
  body.appendChild(logPane);
  wrap.appendChild(body);
  return wrap;
}

function buildComposer() {
  const composer = el('div', { class: 'ai-composer' });

  const modeRow = el('div', { class: 'ai-mode-row' });
  const group = el('div', { class: 'ai-mode-group' });
  for (const mode of ['chat', 'command']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-mode-btn';
    btn.dataset.mode = mode;
    btn.textContent = mode === 'chat' ? 'Chat' : 'Command';
    btn.addEventListener('click', () => {
      state.mode = mode;
      renderModeButtons();
    });
    group.appendChild(btn);
  }
  modeRow.appendChild(group);
  composer.appendChild(modeRow);

  const inputRow = el('div', { class: 'ai-input-row' });
  const input = document.createElement('textarea');
  input.className = 'ai-input';
  input.placeholder = 'Ask or command...';
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      sendCurrentMessage();
    }
  });
  inputRow.appendChild(input);

  const micBtn = document.createElement('button');
  micBtn.type = 'button';
  micBtn.className = 'ai-mic-btn';
  micBtn.title = 'Voice input';
  micBtn.textContent = 'Mic';
  micBtn.addEventListener('click', toggleVoiceRecording);
  inputRow.appendChild(micBtn);

  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'ai-send-btn';
  sendBtn.textContent = 'Send';
  sendBtn.addEventListener('click', sendCurrentMessage);
  inputRow.appendChild(sendBtn);

  composer.appendChild(inputRow);
  return composer;
}

function renderModeButtons() {
  if (!state.root) return;
  for (const btn of state.root.querySelectorAll('.ai-mode-btn')) {
    btn.classList.toggle('active', btn.dataset.mode === state.mode);
  }
}

function renderResponse() {
  const node = state.root?.querySelector('.ai-response');
  if (!node) return;
  node.classList.toggle('empty', !state.reply);
  node.textContent = state.reply || (state.busy ? 'Thinking...' : 'Ready');
}

function renderLog() {
  const node = state.root?.querySelector('.ai-execution-log');
  if (!node) return;
  node.innerHTML = '';
  node.classList.toggle('empty', state.logs.length === 0);
  if (!state.logs.length) {
    node.textContent = 'No commands yet';
    return;
  }
  for (const item of state.logs) {
    const row = el('div', { class: `ai-log-item ${item.status || ''}` });
    row.appendChild(el('div', { class: 'ai-log-name', text: item.name || 'command' }));
    row.appendChild(el('div', { class: 'ai-log-message', text: item.message || item.status || '' }));
    if (Array.isArray(item.choices) && item.choices.length > 0) {
      const choices = el('div', { class: 'ai-log-choices' });
      for (const choice of item.choices.slice(0, 5)) {
        choices.appendChild(el('div', {
          class: 'ai-log-choice',
          text: choice.title || choice.name || choice.item_uuid || 'choice',
        }));
      }
      row.appendChild(choices);
    }
    node.appendChild(row);
  }
}

function setBusy(nextBusy) {
  state.busy = nextBusy;
  const input = state.root?.querySelector('.ai-input');
  const send = state.root?.querySelector('.ai-send-btn');
  const mic = state.root?.querySelector('.ai-mic-btn');
  if (input) input.disabled = nextBusy;
  if (send) send.disabled = nextBusy;
  if (mic) mic.disabled = (nextBusy && !state.voiceRecording) || state.voiceBusy;
  renderVoiceButton();
  renderResponse();
}

function renderVoiceButton() {
  const mic = state.root?.querySelector('.ai-mic-btn');
  if (!mic) return;
  mic.classList.toggle('recording', state.voiceRecording);
  if (state.voiceBusy) {
    mic.textContent = state.voiceRecording ? 'Stopping...' : 'Starting...';
    mic.title = 'Voice input is changing state';
  } else if (state.voiceRecording) {
    mic.textContent = 'Stop';
    mic.title = 'Stop voice input';
  } else {
    mic.textContent = 'Mic';
    mic.title = 'Voice input';
  }
  mic.disabled = (state.busy && !state.voiceRecording) || state.voiceBusy;
}

function buildContext() {
  return {
    module: window.__keyboardHelperActiveTab || 'ai',
    recent_task_uuid: localStorage.getItem('ai.recent_task_uuid') || null,
    locale: localStorage.getItem('mock.settings')
      ? 'ru'
      : (navigator.language || '').startsWith('ru') ? 'ru' : 'en',
  };
}

async function sendCurrentMessage() {
  if (state.busy) return;
  if (state.voiceRecording) {
    showToast('Stop voice input first', 'error');
    return;
  }
  const input = state.root?.querySelector('.ai-input');
  const message = String(input?.value || '').trim();
  if (!message) return;

  setBusy(true);
  state.reply = '';
  state.logs = [];
  renderLog();

  try {
    const response = await sendAiChat({
      mode: state.mode,
      message,
      context: buildContext(),
    });
    const reply = response?.reply || '';
    const commands = Array.isArray(response?.commands) ? response.commands : [];
    let results = Array.isArray(response?.results) ? response.results : [];

    if (state.mode === 'command' && commands.length > 0) {
      results = await executeAiCommands(commands);
    }

    state.reply = reply || (results.length ? 'Command plan executed.' : 'No response.');
    state.logs = results;
    if (input) input.value = '';
  } catch (err) {
    state.reply = `AI request failed: ${err}`;
    state.logs = [{
      name: 'ai_chat',
      status: 'failed',
      message: String(err),
    }];
  } finally {
    setBusy(false);
    renderResponse();
    renderLog();
  }
}

async function toggleVoiceRecording() {
  if (state.voiceBusy) return;
  if (state.busy && !state.voiceRecording) return;
  const stopping = state.voiceRecording;
  state.voiceBusy = true;
  renderVoiceButton();
  try {
    if (!state.voiceRecording) {
      await whisperApi.startRecording();
      state.voiceRecording = true;
      return;
    }

    const text = await whisperApi.stopRecording();
    state.voiceRecording = false;
    insertVoiceTranscript(text);
  } catch (err) {
    state.voiceRecording = false;
    showErrorDialog({
      title: 'AI voice input failed',
      message: 'The AI tab could not record or transcribe voice input.',
      details: {
        error: String(err),
        stage: stopping ? 'stop' : 'start',
      },
    });
  } finally {
    state.voiceBusy = false;
    renderVoiceButton();
  }
}

function insertVoiceTranscript(text) {
  const input = state.root?.querySelector('.ai-input');
  const transcript = String(text || '').trim();
  if (!input || !transcript) return;
  const current = String(input.value || '').trim();
  input.value = current ? `${current}\n${transcript}` : transcript;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

function el(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
}
