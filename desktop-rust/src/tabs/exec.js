import { call } from '../tauri-api.js';
import { showModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

let root = null;
let categories = [];
let commands = [];
let selectedCategoryId = null;
let isRunning = false;

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  root.appendChild(buildLayout());
  loadCategories();
}

// ── Layout ─────────────────────────────────────────────────

function buildLayout() {
  const wrap = el('div', { class: 'exec-wrap' });

  // Top area: categories + commands
  const topArea = el('div', { class: 'exec-top' });

  // Left panel: categories
  const left = el('div', { class: 'exec-left' });
  const leftHeader = el('div', { class: 'exec-panel-header' });
  leftHeader.appendChild(el('span', { text: 'Categories', class: 'exec-panel-title' }));
  const addCatBtn = el('button', { text: '+', class: 'btn-small' });
  addCatBtn.addEventListener('click', onAddCategory);
  leftHeader.appendChild(addCatBtn);
  left.appendChild(leftHeader);

  const catList = el('div', { class: 'exec-cat-list', id: 'exec-cat-list' });
  left.appendChild(catList);

  // Right panel: commands
  const right = el('div', { class: 'exec-right' });
  const rightHeader = el('div', { class: 'exec-panel-header' });
  rightHeader.appendChild(el('span', { text: 'Commands', class: 'exec-panel-title' }));
  const addCmdBtn = el('button', { text: '+', class: 'btn-small', id: 'add-cmd-btn' });
  addCmdBtn.addEventListener('click', onAddCommand);
  rightHeader.appendChild(addCmdBtn);
  right.appendChild(rightHeader);

  const cmdList = el('div', { class: 'exec-cmd-list', id: 'exec-cmd-list' });
  cmdList.innerHTML = '<p style="padding:12px;color:var(--text-muted)">Select a category</p>';
  right.appendChild(cmdList);

  topArea.appendChild(left);
  topArea.appendChild(right);
  wrap.appendChild(topArea);

  // Bottom panel: output console
  const bottom = el('div', { class: 'exec-bottom' });
  const bottomHeader = el('div', { class: 'exec-panel-header' });
  bottomHeader.appendChild(el('span', { text: 'Output', class: 'exec-panel-title' }));
  const stopBtn = el('button', { text: 'Stop', class: 'btn-secondary btn-small', id: 'exec-stop-btn' });
  stopBtn.style.display = 'none';
  stopBtn.addEventListener('click', onStop);
  bottomHeader.appendChild(stopBtn);
  bottom.appendChild(bottomHeader);

  const console = el('pre', { class: 'exec-console', id: 'exec-console' });
  console.textContent = 'Ready.';
  bottom.appendChild(console);

  wrap.appendChild(bottom);
  return wrap;
}

// ── Categories ─────────────────────────────────────────────

async function loadCategories() {
  try {
    categories = await call('list_exec_categories');
    renderCategories();
    if (categories.length && !selectedCategoryId) {
      selectCategory(categories[0].id);
    } else if (selectedCategoryId) {
      const still = categories.find(c => c.id === selectedCategoryId);
      if (still) selectCategory(selectedCategoryId);
      else if (categories.length) selectCategory(categories[0].id);
      else { selectedCategoryId = null; renderCommandsEmpty(); }
    } else {
      renderCommandsEmpty();
    }
  } catch (e) {
    showToast('Failed to load categories: ' + e, 'error');
  }
}

function renderCategories() {
  const list = root.querySelector('#exec-cat-list');
  if (!list) return;
  list.innerHTML = '';
  for (const c of categories) {
    const item = el('div', {
      class: 'exec-cat-item' + (c.id === selectedCategoryId ? ' active' : ''),
    });
    const nameSpan = el('span', { text: c.name, class: 'cat-name' });
    item.appendChild(nameSpan);

    const actions = el('span', { class: 'cat-actions' });
    const editBtn = el('button', { text: '\u270E', class: 'btn-icon', title: 'Edit' });
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); onEditCategory(c); });
    const deleteBtn = el('button', { text: '\u2715', class: 'btn-icon btn-icon-danger', title: 'Delete' });
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); onDeleteCategory(c); });
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(actions);

    item.addEventListener('click', () => selectCategory(c.id));
    list.appendChild(item);
  }
}

function selectCategory(id) {
  selectedCategoryId = id;
  renderCategories();
  loadCommands();
}

async function onAddCategory() {
  const body = document.createElement('div');
  body.innerHTML = `
    <label style="display:block;margin-bottom:6px;color:var(--text)">Name</label>
    <input id="cat-name-input" style="width:100%" placeholder="Category name" />
    <label style="display:block;margin-top:8px;margin-bottom:6px;color:var(--text)">Sort order</label>
    <input id="cat-sort-input" type="number" style="width:100%" value="${categories.length}" />
  `;
  try {
    await showModal({
      title: 'New Category',
      body,
      onConfirm: async () => {
        const name = document.getElementById('cat-name-input').value.trim();
        const sortOrder = parseInt(document.getElementById('cat-sort-input').value) || 0;
        if (!name) throw new Error('Name is required');
        await call('create_exec_category', { name, sortOrder });
        showToast('Category created', 'success');
      },
    });
    await loadCategories();
  } catch (_) { /* cancelled */ }
}

