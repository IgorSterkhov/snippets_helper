import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';
import { showModal } from '../../components/modal.js';
import { tasksCSS } from './tasks-css.js';
import { renderCard, resetCollapseState, invalidateCheckboxCache, invalidateAllCheckboxCache, loadCheckboxes, focusAfterReload } from './card.js';
import { renderPinnedChips, renderFilterDropdown } from './dropdown.js';
import { helpButton } from '../sql/sql-help.js';
import { TASKS_HELP_HTML } from './help-content.js';
import { installTaskDnd, commitCardMetaChange, commitCardReorder, commitCheckboxReorder, commitPinnedChipReorder } from './dnd.js';

// ── Module-level state ──────────────────────────────────────

const state = {
  root: null,
  categories: [],    // [{id, name, color, sort_order, ...}]
  statuses: [],      // [{id, name, color, sort_order, ...}]
  tasks: [],         // visible list (after filter)
  pinned: [],        // all pinned tasks for chip strip
  filter: {
    category: 'all', // 'all' | 'none' | string-of-id
    status:   'all',
  },
  layoutMode: 'one-col', // 'one-col' | 'two-col' | 'focus'
  expandedTaskId: null,  // selected/expanded task id
  selectedTask: null,    // task snapshot for Focus view, including outside-filter tasks
  focusCardExpanded: false,
  focusSearch: '',
  // Count of tasks with category_id=NULL / status_id=NULL. Derived from
  // `tasks` (unfiltered). Used to show the "None" item in dropdowns only
  // when there is something to show.
  orphanCatCount: 0,
  orphanStatusCount: 0,
};

const TASK_SYNC_TABLES = new Set([
  'task_categories',
  'task_statuses',
  'tasks',
  'task_checkboxes',
  'task_links',
]);

let syncRefreshListenerInstalled = false;
let aiTaskListenerInstalled = false;

// ── Public init ─────────────────────────────────────────────

export async function init(container) {
  state.root = container;
  container.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = tasksCSS();
  container.appendChild(style);

  container.appendChild(buildLayout());

  // Restore layout mode from settings (best-effort).
  try {
    const saved = await call('get_setting', { key: 'tasks_layout_mode' });
    if (saved === 'two-col' || saved === 'one-col' || saved === 'focus') {
      state.layoutMode = saved;
    }
  } catch { /* ignore */ }
  applyLayoutMode();

  // Apply saved checkbox font size as a CSS root var — takes effect
  // immediately without touching scoped styles.
  try {
    const cbFont = await call('get_setting', { key: 'tasks_checkbox_font_size' });
    if (cbFont) {
      const n = parseInt(cbFont, 10);
      if (Number.isFinite(n) && n >= 10 && n <= 20) {
        document.documentElement.style.setProperty('--task-cb-font-size', n + 'px');
      }
    }
  } catch { /* default via CSS fallback */ }

  await Promise.all([loadCategories(), loadStatuses()]);
  await loadTasks();
  await loadPinned();
  await resetCollapseState();
  await renderAll();
  installSyncRefreshListener();
  installAiTaskListener();

  // Pointer-based DnD: card → dropdown item / card → card / checkbox → row.
  // New model (v1.3.23): the DOM is reordered live during drag; on drop
  // we pass the full ordered-ids list for the backend reorder_tasks call.
  installTaskDnd(container, {
    onTaskMetaChange: async (taskId, kind, newId) => {
      await commitCardMetaChange(state, taskId, kind, newId);
      await reloadTasks();
    },
    onTaskReorderCommit: async (_draggedId, orderedIds) => {
      await commitCardReorder(state, _draggedId, orderedIds);
      await reloadTasks();
    },
    onCheckboxReorderCommit: async (taskId, draggedId, orderedIds, nestUnder) => {
      await commitCheckboxReorder(taskId, draggedId, orderedIds, nestUnder);
      invalidateCheckboxCache(taskId);
      await renderTaskList();
      focusAfterReload(`[data-cb-id="${draggedId}"] .tcb-text[contenteditable="true"]`);
    },
    onPinnedReorderCommit: async (orderedPinnedIds) => {
      await commitPinnedChipReorder(state, orderedPinnedIds);
      await reloadTasks();
    },
  });
}

