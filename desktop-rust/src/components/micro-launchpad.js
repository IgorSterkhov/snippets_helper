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
let resizeDrag = null;
let suppressTileClickUntil = 0;
let state = {
  settings: { showSearch: true, showRecent: true, columns: 4, rows: 3 },
  items: [],
  recent: [],
  results: [],
  query: '',
  selectedIndex: 0,
  editMode: false,
  menuOpen: false,
  addMenuOpen: false,
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
  const [showSearch, showRecent, columns, rows, itemsRaw, recentRaw] = await Promise.all([
    getSetting('launchpad.show_search', '1'),
    getSetting('launchpad.show_recent', '1'),
    getSetting('launchpad.columns', '4'),
    getSetting('launchpad.rows', '3'),
    getSetting('launchpad.items', '[]'),
    getSetting('launchpad.recent', '[]'),
  ]);
  state.settings.showSearch = showSearch !== '0';
  state.settings.showRecent = showRecent !== '0';
  state.settings.columns = normalizeInt(columns, 4, 3, 8);
  state.settings.rows = normalizeInt(rows, 3, 2, 6);
  state.items = normalizeEntries(parseArray(itemsRaw));
  state.recent = parseArray(recentRaw);
}

async function persistItems() {
  await setSetting('launchpad.items', JSON.stringify(state.items));
}

async function persistGridSize() {
  await setSetting('launchpad.columns', state.settings.columns);
  await setSetting('launchpad.rows', state.settings.rows);
  await call('resize_launchpad_window', {
    columns: state.settings.columns,
    rows: state.settings.rows,
  }).catch(() => {});
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
  shell.style.setProperty('--launchpad-columns', String(state.settings.columns));
  shell.style.setProperty('--launchpad-rows', String(state.settings.rows));
  shell.appendChild(renderTopline());
  if (state.menuOpen) shell.appendChild(renderMenu());
  if (state.addMenuOpen) shell.appendChild(renderAddMenu());
  if (state.addOpen) shell.appendChild(renderAddPicker());
  shell.appendChild(state.status ? renderStatus() : renderGrid());
  shell.appendChild(renderFooter());
  root.appendChild(shell);
}

function normalizeInt(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEntries(items) {
  return (Array.isArray(items) ? items : []).map(entry => normalizeEntry(entry)).filter(Boolean);
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.layoutType === 'container') {
    return {
      layoutType: 'container',
      id: entry.id || makeId('container'),
      title: entry.title || entry.label || 'Container',
      w: clampSpan(entry.w, 2, 1, state.settings.columns),
      h: clampSpan(entry.h, 1, 1, 4),
      children: normalizeContainerChildren(entry.children || []),
    };
  }
  if (entry.layoutType === 'separator') {
    return {
      layoutType: 'separator',
      id: entry.id || makeId('separator'),
      w: clampSpan(entry.w, state.settings.columns, 1, state.settings.columns),
      h: 1,
    };
  }
  if (entry.layoutType === 'tile') {
    const item = entry.item || entry;
    return {
      layoutType: 'tile',
      id: entry.id || makeId('tile'),
      w: clampSpan(entry.w, 1, 1, state.settings.columns),
      h: clampSpan(entry.h, 1, 1, 4),
      item: { ...item },
    };
  }
  return {
    layoutType: 'tile',
    id: makeId('tile'),
    w: 1,
    h: 1,
    item: { ...entry },
  };
}

function normalizeContainerChildren(children) {
  return (Array.isArray(children) ? children : []).map(child => child?.item || child).filter(Boolean);
}