async function onEditCategory(cat) {
  const body = document.createElement('div');
  body.innerHTML = `
    <label style="display:block;margin-bottom:6px;color:var(--text)">Name</label>
    <input id="cat-name-input" style="width:100%" value="${cat.name}" />
    <label style="display:block;margin-top:8px;margin-bottom:6px;color:var(--text)">Sort order</label>
    <input id="cat-sort-input" type="number" style="width:100%" value="${cat.sort_order}" />
  `;
  try {
    await showModal({
      title: 'Edit Category',
      body,
      onConfirm: async () => {
        const name = document.getElementById('cat-name-input').value.trim();
        const sortOrder = parseInt(document.getElementById('cat-sort-input').value) || 0;
        if (!name) throw new Error('Name is required');
        await call('update_exec_category', { id: cat.id, name, sortOrder });
        showToast('Category updated', 'success');
      },
    });
    await loadCategories();
  } catch (_) { /* cancelled */ }
}

async function onDeleteCategory(cat) {
  try {
    await showModal({
      title: 'Delete Category',
      body: `Delete category "${cat.name}" and all its commands?`,
      onConfirm: async () => {
        await call('delete_exec_category', { id: cat.id });
        showToast('Category deleted', 'success');
      },
    });
    if (selectedCategoryId === cat.id) selectedCategoryId = null;
    await loadCategories();
  } catch (_) { /* cancelled */ }
}

// ── Commands ───────────────────────────────────────────────

async function loadCommands() {
  if (!selectedCategoryId) { renderCommandsEmpty(); return; }
  try {
    commands = await call('list_exec_commands', { categoryId: selectedCategoryId });
    renderCommands();
  } catch (e) {
    showToast('Failed to load commands: ' + e, 'error');
  }
}

function renderCommandsEmpty() {
  const list = root.querySelector('#exec-cmd-list');
  if (!list) return;
  list.innerHTML = '<p style="padding:12px;color:var(--text-muted)">Select a category</p>';
}

function renderCommands() {
  const list = root.querySelector('#exec-cmd-list');
  if (!list) return;
  list.innerHTML = '';

  if (!commands.length) {
    list.innerHTML = '<p style="padding:12px;color:var(--text-muted)">No commands yet</p>';
    return;
  }

  for (const cmd of commands) {
    const card = el('div', { class: 'exec-cmd-card' });

    const header = el('div', { class: 'exec-cmd-header' });
    header.appendChild(el('strong', { text: cmd.name }));

    const cardActions = el('div', { class: 'cmd-actions' });
    const runBtn = el('button', { text: 'Run', class: 'btn-small' });
    runBtn.addEventListener('click', () => onRunCommand(cmd));
    cardActions.appendChild(runBtn);

    const editBtn = el('button', { text: '\u270E', class: 'btn-icon', title: 'Edit' });
    editBtn.addEventListener('click', () => onEditCommand(cmd));
    cardActions.appendChild(editBtn);

    const delBtn = el('button', { text: '\u2715', class: 'btn-icon btn-icon-danger', title: 'Delete' });
    delBtn.addEventListener('click', () => onDeleteCommand(cmd));
    cardActions.appendChild(delBtn);

    header.appendChild(cardActions);
    card.appendChild(header);

    if (cmd.description) {
      card.appendChild(el('div', { text: cmd.description, class: 'exec-cmd-desc' }));
    }
    card.appendChild(el('code', { text: cmd.command, class: 'exec-cmd-code' }));

    list.appendChild(card);
  }
}

async function onAddCommand() {
  if (!selectedCategoryId) {
    showToast('Select a category first', 'info');
    return;
  }
  const body = buildCommandForm({});
  try {
    await showModal({
      title: 'New Command',
      body,
      onConfirm: async () => {
        const vals = readCommandForm();
        if (!vals.name) throw new Error('Name is required');
        await call('create_exec_command', {
          categoryId: selectedCategoryId,
          name: vals.name,
          command: vals.command,
          description: vals.description,
          sortOrder: vals.sortOrder,
          hideAfterRun: vals.hideAfterRun,
        });
        showToast('Command created', 'success');
      },
    });
    await loadCommands();
  } catch (_) { /* cancelled */ }
}

