import { call } from '../tauri-api.js';

const MODULES = [
  { type: 'module', moduleId: 'shortcuts', label: 'Snippets', icon: '🏷' },
  { type: 'module', moduleId: 'notes', label: 'Notes', icon: '🗒' },
  { type: 'module', moduleId: 'tasks', label: 'Tasks', icon: '✓' },
  { type: 'module', moduleId: 'finance', label: 'Finance', icon: '$' },
  { type: 'module', moduleId: 'exec', label: 'Exec', icon: '⚡' },
  { type: 'module', moduleId: 'repo-search', label: 'Search', icon: '⌕' },
  { type: 'module', moduleId: 'clickhouse-docs', label: 'ClickHouse', icon: 'CH' },
  { type: 'module', moduleId: 'ai', label: 'AI', icon: 'AI' },
  { type: 'module', moduleId: 'whisper', label: 'Whisper', icon: '🎤' },
  { type: 'module', moduleId: 'vps', label: 'VPS', icon: '▣' },
];

const BROWSABLE_MODULES = new Set(['shortcuts', 'notes', 'tasks', 'exec', 'finance']);

let root = null;
let reorderDrag = null;
let suppressTileClickUntil = 0;
let state = {
  settings: { showSearch: true, showRecent: true },
  items: [],
  recent: [],
  results: [],
  query: '',
  selectedIndex: 0,
  editMode: false,
  menuOpen: false,
  addOpen: false,
  addModuleId: null,
  addQuery: '',
  status: null,
};

export async function init(container) {
  document.body.classList.add('micro-launchpad-window');
  document.body.classList.remove('standalone-module-window');
  container.innerHTML = '';
  container.className = 'micro-launchpad-root';
  root = container;
  await loadState();
  render();
  document.addEventListener('keydown', onKeydown, true);
  setTimeout(() => root?.querySelector('.launchpad-search-input')?.focus(), 0);
}

async function getSetting(key, fallback = null) {
  const value = await call('get_setting', { key }).catch(() => null);
  return value == null || value === '' ? fallback : value;
}

async function setSetting(key, value) {
  await call('set_setting', { key, value: String(value) });
}

