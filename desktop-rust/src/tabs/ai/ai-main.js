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
  voiceProvider: 'local',
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
  await loadVoiceProvider();
  renderModeButtons();
  renderResponse();
  renderLog();
  renderVoiceProvider();
}

function buildLayout() {
  const wrap = el('div', { class: 'ai-agent-wrap' });

  const header = el('div', { class: 'ai-agent-header' });
  header.appendChild(el('h2', { text: 'AI' }));
  const helpBtn = document.createElement('button');
  helpBtn.type = 'button';
  helpBtn.className = 'ai-help-btn';
  helpBtn.title = 'AI help';
  helpBtn.textContent = '?';
  helpBtn.addEventListener('click', showAiHelp);
  header.appendChild(helpBtn);
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
  const voiceWrap = el('label', { class: 'ai-voice-provider-wrap' });
  voiceWrap.appendChild(el('span', { text: 'Voice' }));
  const voiceSelect = document.createElement('select');
  voiceSelect.className = 'ai-voice-provider-select';
  voiceSelect.innerHTML = '<option value="local">Whisper</option><option value="deepgram">Deepgram</option>';
  voiceSelect.addEventListener('change', async () => {
    state.voiceProvider = voiceSelect.value === 'deepgram' ? 'deepgram' : 'local';
    renderVoiceProvider();
    try {
      await whisperApi.setSetting('ai.voice_provider', state.voiceProvider);
    } catch (err) {
      showErrorDialog({
        title: 'AI voice setting failed',
        message: 'The AI voice provider setting could not be saved.',
        details: { error: String(err), voice_provider: state.voiceProvider },
      });
    }
  });
  voiceWrap.appendChild(voiceSelect);
  modeRow.appendChild(voiceWrap);
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
  renderVoiceProvider();
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

function renderVoiceProvider() {
  const select = state.root?.querySelector('.ai-voice-provider-select');
  if (!select) return;
  select.value = state.voiceProvider === 'deepgram' ? 'deepgram' : 'local';
  select.disabled = state.voiceBusy || state.voiceRecording || state.busy;
}

async function loadVoiceProvider() {
  try {
    const saved = await whisperApi.getSetting('ai.voice_provider');
    state.voiceProvider = saved === 'deepgram' ? 'deepgram' : 'local';
  } catch {
    state.voiceProvider = 'local';
  }
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
      if (shouldContinueCommand(message, commands, results)) {
        const followup = await sendAiChat({
          mode: state.mode,
          message: buildFollowupMessage(message, results),
          context: buildContext(),
        });
        const followupReply = followup?.reply || '';
        const followupCommands = Array.isArray(followup?.commands) ? followup.commands : [];
        let followupResults = Array.isArray(followup?.results) ? followup.results : [];
        if (followupCommands.length > 0) {
          followupResults = await executeAiCommands(followupCommands);
        }
        results = [...results, ...followupResults];
        state.reply = followupReply || reply || (results.length ? 'Command plan executed.' : 'No response.');
      }
    }

    if (!state.reply) {
      state.reply = reply || (results.length ? 'Command plan executed.' : 'No response.');
    }
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
  renderVoiceProvider();
  try {
    if (!state.voiceRecording) {
      if (state.voiceProvider === 'deepgram') {
        await whisperApi.startLive();
      } else {
        await whisperApi.startRecording();
      }
      state.voiceRecording = true;
      return;
    }

    const text = state.voiceProvider === 'deepgram'
      ? await whisperApi.stopLive()
      : await whisperApi.stopRecording();
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
    renderVoiceProvider();
    renderVoiceButton();
  }
}

function shouldContinueCommand(message, commands, results) {
  const lower = String(message || '').toLowerCase();
  const mutationIntent = [
    'отмет', 'выполн', 'добав', 'созд', 'mark', 'complete', 'done', 'add', 'create',
  ].some(token => lower.includes(token));
  if (!mutationIntent) return false;
  if (commands.some(c => ['create_task', 'add_task_checkbox', 'complete_task_checkbox'].includes(c?.name))) return false;
  return results.some(r => (
    (r.status === 'executed' || r.status === 'needs_clarification')
    && Array.isArray(r.choices)
    && r.choices.length > 0
  ));
}

function buildFollowupMessage(originalMessage, results) {
  const compact = results.map(r => ({
    name: r.name,
    status: r.status,
    message: r.message,
    item_type: r.item_type,
    item_uuid: r.item_uuid,
    choices: (r.choices || []).slice(0, 5),
  }));
  return [
    'Continue the same command request using the previous local command results.',
    'Do not repeat a pure search if the result contains one suitable item.',
    'For task checkbox actions, use task_uuid or task_ref="current" for the task and checkbox_query for the checkbox text.',
    `Original request: ${originalMessage}`,
    `Previous command results: ${JSON.stringify(compact)}`,
  ].join('\n');
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

function showAiHelp() {
  if (document.querySelector('.ai-help-overlay')) return;
  const overlay = el('div', { class: 'modal-overlay ai-help-overlay' });
  const modal = el('div', { class: 'modal ai-help-modal' });

  const header = el('div', { class: 'ai-help-header' });
  header.appendChild(el('h3', { text: 'AI help' }));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn-secondary ai-help-close';
  close.textContent = 'Close';
  close.addEventListener('click', () => overlay.remove());
  header.appendChild(close);
  modal.appendChild(header);

  const sections = [
    {
      title: 'Modes',
      items: [
        'Chat mode answers in this tab and does not change app data.',
        'Command mode asks DeepSeek for a validated command plan, then the desktop app executes safe local actions.',
        'When a mutation request starts with a search-only plan, the tab can run one follow-up turn using the found result.',
        'Voice input writes a transcript into the prompt; choose Whisper for local transcription or Deepgram for live cloud transcription.',
      ],
    },
    {
      title: 'What commands can do',
      items: [
        'Open matching tasks, notes, and snippets.',
        'Create a new task with optional checkbox items.',
        'Add a checkbox to the current or named task.',
        'Mark a matching task checkbox as completed.',
      ],
    },
    {
      title: 'Telegram bot',
      items: [
        'Telegram uses the per-user bot token saved in Settings > AI.',
        'Unknown chats are denied. Bind a chat to the app user on the server before using commands.',
        'Telegram commands run on the server, so desktop and mobile see the changes after sync.',
      ],
    },
  ];

  for (const section of sections) {
    const block = el('section', { class: 'ai-help-section' });
    block.appendChild(el('h4', { text: section.title }));
    const list = document.createElement('ul');
    for (const item of section.items) {
      list.appendChild(el('li', { text: item }));
    }
    block.appendChild(list);
    modal.appendChild(block);
  }

  const examples = el('section', { class: 'ai-help-section' });
  examples.appendChild(el('h4', { text: 'Examples' }));
  const exampleList = document.createElement('div');
  exampleList.className = 'ai-help-examples';
  for (const text of [
    'Покажи задачу Аптека',
    'Создай задачу Аптека с пунктами купить аспирин, проверить рецепт',
    'Добавь в эту задачу пункт купить ибупрофен',
    'Отметь в задаче Аптека пункт купить аспирин выполненным',
    'Найди заметку про отпуск',
    'Найди сниппет про rsync',
  ]) {
    exampleList.appendChild(el('code', { text }));
  }
  examples.appendChild(exampleList);
  modal.appendChild(examples);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
}

function el(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
}