function clampSpan(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
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
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'launchpad-plus-btn';
  plus.title = 'Add to Launchpad';
  plus.textContent = '+';
  plus.addEventListener('click', () => {
    state.addMenuOpen = !state.addMenuOpen;
    state.menuOpen = false;
    state.addOpen = false;
    render();
  });
  top.appendChild(plus);
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'launchpad-gear-btn';
  gear.title = 'Launchpad settings';
  gear.textContent = '⚙';
  gear.addEventListener('click', () => {
    state.menuOpen = !state.menuOpen;
    state.addOpen = false;
    state.addMenuOpen = false;
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
  menu.appendChild(sizeControl('Columns', 'columns', 3, 8));
  menu.appendChild(sizeControl('Rows', 'rows', 2, 6));
  return menu;
}

function renderAddMenu() {
  const menu = document.createElement('div');
  menu.className = 'launchpad-add-menu';
  menu.appendChild(menuButton('Add item', () => {
    state.addOpen = true;
    state.addMenuOpen = false;
    state.addModuleId = null;
    state.addQuery = '';
    render();
  }));
  menu.appendChild(menuButton('Add container', () => addContainer()));
  menu.appendChild(menuButton('Add separator', () => addSeparator()));
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

function sizeControl(label, key, min, max) {
  const wrap = document.createElement('label');
  wrap.className = 'launchpad-size-control';
  wrap.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.value = String(state.settings[key]);
  input.dataset.launchpadSize = key;
  input.addEventListener('change', async () => {
    state.settings[key] = normalizeInt(input.value, state.settings[key], min, max);
    input.value = String(state.settings[key]);
    state.items = normalizeEntries(state.items);
    await persistGridSize();
    await persistItems();
    render();
  });
  wrap.appendChild(input);
  return wrap;
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
  if (state.query.trim()) {
    items.forEach((item, index) => grid.appendChild(renderTile(item, index, { source: 'search' })));
  } else {
    state.items.forEach((entry, entryIndex) => grid.appendChild(renderEntry(entry, entryIndex)));
  }
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
  return state.query.trim() ? state.results : flattenEntries(state.items).map(x => x.item);
}

function renderEntry(entry, entryIndex) {
  if (entry.layoutType === 'container') return renderContainer(entry, entryIndex);
  if (entry.layoutType === 'separator') return renderSeparator(entry, entryIndex);
  return renderTile(entry.item, flatIndexForPath([entryIndex]), { entry, path: [entryIndex] });
}

function renderTile(item, index, opts = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'launchpad-tile' + (index === state.selectedIndex ? ' active' : '');
  if (state.editMode && !state.query.trim()) btn.classList.add('editable');
  if (reorderDrag?.active && reorderDrag.currentIndex === index) btn.classList.add('reordering');
  btn.dataset.index = String(index);
  if (opts.path) btn.dataset.path = opts.path.join('.');
  if (opts.entry) {
    btn.classList.add('launchpad-entry');
    btn.dataset.entryIndex = String(opts.path?.[0] ?? index);
    btn.style.gridColumn = `span ${clampSpan(opts.entry.w, 1, 1, state.settings.columns)}`;
    btn.style.gridRow = `span ${clampSpan(opts.entry.h, 1, 1, 4)}`;
  }
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
      removePath(opts.path || [index]);
      return;
    }
    if (state.editMode) {
      state.selectedIndex = index;
      render();
      return;
    }
    activateItem(item);
  });
  btn.addEventListener('pointerdown', event => startPointerReorder(event, opts.path || [index]));
  return btn;
}

function renderContainer(entry, entryIndex) {
  const box = document.createElement('div');
  box.className = 'launchpad-entry launchpad-container-entry';
  box.dataset.entryIndex = String(entryIndex);
  box.style.gridColumn = `span ${clampSpan(entry.w, 2, 1, state.settings.columns)}`;
  box.style.gridRow = `span ${clampSpan(entry.h, 1, 1, 4)}`;
  const header = document.createElement('div');
  header.className = 'launchpad-container-header';
  const title = document.createElement('span');
  title.className = 'launchpad-container-title';
  title.textContent = entry.title || 'Container';
  header.appendChild(title);
  if (state.editMode) {
    const dims = document.createElement('span');
    dims.className = 'launchpad-container-dims';
    dims.textContent = `${entry.w}×${entry.h}`;
    header.appendChild(dims);
    const wInput = spanInput(entry, entryIndex, 'w', 1, state.settings.columns);
    const hInput = spanInput(entry, entryIndex, 'h', 1, 4);
    header.appendChild(wInput);
    header.appendChild(hInput);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'launchpad-container-remove';
    remove.textContent = '×';
    remove.title = 'Remove container';
    remove.addEventListener('click', () => unwrapContainer(entryIndex));
    header.appendChild(remove);
  }
  box.appendChild(header);
  const children = document.createElement('div');
  children.className = 'launchpad-container-children';
  (entry.children || []).forEach((child, childIndex) => {
    children.appendChild(renderTile(child, flatIndexForPath([entryIndex, childIndex]), {
      path: [entryIndex, childIndex],
    }));
  });
  if (!entry.children?.length) {
    const empty = document.createElement('div');
    empty.className = 'launchpad-container-empty';
    empty.textContent = state.editMode ? 'Drop items here' : '';
    children.appendChild(empty);
  }
  box.appendChild(children);
  if (state.editMode) {
    const handle = document.createElement('div');
    handle.className = 'launchpad-resize-handle';
    handle.addEventListener('pointerdown', event => startContainerResize(event, entryIndex));
    box.appendChild(handle);
    box.addEventListener('pointerdown', event => {
      if (event.target.closest('.launchpad-tile, input, button, .launchpad-resize-handle')) return;
      startPointerReorder(event, [entryIndex]);
    });
  }
  return box;
}

