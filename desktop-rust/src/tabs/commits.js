import { call } from '../tauri-api.js';
import { showModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

let root = null;
let history = [];
let tags = [];
let computerId = '';

// Form state
let form = resetForm();

function resetForm() {
  return {
    task_link: '',
    task_id: '',
    commit_type: 'feat',
    object_category: 'other',
    object_value: '',
    message: '',
    selected_tags: [],
    mr_link: '',
    test_report: '',
    prod_report: '',
    transfer_connect: '',
    test_dag: '',
  };
}

const COMMIT_TYPES = [
  { value: 'feat', label: 'feat' },
  { value: 'fix', label: 'fix' },
  { value: 'refactor', label: 'refactor' },
  { value: 'chore', label: 'chore' },
  { value: 'docs', label: 'docs' },
  { value: 'test', label: 'test' },
  { value: 'style', label: 'style' },
];

const OBJECT_CATEGORIES = [
  { value: 'report', label: 'Report' },
  { value: 'dag', label: 'DAG' },
  { value: 'script', label: 'Script' },
  { value: 'config', label: 'Config' },
  { value: 'other', label: 'Other' },
];

export async function init(container) {
  root = container;
  root.innerHTML = '';

  // Get computer_id
  try {
    computerId = await getComputerId();
  } catch {
    computerId = 'default';
  }

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  root.appendChild(buildLayout());

  await Promise.all([loadHistory(), loadTags()]);
  renderForm();
}

async function getComputerId() {
  const saved = await call('get_setting', { key: 'computer_id' });
  return saved || 'default';
}

// ── Layout ─────────────────────────────────────────────────

function buildLayout() {
  const wrap = el('div', { class: 'commits-wrap' });

  // Left: form
  const left = el('div', { class: 'commits-left' });
  const leftHeader = el('div', { class: 'commits-header' });
  leftHeader.appendChild(el('span', { text: 'Commit Builder', class: 'commits-title' }));
  left.appendChild(leftHeader);

  const formArea = el('div', { class: 'commits-form', id: 'commits-form' });
  left.appendChild(formArea);

  // Right: output + actions
  const right = el('div', { class: 'commits-right' });
  const rightHeader = el('div', { class: 'commits-header' });
  rightHeader.appendChild(el('span', { text: 'Result', class: 'commits-title' }));
  right.appendChild(rightHeader);

  const outputArea = el('div', { class: 'commits-output-area', id: 'commits-output-area' });
  right.appendChild(outputArea);

  wrap.appendChild(left);
  wrap.appendChild(right);
  return wrap;
}

// ── Form rendering ─────────────────────────────────────────

function renderForm() {
  const formArea = root.querySelector('#commits-form');
  if (!formArea) return;
  formArea.innerHTML = '';

  // History dropdown
  const historyRow = el('div', { class: 'form-row' });
  historyRow.appendChild(el('label', { text: 'History:', class: 'form-label' }));
  const histSelect = document.createElement('select');
  histSelect.className = 'form-select';
  histSelect.innerHTML = '<option value="">-- new commit --</option>';
  for (const h of history) {
    const opt = document.createElement('option');
    opt.value = h.id;
    const date = h.created_at ? h.created_at.substring(0, 16) : '';
    opt.textContent = `[${date}] ${h.commit_type}: ${h.message.substring(0, 50)}`;
    histSelect.appendChild(opt);
  }
  histSelect.addEventListener('change', () => {
    if (histSelect.value) {
      const h = history.find(x => x.id === Number(histSelect.value));
      if (h) fillFromHistory(h);
    } else {
      form = resetForm();
      renderForm();
    }
  });
  historyRow.appendChild(histSelect);

  const delHistBtn = el('button', { text: '\u2715', class: 'btn-small btn-secondary', title: 'Delete selected' });
  delHistBtn.addEventListener('click', onDeleteHistory);
  historyRow.appendChild(delHistBtn);
  formArea.appendChild(historyRow);

  // Task link
  formArea.appendChild(makeInput('task_link', 'Task link', 'https://jira.example.com/TASK-123'));

  // Task ID
  formArea.appendChild(makeInput('task_id', 'Task ID', 'TASK-123'));

  // Commit type
  formArea.appendChild(makeSelect('commit_type', 'Type', COMMIT_TYPES));

  // Object category
  formArea.appendChild(makeSelect('object_category', 'Category', OBJECT_CATEGORIES));

  // Object value
  formArea.appendChild(makeInput('object_value', 'Object', 'object_name'));

  // Message
  formArea.appendChild(makeInput('message', 'Message', 'short commit message'));

  // MR link
  formArea.appendChild(makeInput('mr_link', 'MR link', 'https://gitlab.example.com/mr/123'));

  // Conditional: report fields
  if (form.object_category === 'report') {
    formArea.appendChild(makeInput('test_report', 'Test report', 'test report link'));
    formArea.appendChild(makeInput('prod_report', 'Prod report', 'prod report link'));
    formArea.appendChild(makeInput('transfer_connect', 'Transfer connect', 'connect string'));
  }

  // Conditional: dag fields
  if (form.object_category === 'dag') {
    formArea.appendChild(makeInput('test_dag', 'Test DAG', 'test DAG link'));
  }

  // Tags
  const tagRow = el('div', { class: 'form-row' });
  tagRow.appendChild(el('label', { text: 'Tags:', class: 'form-label' }));
  const tagWrap = el('div', { class: 'tag-checkboxes' });
  for (const t of tags) {
    const lbl = document.createElement('label');
    lbl.className = 'tag-checkbox-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = form.selected_tags.includes(t.tag_name);
    cb.addEventListener('change', () => {
      if (cb.checked) {
        if (!form.selected_tags.includes(t.tag_name)) form.selected_tags.push(t.tag_name);
      } else {
        form.selected_tags = form.selected_tags.filter(n => n !== t.tag_name);
      }
    });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' ' + t.tag_name));
    tagWrap.appendChild(lbl);
  }
  const addTagBtn = el('button', { text: '+', class: 'btn-small', title: 'Add tag' });
  addTagBtn.addEventListener('click', onAddTag);
  tagWrap.appendChild(addTagBtn);
  tagRow.appendChild(tagWrap);
  formArea.appendChild(tagRow);

  // Action buttons
  const actions = el('div', { class: 'form-actions' });
  const genBtn = el('button', { text: 'Generate' });
  genBtn.addEventListener('click', onGenerate);
  actions.appendChild(genBtn);

  const resetBtn = el('button', { text: 'Reset', class: 'btn-secondary' });
  resetBtn.addEventListener('click', () => {
    form = resetForm();
    renderForm();
    renderOutput('', '');
  });
  actions.appendChild(resetBtn);
  formArea.appendChild(actions);
}