function parseArray(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function loadState() {
  const [showSearch, showRecent, itemsRaw, recentRaw] = await Promise.all([
    getSetting('launchpad.show_search', '1'),
    getSetting('launchpad.show_recent', '1'),
    getSetting('launchpad.items', '[]'),
    getSetting('launchpad.recent', '[]'),
  ]);
  state.settings.showSearch = showSearch !== '0';
  state.settings.showRecent = showRecent !== '0';
  state.items = parseArray(itemsRaw);
  state.recent = parseArray(recentRaw);
}

async function persistItems() {
  await setSetting('launchpad.items', JSON.stringify(state.items));
}

async function persistRecent() {
  await setSetting('launchpad.recent', JSON.stringify(state.recent.slice(0, 12)));
}

function render() {
  if (!root) return;
  document.body.classList.toggle('launchpad-edit-mode', state.editMode);
  root.innerHTML = '';
  const shell = document.createElement('div');
  shell.className = 'micro-launchpad';
  shell.appendChild(renderTopline());
  if (state.menuOpen) shell.appendChild(renderMenu());
  if (state.addOpen) shell.appendChild(renderAddPicker());
  shell.appendChild(state.status ? renderStatus() : renderGrid());
  shell.appendChild(renderFooter());
  root.appendChild(shell);
}

function renderTopline() {
  const top = document.createElement('div');
  top.className = 'launchpad-topline';
  if (state.settings.showSearch) {
    const input = document.createElement('input');
    input.className = 'launchpad-search-input';
    input.type = 'text';
    input.placeholder = 'Search modules, objects, commands...';
    input.value = state.query;
    input.spellcheck = false;
    input.addEventListener('input', async () => {
      state.query = input.value;
      state.selectedIndex = 0;
      await refreshSearchResults();
      render();
    });
    top.appendChild(input);
  } else {
    const title = document.createElement('div');
    title.className = 'launchpad-title';
    title.textContent = state.editMode ? 'Edit Launchpad' : 'Launchpad';
    top.appendChild(title);
  }
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'launchpad-gear-btn';
  gear.title = 'Launchpad settings';
  gear.textContent = '⚙';
  gear.addEventListener('click', () => {
    state.menuOpen = !state.menuOpen;
    state.addOpen = false;
    render();
  });
  top.appendChild(gear);
  return top;
}

function renderMenu() {
  const menu = document.createElement('div');
  menu.className = 'launchpad-menu';
  menu.appendChild(menuButton(state.editMode ? 'Done editing' : 'Edit Launchpad', () => {
    state.editMode = !state.editMode;
    state.menuOpen = false;
    render();
  }));
  menu.appendChild(menuButton('Add item', () => {
    state.addOpen = true;
    state.addModuleId = null;
    state.addQuery = '';
    state.menuOpen = false;
    render();
  }));
  menu.appendChild(settingButton('Show search', 'show-search', state.settings.showSearch, async () => {
    state.settings.showSearch = !state.settings.showSearch;
    await setSetting('launchpad.show_search', state.settings.showSearch ? '1' : '0');
    render();
  }));
  menu.appendChild(settingButton('Show recent', 'show-recent', state.settings.showRecent, async () => {
    state.settings.showRecent = !state.settings.showRecent;
    await setSetting('launchpad.show_recent', state.settings.showRecent ? '1' : '0');
    render();
  }));
  return menu;
}

function menuButton(text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

function settingButton(text, name, checked, onClick) {
  const btn = menuButton(`${checked ? '✓' : ' '} ${text}`, onClick);
  btn.dataset.launchpadSetting = name;
  return btn;
}

function renderGrid() {
  const wrap = document.createElement('div');
  wrap.className = 'launchpad-body';
  const section = document.createElement('div');
  section.className = 'launchpad-section-title';
  section.textContent = state.query.trim() ? 'Results' : 'Launchpad';
  wrap.appendChild(section);
  const grid = document.createElement('div');
  grid.className = 'launchpad-grid';
  const items = visibleItems();
  items.forEach((item, index) => grid.appendChild(renderTile(item, index)));
  if (!state.query.trim()) grid.appendChild(renderAddTile());
  if (!items.length && state.query.trim()) {
    const empty = document.createElement('div');
    empty.className = 'launchpad-empty';
    empty.textContent = 'No matching items';
    grid.appendChild(empty);
  }
  wrap.appendChild(grid);
  if (!state.query.trim() && state.settings.showRecent && state.recent.length) {
    const recentTitle = document.createElement('div');
    recentTitle.className = 'launchpad-section-title';
    recentTitle.textContent = 'Recent';
    wrap.appendChild(recentTitle);
    const recent = document.createElement('div');
    recent.className = 'launchpad-recent-list';
    state.recent.slice(0, 5).forEach(item => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'launchpad-recent-row';
      row.textContent = `${item.icon || iconFor(item)} ${titleFor(item)}`;
      row.addEventListener('click', () => activateItem(item));
      recent.appendChild(row);
    });
    wrap.appendChild(recent);
  }
  return wrap;
}

function visibleItems() {
  return state.query.trim() ? state.results : state.items;
}

function renderTile(item, index) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'launchpad-tile' + (index === state.selectedIndex ? ' active' : '');
  if (state.editMode && !state.query.trim()) btn.classList.add('editable');
  if (reorderDrag?.active && reorderDrag.currentIndex === index) btn.classList.add('reordering');
  btn.dataset.index = String(index);
  btn.innerHTML = `
    ${state.editMode && !state.query.trim() ? '<span class="launchpad-remove">×</span>' : ''}
    <span class="launchpad-tile-icon">${escapeHtml(item.icon || iconFor(item))}</span>
    <span class="launchpad-tile-label">${escapeHtml(titleFor(item))}</span>
    <span class="launchpad-tile-kind">${escapeHtml(kindFor(item))}</span>
  `;
  btn.addEventListener('click', (event) => {
    if (Date.now() < suppressTileClickUntil) {
      event.preventDefault();
      return;
    }
    if (state.editMode && event.target?.classList?.contains('launchpad-remove')) {
      removeItem(index);
      return;
    }
    if (state.editMode) {
      state.selectedIndex = index;
      render();
      return;
    }
    activateItem(item);
  });
  btn.addEventListener('pointerdown', event => startPointerReorder(event, index));
  return btn;
}