function renderSeparator(entry, entryIndex) {
  const sep = document.createElement('div');
  sep.className = 'launchpad-entry launchpad-separator-entry';
  sep.dataset.entryIndex = String(entryIndex);
  sep.style.gridColumn = `span ${clampSpan(entry.w, state.settings.columns, 1, state.settings.columns)}`;
  sep.innerHTML = state.editMode
    ? '<span></span><button type="button" class="launchpad-separator-remove">×</button>'
    : '<span></span>';
  sep.querySelector('.launchpad-separator-remove')?.addEventListener('click', () => removePath([entryIndex]));
  sep.addEventListener('pointerdown', event => startPointerReorder(event, [entryIndex]));
  return sep;
}

function spanInput(entry, entryIndex, key, min, max) {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.value = String(entry[key]);
  input.className = 'launchpad-span-input';
  input.addEventListener('change', async () => {
    entry[key] = clampSpan(input.value, entry[key], min, max);
    input.value = String(entry[key]);
    await persistItems();
    render();
  });
  input.addEventListener('pointerdown', event => event.stopPropagation());
  return input;
}

function flattenEntries(entries) {
  const flat = [];
  entries.forEach((entry, entryIndex) => {
    if (entry.layoutType === 'tile') {
      flat.push({ item: entry.item, path: [entryIndex] });
    } else if (entry.layoutType === 'container') {
      (entry.children || []).forEach((child, childIndex) => {
        flat.push({ item: child, path: [entryIndex, childIndex] });
      });
    }
  });
  return flat;
}

function flatIndexForPath(path) {
  return flattenEntries(state.items).findIndex(x => x.path.join('.') === path.join('.'));
}