async function onEditCommand(cmd) {
  const body = buildCommandForm(cmd);
  try {
    await showModal({
      title: 'Edit Command',
      body,
      onConfirm: async () => {
        const vals = readCommandForm();
        if (!vals.name) throw new Error('Name is required');
        await call('update_exec_command', {
          id: cmd.id,
          name: vals.name,
          command: vals.command,
          description: vals.description,
          sortOrder: vals.sortOrder,
          hideAfterRun: vals.hideAfterRun,
        });
        showToast('Command updated', 'success');
      },
    });
    await loadCommands();
  } catch (_) { /* cancelled */ }
}

async function onDeleteCommand(cmd) {
  try {
    await showModal({
      title: 'Delete Command',
      body: `Delete command "${cmd.name}"?`,
      onConfirm: async () => {
        await call('delete_exec_command', { id: cmd.id });
        showToast('Command deleted', 'success');
      },
    });
    await loadCommands();
  } catch (_) { /* cancelled */ }
}

function buildCommandForm(cmd) {
  const body = document.createElement('div');
  body.innerHTML = `
    <label style="display:block;margin-bottom:4px;color:var(--text)">Name</label>
    <input id="cmd-name" style="width:100%" value="${cmd.name || ''}" placeholder="Command name" />
    <label style="display:block;margin-top:8px;margin-bottom:4px;color:var(--text)">Command</label>
    <textarea id="cmd-command" style="width:100%;min-height:60px;font-family:monospace" placeholder="sh -c '...'">${cmd.command || ''}</textarea>
    <label style="display:block;margin-top:8px;margin-bottom:4px;color:var(--text)">Description</label>
    <input id="cmd-desc" style="width:100%" value="${cmd.description || ''}" placeholder="Optional description" />
    <label style="display:block;margin-top:8px;margin-bottom:4px;color:var(--text)">Sort order</label>
    <input id="cmd-sort" type="number" style="width:100%" value="${cmd.sort_order ?? 0}" />
    <label style="display:flex;align-items:center;gap:6px;margin-top:8px;color:var(--text)">
      <input type="checkbox" id="cmd-hide" ${cmd.hide_after_run ? 'checked' : ''} /> Hide window after run
    </label>
  `;
  return body;
}

function readCommandForm() {
  return {
    name: document.getElementById('cmd-name').value.trim(),
    command: document.getElementById('cmd-command').value.trim(),
    description: document.getElementById('cmd-desc').value.trim(),
    sortOrder: parseInt(document.getElementById('cmd-sort').value) || 0,
    hideAfterRun: document.getElementById('cmd-hide').checked,
  };
}

// ── Run / Stop ─────────────────────────────────────────────

async function onRunCommand(cmd) {
  const console_ = root.querySelector('#exec-console');
  const stopBtn = root.querySelector('#exec-stop-btn');
  if (!console_ || isRunning) return;

  isRunning = true;
  stopBtn.style.display = '';
  console_.textContent = `Running: ${cmd.command}\n...\n`;

  try {
    const output = await call('run_command', { command: cmd.command });
    console_.textContent = output;
  } catch (e) {
    console_.textContent = `Error: ${e}`;
  } finally {
    isRunning = false;
    stopBtn.style.display = 'none';
  }
}

async function onStop() {
  try {
    await call('stop_command');
    showToast('Stop signal sent', 'info');
  } catch (e) {
    showToast('Stop error: ' + e, 'error');
  }
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
.exec-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.exec-top {
  display: flex;
  flex: 1;
  min-height: 0;
}
.exec-left {
  width: 220px;
  min-width: 220px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.exec-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.exec-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px 12px;
  border-bottom: 1px solid var(--border);
}
.exec-panel-title {
  font-weight: 600;
  font-size: 14px;
}
.exec-cat-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}
.exec-cat-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 2px;
}
.exec-cat-item:hover {
  background: var(--bg-secondary);
}
.exec-cat-item.active {
  background: var(--bg-secondary);
  border-left: 3px solid var(--accent);
  padding-left: 7px;
}
.cat-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cat-actions {
  display: none;
  gap: 2px;
}
.exec-cat-item:hover .cat-actions {
  display: flex;
}
.exec-cmd-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.exec-cmd-card {
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 10px 14px;
  border-left: 3px solid transparent;
  transition: border-color 0.15s;
}
.exec-cmd-card:hover {
  border-left-color: var(--accent);
}
.exec-cmd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.cmd-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}
.exec-cmd-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.exec-cmd-code {
  display: block;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  padding: 4px 8px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.exec-bottom {
  height: 200px;
  min-height: 120px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
.exec-console {
  flex: 1;
  margin: 0;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.5;
  background: #1e1e2e;
  color: #cdd6f4;
  overflow: auto;
  white-space: pre-wrap;
}
.btn-icon {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
  font-size: 13px;
  border-radius: 4px;
  min-width: 0;
}
.btn-icon:hover {
  background: var(--bg-tertiary);
  color: var(--text);
}
.btn-icon-danger:hover {
  color: var(--danger);
}
.btn-small {
  padding: 4px 10px;
  font-size: 14px;
  line-height: 1;
}
`;
}
