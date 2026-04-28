// Pointer-based DnD for the Exec tab. Pointer (not HTML5 DnD) because
// Tauri WebView2 has known HTML5 DnD issues — same reason as tasks/dnd.js.
//
// Visual model:
//   • on pointerdown on a `[data-drag-kind="cmd"]` grip we arm but don't
//     start the drag yet — we wait until the cursor moves > DRAG_THRESHOLD
//     pixels. This lets a click-without-drag open the "Move to…" popover
//     instead of accidentally starting a drag.
//   • once the threshold is crossed: clone the .exec-cmd-card into a
//     floating ghost (position:fixed, z-index high), dim the source,
//     start watching the cursor for drop-targets;
//   • drop-targets:
//       - left panel `.exec-cat-item` (≠ source's current group) →
//         mode='move-to-group', target gets a dashed accent outline;
//       - right panel `.exec-cmd-card` (≠ source) inside the same list →
//         mode='reorder', a 2px insertion-line shows where the drop will
//         land between cards;
//       - anywhere else → mode=null, nothing highlighted.
//   • on pointerup we commit via the callbacks the host passed in.

const DRAG_THRESHOLD_PX = 4;

let active = null;
// Fields while active:
//   gripEl, source, sourceCmdId, sourceGroupId, listEl
//   startX, startY, offsetX, offsetY
//   ghost            — the clone (null until threshold crossed)
//   line             — insertion-line element (only in reorder mode)
//   mode             — 'move-to-group' | 'reorder' | null
//   targetGroupEl    — highlighted .exec-cat-item (move mode)
//   insertBefore     — DOM node the insertion-line sits before (reorder)

export function installExecDnd(rootEl, {
  onMoveCommit,         // async (cmdId, targetGroupId) => void
  onReorderCommit,      // async (idsInOrder) => void
  onMoveContextMenu,    // (cmdId, anchorEl) => void   (click without drag)
}) {
  rootEl.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('[data-drag-kind="cmd"]');
    if (!grip) return;
    if (e.button !== 0) return;

    const source = grip.closest('.exec-cmd-card');
    if (!source) return;

    e.preventDefault();
    armDrag(grip, source, e);

    const onMove = (ev) => onPointerMove(ev);
    const onUp = async (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      try {
        await onPointerUp(ev, { onMoveCommit, onReorderCommit, onMoveContextMenu });
      } finally {
        cleanup();
      }
    };
    const onCancel = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      cleanup();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  });
}

function armDrag(gripEl, source, e) {
  const sourceCmdId = Number(gripEl.dataset.cmdId);
  const sourceGroupItem = document.querySelector('.exec-cat-item.active');
  const sourceGroupId = sourceGroupItem ? Number(sourceGroupItem.dataset.groupId) : null;
  const listEl = source.closest('.exec-cmd-list') || source.parentElement;

  active = {
    gripEl, source, sourceCmdId, sourceGroupId, listEl,
    startX: e.clientX, startY: e.clientY,
    offsetX: 0, offsetY: 0,
    ghost: null,
    line: null,
    mode: null,
    targetGroupEl: null,
    insertBefore: null,
  };
}

function startDragVisuals(e) {
  const rect = active.source.getBoundingClientRect();
  const ghost = active.source.cloneNode(true);
  ghost.classList.add('exec-dnd-drag-clone');
  ghost.style.position = 'fixed';
  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';
  ghost.style.width = rect.width + 'px';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '10000';
  ghost.style.opacity = '0.85';
  ghost.style.boxShadow = '0 8px 24px rgba(0,0,0,0.45)';
  // Disable any interactive widgets in the clone.
  for (const el of ghost.querySelectorAll('input, button, textarea, select')) {
    el.disabled = true;
  }
  document.body.appendChild(ghost);

  active.source.classList.add('exec-dnd-source-dimmed');
  active.ghost = ghost;
  // Anchor the cursor relative to top-left of the source.
  active.offsetX = e.clientX - rect.left;
  active.offsetY = e.clientY - rect.top;
}