function makeInput(field, label, placeholder) {
  const row = el('div', { class: 'form-row' });
  row.appendChild(el('label', { text: label + ':', class: 'form-label' }));
  const input = document.createElement('input');
  input.className = 'form-input';
  input.placeholder = placeholder || '';
  input.value = form[field] || '';
  input.addEventListener('input', () => { form[field] = input.value; });
  row.appendChild(input);
  return row;
}

function makeSelect(field, label, options) {
  const row = el('div', { class: 'form-row' });
  row.appendChild(el('label', { text: label + ':', class: 'form-label' }));
  const select = document.createElement('select');
  select.className = 'form-select';
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (form[field] === opt.value) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener('change', () => {
    form[field] = select.value;
    // Re-render form for conditional fields
    if (field === 'object_category') renderForm();
  });
  row.appendChild(select);
  return row;
}

function fillFromHistory(h) {
  form = {
    task_link: h.task_link || '',
    task_id: h.task_id || '',
    commit_type: h.commit_type || 'feat',
    object_category: h.object_category || 'other',
    object_value: h.object_value || '',
    message: h.message || '',
    selected_tags: h.selected_tags ? h.selected_tags.split(',').filter(Boolean) : [],
    mr_link: h.mr_link || '',
    test_report: h.test_report || '',
    prod_report: h.prod_report || '',
    transfer_connect: h.transfer_connect || '',
    test_dag: h.test_dag || '',
  };
  renderForm();
}