function startPointerReorder(event, index) {
  if (!state.editMode || state.query.trim() || event.button !== 0) return;
  if (event.target?.classList?.contains('launchpad-remove')) return;
  if (!state.items[index]) return;
  reorderDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentIndex: index,
    active: false,
    changed: false,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  document.addEventListener('pointermove', onPointerReorderMove, true);
  document.addEventListener('pointerup', finishPointerReorder, true);
  document.addEventListener('pointercancel', cancelPointerReorder, true);
}

function onPointerReorderMove(event) {
  if (!reorderDrag || event.pointerId !== reorderDrag.pointerId) return;
  const dx = Math.abs(event.clientX - reorderDrag.startX);
  const dy = Math.abs(event.clientY - reorderDrag.startY);
  if (!reorderDrag.active && dx + dy < 6) return;
  reorderDrag.active = true;
  event.preventDefault();
  document.body.classList.add('launchpad-reorder-active');
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.launchpad-tile[data-index]');
  const targetIndex = Number(target?.dataset?.index);
  if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= state.items.length) return;
  if (targetIndex === reorderDrag.currentIndex) return;
  const [moved] = state.items.splice(reorderDrag.currentIndex, 1);
  state.items.splice(targetIndex, 0, moved);
  reorderDrag.currentIndex = targetIndex;
  reorderDrag.changed = true;
  state.selectedIndex = targetIndex;
  render();
  document.body.classList.add('launchpad-reorder-active');
}

async function finishPointerReorder(event) {
  if (!reorderDrag || event.pointerId !== reorderDrag.pointerId) return;
  const shouldPersist = reorderDrag.changed;
  const wasActive = reorderDrag.active;
  cleanupPointerReorder();
  if (wasActive) suppressTileClickUntil = Date.now() + 350;
  if (shouldPersist) await persistItems();
  render();
}

function cancelPointerReorder(event) {
  if (!reorderDrag || event.pointerId !== reorderDrag.pointerId) return;
  cleanupPointerReorder();
  render();
}

function cleanupPointerReorder() {
  reorderDrag = null;
  document.body.classList.remove('launchpad-reorder-active');
  document.removeEventListener('pointermove', onPointerReorderMove, true);
  document.removeEventListener('pointerup', finishPointerReorder, true);
  document.removeEventListener('pointercancel', cancelPointerReorder, true);
}

function renderAddTile() {
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'launchpad-tile launchpad-add-tile';
  add.innerHTML = '<span class="launchpad-tile-icon">+</span><span class="launchpad-tile-label">Add</span><span class="launchpad-tile-kind">Item</span>';
  add.addEventListener('click', () => {
    state.addOpen = true;
    state.addModuleId = null;
    state.addQuery = '';
    render();
  });
  return add;
}

function renderAddPicker() {
  const picker = document.createElement('div');
  picker.className = 'launchpad-add-picker';
  if (state.addModuleId) return renderObjectAddPicker(picker);

  const title = document.createElement('div');
  title.className = 'launchpad-add-title';
  title.textContent = 'Add item';
  picker.appendChild(title);

  const list = document.createElement('div');
  list.className = 'launchpad-add-module-list';
  MODULES.forEach(item => list.appendChild(addModuleRow(item)));
  picker.appendChild(list);
  return picker;
}