function onPointerMove(e) {
  if (!active) return;
  // Have we crossed the threshold yet? If not, do nothing — a small jiggle
  // before pointerup is treated as a click.
  if (!active.ghost) {
    const dx = e.clientX - active.startX;
    const dy = e.clientY - active.startY;
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    startDragVisuals(e);
  }

  // Float the ghost.
  active.ghost.style.left = (e.clientX - active.offsetX) + 'px';
  active.ghost.style.top = (e.clientY - active.offsetY) + 'px';

  clearGroupHighlight();

  const under = document.elementFromPoint(e.clientX, e.clientY);

  // Drop on a group in the left panel?
  const groupItem = under && under.closest('.exec-cat-item');
  if (groupItem) {
    const targetGroupId = Number(groupItem.dataset.groupId);
    // Don't highlight the current group as a valid drop target — moving
    // a command "to its own group" is a no-op.
    if (targetGroupId !== active.sourceGroupId) {
      groupItem.classList.add('exec-dnd-drop-target-group');
      active.targetGroupEl = groupItem;
      active.mode = 'move-to-group';
      hideInsertionLine();
      return;
    }
  }

  // Drop on a card in the right panel?
  if (under && active.listEl && active.listEl.contains(under)) {
    const peer = under.closest('.exec-cmd-card');
    if (peer && peer !== active.source) {
      active.mode = 'reorder';
      updateInsertionLine(e);
      return;
    }
  }

  // No target.
  active.mode = null;
  hideInsertionLine();
}

function updateInsertionLine(e) {
  const listEl = active.listEl;
  if (!listEl) return;
  const peers = Array.from(listEl.querySelectorAll(':scope > .exec-cmd-card'))
    .filter(el => el !== active.source);
  if (peers.length === 0) {
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

function placeLine(listEl, beforeEl) {
  if (!active.line) {
    const line = document.createElement('div');
    line.className = 'exec-dnd-insertion-line';
    active.line = line;
  }
  const line = active.line;
  if (line.parentElement !== listEl || line.nextSibling !== beforeEl) {
    listEl.insertBefore(line, beforeEl || null);
  }
  line.style.display = '';
}

function hideInsertionLine() {
  if (active && active.line) active.line.style.display = 'none';
  if (active) active.insertBefore = null;
}

function clearGroupHighlight() {
  for (const el of document.querySelectorAll('.exec-cat-item.exec-dnd-drop-target-group')) {
    el.classList.remove('exec-dnd-drop-target-group');
  }
  if (active) active.targetGroupEl = null;
}

async function onPointerUp(e, { onMoveCommit, onReorderCommit, onMoveContextMenu }) {
  if (!active) return;

  // No ghost = never crossed the threshold = it was a click on the grip.
  if (!active.ghost) {
    if (typeof onMoveContextMenu === 'function') {
      onMoveContextMenu(active.sourceCmdId, active.gripEl);
    }
    return;
  }

  if (active.mode === 'move-to-group' && active.targetGroupEl) {
    const targetGroupId = Number(active.targetGroupEl.dataset.groupId);
    await onMoveCommit(active.sourceCmdId, targetGroupId);
    return;
  }

  if (active.mode === 'reorder') {
    // Build the new id-order from DOM state at drop-time. The line's
    // position tells us where the source belongs.
    const listEl = active.listEl;
    if (!listEl) return;
    const peers = Array.from(listEl.querySelectorAll(':scope > .exec-cmd-card'));
    const sourceIdx = peers.indexOf(active.source);
    if (sourceIdx === -1) return;
    let targetIdx;
    if (active.insertBefore) {
      targetIdx = peers.indexOf(active.insertBefore);
      // Removing source first shifts indices for items after it.
      if (sourceIdx < targetIdx) targetIdx--;
    } else {
      targetIdx = peers.length - 1; // drop at end (after removing source)
    }
    if (targetIdx === sourceIdx) return; // no-op
    const newOrder = peers.filter(p => p !== active.source);
    newOrder.splice(targetIdx, 0, active.source);
    const ids = newOrder.map(c => Number(c.dataset.cmdId));
    await onReorderCommit(ids);
    return;
  }
  // mode === null → nothing to do.
}

function cleanup() {
  if (!active) return;
  if (active.ghost && active.ghost.parentNode) active.ghost.remove();
  if (active.line && active.line.parentNode) active.line.remove();
  if (active.source) active.source.classList.remove('exec-dnd-source-dimmed');
  clearGroupHighlight();
  active = null;
}