// ── Generate ───────────────────────────────────────────────

function onGenerate() {
  const commitMsg = buildCommitMessage();
  const chatMsg = buildChatMessage();
  renderOutput(commitMsg, chatMsg);
}

function buildCommitMessage() {
  const parts = [];
  parts.push(`${form.commit_type}(${form.object_category}): ${form.message}`);
  if (form.object_value) parts.push(`Object: ${form.object_value}`);
  if (form.task_id) parts.push(`Task: ${form.task_id}`);
  return parts.join('\n');
}

function buildChatMessage() {
  const lines = [];
  if (form.selected_tags.length) lines.push(`Tags: ${form.selected_tags.join(', ')}`);
  if (form.task_link) lines.push(`Task: ${form.task_link}`);
  if (form.task_id) lines.push(`ID: ${form.task_id}`);
  lines.push(`Type: ${form.commit_type}`);
  lines.push(`Category: ${form.object_category}`);
  if (form.object_value) lines.push(`Object: ${form.object_value}`);
  if (form.message) lines.push(`Message: ${form.message}`);
  if (form.mr_link) lines.push(`MR: ${form.mr_link}`);
  if (form.test_report) lines.push(`Test report: ${form.test_report}`);
  if (form.prod_report) lines.push(`Prod report: ${form.prod_report}`);
  if (form.transfer_connect) lines.push(`Transfer: ${form.transfer_connect}`);
  if (form.test_dag) lines.push(`Test DAG: ${form.test_dag}`);
  return lines.join('\n');
}

function renderOutput(commitMsg, chatMsg) {
  const area = root.querySelector('#commits-output-area');
  if (!area) return;
  area.innerHTML = '';

  // Commit message section
  area.appendChild(el('label', { text: 'Commit message:', class: 'form-label' }));
  const commitPre = el('pre', { class: 'commits-output-pre' });
  commitPre.textContent = commitMsg || '(click Generate)';
  area.appendChild(commitPre);

  const commitActions = el('div', { class: 'form-actions' });
  const copyCommitBtn = el('button', { text: 'Copy commit', class: 'btn-secondary' });
  copyCommitBtn.addEventListener('click', () => {
    if (commitMsg) {
      navigator.clipboard.writeText(commitMsg);
      showToast('Commit message copied', 'success');
    }
  });
  commitActions.appendChild(copyCommitBtn);

  const saveBtn = el('button', { text: 'Save to history' });
  saveBtn.addEventListener('click', () => onSaveHistory());
  commitActions.appendChild(saveBtn);
  area.appendChild(commitActions);

  // Chat message section
  area.appendChild(el('label', { text: 'Chat message:', class: 'form-label', style: 'margin-top:16px' }));
  const chatPre = el('pre', { class: 'commits-output-pre' });
  chatPre.textContent = chatMsg || '';
  area.appendChild(chatPre);

  const chatActions = el('div', { class: 'form-actions' });
  const copyChatBtn = el('button', { text: 'Copy chat', class: 'btn-secondary' });
  copyChatBtn.addEventListener('click', () => {
    if (chatMsg) {
      navigator.clipboard.writeText(chatMsg);
      showToast('Chat message copied', 'success');
    }
  });
  chatActions.appendChild(copyChatBtn);
  area.appendChild(chatActions);
}

// ── Data operations ────────────────────────────────────────