function addModuleRow(item) {
  const row = document.createElement('div');
  row.className = 'launchpad-add-module-row';

  const label = document.createElement('div');
  label.className = 'launchpad-add-module-label';
  label.innerHTML = `
    <span class="launchpad-add-module-icon">${escapeHtml(item.icon || iconFor(item))}</span>
    <span>${escapeHtml(titleFor(item))}</span>
  `;
  row.appendChild(label);

  const actions = document.createElement('div');
  actions.className = 'launchpad-add-module-actions';
  if (BROWSABLE_MODULES.has(item.moduleId)) {
    const browse = document.createElement('button');
    browse.type = 'button';
    browse.className = 'launchpad-module-browse';
    browse.textContent = 'Browse';
    browse.addEventListener('click', () => {
      state.addModuleId = item.moduleId;
      state.addQuery = '';
      render();
    });
    actions.appendChild(browse);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'launchpad-module-add';
  add.textContent = 'Add module';
  add.addEventListener('click', () => addItem(item));
  actions.appendChild(add);
  row.appendChild(actions);
  return row;
}

function renderObjectAddPicker(picker) {
  const module = MODULES.find(item => item.moduleId === state.addModuleId) || {};
  const header = document.createElement('div');
  header.className = 'launchpad-add-header';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'launchpad-add-back';
  back.textContent = 'Back';
  back.addEventListener('click', () => {
    state.addModuleId = null;
    state.addQuery = '';
    render();
  });
  header.appendChild(back);
  const title = document.createElement('div');
  title.className = 'launchpad-add-title';
  title.textContent = module.label || 'Items';
  header.appendChild(title);
  picker.appendChild(header);

  const search = document.createElement('input');
  search.className = 'launchpad-add-search';
  search.type = 'text';
  search.placeholder = `Search ${module.label || 'items'}...`;
  search.value = state.addQuery;
  search.spellcheck = false;
  search.addEventListener('input', () => {
    state.addQuery = search.value;
    render();
  });
  picker.appendChild(search);

  const list = document.createElement('div');
  list.className = 'launchpad-add-results';
  list.textContent = 'Loading...';
  picker.appendChild(list);

  const moduleId = state.addModuleId;
  const query = state.addQuery;
  collectAddObjects(moduleId).then(items => {
    if (!root || state.addModuleId !== moduleId || state.addQuery !== query) return;
    const filtered = items.filter(item => matches(item, query.trim().toLowerCase())).slice(0, 60);
    list.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'launchpad-add-empty';
      empty.textContent = 'No matching items';
      list.appendChild(empty);
      return;
    }
    filtered.forEach(item => list.appendChild(addResult(item)));
  }).catch(err => {
    list.textContent = `Failed to load items: ${String(err)}`;
  });
  setTimeout(() => root?.querySelector('.launchpad-add-search')?.focus(), 0);
  return picker;
}

function addResult(item) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'launchpad-add-result';
  btn.textContent = `${item.icon || iconFor(item)} ${titleFor(item)}`;
  btn.addEventListener('click', () => addItem(item));
  return btn;
}

async function addItem(item) {
  state.items.push({ ...item });
  state.addOpen = false;
  state.addModuleId = null;
  state.addQuery = '';
  await persistItems();
  render();
}

async function removeItem(index) {
  state.items.splice(index, 1);
  await persistItems();
  render();
}

function renderStatus() {
  const panel = document.createElement('div');
  panel.className = 'launchpad-status';
  panel.dataset.state = state.status.state;
  const title = document.createElement('div');
  title.className = 'launchpad-status-title';
  title.textContent = state.status.title;
  panel.appendChild(title);
  const pre = document.createElement('pre');
  pre.textContent = state.status.output || state.status.message || '';
  panel.appendChild(pre);
  return panel;
}

function renderFooter() {
  const footer = document.createElement('div');
  footer.className = 'launchpad-footer';
  footer.textContent = state.editMode
    ? 'Drag reorder · Delete remove · Esc done'
    : 'Arrow keys select · Enter open/run · Ctrl+E edit · Esc close';
  return footer;
}

