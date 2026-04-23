import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';

// Pointer-based drag-and-drop for the Tasks tab. Pointer (not HTML5 DnD)
// because Tauri WebView2 has known HTML5 DnD issues (documented in
// desktop-rust/RELEASES.md).
//
// Two drag modes, detected by the element's `data-drag-kind`:
//   1. "card"      — whole task card; drop targets:
//                       a) `.tasks-dropdown-item[data-drop-kind]` → change
//                          task.category_id / status_id (filter unchanged);
//                       b) another `.task-card` → reorder list.
//                    During drag we hover over a `.tasks-dropdown` to
//                    auto-open its menu after 250ms; opened menu items
//                    become the drop targets.
//   2. "checkbox"  — single checkbox row; drop target: another `.tcb-item`
//                    in the SAME task; drop flips parent/sort_order; nest
//                    if horizontal offset > threshold.

const HOVER_OPEN_MS = 250;
const GHOST_OFFSET = { x: 10, y: 10 };

let active = null; // { kind, payload, ghost, startX, startY, hoverTimer, hoverDropdownEl, ... }

export function installTaskDnd(rootEl, { onTaskMetaChange, onTaskReorder, onCheckboxChange }) {
  rootEl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-drag-kind]');
    if (!handle) return;
    if (e.button !== 0) return;
    const kind = handle.dataset.dragKind;
    if (kind !== 'card' && kind !== 'checkbox') return;

    e.preventDefault();
    active = startDrag(handle, kind, e);

    const onMove = (ev) => {
      if (!active) return;
      onPointerMove(ev, rootEl);
    };
    const onUp = async (ev) => {
      if (!active) { cleanup(); return; }
      try {
        await onPointerUp(ev, { onTaskMetaChange, onTaskReorder, onCheckboxChange });
      } finally {
        cleanup();
      }
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

function startDrag(handle, kind, e) {
  const ghost = buildGhost(handle, kind);
  const rect = handle.getBoundingClientRect();
  ghost.style.left = (e.clientX + GHOST_OFFSET.x) + 'px';
  ghost.style.top  = (e.clientY + GHOST_OFFSET.y) + 'px';
  document.body.appendChild(ghost);

  const payload = kind === 'card'
    ? { taskId: Number(handle.dataset.taskId) }
    : { cbId: Number(handle.dataset.cbId), taskId: Number(handle.dataset.taskId) };

  // mark source card/row as dragging (visual cue)
  const source = handle.closest(kind === 'card' ? '.task-card' : '.tcb-item');
  if (source) source.classList.add('dragging');

  return {
    kind,
    payload,
    ghost,
    source,
    startX: e.clientX,
    startY: e.clientY,
    hoverTimer: null,
    hoverDropdownEl: null,
    currentDropTarget: null,
  };
}

function buildGhost(handle, kind) {
  const g = document.createElement('div');
  g.className = 'task-dnd-ghost';
  if (kind === 'card') {
    const card = handle.closest('.task-card');
    const title = card && card.querySelector('.task-title');
    g.textContent = title ? title.textContent : 'task';
  } else {
    const row = handle.closest('.tcb-item');
    const textEl = row && row.querySelector('.tcb-text');
    g.textContent = textEl ? (textEl.value != null ? textEl.value : textEl.textContent) : 'item';
  }
  return g;
}

function onPointerMove(e, rootEl) {
  if (!active) return;
  active.ghost.style.left = (e.clientX + GHOST_OFFSET.x) + 'px';
  active.ghost.style.top  = (e.clientY + GHOST_OFFSET.y) + 'px';

  // Remove stale highlight
  clearDropHighlights();

  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (!under) return;

  if (active.kind === 'card') {
    // 1) Dropdown-item drop target (menu already open).
    const menuItem = under.closest('.tasks-dropdown-item[data-drop-kind]');
    if (menuItem) {
      menuItem.classList.add('drop-target');
      active.currentDropTarget = { kind: 'menu-item', el: menuItem };
      return;
    }
    // 2) Hovering over a dropdown that is not yet open → schedule auto-open.
    const dropdown = under.closest('.tasks-dropdown');
    if (dropdown) {
      dropdown.classList.add('drop-hover');
      if (active.hoverDropdownEl !== dropdown) {
        if (active.hoverTimer) clearTimeout(active.hoverTimer);
        active.hoverDropdownEl = dropdown;
        active.hoverTimer = setTimeout(() => {
          // Simulate open by clicking (dropdown click handler ignores drag state).
          if (!dropdown.querySelector('.tasks-dropdown-menu')) {
            dropdown.click();
          }
        }, HOVER_OPEN_MS);
      }
      active.currentDropTarget = { kind: 'dropdown', el: dropdown };
      return;
    }
    // 3) Another task card → reorder target.
    const card = under.closest('.task-card');
    if (card && card !== active.source) {
      card.classList.add('drop-target');
      active.currentDropTarget = { kind: 'card-target', el: card };
      return;
    }
    active.currentDropTarget = null;
    if (active.hoverDropdownEl) {
      clearTimeout(active.hoverTimer);
      active.hoverTimer = null;
      active.hoverDropdownEl = null;
    }
  } else {
    // checkbox drag: target is another row in the same task.
    const row = under.closest('.tcb-item');
    if (row && row !== active.source) {
      const sourceTaskId = active.payload.taskId;
      const rowTaskCard = row.closest('.task-card');
      const rowTaskId = rowTaskCard && Number(rowTaskCard.dataset.taskId);
      if (rowTaskId === sourceTaskId) {
        row.classList.add('drop-target');
        // horizontal offset ≥ 30px → nest under target (if depth allows).
        const nest = (e.clientX - active.startX) > 30;
        active.currentDropTarget = { kind: 'cb-row', el: row, nest };
        return;
      }
    }
    active.currentDropTarget = null;
  }
}

function clearDropHighlights() {
  for (const el of document.querySelectorAll('.drop-target')) el.classList.remove('drop-target');
  for (const el of document.querySelectorAll('.tasks-dropdown.drop-hover')) el.classList.remove('drop-hover');
}

async function onPointerUp(e, { onTaskMetaChange, onTaskReorder, onCheckboxChange }) {
  if (!active) return;
  const target = active.currentDropTarget;
  if (!target) return;

  if (active.kind === 'card') {
    const taskId = active.payload.taskId;
    if (target.kind === 'menu-item') {
      const kind = target.el.dataset.dropKind;
      const raw = target.el.dataset.dropId;
      const newId = raw ? Number(raw) : null;
      await onTaskMetaChange(taskId, kind, newId);
    } else if (target.kind === 'card-target') {
      const destId = Number(target.el.dataset.taskId);
      await onTaskReorder(taskId, destId);
    }
  } else {
    const { cbId, taskId } = active.payload;
    const destEl = target.el;
    const destCbId = Number(destEl.dataset.cbId);
    const nest = !!target.nest;
    await onCheckboxChange(taskId, cbId, destCbId, nest);
  }
}

function cleanup() {
  if (!active) return;
  if (active.ghost && active.ghost.parentNode) active.ghost.remove();
  if (active.source) active.source.classList.remove('dragging');
  if (active.hoverTimer) clearTimeout(active.hoverTimer);
  clearDropHighlights();
  active = null;
}

// ── High-level helpers used by index.js ──────────────────────

export async function commitCardMetaChange(state, taskId, kind, newId) {
  const task = state.tasks.find(t => t.id === taskId) || state.pinned.find(t => t.id === taskId);
  if (!task) return;
  const patch = { ...task };
  if (kind === 'category') patch.category_id = newId;
  else if (kind === 'status') patch.status_id = newId;
  try {
    await call('update_task', {
      id: task.id,
      title: task.title || '',
      categoryId: patch.category_id,
      statusId: patch.status_id,
      isPinned: !!task.is_pinned,
      bgColor: task.bg_color,
      trackerUrl: task.tracker_url,
      notesMd: task.notes_md || '',
    });
  } catch (e) {
    showToast('Update failed: ' + e, 'error');
  }
}

export async function commitCardReorder(state, draggedId, destId) {
  // Reorder within the current visible list: insert dragged before dest.
  const ids = state.tasks.map(t => t.id);
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(destId);
  if (from === -1 || to === -1 || from === to) return;
  ids.splice(from, 1);
  const destAfter = ids.indexOf(destId);
  ids.splice(destAfter, 0, draggedId);
  try {
    await call('reorder_tasks', { ids });
  } catch (e) {
    showToast('Reorder failed: ' + e, 'error');
  }
}

export async function commitCheckboxChange(taskId, draggedId, destId, nest) {
  try {
    // Load current list, rebuild ordering, send as reorder batch.
    const items = await call('list_task_checkboxes', { taskId });
    const byId = new Map(items.map(x => [x.id, { ...x }]));
    const dragged = byId.get(draggedId);
    const dest = byId.get(destId);
    if (!dragged || !dest) return;

    if (nest) {
      // Make dragged a child of dest (depth ≤ 3).
      const destDepth = depthOf(dest.id, byId);
      if (destDepth >= 2) {
        showToast('Max nesting depth is 3', 'info');
        return;
      }
      dragged.parent_id = dest.id;
      dragged.sort_order = 9999; // end
    } else {
      // Insert dragged next to dest at the same level.
      dragged.parent_id = dest.parent_id;
      dragged.sort_order = dest.sort_order + 1; // just after dest
      // Shift siblings after dest forward by 2 to leave room.
      for (const it of byId.values()) {
        if (it.id !== dragged.id
            && it.parent_id === dest.parent_id
            && it.sort_order > dest.sort_order) {
          it.sort_order += 2;
        }
      }
    }

    const entries = Array.from(byId.values()).map(x => ({
      id: x.id, parent_id: x.parent_id, sort_order: x.sort_order,
    }));
    await call('reorder_task_checkboxes', { taskId, entries });
  } catch (e) {
    showToast('Reorder failed: ' + e, 'error');
  }
}

function depthOf(id, byId) {
  let d = 0;
  let cur = id;
  while (cur != null && d < 10) {
    const n = byId.get(cur);
    if (!n || n.parent_id == null) break;
    cur = n.parent_id;
    d++;
  }
  return d;
}