async function loadHistory() {
  try {
    history = await call('list_commit_history', { computerId });
  } catch (e) {
    showToast('Failed to load history: ' + e, 'error');
  }
}

async function loadTags() {
  try {
    tags = await call('list_commit_tags', { computerId });
    // Pre-select default tags
    if (form.selected_tags.length === 0) {
      form.selected_tags = tags.filter(t => t.is_default).map(t => t.tag_name);
    }
  } catch (e) {
    showToast('Failed to load tags: ' + e, 'error');
  }
}

async function onSaveHistory() {
  try {
    await call('create_commit_history', {
      computerId,
      taskLink: form.task_link,
      taskId: form.task_id,
      commitType: form.commit_type,
      objectCategory: form.object_category,
      objectValue: form.object_value,
      message: form.message,
      selectedTags: form.selected_tags.join(','),
      mrLink: form.mr_link,
      testReport: form.test_report,
      prodReport: form.prod_report,
      transferConnect: form.transfer_connect,
      testDag: form.test_dag,
    });
    showToast('Saved to history', 'success');
    await loadHistory();
    renderForm();
  } catch (e) {
    showToast('Save error: ' + e, 'error');
  }
}

async function onDeleteHistory() {
  const formArea = root.querySelector('#commits-form');
  const histSelect = formArea && formArea.querySelector('select');
  if (!histSelect || !histSelect.value) {
    showToast('Select a history entry first', 'info');
    return;
  }
  const id = Number(histSelect.value);
  try {
    await showModal({
      title: 'Delete History',
      body: 'Delete this history entry?',
      onConfirm: async () => {
        await call('delete_commit_history', { id });
        showToast('History entry deleted', 'success');
      },
    });
    await loadHistory();
    form = resetForm();
    renderForm();
  } catch (_) { /* cancelled */ }
}

async function onAddTag() {
  const body = document.createElement('div');
  body.innerHTML = `
    <label style="display:block;margin-bottom:6px;color:var(--text)">Tag name</label>
    <input id="new-tag-input" style="width:100%" placeholder="e.g. backend" />
    <label style="display:flex;align-items:center;gap:6px;margin-top:8px;color:var(--text)">
      <input type="checkbox" id="new-tag-default" /> Default
    </label>
  `;
  try {
    await showModal({
      title: 'New Tag',
      body,
      onConfirm: async () => {
        const name = document.getElementById('new-tag-input').value.trim();
        const isDefault = document.getElementById('new-tag-default').checked;
        if (!name) throw new Error('Name is required');
        await call('create_commit_tag', { computerId, tagName: name, isDefault: isDefault });
        showToast('Tag created', 'success');
      },
    });
    await loadTags();
    renderForm();
  } catch (_) { /* cancelled */ }
}

// ── Helpers ────────────────────────────────────────────────

function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.class) e.className = opts.class;
  if (opts.text) e.textContent = opts.text;
  if (opts.id) e.id = opts.id;
  if (opts.style) e.setAttribute('style', opts.style);
  if (opts.title) e.title = opts.title;
  return e;
}

function css() {
  return `
.commits-wrap {
  display: flex;
  height: 100%;
  gap: 0;
}
.commits-left {
  flex: 1;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.commits-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.commits-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 8px 12px;
  border-bottom: 1px solid var(--border);
}
.commits-title {
  font-weight: 600;
  font-size: 15px;
}
.commits-form {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.commits-output-area {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.commits-output-pre {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.5;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--text);
  margin: 0;
  min-height: 60px;
}
.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.form-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-muted);
  min-width: 90px;
  flex-shrink: 0;
}
.form-input {
  flex: 1;
  padding: 6px 10px;
  font-size: 13px;
}
.form-select {
  flex: 1;
  padding: 6px 10px;
  font-size: 13px;
}
.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.tag-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.tag-checkbox-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  cursor: pointer;
}
.btn-small {
  padding: 4px 10px;
  font-size: 14px;
  line-height: 1;
}
`;
}