function startPointerReorder(event, path) {
  if (!state.editMode || state.query.trim() || event.button !== 0) return;
  if (event.target?.classList?.contains('launchpad-remove')) return;
  if (!getByPath(path)) return;
  reorderDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    path,
    currentIndex: flatIndexForPath(path),
    active: false,
    changed: false,
  };
  capturePointer(event.currentTarget, event.pointerId);
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
  const pointEl = document.elementFromPoint(event.clientX, event.clientY);
  const eventEl = event.target?.closest ? event.target : null;
  const target = pointEl?.closest?.('.launchpad-tile[data-path], .launchpad-container-entry[data-entry-index], .launchpad-separator-entry[data-entry-index]')
    || eventEl?.closest?.('.launchpad-tile[data-path], .launchpad-container-entry[data-entry-index], .launchpad-separator-entry[data-entry-index]');
  const targetPath = parseTargetPath(target);
  if (!targetPath) return;

  if (pathLength(targetPath) === 2 && canMovePathAsTile(reorderDrag.path)) {
    if (reorderDrag.path.join('.') === targetPath.join('.')) return;
    const targetContainer = state.items[targetPath[0]];
    let insertAt = targetPath[1];
    if (!targetContainer || targetContainer.layoutType !== 'container') return;
    if (pathLength(reorderDrag.path) === 2 && state.items[reorderDrag.path[0]] === targetContainer && reorderDrag.path[1] < insertAt) {
      insertAt -= 1;
    }
    const moved = removeByPath(reorderDrag.path);
    if (moved?.layoutType === 'tile') {
      targetContainer.children = targetContainer.children || [];
      targetContainer.children.splice(Math.max(0, insertAt), 0, moved.item);
      const containerIndex = state.items.indexOf(targetContainer);
      reorderDrag.path = [containerIndex, Math.max(0, insertAt)];
      reorderDrag.currentIndex = flatIndexForPath(reorderDrag.path);
      reorderDrag.changed = true;
      state.selectedIndex = Math.max(0, reorderDrag.currentIndex);
      render();
      document.body.classList.add('launchpad-reorder-active');
    }
    return;
  }

  const containerEl = pointEl?.closest?.('.launchpad-container-entry[data-entry-index]')
    || eventEl?.closest?.('.launchpad-container-entry[data-entry-index]');
  if (containerEl && canMovePathAsTile(reorderDrag.path)) {
    const targetContainer = state.items[Number(containerEl.dataset.entryIndex)];
    if (targetContainer?.layoutType === 'container' && !sameContainerPath(reorderDrag.path, targetContainer)) {
      const moved = removeByPath(reorderDrag.path);
      if (moved?.layoutType === 'tile') {
        targetContainer.children = targetContainer.children || [];
        targetContainer.children.push(moved.item);
        const containerIndex = state.items.indexOf(targetContainer);
        reorderDrag.path = [containerIndex, targetContainer.children.length - 1];
        reorderDrag.currentIndex = flatIndexForPath(reorderDrag.path);
        reorderDrag.changed = true;
        state.selectedIndex = Math.max(0, reorderDrag.currentIndex);
        render();
        document.body.classList.add('launchpad-reorder-active');
      }
    }
    return;
  }

  if (pathLength(reorderDrag.path) === 2 && pathLength(targetPath) === 1) {
    const moved = removeByPath(reorderDrag.path);
    if (moved?.layoutType === 'tile') {
      const insertAt = Math.max(0, Math.min(state.items.length, targetPath[0]));
      state.items.splice(insertAt, 0, moved);
      reorderDrag.path = [insertAt];
      reorderDrag.currentIndex = flatIndexForPath(reorderDrag.path);
      reorderDrag.changed = true;
      state.selectedIndex = Math.max(0, reorderDrag.currentIndex);
      render();
      document.body.classList.add('launchpad-reorder-active');
    }
    return;
  }
  if (pathLength(reorderDrag.path) !== 1 || pathLength(targetPath) !== 1) return;
  const from = reorderDrag.path[0];
  const to = targetPath[0];
  if (from === to || !state.items[from] || !state.items[to]) return;
  const [moved] = state.items.splice(from, 1);
  state.items.splice(to, 0, moved);
  reorderDrag.path = [to];
  reorderDrag.currentIndex = flatIndexForPath([to]);
  reorderDrag.changed = true;
  state.selectedIndex = Math.max(0, reorderDrag.currentIndex);
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

function parseTargetPath(target) {
  if (!target) return null;
  if (target.dataset?.path) return target.dataset.path.split('.').map(Number);
  if (target.dataset?.entryIndex != null) return [Number(target.dataset.entryIndex)];
  return null;
}

function sameContainerPath(path, containerEntry) {
  return pathLength(path) === 2 && state.items[path[0]] === containerEntry;
}

function canMovePathAsTile(path) {
  const value = getByPath(path);
  return pathLength(path) === 2 || value?.layoutType === 'tile';
}

function capturePointer(target, pointerId) {
  try {
    target?.setPointerCapture?.(pointerId);
  } catch {
    // Synthetic browser-smoke events do not always have an active pointer.
  }
}

function pathLength(path) {
  return Array.isArray(path) ? path.length : 0;
}

function getByPath(path) {
  if (!Array.isArray(path)) return null;
  const entry = state.items[path[0]];
  if (path.length === 1) return entry || null;
  return entry?.children?.[path[1]] || null;
}

function removeByPath(path) {
  if (!Array.isArray(path)) return null;
  if (path.length === 1) {
    const [removed] = state.items.splice(path[0], 1);
    return removed || null;
  }
  const entry = state.items[path[0]];
  if (entry?.layoutType !== 'container') return null;
  const [removed] = entry.children.splice(path[1], 1);
  return removed ? { layoutType: 'tile', id: makeId('tile'), w: 1, h: 1, item: removed } : null;
}

async function removePath(path) {
  const entry = getByPath(path);
  if (path.length === 1 && entry?.layoutType === 'container') {
    await unwrapContainer(path[0]);
    return;
  }
  removeByPath(path);
  await persistItems();
  render();
}

