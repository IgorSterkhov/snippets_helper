import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';
import { showModal } from '../../components/modal.js';
import { tasksCSS } from './tasks-css.js';
import { renderCard, resetCollapseState, invalidateCheckboxCache, loadCheckboxes } from './card.js';
import { renderPinnedChips, renderFilterDropdown } from './dropdown.js';
import { helpButton } from '../sql/sql-help.js';
import { TASKS_HELP_HTML } from './help-content.js';
import { installTaskDnd, commitCardMetaChange, commitCardReorder, commitCheckboxReorder } from './dnd.js';

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
  layoutMode: 'one-col', // 'one-col' | 'two-col'
  expandedTaskId: null,  // id of currently expanded card (at most one)
  // Count of tasks with category_id=NULL / status_id=NULL. Derived from
  // `tasks` (unfiltered). Used to show the "None" item in dropdowns only
  // when there is something to show.
  orphanCatCount: 0,
  orphanStatusCount: 0,
};

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
    if (saved === 'two-col' || saved === 'one-col') {
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
  resetCollapseState();
  renderAll();

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
      // Restore focus to the dragged checkbox after DOM rebuild
      setTimeout(() => {
        const el = document.querySelector(`[data-cb-id="${draggedId}"] .tcb-text[contenteditable="true"]`);
        if (el) {
          el.focus();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }, 30);
    },
  });
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

  // Layout toggle button (right corner). SVG icon flips based on mode.
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'tasks-layout-toggle';
  toggleBtn.className = 'tasks-layout-toggle';
  toggleBtn.title = 'Toggle 1/2 column layout';
  toggleBtn.type = 'button';
  toggleBtn.addEventListener('click', onToggleLayout);
  filterRow.appendChild(toggleBtn);

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
  renderAll();
}

export async function reloadTasks() {
  await loadTasks();
  await loadPinned();
  renderTaskList();
  renderPinnedStrip();
  // Dropdowns may need to show/hide the "None" item as orphan counts change.
  renderDropdowns();
}

// ── Render ──────────────────────────────────────────────────

function renderAll() {
  renderPinnedStrip();
  renderDropdowns();
  renderLayoutToggle();
  renderTaskList();
}

function renderPinnedStrip() {
  const el = state.root.querySelector('#tasks-pinned');
  if (!el) return;
  renderPinnedChips(el, state.pinned, state.categories, (task) => openExpanded(task.id));
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
  const btn = state.root.querySelector('#tasks-layout-toggle');
  if (!btn) return;
  const isTwoCol = state.layoutMode === 'two-col';
  btn.classList.toggle('active', isTwoCol);
  btn.title = isTwoCol ? 'Switch to 1 column' : 'Switch to 2 columns';
  btn.innerHTML = isTwoCol
    ? `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
         <rect x="2" y="2" width="12" height="12" rx="1.5"/>
         <line x1="8" y1="2" x2="8" y2="14"/>
       </svg>`
    : `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
         <rect x="2" y="2" width="12" height="12" rx="1.5"/>
       </svg>`;
}

function applyLayoutMode() {
  const scroll = state.root.querySelector('#tasks-cards-scroll');
  if (!scroll) return;
  scroll.classList.remove('one-col', 'two-col');
  scroll.classList.add(state.layoutMode);
}

async function renderTaskList() {
  const scroll = state.root.querySelector('#tasks-cards-scroll');
  if (!scroll) return;
  scroll.innerHTML = '';
  if (!state.tasks.length) {
    scroll.appendChild(el('div', { class: 'tasks-empty', text: 'No tasks yet. Click "+ New task" to add one.' }));
    return;
  }
  // Preload checkboxes for collapsed cards so grid/flex sees final height
  // before first paint — prevents overlap in two-col grid mode (WebView2
  // does not re-layout grid rows when card height changes asynchronously).
  for (const task of state.tasks) {
    if (state.expandedTaskId !== task.id) {
      try { await loadCheckboxes(task.id); } catch { /* renderCard will retry */ }
    }
  }
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

// ── Expand / collapse ───────────────────────────────────────

function toggleExpanded(id) {
  state.expandedTaskId = state.expandedTaskId === id ? null : id;
  renderTaskList();
}

export function openExpanded(id) {
  state.expandedTaskId = id;
  renderTaskList();
  // Ensure card is scrolled into view.
  setTimeout(() => {
    const card = state.root.querySelector(`[data-task-id="${id}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 50);
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
    await reloadTasks();
  } catch (e) {
    showToast('Failed to create task: ' + e, 'error');
  }
}

async function onToggleLayout() {
  state.layoutMode = state.layoutMode === 'two-col' ? 'one-col' : 'two-col';
  applyLayoutMode();
  renderLayoutToggle();
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