async function refreshSearchResults() {
  const query = state.query.trim().toLowerCase();
  if (!query) {
    state.results = [];
    return;
  }
  state.results = (await collectCandidates()).filter(item => matches(item, query)).slice(0, 40);
}

function matches(item, query) {
  const haystack = [
    item.label,
    item.title,
    item.name,
    item.description,
    item.command,
    item.value,
    item.content,
    item.moduleId,
  ].map(v => String(v || '').toLowerCase()).join('\n');
  return query.split(/\s+/).filter(Boolean).every(token => haystack.includes(token));
}

async function collectCandidates() {
  const [tasks, snippets, notes, commands, financePlans] = await Promise.all([
    call('list_tasks', { category: null, status: null }).catch(() => []),
    call('list_shortcuts').catch(() => []),
    collectNotes(),
    collectExecCommands(),
    collectFinancePlans(),
  ]);
  return [
    ...MODULES,
    ...tasks.map(t => ({
      type: 'task', moduleId: 'tasks', objectType: 'task', objectId: t.id,
      objectUuid: t.uuid, label: t.title || '(untitled task)', icon: '✓', title: t.title,
    })),
    ...snippets.map(s => ({
      type: 'snippet', moduleId: 'shortcuts', objectType: 'shortcut', objectId: s.id,
      objectUuid: s.uuid, label: s.name || '(untitled snippet)', icon: '🏷',
      title: s.name, value: s.value, description: s.description,
    })),
    ...notes.map(n => ({
      type: 'note', moduleId: 'notes', objectType: 'note', objectId: n.id,
      objectUuid: n.uuid, label: n.title || '(untitled note)', icon: '🗒',
      title: n.title, content: n.content,
    })),
    ...commands.map(c => ({
      type: 'exec_command', commandId: c.id, label: c.name || '(untitled command)',
      icon: '⚡', command: c.command, shell: c.shell || 'host',
      wslDistro: c.wsl_distro || null, description: c.description,
    })),
    ...financePlans.map(p => financePlanItem(p)),
  ];
}

async function collectAddObjects(moduleId) {
  if (moduleId === 'tasks') {
    const tasks = await call('list_tasks', { category: null, status: null }).catch(() => []);
    return tasks.map(t => ({
      type: 'task', moduleId: 'tasks', objectType: 'task', objectId: t.id,
      objectUuid: t.uuid, label: t.title || '(untitled task)', icon: '✓', title: t.title,
    }));
  }
  if (moduleId === 'shortcuts') {
    const snippets = await call('list_shortcuts').catch(() => []);
    return snippets.map(s => ({
      type: 'snippet', moduleId: 'shortcuts', objectType: 'shortcut', objectId: s.id,
      objectUuid: s.uuid, label: s.name || '(untitled snippet)', icon: '🏷',
      title: s.name, value: s.value, description: s.description,
    }));
  }
  if (moduleId === 'notes') {
    const notes = await collectNotes();
    return notes.map(n => ({
      type: 'note', moduleId: 'notes', objectType: 'note', objectId: n.id,
      objectUuid: n.uuid, label: n.title || '(untitled note)', icon: '🗒',
      title: n.title, content: n.content,
    }));
  }
  if (moduleId === 'exec') {
    const commands = await collectExecCommands();
    return commands.map(c => ({
      type: 'exec_command', commandId: c.id, label: c.name || '(untitled command)',
      icon: '⚡', command: c.command, shell: c.shell || 'host',
      wslDistro: c.wsl_distro || null, description: c.description,
    }));
  }
  if (moduleId === 'finance') {
    const plans = await collectFinancePlans();
    return plans.map(financePlanItem);
  }
  return [];
}

async function collectNotes() {
  const folders = await call('list_note_folders').catch(() => []);
  const batches = await Promise.all(folders.map(f => call('list_notes', { folderId: f.id }).catch(() => [])));
  return batches.flat();
}

