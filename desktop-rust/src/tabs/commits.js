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
    commit_type: 'fix',
    object_category: 'отчет',
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

const COMMIT_TYPES = ['fix', 'new', 'rm', 'feat', 'ref', 'chore', 'style'];

const COMMIT_CATEGORIES = ['отчет', 'таблица', 'плагин', 'даг', 'ручка апи', 'несколько'];

const COMMIT_OBJECT_HINTS = {
  'отчет': '004.1',
  'таблица': 'datamart.srid_tracker_tangle',
  'плагин': 'имя функции',
  'даг': 'dm3_report_1',
  'ручка апи': '/api/v1/endpoint',
  'несколько': 'общий префикс или пусто',
};

// ── Task ID parsing ────────────────────────────────────────

function parseTaskId(text) {
  if (!text) return '';

  // 1. /i/<PROJECT>/<TASK_ID>/
  const iMatch = text.match(/\/i\/[^/]+\/([A-Za-z]+-\d+)/);
  if (iMatch) return iMatch[1];

  // 2. /issue/<TASK_ID>/
  const issueMatch = text.match(/\/issue\/([A-Za-z]+-\d+)/);
  if (issueMatch) return issueMatch[1];

  // 3. Standalone pattern anywhere
  const standaloneMatch = text.match(/([A-Za-z]+-\d+)/);
  if (standaloneMatch) return standaloneMatch[1];

  return '';
}

// ── Commit message format (Python logic) ───────────────────

function buildCommitMessage() {
  const type = form.commit_type;
  const obj = form.object_value.trim();
  const msg = form.message.trim();
  const taskId = form.task_id.trim();

  let core = '';
  if (obj && msg) {
    core = `${type}(${obj}): ${msg}`;
  } else if (obj) {
    core = `${type}(${obj})`;
  } else if (msg) {
    core = `${type}: ${msg}`;
  } else {
    core = type;
  }

  if (taskId) {
    return `[${taskId}] ${core}`;
  }
  return core;
}

// ── Chat message format (Python logic) ─────────────────────

function buildChatMessage() {
  const lines = [];

  // tags (space-separated)
  if (form.selected_tags.length) {
    lines.push(form.selected_tags.join(' '));
  }

  // [task_id](task_link)
  if (form.task_id && form.task_link) {
    lines.push(`[${form.task_id}](${form.task_link})`);
  } else if (form.task_id) {
    lines.push(form.task_id);
  } else if (form.task_link) {
    lines.push(form.task_link);
  }

  // MR
  if (form.mr_link) {
    lines.push(`MR: ${form.mr_link}`);
  }

  // даг: test dag link
  if (form.test_dag) {
    lines.push(`даг: [тест](${form.test_dag})`);
  }

  // отчеты: test + prod
  if (form.test_report || form.prod_report) {
    const parts = [];
    if (form.test_report) parts.push(`[тест](${form.test_report})`);
    if (form.prod_report) parts.push(`[прод](${form.prod_report})`);
    lines.push(`отчеты: ${parts.join(', ')}`);
  }

  // connect
  if (form.transfer_connect) {
    lines.push(`надо перенести коннект: ${form.transfer_connect}`);
  }

  return lines.join('\n');
}

// ── Auto-fill prod from test URL ───────────────────────────

function autofillProdFromTest(testUrl) {
  if (testUrl && testUrl.includes('superset-test')) {
    return testUrl.replace('superset-test', 'superset');
  }
  return '';
}

// ── Init ───────────────────────────────────────────────────

