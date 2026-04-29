import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';

// Pointer-based drag-and-drop for the Tasks tab. Pointer (not HTML5 DnD)
// because Tauri WebView2 has known HTML5 DnD issues.
//
// Visual model:
//   • on pointerdown on a handle we CLONE the card/row into a floating
//     ghost element that follows the cursor (position:fixed, z-index high);
//   • the SOURCE element stays in place but dimmed (so the user can see
//     where it came from);
//   • a blue INSERTION-LINE element is inserted into the list at the
//     would-be drop position; as the user moves the cursor, the line
//     follows and passes "through" other cards, giving strong spatial
//     feedback of where the drop will land;
//   • on pointerup we compute the final index from where the line sits,
//     and commit to the backend via `reorder_tasks` /
//     `reorder_task_checkboxes` (computed from the resulting DOM).
//
// Drag kinds (detected via data-drag-kind on the grip handle):
//   1. "card"      — source is `.task-card`; drop targets:
//                       a) another card inside .tasks-cards-scroll → reorder;
//                       b) a `.tasks-dropdown` (hover 300ms auto-opens menu,
//                          drop on a menu item flips category/status;
//                          the source position in the list is unchanged);
//   2. "checkbox"  — source is `.tcb-item`; drop target: another row inside
//                    the SAME task's cb list → reorder. Horizontal offset
//                    > NEST_THRESHOLD_PX nests under the row above.

const HOVER_OPEN_MS = 300;
const NEST_THRESHOLD_PX = 30;

let active = null;
// Fields while active:
//   kind, handle, source, sourceOriginalRect, offsetX, offsetY
//   ghost: HTMLElement
//   listEl: HTMLElement   // scroll container that owns this drag's list
//   line:  HTMLElement    // blue insertion indicator (only for list reorder)
//   dropdown-hover state: hoverDropdownEl, hoverTimer
//   insertBefore: HTMLElement | null — the DOM node the line sits before
//                 (null = line at end of list)
//   mode: 'reorder' | 'dropdown' — current drop-target mode
//   dropdownItem: HTMLElement | null — highlighted dropdown menu item
//   placeholder      — real DOM element holding source's slot during drag (checkbox only)
//   sourceHidden     — whether source has display:none applied