function installSyncRefreshListener() {
  if (syncRefreshListenerInstalled) return;
  syncRefreshListenerInstalled = true;
  window.addEventListener('snippets:sync-complete', async (event) => {
    const result = event.detail?.result || {};
    if (!syncResultTouchesTasks(result)) return;
    if (!state.root) return;
    invalidateAllCheckboxCache();
    await reloadAll();
  });
}

function installAiTaskListener() {
  if (aiTaskListenerInstalled) return;
  aiTaskListenerInstalled = true;
  window.addEventListener('ai:tasks-open', async (event) => {
    if (!state.root) return;
    const detail = event.detail || {};
    try {
      const all = await call('list_tasks', { category: null, status: null });
      const target = all.find(t => (
        (detail.taskUuid && t.uuid === detail.taskUuid)
        || (detail.taskId != null && Number(t.id) === Number(detail.taskId))
        || (detail.title && String(t.title || '').toLowerCase().includes(String(detail.title).toLowerCase()))
      ));
      if (!target) {
        showToast('AI task target not found', 'error');
        return;
      }
      localStorage.setItem('ai.recent_task_uuid', target.uuid);
      await showSelectedTaskInList(target);
    } catch (err) {
      showToast('Failed to open AI task target: ' + err, 'error');
    }
  });
  window.addEventListener('view-history:open', async (event) => {
    if (!state.root) return;
    const detail = event.detail || {};
    if (detail.moduleId !== 'tasks') return;
    try {
      await openTaskFromViewHistory(detail);
    } catch (err) {
      showToast('Failed to restore task view: ' + err, 'error');
    }
  });
}

function syncResultTouchesTasks(result) {
  return syncMapTouchesTasks(result?.pull?.pulled)
    || syncMapTouchesTasks(result?.push?.pushed);
}

function syncMapTouchesTasks(map) {
  if (!map || typeof map !== 'object') return false;
  return Object.entries(map).some(([table, rows]) => (
    TASK_SYNC_TABLES.has(table) && Array.isArray(rows) && rows.length > 0
  ));
}

// ── Layout ──────────────────────────────────────────────────

function buildLayout() {
  const wrap = el('div', { class: 'tasks-wrap' });

  // Header with title + help
  const header = el('div', { class: 'tasks-header' });
  header.appendChild(el('h2', { text: 'Tasks' }));
  header.appendChild(helpButton('Tasks — справка', TASKS_HELP_HTML));

  // Settings gear button
  const gearBtn = document.createElement('button');
  gearBtn.className = 'task-icon-btn';
  gearBtn.title = 'Display settings';
  gearBtn.textContent = '⚙';
  gearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openTasksSettings();
  });
  header.appendChild(gearBtn);

  wrap.appendChild(header);

  // Pinned chip strip
  wrap.appendChild(el('div', { id: 'tasks-pinned', class: 'tasks-pinned-chips empty' }));

  // Filter row
  const filterRow = el('div', { class: 'tasks-filter-row' });

  const catGroup = el('div', { class: 'tasks-filter-group' });
  catGroup.appendChild(el('span', { text: 'Category:', class: 'tasks-filter-label' }));
  const catDd = el('div', { id: 'tasks-cat-dropdown' });
  catGroup.appendChild(catDd);
  filterRow.appendChild(catGroup);

  const stGroup = el('div', { class: 'tasks-filter-group' });
  stGroup.appendChild(el('span', { text: 'Status:', class: 'tasks-filter-label' }));
  const stDd = el('div', { id: 'tasks-status-dropdown' });
  stGroup.appendChild(stDd);
  filterRow.appendChild(stGroup);

  filterRow.appendChild(el('div', { class: 'spacer' }));

  const newBtn = document.createElement('button');
  newBtn.className = 'task-editor-btn primary';
  newBtn.textContent = '+ New task';
  newBtn.addEventListener('click', onNewTask);
  filterRow.appendChild(newBtn);

  const modes = el('div', { id: 'tasks-layout-toggle', class: 'tasks-layout-switch' });
  [
    { id: 'one-col', btnId: 'tasks-layout-one', title: 'One column', icon: oneColumnIcon() },
    { id: 'two-col', btnId: 'tasks-layout-two', title: 'Two columns', icon: twoColumnIcon() },
    { id: 'focus', btnId: 'tasks-layout-focus', title: 'Focus view', icon: focusViewIcon() },
  ].forEach(mode => {
    const btn = document.createElement('button');
    btn.id = mode.btnId;
    btn.className = 'tasks-layout-mode';
    btn.type = 'button';
    btn.title = mode.title;
    btn.innerHTML = mode.icon;
    btn.addEventListener('click', () => onSetLayoutMode(mode.id));
    modes.appendChild(btn);
  });
  filterRow.appendChild(modes);

  wrap.appendChild(filterRow);

  // Cards scroll area
  const scroll = el('div', { id: 'tasks-cards-scroll', class: 'tasks-cards-scroll one-col' });
  wrap.appendChild(scroll);

  return wrap;
}