export async function init(container) {
  root = container;
  root.innerHTML = '';

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
  updatePreviews();
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
  rightHeader.appendChild(el('span', { text: 'Preview', class: 'commits-title' }));
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
    const obj = h.object_value ? `(${h.object_value})` : '';
    opt.textContent = `[${date}] ${h.commit_type}${obj}: ${(h.message || '').substring(0, 40)}`;
    histSelect.appendChild(opt);
  }
  histSelect.addEventListener('change', () => {
    if (histSelect.value) {
      const h = history.find(x => x.id === Number(histSelect.value));
      if (h) fillFromHistory(h);
    } else {
      form = resetForm();
      // Re-select default tags
      form.selected_tags = tags.filter(t => t.is_default).map(t => t.tag_name);
      renderForm();
      updatePreviews();
    }
  });
  historyRow.appendChild(histSelect);

  const delHistBtn = el('button', { text: '\u2715', class: 'btn-small btn-secondary', title: 'Delete selected' });
  delHistBtn.addEventListener('click', onDeleteHistory);
  historyRow.appendChild(delHistBtn);
  formArea.appendChild(historyRow);

  // Task link
  formArea.appendChild(makeInput('task_link', 'Task link', 'https://tracker.example.ru/i/PROJECT/TASK-123', (val) => {
    form.task_link = val;
    const parsed = parseTaskId(val);
    if (parsed) {
      form.task_id = parsed;
      // Update task_id input if it exists
      const taskIdInput = root.querySelector('[data-field="task_id"]');
      if (taskIdInput) taskIdInput.value = parsed;
    }
    updatePreviews();
  }));

  // Task ID
  formArea.appendChild(makeInput('task_id', 'Task ID', 'TASK-123'));

  // Commit type
  formArea.appendChild(makeSelect('commit_type', 'Type', COMMIT_TYPES.map(t => ({ value: t, label: t }))));

  // Object category
  formArea.appendChild(makeSelect('object_category', 'Category', COMMIT_CATEGORIES.map(c => ({ value: c, label: c }))));

  // Object value (with hint from category)
  const objectHint = COMMIT_OBJECT_HINTS[form.object_category] || '';
  formArea.appendChild(makeInput('object_value', 'Object', objectHint));

  // Message
  formArea.appendChild(makeInput('message', 'Message', 'short commit message'));

  // MR link
  formArea.appendChild(makeInput('mr_link', 'MR link', 'https://gitlab.example.com/mr/123'));

  // Conditional: report fields (category = "отчет")
  if (form.object_category === 'отчет') {
    formArea.appendChild(makeInput('test_report', 'Тест', 'test report link', (val) => {
      form.test_report = val;
      const autoProd = autofillProdFromTest(val);
      if (autoProd) {
        form.prod_report = autoProd;
        const prodInput = root.querySelector('[data-field="prod_report"]');
        if (prodInput) prodInput.value = autoProd;
      }
      updatePreviews();
    }));
    formArea.appendChild(makeInput('prod_report', 'Прод', 'prod report link'));
    formArea.appendChild(makeInput('transfer_connect', 'Коннект', 'connect string'));
  }

  // Conditional: dag field (category = "даг")
  if (form.object_category === 'даг') {
    formArea.appendChild(makeInput('test_dag', 'Тест даг', 'test DAG link'));
  }

  // Tags
  const tagRow = el('div', { class: 'form-row form-row-tags' });
  tagRow.appendChild(el('label', { text: 'Tags:', class: 'form-label' }));
  const tagWrap = el('div', { class: 'tag-area' });

  // Selected tags display
  const selectedWrap = el('div', { class: 'tag-selected' });
  for (const name of form.selected_tags) {
    const chip = el('span', { text: name, class: 'tag-chip' });
    const removeBtn = el('span', { text: '\u00d7', class: 'tag-chip-remove' });
    removeBtn.addEventListener('click', () => {
      form.selected_tags = form.selected_tags.filter(n => n !== name);
      renderForm();
      updatePreviews();
    });
    chip.appendChild(removeBtn);
    selectedWrap.appendChild(chip);
  }
  tagWrap.appendChild(selectedWrap);

  // Tag combo row: select + add + clear
  const tagComboRow = el('div', { class: 'tag-combo-row' });
  const tagSelect = document.createElement('select');
  tagSelect.className = 'form-select tag-combo-select';
  tagSelect.innerHTML = '<option value="">-- add tag --</option>';
  for (const t of tags) {
    if (!form.selected_tags.includes(t.tag_name)) {
      const opt = document.createElement('option');
      opt.value = t.tag_name;
      opt.textContent = t.tag_name;
      tagSelect.appendChild(opt);
    }
  }
  tagSelect.addEventListener('change', () => {
    if (tagSelect.value && !form.selected_tags.includes(tagSelect.value)) {
      form.selected_tags.push(tagSelect.value);
      renderForm();
      updatePreviews();
    }
  });
  tagComboRow.appendChild(tagSelect);

  const addTagBtn = el('button', { text: '+', class: 'btn-small', title: 'Create new tag' });
  addTagBtn.addEventListener('click', onAddTag);
  tagComboRow.appendChild(addTagBtn);

  const clearTagsBtn = el('button', { text: 'Clear', class: 'btn-small btn-secondary', title: 'Clear all tags' });
  clearTagsBtn.addEventListener('click', () => {
    form.selected_tags = [];
    renderForm();
    updatePreviews();
  });
  tagComboRow.appendChild(clearTagsBtn);

  tagWrap.appendChild(tagComboRow);
  tagRow.appendChild(tagWrap);
  formArea.appendChild(tagRow);

  // Action buttons
  const actions = el('div', { class: 'form-actions' });

  const copyCommitBtn = el('button', { text: 'Copy commit' });
  copyCommitBtn.addEventListener('click', () => {
    const msg = buildCommitMessage();
    if (msg) {
      navigator.clipboard.writeText(msg);
      showToast('Commit message copied', 'success');
    }
  });
  actions.appendChild(copyCommitBtn);

  const copyChatBtn = el('button', { text: 'Copy chat', class: 'btn-secondary' });
  copyChatBtn.addEventListener('click', () => {
    const msg = buildChatMessage();
    if (msg) {
      navigator.clipboard.writeText(msg);
      showToast('Chat message copied', 'success');
    }
  });
  actions.appendChild(copyChatBtn);

  const saveBtn = el('button', { text: 'Save', class: 'btn-secondary', title: 'Save to history' });
  saveBtn.addEventListener('click', () => onSaveHistory());
  actions.appendChild(saveBtn);

  const resetBtn = el('button', { text: 'Reset', class: 'btn-secondary btn-danger-subtle' });
  resetBtn.addEventListener('click', () => {
    form = resetForm();
    form.selected_tags = tags.filter(t => t.is_default).map(t => t.tag_name);
    renderForm();
    updatePreviews();
  });
  actions.appendChild(resetBtn);

  formArea.appendChild(actions);
}