async function unwrapContainer(index) {
  const entry = state.items[index];
  if (!entry || entry.layoutType !== 'container') return;
  const children = (entry.children || []).map(child => ({
    layoutType: 'tile',
    id: makeId('tile'),
    w: 1,
    h: 1,
    item: { ...child },
  }));
  state.items.splice(index, 1, ...children);
  await persistItems();
  render();
}

async function addContainer() {
  state.items.push({
    layoutType: 'container',
    id: makeId('container'),
    title: 'Container',
    w: Math.min(2, state.settings.columns),
    h: 1,
    children: [],
  });
  state.addMenuOpen = false;
  await persistItems();
  render();
}

async function addSeparator() {
  state.items.push({
    layoutType: 'separator',
    id: makeId('separator'),
    w: state.settings.columns,
    h: 1,
  });
  state.addMenuOpen = false;
  await persistItems();
  render();
}

function startContainerResize(event, entryIndex) {
  if (!state.editMode || event.button !== 0) return;
  const entry = state.items[entryIndex];
  if (!entry || entry.layoutType !== 'container') return;
  resizeDrag = {
    pointerId: event.pointerId,
    entryIndex,
    startX: event.clientX,
    startY: event.clientY,
    startW: Number(entry.w) || 1,
    startH: Number(entry.h) || 1,
  };
  event.preventDefault();
  event.stopPropagation();
  capturePointer(event.currentTarget, event.pointerId);
  document.addEventListener('pointermove', onContainerResizeMove, true);
  document.addEventListener('pointerup', finishContainerResize, true);
  document.addEventListener('pointercancel', cancelContainerResize, true);
  document.body.classList.add('launchpad-resize-active');
}

function onContainerResizeMove(event) {
  if (!resizeDrag || event.pointerId !== resizeDrag.pointerId) return;
  event.preventDefault();
  const entry = state.items[resizeDrag.entryIndex];
  if (!entry || entry.layoutType !== 'container') return;
  const dw = Math.floor((event.clientX - resizeDrag.startX) / 120);
  const dh = Math.floor((event.clientY - resizeDrag.startY) / 78);
  entry.w = clampSpan(resizeDrag.startW + dw, resizeDrag.startW, 1, state.settings.columns);
  entry.h = clampSpan(resizeDrag.startH + dh, resizeDrag.startH, 1, 4);
  render();
  document.body.classList.add('launchpad-resize-active');
}

async function finishContainerResize(event) {
  if (!resizeDrag || event.pointerId !== resizeDrag.pointerId) return;
  cleanupContainerResize();
  await persistItems();
  render();
}

function cancelContainerResize(event) {
  if (!resizeDrag || event.pointerId !== resizeDrag.pointerId) return;
  cleanupContainerResize();
  render();
}

function cleanupContainerResize() {
  resizeDrag = null;
  document.body.classList.remove('launchpad-resize-active');
  document.removeEventListener('pointermove', onContainerResizeMove, true);
  document.removeEventListener('pointerup', finishContainerResize, true);
  document.removeEventListener('pointercancel', cancelContainerResize, true);
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
  state.items.push({
    layoutType: 'tile',
    id: makeId('tile'),
    w: 1,
    h: 1,
    item: { ...item },
  });
  state.addOpen = false;
  state.addModuleId = null;
  state.addQuery = '';
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
  return dedupeCandidates([
    ...flattenEntries(state.items).map(x => x.item),
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
  ]);
}

function dedupeCandidates(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = itemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    await closeLaunchpadWindow();
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
    await closeLaunchpadWindow();
  } else if (item.type === 'exec_command') {
    await runExecItem(item);
  }
}

async function closeLaunchpadWindow() {
  await call('close_launchpad').catch(() => window.close());
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
    if (state.addOpen || state.addMenuOpen || state.menuOpen) {
      if (state.addOpen && state.addModuleId) {
        state.addModuleId = null;
        state.addQuery = '';
        render();
        return;
      }
      state.addOpen = false;
      state.addMenuOpen = false;
      state.menuOpen = false;
      render();
      return;
    }
    if (state.status && state.status.state !== 'running') {
      state.status = null;
      render();
      return;
    }
    await closeLaunchpadWindow();
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
