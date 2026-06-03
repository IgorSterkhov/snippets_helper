import { showToast } from '../../components/toast.js';
import { showErrorDialog } from '../../components/error-dialog.js';
import { whisperApi } from '../whisper/whisper-api.js';
import { aiCSS } from './ai-css.js';
import {
  getAiAgentSettings,
  getAiCapabilities,
  previewAiPrompt,
  saveAiAgentSettings,
  sendAiChat,
} from './ai-api.js';
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
  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'ai-agent-settings-btn';
  settingsBtn.title = 'AI agent settings';
  settingsBtn.textContent = '⚙';
  settingsBtn.addEventListener('click', showAiAgentSettings);
  header.appendChild(settingsBtn);
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
  voiceSelect.innerHTML = '<option value="local">Whisper</option><option value="deepgram">Deepgram</option><option value="yandex">Yandex SpeechKit</option>';
  voiceSelect.addEventListener('change', async () => {
    state.voiceProvider = ['deepgram', 'yandex'].includes(voiceSelect.value) ? voiceSelect.value : 'local';
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
  select.value = ['deepgram', 'yandex'].includes(state.voiceProvider) ? state.voiceProvider : 'local';
  select.disabled = state.voiceBusy || state.voiceRecording || state.busy;
}

async function loadVoiceProvider() {
  try {
    const saved = await whisperApi.getSetting('ai.voice_provider');
    state.voiceProvider = ['deepgram', 'yandex'].includes(saved) ? saved : 'local';
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
  const cloudVoice = state.voiceProvider === 'deepgram' || state.voiceProvider === 'yandex';
  let previousLiveProvider = null;
  let liveProviderTemporarilyChanged = false;
  let previousRecognitionEngine = null;
  let recognitionEngineTemporarilyChanged = false;
  state.voiceBusy = true;
  renderVoiceButton();
  renderVoiceProvider();
  try {
    if (!state.voiceRecording) {
      if (cloudVoice) {
        previousLiveProvider = await whisperApi.getSetting('whisper.live_provider');
        await whisperApi.setSetting('whisper.live_provider', state.voiceProvider);
        liveProviderTemporarilyChanged = true;
        await whisperApi.startLive();
      } else {
        const models = await whisperApi.listModels();
        const local = models.find(m => m.is_default) || models[0];
        if (!local) throw new Error('No local Whisper model installed.');
        previousRecognitionEngine = await whisperApi.getSetting('whisper.recognition_engine');
        await whisperApi.setSetting('whisper.recognition_engine', `local:${local.name}`);
        recognitionEngineTemporarilyChanged = true;
        await whisperApi.startRecording();
      }
      state.voiceRecording = true;
      return;
    }

    const text = (state.voiceProvider === 'deepgram' || state.voiceProvider === 'yandex')
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
    if (liveProviderTemporarilyChanged) {
      try {
        await whisperApi.setSetting('whisper.live_provider', previousLiveProvider || 'deepgram');
      } catch (restoreErr) {
        console.warn('[ai] failed to restore whisper live provider', restoreErr);
      }
    }
    if (recognitionEngineTemporarilyChanged) {
      try {
        await whisperApi.setSetting('whisper.recognition_engine', previousRecognitionEngine || '');
      } catch (restoreErr) {
        console.warn('[ai] failed to restore whisper recognition engine', restoreErr);
      }
    }
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
    (r.status === 'executed' || r.status === 'needs_clarification') && (
      (Array.isArray(r.choices) && r.choices.length > 0)
      || (r.name === 'open_task' && r.item_type === 'task' && !!r.item_uuid)
    )
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
    'If a previous result has item_type="task" and item_uuid, treat that item_uuid as the target task.',
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
        'Voice input writes a transcript into the prompt; choose Whisper for local transcription, or Deepgram/Yandex SpeechKit for live cloud transcription.',
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

function showAiAgentSettings() {
  if (document.querySelector('.ai-agent-settings-overlay')) return;
  const overlay = el('div', { class: 'modal-overlay ai-agent-settings-overlay' });
  const modal = el('div', { class: 'modal ai-agent-settings-modal' });

  const header = el('div', { class: 'ai-agent-settings-header' });
  header.appendChild(el('h3', { text: 'AI Agent Settings' }));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn-secondary ai-agent-settings-close';
  close.textContent = 'Close';
  close.addEventListener('click', () => overlay.remove());
  header.appendChild(close);
  modal.appendChild(header);

  const body = el('div', { class: 'ai-agent-settings-body' });
  modal.appendChild(body);

  const instructions = el('section', { class: 'ai-agent-settings-section' });
  instructions.appendChild(el('h4', { text: 'Instructions' }));
  instructions.appendChild(el('p', {
    class: 'ai-agent-settings-help',
    text: 'Custom instructions are added after immutable safety rules and apply to this sync API user.',
  }));
  const textarea = document.createElement('textarea');
  textarea.className = 'ai-agent-instructions-input';
  textarea.placeholder = 'Example: answer in Russian unless I ask otherwise.';
  instructions.appendChild(textarea);
  const core = el('pre', { class: 'ai-agent-core-instructions', text: 'Loading core instructions...' });
  instructions.appendChild(core);
  const status = el('div', { class: 'ai-agent-settings-status', text: '' });
  const instructionActions = el('div', { class: 'ai-agent-settings-actions' });
  const saveBtn = el('button', { class: 'ai-agent-save-btn', text: 'Save' });
  const resetBtn = el('button', { class: 'btn-secondary ai-agent-reset-btn', text: 'Reset' });
  instructionActions.appendChild(saveBtn);
  instructionActions.appendChild(resetBtn);
  instructionActions.appendChild(status);
  instructions.appendChild(instructionActions);
  body.appendChild(instructions);

  const capabilities = el('section', { class: 'ai-agent-settings-section' });
  capabilities.appendChild(el('h4', { text: 'Capabilities' }));
  const capabilityBox = el('div', { class: 'ai-agent-capabilities-box', text: 'Loading capabilities...' });
  capabilities.appendChild(capabilityBox);
  body.appendChild(capabilities);

  const preview = el('section', { class: 'ai-agent-settings-section' });
  preview.appendChild(el('h4', { text: 'Test Prompt' }));
  preview.appendChild(el('p', {
    class: 'ai-agent-settings-help',
    text: 'Preview asks DeepSeek for a plan but does not execute commands or navigate the app.',
  }));
  const previewInput = document.createElement('textarea');
  previewInput.className = 'ai-agent-preview-input';
  previewInput.placeholder = 'Покажи задачу Аптека';
  preview.appendChild(previewInput);
  const previewActions = el('div', { class: 'ai-agent-settings-actions' });
  const previewBtn = el('button', { class: 'ai-agent-preview-btn', text: 'Preview' });
  previewActions.appendChild(previewBtn);
  preview.appendChild(previewActions);
  const previewOutput = el('div', { class: 'ai-agent-preview-output empty', text: 'No preview yet' });
  preview.appendChild(previewOutput);
  body.appendChild(preview);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });

  loadAgentSettingsModal({ textarea, core, capabilityBox, status });

  saveBtn.addEventListener('click', async () => {
    await saveAgentInstructions(textarea.value, { textarea, core, status, saveBtn });
  });
  resetBtn.addEventListener('click', async () => {
    textarea.value = '';
    await saveAgentInstructions('', { textarea, core, status, saveBtn: resetBtn });
  });
  previewBtn.addEventListener('click', async () => {
    await runAgentPreview(previewInput.value, { previewBtn, previewOutput });
  });
}

async function loadAgentSettingsModal({ textarea, core, capabilityBox, status }) {
  try {
    const [settings, capabilities] = await Promise.all([
      getAiAgentSettings(),
      getAiCapabilities(),
    ]);
    textarea.value = settings?.custom_instructions || '';
    core.textContent = settings?.core_instructions || '';
    renderCapabilities(capabilityBox, capabilities);
    status.textContent = settings?.updated_at ? `Loaded: ${formatDate(settings.updated_at)}` : 'Loaded';
  } catch (err) {
    status.textContent = 'Load failed';
    capabilityBox.textContent = 'Capabilities unavailable.';
    showErrorDialog({
      title: 'AI agent settings failed',
      message: 'The AI tab could not load agent settings.',
      details: { error: String(err) },
    });
  }
}

async function saveAgentInstructions(value, { status, saveBtn }) {
  const original = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  status.textContent = '';
  try {
    const saved = await saveAiAgentSettings(value);
    status.textContent = saved?.updated_at ? `Saved: ${formatDate(saved.updated_at)}` : 'Saved';
  } catch (err) {
    status.textContent = 'Save failed';
    showErrorDialog({
      title: 'AI agent settings save failed',
      message: 'Custom instructions could not be saved.',
      details: { error: String(err) },
    });
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = original;
  }
}

function renderCapabilities(container, data) {
  container.innerHTML = '';
  const tools = Array.isArray(data?.tools) ? data.tools : [];
  const safety = Array.isArray(data?.safety_rules) ? data.safety_rules : [];
  const fields = Array.isArray(data?.context_fields) ? data.context_fields : [];

  const toolList = el('div', { class: 'ai-agent-capability-list' });
  for (const tool of tools) {
    const row = el('div', { class: 'ai-agent-capability-tool' });
    row.appendChild(el('code', { text: tool.name || 'tool' }));
    row.appendChild(el('span', { text: tool.description || '' }));
    toolList.appendChild(row);
  }
  container.appendChild(sectionBlock('Tools', toolList));

  const safetyList = document.createElement('ul');
  for (const rule of safety) safetyList.appendChild(el('li', { text: rule }));
  container.appendChild(sectionBlock('Safety', safetyList));

  const contextList = el('div', { class: 'ai-agent-context-list' });
  for (const field of fields) {
    const row = el('div', { class: 'ai-agent-context-field' });
    row.appendChild(el('code', { text: field.name || 'field' }));
    row.appendChild(el('span', { text: field.description || '' }));
    contextList.appendChild(row);
  }
  container.appendChild(sectionBlock('Context', contextList));
}

function sectionBlock(title, content) {
  const block = el('div', { class: 'ai-agent-capability-block' });
  block.appendChild(el('h5', { text: title }));
  block.appendChild(content);
  return block;
}

async function runAgentPreview(message, { previewBtn, previewOutput }) {
  const text = String(message || '').trim();
  if (!text) {
    previewOutput.classList.remove('empty');
    previewOutput.textContent = 'Enter a prompt first.';
    return;
  }
  const original = previewBtn.textContent;
  previewBtn.disabled = true;
  previewBtn.textContent = 'Previewing...';
  previewOutput.classList.add('empty');
  previewOutput.textContent = 'Planning...';
  try {
    const response = await previewAiPrompt({
      mode: 'command',
      channel: 'client',
      message: text,
      context: buildContext(),
    });
    renderPreviewOutput(previewOutput, response);
  } catch (err) {
    previewOutput.classList.remove('empty');
    previewOutput.textContent = 'Preview failed';
    showErrorDialog({
      title: 'AI prompt preview failed',
      message: 'The AI tab could not preview this prompt.',
      details: { error: String(err), message: text },
    });
  } finally {
    previewBtn.disabled = false;
    previewBtn.textContent = original;
  }
}

function renderPreviewOutput(container, response) {
  container.innerHTML = '';
  container.classList.remove('empty');
  const reply = String(response?.reply || '').trim();
  if (reply) {
    container.appendChild(el('div', { class: 'ai-agent-preview-reply', text: reply }));
  }
  const commands = Array.isArray(response?.commands) ? response.commands : [];
  if (!commands.length) {
    container.appendChild(el('div', { class: 'ai-agent-preview-empty', text: 'No commands planned.' }));
    return;
  }
  for (const command of commands) {
    const row = el('div', { class: 'ai-agent-preview-command' });
    row.appendChild(el('code', { text: command?.name || 'command' }));
    row.appendChild(el('pre', { text: JSON.stringify(command?.args || {}, null, 2) }));
    container.appendChild(row);
  }
}

function formatDate(value) {
  if (!value) return 'never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function el(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
}