function makeInput(field, label, placeholder, customHandler) {
  const row = el('div', { class: 'form-row' });
  row.appendChild(el('label', { text: label + ':', class: 'form-label' }));
  const input = document.createElement('input');
  input.className = 'form-input';
  input.placeholder = placeholder || '';
  input.value = form[field] || '';
  input.setAttribute('data-field', field);
  input.addEventListener('input', () => {
    if (customHandler) {
      customHandler(input.value);
    } else {
      form[field] = input.value;
      updatePreviews();
    }
  });
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
    if (field === 'object_category') {
      renderForm();
    }
    updatePreviews();
  });
  row.appendChild(select);
  return row;
}

function fillFromHistory(h) {
  form = {
    task_link: h.task_link || '',
    task_id: h.task_id || '',
    commit_type: h.commit_type || 'fix',
    object_category: h.object_category || 'отчет',
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
  updatePreviews();
}

// ── Preview (real-time) ────────────────────────────────────

function updatePreviews() {
  const area = root.querySelector('#commits-output-area');
  if (!area) return;
  area.innerHTML = '';

  const commitMsg = buildCommitMessage();
  const chatMsg = buildChatMessage();

  // Commit message section
  area.appendChild(el('label', { text: 'Commit message:', class: 'output-label' }));
  const commitPre = el('pre', { class: 'commits-output-pre' });
  commitPre.textContent = commitMsg || '...';
  area.appendChild(commitPre);

  // Chat message section
  area.appendChild(el('label', { text: 'Chat message:', class: 'output-label' }));
  const chatPre = el('pre', { class: 'commits-output-pre' });
  chatPre.textContent = chatMsg || '...';
  area.appendChild(chatPre);
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
    form.selected_tags = tags.filter(t => t.is_default).map(t => t.tag_name);
    renderForm();
    updatePreviews();
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
  letter-spacing: -0.01em;
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
.output-label {
  font-weight: 600;
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 8px;
}
.output-label:first-child {
  margin-top: 0;
}
.commits-output-pre {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', 'Cascadia Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--text);
  margin: 0;
  min-height: 48px;
}
.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.form-row-tags {
  align-items: flex-start;
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
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.tag-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tag-selected {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 24px;
}
.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  color: var(--text);
  line-height: 1.4;
}
.tag-chip-remove {
  cursor: pointer;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
  margin-left: 2px;
}
.tag-chip-remove:hover {
  color: var(--danger);
}
.tag-combo-row {
  display: flex;
  gap: 4px;
  align-items: center;
}
.tag-combo-select {
  flex: 1;
  min-width: 0;
}
.btn-small {
  padding: 4px 10px;
  font-size: 14px;
  line-height: 1;
}
.btn-danger-subtle {
  color: var(--danger);
}
.btn-danger-subtle:hover {
  background: var(--danger);
  color: #fff;
  border-color: var(--danger);
}
`;
}