// ── Data loading ────────────────────────────────────────────

async function loadCategories() {
  try {
    state.categories = await call('list_task_categories');
  } catch (e) {
    console.warn('list_task_categories failed:', e);
    state.categories = [];
  }
}

async function loadStatuses() {
  try {
    state.statuses = await call('list_task_statuses');
  } catch (e) {
    console.warn('list_task_statuses failed:', e);
    state.statuses = [];
  }
}

async function loadTasks() {
  const filter = {
    category: state.filter.category === 'all' ? null : state.filter.category,
    status:   state.filter.status === 'all'   ? null : state.filter.status,
  };
  try {
    state.tasks = await call('list_tasks', filter);
  } catch (e) {
    console.warn('list_tasks failed:', e);
    state.tasks = [];
  }
  // Compute orphan counts from a full-list call so we know whether to
  // show the "None" item in the dropdowns.
  try {
    const all = await call('list_tasks', { category: null, status: null });
    state.orphanCatCount    = all.filter(t => t.category_id == null).length;
    state.orphanStatusCount = all.filter(t => t.status_id   == null).length;
  } catch {
    state.orphanCatCount = 0;
    state.orphanStatusCount = 0;
  }
}

async function loadPinned() {
  try {
    state.pinned = await call('list_pinned_tasks');
  } catch (e) {
    console.warn('list_pinned_tasks failed:', e);
    state.pinned = [];
  }
}

export async function reloadAll() {
  await Promise.all([loadCategories(), loadStatuses()]);
  await loadTasks();
  await loadPinned();
  await renderAll();
}

export async function reloadTasks() {
  await loadTasks();
  await loadPinned();
  if (state.expandedTaskId != null) {
    state.selectedTask = findTaskById(state.expandedTaskId)
      || (state.selectedTask && state.selectedTask.id === state.expandedTaskId ? state.selectedTask : null);
  }
  await renderTaskList();
  renderPinnedStrip();
  // Dropdowns may need to show/hide the "None" item as orphan counts change.
  renderDropdowns();
}

// ── Render ──────────────────────────────────────────────────

async function renderAll() {
  renderPinnedStrip();
  renderDropdowns();
  renderLayoutToggle();
  await renderTaskList();
}

function renderPinnedStrip() {
  const el = state.root.querySelector('#tasks-pinned');
  if (!el) return;
  renderPinnedChips(el, state.pinned, state.categories, (task) => openExpanded(task.id, task));
}

function renderDropdowns() {
  const catEl = state.root.querySelector('#tasks-cat-dropdown');
  const stEl  = state.root.querySelector('#tasks-status-dropdown');
  if (!catEl || !stEl) return;

  renderFilterDropdown(catEl, {
    kind: 'category',
    items: state.categories,
    currentValue: state.filter.category,
    showNone: state.orphanCatCount > 0,
    noneCount: state.orphanCatCount,
    tasks: state.tasks,
    onPick: (val) => {
      state.filter.category = val;
      reloadTasks();
    },
  });

  renderFilterDropdown(stEl, {
    kind: 'status',
    items: state.statuses,
    currentValue: state.filter.status,
    showNone: state.orphanStatusCount > 0,
    noneCount: state.orphanStatusCount,
    tasks: state.tasks,
    onPick: (val) => {
      state.filter.status = val;
      reloadTasks();
    },
  });
}

