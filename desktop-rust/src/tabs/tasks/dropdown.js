import { el } from './index.js';
import { openManageModal } from './manage-modal.js';

// ── Pinned chips ─────────────────────────────────────────────

export function renderPinnedChips(container, pinned, categories, onChipClick) {
  container.innerHTML = '';
  if (!pinned.length) {
    container.classList.add('empty');
    return;
  }
  container.classList.remove('empty');
  for (const task of pinned) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tasks-pinned-chip';
    chip.title = task.title || '(untitled)';

    const bar = document.createElement('span');
    bar.className = 'tasks-pinned-chip-bar';
    const cat = categories.find(c => c.id === task.category_id);
    bar.style.background = cat ? cat.color : 'var(--text-muted)';
    chip.appendChild(bar);

    chip.appendChild(el('span', { text: '📌' }));
    chip.appendChild(el('span', { class: 'tasks-pinned-chip-label', text: task.title || '(untitled)' }));

    chip.addEventListener('click', () => onChipClick(task));
    container.appendChild(chip);
  }
}

// ── Filter dropdown ──────────────────────────────────────────

/**
 * Render a single filter dropdown into `container` (replaces its children).
 *
 *   renderFilterDropdown(el, {
 *     kind: 'category' | 'status',
 *     items: [{id, name, color, ...}],
 *     currentValue: 'all' | 'none' | '<id>',
 *     showNone: bool, noneCount: number,
 *     tasks: [...], // used for counting
 *     onPick: (value) => void,
 *   })
 */
export function renderFilterDropdown(container, opts) {
  container.innerHTML = '';
  container.classList.add('tasks-dropdown');
  container.dataset.kind = opts.kind;

  // Current selection label
  const curItem = opts.items.find(x => String(x.id) === String(opts.currentValue));
  let label;
  if (opts.currentValue === 'all') {
    label = el('span', { text: 'All', style: 'font-weight:600;color:var(--text-muted)' });
  } else if (opts.currentValue === 'none') {
    label = el('span', { text: 'None', style: 'font-style:italic;color:var(--text-muted)' });
  } else if (curItem) {
    const dot = el('span', { class: 'tasks-dot' });
    dot.style.background = curItem.color;
    container.appendChild(dot);
    label = el('span', { text: curItem.name });
  } else {
    label = el('span', { text: 'All', style: 'font-weight:600;color:var(--text-muted)' });
  }
  container.appendChild(label);
  container.appendChild(el('span', { class: 'tasks-dropdown-chevron', text: '▾' }));

  // Click → open menu
  container.addEventListener('click', (e) => {
    e.stopPropagation();
    openDropdownMenu(container, opts);
  });

  // Right-click → open Manage modal
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, opts.kind);
  });
}

function openDropdownMenu(container, opts) {
  closeAllDropdowns();
  const menu = buildMenu(opts);
  container.appendChild(menu);
  // close on outside click
  const onDocClick = (ev) => {
    if (!menu.contains(ev.target) && ev.target !== container) {
      closeAllDropdowns();
      document.removeEventListener('click', onDocClick);
    }
  };
  // deferred attach so the opening click itself doesn't close.
  setTimeout(() => document.addEventListener('click', onDocClick), 0);
}

export function closeAllDropdowns() {
  for (const m of document.querySelectorAll('.tasks-dropdown-menu')) {
    m.remove();
  }
}

function buildMenu(opts) {
  const menu = document.createElement('div');
  menu.className = 'tasks-dropdown-menu';

  // "All" first
  const allItem = buildDropdownItem({
    text: 'All',
    isSelected: opts.currentValue === 'all',
    onClick: () => { opts.onPick('all'); closeAllDropdowns(); },
  });
  menu.appendChild(allItem);

  for (const it of opts.items) {
    const count = opts.tasks.filter(t =>
      opts.kind === 'category' ? t.category_id === it.id : t.status_id === it.id
    ).length;

    const item = buildDropdownItem({
      text: it.name,
      color: it.color,
      count,
      isSelected: String(opts.currentValue) === String(it.id),
      onClick: () => { opts.onPick(String(it.id)); closeAllDropdowns(); },
      dropKind: opts.kind,
      dropId: it.id,
    });
    menu.appendChild(item);
  }

  if (opts.showNone) {
    const noneItem = buildDropdownItem({
      text: 'None',
      count: opts.noneCount,
      isSelected: opts.currentValue === 'none',
      isNone: true,
      onClick: () => { opts.onPick('none'); closeAllDropdowns(); },
      dropKind: opts.kind,
      dropId: null, // NULL = unset
    });
    menu.appendChild(noneItem);
  }

  return menu;
}

function buildDropdownItem({ text, color, count, isSelected, isNone, onClick, dropKind, dropId }) {
  const item = document.createElement('div');
  item.className = 'tasks-dropdown-item';
  if (isSelected) item.classList.add('selected');
  if (isNone) item.classList.add('none-item');
  if (dropKind) {
    item.dataset.dropKind = dropKind;
    item.dataset.dropId = dropId == null ? '' : String(dropId);
  }
  if (color) {
    const dot = el('span', { class: 'tasks-dot' });
    dot.style.background = color;
    item.appendChild(dot);
  } else if (isNone) {
    const dot = el('span', { class: 'tasks-dot' });
    item.appendChild(dot);
  }
  item.appendChild(el('span', { text }));
  if (count != null && count > 0) {
    item.appendChild(el('span', { class: 'item-count', text: String(count) }));
  }
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return item;
}

// ── Right-click context menu ─────────────────────────────────

function showContextMenu(x, y, kind) {
  removeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'tasks-ctx-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const item = document.createElement('div');
  item.className = 'tasks-ctx-menu-item';
  item.textContent = kind === 'category' ? '⚙ Manage categories…' : '⚙ Manage statuses…';
  item.addEventListener('click', () => {
    removeContextMenu();
    openManageModal(kind);
  });
  menu.appendChild(item);

  document.body.appendChild(menu);
  setTimeout(() => {
    document.addEventListener('click', removeContextMenu, { once: true });
  }, 0);
}

function removeContextMenu() {
  for (const m of document.querySelectorAll('.tasks-ctx-menu')) m.remove();
}