export function installTaskDnd(rootEl, {
  onTaskReorderCommit,
  onTaskMetaChange,
  onCheckboxReorderCommit,
}) {
  rootEl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-drag-kind]');
    if (!handle) return;
    if (e.button !== 0) return;
    const kind = handle.dataset.dragKind;
    if (kind !== 'card' && kind !== 'checkbox') return;

    e.preventDefault();
    startDrag(handle, kind, e);
    if (!active) return;

    const onMove = (ev) => onPointerMove(ev);
    const onUp = async (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      try {
        await onPointerUp(ev, {
          onTaskReorderCommit,
          onTaskMetaChange,
          onCheckboxReorderCommit,
        });
      } finally {
        cleanup();
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

function startDrag(handle, kind, e) {
  const source = handle.closest(kind === 'card' ? '.task-card' : '.tcb-item');
  if (!source) return;

  const rect = source.getBoundingClientRect();

  const ghost = source.cloneNode(true);
  ghost.classList.add('task-dnd-drag-clone');
  ghost.style.position = 'fixed';
  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';
  ghost.style.width = rect.width + 'px';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '10000';
  ghost.style.opacity = '0.92';
  ghost.style.transform = 'rotate(-0.8deg)';
  ghost.style.boxShadow = '0 16px 32px rgba(0,0,0,0.55)';
  // Neutralise inputs/animations inside the clone
  for (const el of ghost.querySelectorAll('input, button, textarea, select')) {
    el.disabled = true;
  }
  document.body.appendChild(ghost);

  source.classList.add('task-dnd-source');

  // List container: for cards the nearest .tasks-col (two-col) or
  // .tasks-cards-scroll (one-col); for checkbox the row's parent.
  const listEl = kind === 'card'
    ? (source.closest('.tasks-col') || source.closest('.tasks-cards-scroll') || source.parentElement)
    : source.parentElement;

  // Checkbox mode: build placeholder, hide source, early return
  if (kind === 'checkbox') {
    const placeholder = document.createElement('div');
    placeholder.className = 'task-dnd-placeholder';
    placeholder.style.height = rect.height + 'px';
    source.parentElement.insertBefore(placeholder, source);
    source.style.display = 'none';
    active = {
      kind, handle, source, listEl,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      ghost,
      line: null,
      placeholder,
      sourceHidden: true,
      insertBefore: null,
      hoverDropdownEl: null,
      hoverTimer: null,
      mode: 'reorder',
      dropdownItem: null,
      startX: e.clientX,
    };
    return;
  }

  active = {
    kind, handle, source, listEl,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    ghost,
    line: null,
    insertBefore: null,
    hoverDropdownEl: null,
    hoverTimer: null,
    mode: 'reorder',
    dropdownItem: null,
    startX: e.clientX,
  };
}

function onPointerMove(e) {
  if (!active) return;
  // Float the ghost.
  active.ghost.style.left = (e.clientX - active.offsetX) + 'px';
  active.ghost.style.top = (e.clientY - active.offsetY) + 'px';

  clearDropdownHighlight();
  active.dropdownItem = null;

  const under = document.elementFromPoint(e.clientX, e.clientY);

  // ── Card mode — check dropdown drop first ────────────────────
  if (active.kind === 'card' && under) {
    // 1) Drop target = already-open dropdown menu item
    const menuItem = under.closest('.tasks-dropdown-item[data-drop-kind]');
    if (menuItem) {
      menuItem.classList.add('drop-target');
      active.dropdownItem = menuItem;
      active.mode = 'dropdown';
      hideInsertionLine();
      return;
    }
    // 2) Hover on a dropdown chip → auto-open after HOVER_OPEN_MS
    const dropdown = under.closest('.tasks-dropdown');
    if (dropdown) {
      dropdown.classList.add('drop-hover');
      if (active.hoverDropdownEl !== dropdown) {
        if (active.hoverTimer) clearTimeout(active.hoverTimer);
        active.hoverDropdownEl = dropdown;
        active.hoverTimer = setTimeout(() => {
          if (!dropdown.querySelector('.tasks-dropdown-menu')) {
            dropdown.click();
          }
        }, HOVER_OPEN_MS);
      }
      active.mode = 'dropdown';
      hideInsertionLine();
      return;
    }
    // Not over dropdown — cancel pending auto-open.
    if (active.hoverDropdownEl) {
      clearTimeout(active.hoverTimer);
      active.hoverTimer = null;
      active.hoverDropdownEl = null;
    }
  }

  // ── Checkbox mode — relaxed drop zone ─────────────────────────
  if (active.kind === 'checkbox') {
    const listEl = active.listEl;
    if (!listEl) return;
    const lr = listEl.getBoundingClientRect();
    const insideList = e.clientX >= lr.left && e.clientX <= lr.right
                    && e.clientY >= lr.top  && e.clientY <= lr.bottom;
    if (insideList) {
      active.mode = 'reorder';
      if (active.placeholder) active.placeholder.style.display = '';
      updateCheckboxPlaceholder(e);
    } else {
      active.mode = null;
      if (active.placeholder) active.placeholder.style.display = 'none';
    }
    return;
  }

  // ── Reorder mode ────────────────────────────────────────────
  active.mode = 'reorder';
  updateInsertionLine(e);
}

function updateInsertionLine(e) {
  const listEl = active.listEl;
  if (!listEl) return;
  const peerSel = active.kind === 'card' ? '.task-card' : '.tcb-item';
  // Skip the source itself from the layout calc.
  const peers = Array.from(listEl.querySelectorAll(`:scope > ${peerSel}`))
    .filter(el => el !== active.source);

  if (peers.length === 0) {
    // Empty list — line goes at top of listEl.
    placeLine(listEl, null);
    active.insertBefore = null;
    return;
  }

  const cursorY = e.clientY;
  let before = null;
  for (const peer of peers) {
    const r = peer.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (cursorY < mid) { before = peer; break; }
  }

  placeLine(listEl, before);
  active.insertBefore = before;
}

function updateCheckboxPlaceholder(e) {
  const listEl = active.listEl;
  const ph = active.placeholder;
  if (!listEl || !ph) return;

  const peers = Array.from(listEl.querySelectorAll(':scope > .tcb-item'))
    .filter(el => el !== active.source);

  const cursorY = e.clientY;
  let beforeEl = null;
  for (const peer of peers) {
    const r = peer.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (cursorY < mid) { beforeEl = peer; break; }
  }

  // Already in the right slot?
  if (beforeEl === ph.nextElementSibling) return;
  if (beforeEl === null && ph === listEl.lastElementChild) return;

  // FLIP step 1: capture old positions
  const tracked = [...peers, ph];
  const oldTops = new Map();
  for (const el of tracked) {
    oldTops.set(el, el.getBoundingClientRect().top);
  }

  // Reorder placeholder
  listEl.insertBefore(ph, beforeEl);

  // FLIP step 2: animate to new positions
  for (const el of tracked) {
    const oldTop = oldTops.get(el);
    const newTop = el.getBoundingClientRect().top;
    const delta = oldTop - newTop;
    if (delta === 0) continue;
    el.style.transition = 'none';
    el.style.transform = `translateY(${delta}px)`;
    void el.offsetHeight;  // force reflow
    el.style.transition = `transform 180ms ease`;
    el.style.transform = '';
  }
}

function placeLine(listEl, beforeEl) {
  if (!active.line) {
    const line = document.createElement('div');
    line.className = 'task-dnd-insertion-line';
    active.line = line;
  }
  const line = active.line;
  if (line.parentElement !== listEl) {
    listEl.insertBefore(line, beforeEl || null);
  } else if (line.nextSibling !== beforeEl) {
    // Only move if position differs.
    listEl.insertBefore(line, beforeEl || null);
  }
  line.style.display = '';
}

function hideInsertionLine() {
  if (active.line) active.line.style.display = 'none';
  active.insertBefore = null;
}

function clearDropdownHighlight() {
  for (const el of document.querySelectorAll('.tasks-dropdown-item.drop-target')) {
    el.classList.remove('drop-target');
  }
  for (const el of document.querySelectorAll('.tasks-dropdown.drop-hover')) {
    el.classList.remove('drop-hover');
  }
}

async function onPointerUp(e, {
  onTaskReorderCommit,
  onTaskMetaChange,
  onCheckboxReorderCommit,
}) {
  if (!active) return;

  if (active.kind === 'card') {
    if (active.mode === 'dropdown' && active.dropdownItem) {
      const kind = active.dropdownItem.dataset.dropKind;
      const raw = active.dropdownItem.dataset.dropId;
      const newId = raw ? Number(raw) : null;
      const taskId = Number(active.source.dataset.taskId);
      await onTaskMetaChange(taskId, kind, newId);
      return;
    }
    if (active.mode === 'reorder') {
      // Pass the source-id + the insertion-target id. Index.js computes
      // the final order purely from `state.tasks` — no dependency on DOM
      // state, which avoids the "snap back" we hit when the commit read
      // orderedIds from DOM while reloadTasks concurrently wiped it.
      const sourceId = Number(active.source.dataset.taskId);
      const beforeId = active.insertBefore
        ? Number(active.insertBefore.dataset.taskId)
        : null;
      await onTaskReorderCommit(sourceId, beforeId);
      return;
    }
  } else {
    // checkbox — derive order from placeholder position
    if (active.mode !== 'reorder') return;
    const taskCard = active.source.closest('.task-card');
    const taskId = taskCard ? Number(taskCard.dataset.taskId) : null;
    if (taskId == null) return;

    const listEl = active.listEl;
    if (!listEl || !active.source || !active.placeholder) return;

    // Restore source where placeholder sits; remove placeholder
    listEl.insertBefore(active.source, active.placeholder);
    active.placeholder.remove();
    active.placeholder = null;

    // Determine nest target: the row immediately above the dropped position.
    // Do NOT nest into collapsed parents (spec: user must expand first).
    const rowsInOrder = Array.from(listEl.querySelectorAll(':scope > .tcb-item'));
    const myIdx = rowsInOrder.indexOf(active.source);
    const prevRow = myIdx > 0 ? rowsInOrder[myIdx - 1] : null;
    const deltaX = e.clientX - active.startX;
    let nestUnder = null;
    if (prevRow && deltaX > NEST_THRESHOLD_PX) {
      const prevId = Number(prevRow.dataset.cbId);
      // Only nest if target parent is NOT collapsed
      const prevCollapsed = prevRow.classList.contains('collapsed-parent');
      if (!prevCollapsed) {
        nestUnder = prevId;
      }
    }
    const draggedId = Number(active.source.dataset.cbId);
    const orderedIds = rowsInOrder.map(el => Number(el.dataset.cbId));
    await onCheckboxReorderCommit(taskId, draggedId, orderedIds, nestUnder);
  }
}

function cleanup() {
  if (!active) return;
  if (active.ghost && active.ghost.parentNode) active.ghost.remove();
  if (active.placeholder && active.placeholder.parentNode) {
    // If source is still hidden, restore it before removing placeholder
    if (active.sourceHidden && active.source) {
      active.placeholder.parentNode.insertBefore(active.source, active.placeholder);
    }
    active.placeholder.remove();
  }
  if (active.line && active.line.parentNode) active.line.remove();
  if (active.source) {
    active.source.classList.remove('task-dnd-source');
    if (active.sourceHidden) {
      active.source.style.display = '';
    }
  }
  // Wipe FLIP transforms on checkbox peers
  if (active.listEl && active.kind === 'checkbox') {
    for (const el of active.listEl.querySelectorAll(':scope > .tcb-item')) {
      el.style.transition = '';
      el.style.transform = '';
    }
  }
  if (active.hoverTimer) clearTimeout(active.hoverTimer);
  clearDropdownHighlight();
  active = null;
}

// ── Commit helpers invoked by index.js ────────────────────────────

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

export async function commitCardReorder(state, draggedId, beforeId) {
  // Derive the full new id order from the current `state.tasks` list —
  // move `draggedId` to be immediately before `beforeId` (or to the end
  // if beforeId is null).
  if (!state || !Array.isArray(state.tasks)) return;
  const ids = state.tasks.map(t => t.id);
  const from = ids.indexOf(draggedId);
  if (from === -1) return;
  ids.splice(from, 1);
  let to;
  if (beforeId == null) {
    to = ids.length;
  } else {
    to = ids.indexOf(beforeId);
    if (to === -1) to = ids.length;
  }
  ids.splice(to, 0, draggedId);
  if (ids.length < 2) return;
  try {
    await call('reorder_tasks', { ids });
  } catch (e) {
    showToast('Reorder failed: ' + e, 'error');
  }
}

export async function commitCheckboxReorder(taskId, draggedId, orderedIds, nestUnder) {
  try {
    const items = await call('list_task_checkboxes', { taskId });
    const byId = new Map(items.map(x => [x.id, { ...x }]));
    // DOM gives us the flat visual order. We rebuild sort_order + parent
    // from it: everything stays flat under the dragged item's new parent
    // context (either nestUnder, its parent, or null for root).
    const dragged = byId.get(draggedId);
    if (!dragged) return;

    if (nestUnder) {
      // Nest check: depth(nestUnder) + 1 ≤ 3
      const destDepth = depthOf(nestUnder, byId);
      if (destDepth >= 2) {
        showToast('Max nesting depth is 3', 'info');
        return;
      }
      dragged.parent_id = nestUnder;
    } else {
      // Find the row visually before the dragged one and inherit its parent,
      // so dragging between siblings keeps them as siblings.
      const idxInOrder = orderedIds.indexOf(draggedId);
      if (idxInOrder > 0) {
        const prevId = orderedIds[idxInOrder - 1];
        const prev = byId.get(prevId);
        dragged.parent_id = prev ? prev.parent_id : null;
      } else {
        dragged.parent_id = null;
      }
    }

    // Assign sort_order from DOM order, per (parent_id) bucket.
    const counterByParent = new Map();
    for (const id of orderedIds) {
      const node = byId.get(id);
      if (!node) continue;
      const key = node.parent_id == null ? 'root' : String(node.parent_id);
      const n = counterByParent.get(key) || 0;
      node.sort_order = n;
      counterByParent.set(key, n + 1);
    }

    const entries = Array.from(byId.values()).map(x => ({
      id: x.id,
      parent_id: x.parent_id,
      sort_order: x.sort_order,
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