function renderLayoutToggle() {
  for (const btn of state.root.querySelectorAll('.tasks-layout-mode')) {
    const mode = btn.id === 'tasks-layout-one'
      ? 'one-col'
      : btn.id === 'tasks-layout-two'
        ? 'two-col'
        : 'focus';
    btn.classList.toggle('active', state.layoutMode === mode);
  }
}

function oneColumnIcon() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
    <rect x="2" y="2" width="12" height="12" rx="1.5"/>
  </svg>`;
}

function twoColumnIcon() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
    <rect x="2" y="2" width="12" height="12" rx="1.5"/>
    <line x1="8" y1="2" x2="8" y2="14"/>
  </svg>`;
}

function focusViewIcon() {
  return `<svg viewBox="0 0 18 16" fill="none" stroke="currentColor" stroke-width="1.7">
    <rect x="1.8" y="2" width="14.4" height="12" rx="1.6"/>
    <line x1="7" y1="2" x2="7" y2="14"/>
    <line x1="3.5" y1="5" x2="5.4" y2="5"/>
    <line x1="3.5" y1="8" x2="5.4" y2="8"/>
    <line x1="3.5" y1="11" x2="5.4" y2="11"/>
    <line x1="9.2" y1="5.2" x2="14" y2="5.2"/>
    <line x1="9.2" y1="8" x2="14" y2="8"/>
    <line x1="9.2" y1="10.8" x2="12.4" y2="10.8"/>
  </svg>`;
}

function applyLayoutMode() {
  const scroll = state.root.querySelector('#tasks-cards-scroll');
  if (!scroll) return;
  scroll.classList.remove('one-col', 'two-col', 'focus');
  scroll.classList.add(state.layoutMode);
}

async function renderTaskList() {
  const scroll = state.root.querySelector('#tasks-cards-scroll');
  if (!scroll) return;
  scroll.innerHTML = '';
  if (state.layoutMode === 'focus') {
    await renderFocusView(scroll);
    return;
  }
  if (!state.tasks.length) {
    scroll.appendChild(el('div', { class: 'tasks-empty', text: 'No tasks yet. Click "+ New task" to add one.' }));
    return;
  }
  // Preload checkboxes for collapsed cards so the layout sees final
  // card heights before first paint.
  for (const task of state.tasks) {
    if (state.expandedTaskId !== task.id) {
      try { await loadCheckboxes(task.id); } catch { /* renderCard will retry */ }
    }
  }

  if (state.layoutMode === 'two-col') {
    // Two flex columns: distribute cards to the shorter column for
    // tight packing (no large gaps under short cards like CSS grid).
    const left = el('div', { class: 'tasks-col' });
    const right = el('div', { class: 'tasks-col' });
    scroll.appendChild(left);
    scroll.appendChild(right);

    for (const task of state.tasks) {
      const card = renderCard(task, {
        expanded: state.expandedTaskId === task.id,
        state,
        onExpandToggle: () => toggleExpanded(task.id),
        onTaskReload: () => reloadTasks(),
      });
      // Append to the shorter column
      (left.getBoundingClientRect().height <= right.getBoundingClientRect().height
        ? left : right).appendChild(card);
    }
  } else {
    for (const task of state.tasks) {
      const card = renderCard(task, {
        expanded: state.expandedTaskId === task.id,
        state,
        onExpandToggle: () => toggleExpanded(task.id),
        onTaskReload: () => reloadTasks(),
      });
      scroll.appendChild(card);
    }
  }
  recordCurrentTaskView();
}