async function collectExecCommands() {
  const categories = await call('list_exec_categories').catch(() => []);
  const batches = await Promise.all(categories.map(c => call('list_exec_commands', { categoryId: c.id }).catch(() => [])));
  return batches.flat();
}

async function collectFinancePlans() {
  return call('list_finance_plans').catch(() => []);
}

function financePlanItem(plan) {
  return {
    type: 'finance_plan',
    moduleId: 'finance',
    objectType: 'finance_plan',
    objectId: plan.id,
    objectUuid: plan.uuid,
    label: plan.name || '(untitled finance list)',
    title: plan.name,
    icon: '$',
    description: [plan.kind, plan.currency].filter(Boolean).join(' '),
  };
}

async function activateItem(item) {
  if (!item) return;
  if (item.type === 'module') {
    await call('open_module_window', { moduleId: item.moduleId });
    await recordRecent(item);
  } else if (item.type === 'task' || item.type === 'note' || item.type === 'snippet' || item.type === 'finance_plan') {
    await call('open_module_object_window', {
      moduleId: item.moduleId,
      objectType: item.objectType,
      objectId: item.objectId ?? null,
      objectUuid: item.objectUuid || null,
      title: item.label || item.title || '',
      detailTab: item.detailTab || null,
    });
    await recordRecent(item);
  } else if (item.type === 'exec_command') {
    await runExecItem(item);
  }
}

async function runExecItem(item) {
  state.status = { state: 'running', title: titleFor(item), message: `Running: ${item.command || ''}` };
  render();
  try {
    const output = await call('run_command', {
      command: item.command || '',
      shell: item.shell || 'host',
      wslDistro: item.wslDistro || item.wsl_distro || null,
    });
    state.status = { state: 'done', title: titleFor(item), output: String(output || '') };
    await recordRecent(item);
  } catch (err) {
    state.status = { state: 'error', title: titleFor(item), output: String(err) };
  }
  render();
}

async function recordRecent(item) {
  const key = itemKey(item);
  state.recent = [item, ...state.recent.filter(x => itemKey(x) !== key)].slice(0, 12);
  await persistRecent();
}

function itemKey(item) {
  return [item.type, item.moduleId || '', item.objectUuid || item.objectId || item.commandId || ''].join(':');
}

function moveSelection(delta) {
  const items = visibleItems();
  if (!items.length) return;
  state.selectedIndex = (state.selectedIndex + delta + items.length) % items.length;
  render();
}

async function onKeydown(event) {
  if (!document.body.classList.contains('micro-launchpad-window')) return;
  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'e') {
    event.preventDefault();
    event.stopPropagation();
    state.editMode = !state.editMode;
    state.menuOpen = false;
    render();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (state.editMode) {
      state.editMode = false;
      render();
      return;
    }
    if (state.addOpen || state.menuOpen) {
      if (state.addOpen && state.addModuleId) {
        state.addModuleId = null;
        state.addQuery = '';
        render();
        return;
      }
      state.addOpen = false;
      state.menuOpen = false;
      render();
      return;
    }
    if (state.status && state.status.state !== 'running') {
      state.status = null;
      render();
      return;
    }
    await call('close_launchpad').catch(() => window.close());
    return;
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    moveSelection(1);
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveSelection(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    await activateItem(visibleItems()[state.selectedIndex]);
  }
}

function iconFor(item) {
  if (item.type === 'task') return '✓';
  if (item.type === 'note') return '🗒';
  if (item.type === 'snippet') return '🏷';
  if (item.type === 'exec_command') return '⚡';
  if (item.type === 'finance_plan') return '$';
  return item.icon || '•';
}

function titleFor(item) {
  return item.label || item.title || item.name || item.moduleId || item.type || 'Item';
}

function kindFor(item) {
  if (item.type === 'exec_command') return 'Command';
  if (item.type === 'finance_plan') return 'Finance list';
  if (item.type === 'module') return 'Module';
  return item.objectType || item.type || '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