async function renderFocusView(scroll) {
  ensureFocusSelection();

  const shell = el('div', { class: 'tasks-focus-shell' });
  const left = el('div', { class: 'tasks-focus-list' });
  const right = el('div', { class: 'tasks-focus-detail' });
  shell.appendChild(left);
  shell.appendChild(right);
  scroll.appendChild(shell);

  renderFocusLeftPane(left);
  await renderFocusRightPane(right);
}

function findTaskById(id) {
  if (id == null) return null;
  return state.tasks.find(t => t.id === id)
    || state.pinned.find(t => t.id === id)
    || (state.selectedTask && state.selectedTask.id === id ? state.selectedTask : null);
}

function ensureFocusSelection() {
  const current = findTaskById(state.expandedTaskId);
  if (current) {
    state.selectedTask = current;
    return current;
  }
  const first = state.tasks[0] || null;
  state.expandedTaskId = first ? first.id : null;
  state.selectedTask = first;
  return first;
}

function isSelectedOutsideTopFilters() {
  return !!state.expandedTaskId && !state.tasks.some(t => t.id === state.expandedTaskId);
}

function getCategory(task) {
  return state.categories.find(c => c.id === task.category_id) || null;
}

function getStatus(task) {
  return state.statuses.find(s => s.id === task.status_id) || null;
}

function renderFocusLeftPane(left) {
  const tools = el('div', { class: 'tasks-focus-tools' });
  const input = document.createElement('input');
  input.className = 'tasks-focus-search';
  input.type = 'search';
  input.placeholder = 'Search visible tasks...';
  input.value = state.focusSearch;
  input.addEventListener('input', () => {
    state.focusSearch = input.value;
    renderTaskList();
  });
  tools.appendChild(input);
  tools.appendChild(el('span', { class: 'tasks-focus-count', text: String(getFocusVisibleTasks().length) }));
  left.appendChild(tools);

  const visible = getFocusVisibleTasks();
  if (!state.tasks.length) {
    left.appendChild(el('div', { class: 'tasks-focus-empty', text: 'No tasks match the current filters.' }));
    return;
  }
  if (!visible.length) {
    left.appendChild(el('div', { class: 'tasks-focus-empty', text: 'No visible tasks match search.' }));
    return;
  }

  for (const task of visible) {
    left.appendChild(renderFocusRow(task));
  }
}

function getFocusVisibleTasks() {
  const q = state.focusSearch.trim().toLowerCase();
  if (!q) return state.tasks;
  return state.tasks.filter(t => String(t.title || '').toLowerCase().includes(q));
}

function renderFocusRow(task) {
  const row = el('button', { class: 'tasks-focus-row' });
  row.type = 'button';
  row.dataset.taskId = String(task.id);
  row.classList.toggle('active', state.expandedTaskId === task.id);

  const cat = getCategory(task);
  const st = getStatus(task);

  const bar = el('span', { class: 'tasks-focus-cat-bar' });
  if (cat) bar.style.background = cat.color;
  row.appendChild(bar);

  const dot = el('span', { class: 'tasks-focus-status-dot' });
  if (st) dot.style.background = st.color;
  row.appendChild(dot);

  row.appendChild(el('span', { class: 'tasks-focus-row-title', text: task.title || '(untitled)' }));
  if (task.is_pinned) row.appendChild(el('span', { class: 'tasks-focus-pin', text: '📌' }));

  row.addEventListener('click', async () => {
    state.expandedTaskId = task.id;
    state.selectedTask = task;
    state.focusCardExpanded = false;
    await renderTaskList();
  });
  return row;
}

async function renderFocusRightPane(right) {
  const selected = findTaskById(state.expandedTaskId);
  if (!selected) {
    const text = state.tasks.length
      ? 'Select a task from the list.'
      : 'No tasks match the current filters.';
    right.appendChild(el('div', { class: 'tasks-focus-detail-empty', text }));
    return;
  }

  state.selectedTask = selected;

  if (isSelectedOutsideTopFilters()) {
    const banner = el('div', { class: 'tasks-focus-outside-banner' });
    banner.appendChild(el('span', { text: 'Opened from pinned chips. This task is outside current filters.' }));
    const showBtn = document.createElement('button');
    showBtn.className = 'task-editor-btn tasks-focus-show-in-list';
    showBtn.type = 'button';
    showBtn.textContent = 'Show in list';
    showBtn.addEventListener('click', async () => showSelectedTaskInList(selected));
    banner.appendChild(showBtn);
    right.appendChild(banner);
  }

  const card = renderCard(selected, {
    expanded: state.focusCardExpanded,
    state,
    onExpandToggle: async () => {
      state.focusCardExpanded = !state.focusCardExpanded;
      await renderTaskList();
    },
    onTaskReload: async () => reloadTasks(),
  });
  card.classList.add('tasks-focus-card');
  right.appendChild(card);
}

async function showSelectedTaskInList(task) {
  state.filter.category = task.category_id == null ? 'none' : String(task.category_id);
  state.filter.status = task.status_id == null ? 'none' : String(task.status_id);
  state.expandedTaskId = task.id;
  state.selectedTask = task;
  state.focusCardExpanded = false;
  state.focusSearch = '';
  await reloadTasks();
  recordCurrentTaskView();
}

// ── Expand / collapse ───────────────────────────────────────

async function toggleExpanded(id) {
  state.expandedTaskId = state.expandedTaskId === id ? null : id;
  await renderTaskList();
}

export async function openExpanded(id, taskSnapshot = null) {
  state.expandedTaskId = id;
  if (taskSnapshot) state.selectedTask = taskSnapshot;
  if (taskSnapshot?.uuid) localStorage.setItem('ai.recent_task_uuid', taskSnapshot.uuid);
  if (state.layoutMode === 'focus') {
    state.focusCardExpanded = false;
    await renderTaskList();
    recordCurrentTaskView();
    return;
  }
  await renderTaskList();
  recordCurrentTaskView();
  // Ensure card is scrolled into view.
  setTimeout(() => {
    const card = state.root.querySelector(`[data-task-id="${id}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 50);
}

async function openTaskFromViewHistory(detail) {
  let target = null;
  if (detail.objectId != null) {
    target = findTaskById(Number(detail.objectId));
  }
  if (!target) {
    const all = await call('list_tasks', { category: null, status: null });
    target = all.find(task => (
      (detail.objectUuid && task.uuid === detail.objectUuid)
      || (detail.objectId != null && Number(task.id) === Number(detail.objectId))
      || (detail.title && String(task.title || '') === String(detail.title))
    )) || null;
  }
  if (!target) {
    showToast('Task from history was deleted', 'error');
    return;
  }
  await showSelectedTaskInList(target);
}

function recordCurrentTaskView() {
  if (!state.root || window.__keyboardHelperActiveTab !== 'tasks') return;
  if (state.expandedTaskId == null) return;
  const task = findTaskById(state.expandedTaskId) || state.selectedTask;
  if (!task) return;
  window.dispatchEvent(new CustomEvent('view-history:record', {
    detail: {
      key: `task:${task.uuid || task.id}`,
      moduleId: 'tasks',
      objectType: 'task',
      objectId: task.id,
      objectUuid: task.uuid || null,
      title: task.title || '(untitled)',
      label: 'Tasks',
      icon: '✅',
      detail: {},
    },
  }));
}

// ── Actions ─────────────────────────────────────────────────

async function onNewTask() {
  try {
    const catId = state.filter.category !== 'all' && state.filter.category !== 'none'
      ? parseInt(state.filter.category, 10)
      : null;
    const stId = state.filter.status !== 'all' && state.filter.status !== 'none'
      ? parseInt(state.filter.status, 10)
      : null;
    const t = await call('create_task', {
      title: 'New task',
      categoryId: catId,
      statusId: stId,
    });
    state.expandedTaskId = t.id;
    state.selectedTask = t;
    state.focusCardExpanded = state.layoutMode !== 'focus';
    await reloadTasks();
  } catch (e) {
    showToast('Failed to create task: ' + e, 'error');
  }
}

async function onSetLayoutMode(mode) {
  if (!['one-col', 'two-col', 'focus'].includes(mode)) return;
  const wasFocus = state.layoutMode === 'focus';
  state.layoutMode = mode;
  if (mode === 'focus') {
    ensureFocusSelection();
    if (!wasFocus) state.focusCardExpanded = false;
  }
  applyLayoutMode();
  renderLayoutToggle();
  await renderTaskList();
  try {
    await call('set_setting', { key: 'tasks_layout_mode', value: state.layoutMode });
  } catch { /* non-fatal */ }
}

async function openTasksSettings() {
  // Read current values
  const root = document.documentElement;
  const currentCbFont = parseInt(
    getComputedStyle(root).getPropertyValue('--task-cb-font-size')
  ) || 13;

  let currentMaxItems = 10;
  try {
    const s = await call('get_setting', { key: 'tasks_card_max_checkboxes' });
    if (s) currentMaxItems = Math.max(3, parseInt(s, 10) || 10);
  } catch { /* default */ }

  const body = document.createElement('div');
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="display:flex;justify-content:space-between;align-items:baseline;color:var(--text)">
          <span>Checkbox font size</span>
          <span id="tasks-set-cb-val" style="font-family:'JetBrains Mono',monospace;color:var(--text-muted)">${currentCbFont}px</span>
        </label>
        <input id="tasks-set-cb" type="range" min="10" max="20" value="${currentCbFont}" style="width:100%;margin-top:4px" />
      </div>
      <div>
        <label style="display:flex;justify-content:space-between;align-items:baseline;color:var(--text)">
          <span>Max visible checkboxes (collapsed card)</span>
          <span id="tasks-set-max-val" style="font-family:'JetBrains Mono',monospace;color:var(--text-muted)">${currentMaxItems}</span>
        </label>
        <input id="tasks-set-max" type="range" min="3" max="20" value="${currentMaxItems}" style="width:100%;margin-top:4px" />
      </div>
      <div style="font-size:11px;color:var(--text-muted);font-style:italic">
        Changes apply immediately and persist across sessions.
      </div>
    </div>
  `;

  const cbSlider = body.querySelector('#tasks-set-cb');
  const cbVal = body.querySelector('#tasks-set-cb-val');
  const maxSlider = body.querySelector('#tasks-set-max');
  const maxVal = body.querySelector('#tasks-set-max-val');
  const initialCb = currentCbFont;
  const initialMax = currentMaxItems;

  cbSlider.addEventListener('input', () => {
    cbVal.textContent = cbSlider.value + 'px';
    root.style.setProperty('--task-cb-font-size', cbSlider.value + 'px');
  });
  maxSlider.addEventListener('input', () => {
    maxVal.textContent = maxSlider.value;
    // Live-update max-height on visible collapsed card bodies
    for (const bodyEl of document.querySelectorAll('.task-card-body')) {
      bodyEl.style.maxHeight = (parseInt(maxSlider.value) * 26 + 12) + 'px';
    }
  });

  showModal({
    title: 'Tasks — display settings',
    body,
    onConfirm: async () => {
      const cb = parseInt(cbSlider.value);
      const mx = parseInt(maxSlider.value);
      try {
        await call('set_setting', { key: 'tasks_checkbox_font_size', value: String(cb) });
        await call('set_setting', { key: 'tasks_card_max_checkboxes', value: String(mx) });
        root.style.setProperty('--task-cb-font-size', cb + 'px');
        showToast('Saved', 'success');
      } catch (e) {
        showToast('Failed to save: ' + e, 'error');
      }
    },
    onCancel: () => {
      root.style.setProperty('--task-cb-font-size', initialCb + 'px');
      for (const bodyEl of document.querySelectorAll('.task-card-body')) {
        bodyEl.style.maxHeight = (initialMax * 26 + 12) + 'px';
      }
    },
  });
}

// ── DOM helper ──────────────────────────────────────────────

export function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.class) e.className = opts.class;
  if (opts.text != null) e.textContent = opts.text;
  if (opts.id) e.id = opts.id;
  if (opts.style) e.setAttribute('style', opts.style);
  if (opts.title) e.title = opts.title;
  if (opts.html != null) e.innerHTML = opts.html;
  return e;
}
