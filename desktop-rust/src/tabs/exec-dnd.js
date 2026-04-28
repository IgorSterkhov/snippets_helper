// Pointer-based DnD for the Exec tab. Pointer (not HTML5 DnD) because
// Tauri WebView2 has known HTML5 DnD issues — same reason as tasks/dnd.js.
//
// Visual model:
//   • on pointerdown on a `[data-drag-kind="cmd"]` grip we arm but don't
//     start the drag yet — we wait until the cursor moves > DRAG_THRESHOLD
//     pixels. This lets a click-without-drag open the "Move to…" popover
//     instead of accidentally starting a drag.
//   • once the threshold is crossed:
//       - clone the .exec-cmd-card into a floating ghost (position:fixed,
//         follows cursor);
//       - hide the source (display:none) and insert a real placeholder
//         element of the same height into the source's slot. The
//         placeholder is what visually moves through the list as the
//         user drags;
//       - peer cards animate to their new positions via FLIP (capture
//         their old top, do DOM reorder, then play translateY → 0). This
//         gives the user the "cards politely scoot out of the way"
//         effect rather than instant snap.
//   • drop-targets:
//       - left panel `.exec-cat-item` (≠ source's current group) →
//         mode='move-to-group', target gets a dashed accent outline;
//       - cursor inside the right panel's `.exec-cmd-list` (anywhere —
//         over a card, in the gap between cards, in empty space at the
//         end) → mode='reorder', placeholder slot moves to the projected
//         position based on cursor Y vs each peer's vertical midline;
//       - anywhere else → mode=null, placeholder hidden, source restored.
//   • on pointerup we commit via the callbacks the host passed in,
//     deriving the new id-order from where the placeholder ended up.

const DRAG_THRESHOLD_PX = 4;
const FLIP_DURATION_MS = 180;

let active = null;
// Fields while active:
//   gripEl, source, sourceCmdId, sourceGroupId, listEl
//   startX, startY, offsetX, offsetY
//   ghost            — the cursor-following clone (null until threshold)
//   placeholder      — real DOM element holding source's slot during drag
//   sourceHidden     — whether source has display:none applied
//   mode             — 'move-to-group' | 'reorder' | null
//   targetGroupEl    — highlighted .exec-cat-item (move mode)

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
    placeholder: null,
    sourceHidden: false,
    mode: null,
    targetGroupEl: null,
  };
}

function startDragVisuals(e) {
  const rect = active.source.getBoundingClientRect();

  // Floating cursor-follower clone.
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
  for (const el of ghost.querySelectorAll('input, button, textarea, select')) {
    el.disabled = true;
  }
  document.body.appendChild(ghost);
  active.ghost = ghost;
  active.offsetX = e.clientX - rect.left;
  active.offsetY = e.clientY - rect.top;

  // Build the placeholder — same dimensions as the source so it visually
  // takes the source's slot. Insert it in source's current DOM position,
  // then hide the source so the slot is "owned" by the placeholder.
  const placeholder = document.createElement('div');
  placeholder.className = 'exec-dnd-placeholder';
  placeholder.style.height = rect.height + 'px';
  active.placeholder = placeholder;
  active.source.parentElement.insertBefore(placeholder, active.source);
  active.source.style.display = 'none';
  active.sourceHidden = true;
}

function onPointerMove(e) {
  if (!active) return;

  // Below threshold = treat as a click on the grip (Move-to popover path).
  if (!active.ghost) {
    const dx = e.clientX - active.startX;
    const dy = e.clientY - active.startY;
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    startDragVisuals(e);
  }

  active.ghost.style.left = (e.clientX - active.offsetX) + 'px';
  active.ghost.style.top = (e.clientY - active.offsetY) + 'px';

  clearGroupHighlight();

  const under = document.elementFromPoint(e.clientX, e.clientY);

  // Drop on a group in the left panel?
  const groupItem = under && under.closest('.exec-cat-item');
  if (groupItem) {
    const targetGroupId = Number(groupItem.dataset.groupId);
    if (targetGroupId !== active.sourceGroupId) {
      groupItem.classList.add('exec-dnd-drop-target-group');
      active.targetGroupEl = groupItem;
      active.mode = 'move-to-group';
      hidePlaceholder();
      return;
    }
  }

  // Cursor anywhere inside the right panel's command-list bounding box
  // → reorder mode. The placeholder slot is positioned by cursor Y vs
  // each peer's vertical midline. Falling into a 6px gap between cards
  // — or empty space below the last card — used to drop us out of
  // reorder mode; now any pixel inside the list counts.
  if (active.listEl) {
    const lr = active.listEl.getBoundingClientRect();
    const insideList = e.clientX >= lr.left && e.clientX <= lr.right
                    && e.clientY >= lr.top  && e.clientY <= lr.bottom;
    if (insideList) {
      active.mode = 'reorder';
      showPlaceholder();
      updatePlaceholderPosition(e);
      return;
    }
  }

  active.mode = null;
  hidePlaceholder();
}

function showPlaceholder() {
  if (active && active.placeholder) active.placeholder.style.display = '';
}
function hidePlaceholder() {
  if (active && active.placeholder) active.placeholder.style.display = 'none';
}

function updatePlaceholderPosition(e) {
  const listEl = active.listEl;
  const ph = active.placeholder;
  if (!listEl || !ph) return;

  // Peers = visible cards (source is hidden, placeholder isn't a card).
  const peers = Array.from(listEl.querySelectorAll(':scope > .exec-cmd-card'))
    .filter(c => c !== active.source);

  // Determine the DOM node the placeholder should sit before. Iterate
  // peers; if the cursor is above a peer's vertical midline, the
  // placeholder goes before that peer. Otherwise (cursor below all
  // midlines) the placeholder goes at the end.
  const cursorY = e.clientY;
  let beforeEl = null;
  for (const peer of peers) {
    const r = peer.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (cursorY < mid) { beforeEl = peer; break; }
  }

  // Already in the right slot? Nothing to do.
  if (beforeEl === ph.nextElementSibling) return;
  if (beforeEl === null && ph === listEl.lastElementChild) return;

  // FLIP step 1: capture old positions of every peer (and the placeholder
  // itself, so its move animates too).
  const tracked = [...peers, ph];
  const oldTops = new Map();
  for (const el of tracked) {
    oldTops.set(el, el.getBoundingClientRect().top);
  }

  // Reorder: move placeholder before the target peer (or to end).
  listEl.insertBefore(ph, beforeEl);

  // FLIP step 2: for each peer that moved, set the inverse translate so
  // the browser paints it at its OLD position, then transition to
  // identity (transform:'') over FLIP_DURATION_MS so it slides into the
  // new spot.
  for (const el of tracked) {
    const oldTop = oldTops.get(el);
    const newTop = el.getBoundingClientRect().top;
    const delta = oldTop - newTop;
    if (delta === 0) continue;
    el.style.transition = 'none';
    el.style.transform = `translateY(${delta}px)`;
    // Force a reflow so the browser registers the inverse transform
    // before we kick off the transition.
    void el.offsetHeight;
    el.style.transition = `transform ${FLIP_DURATION_MS}ms ease`;
    el.style.transform = '';
  }
}

function clearGroupHighlight() {
  for (const el of document.querySelectorAll('.exec-cat-item.exec-dnd-drop-target-group')) {
    el.classList.remove('exec-dnd-drop-target-group');
  }
  if (active) active.targetGroupEl = null;
}

async function onPointerUp(e, { onMoveCommit, onReorderCommit, onMoveContextMenu }) {
  if (!active) return;

  // No ghost = never crossed the threshold = click on the grip.
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

  if (active.mode === 'reorder' && active.placeholder) {
    const listEl = active.listEl;
    if (!listEl) return;

    // Build the new id list by walking listEl.children: each peer card
    // contributes its id; the placeholder contributes the source's id;
    // the hidden source itself is skipped.
    const newIds = [];
    for (const child of listEl.children) {
      if (child === active.placeholder) {
        newIds.push(Number(active.source.dataset.cmdId));
      } else if (child === active.source) {
        // hidden source — its position is now represented by the placeholder
      } else if (child.classList && child.classList.contains('exec-cmd-card')) {
        newIds.push(Number(child.dataset.cmdId));
      }
    }
    await onReorderCommit(newIds);
    return;
  }
  // mode === null → nothing to do.
}

function cleanup() {
  if (!active) return;
  if (active.ghost && active.ghost.parentNode) active.ghost.remove();
  if (active.placeholder && active.placeholder.parentNode) active.placeholder.remove();
  if (active.source) {
    active.source.classList.remove('exec-dnd-source-dimmed');
    if (active.sourceHidden) {
      active.source.style.display = '';
    }
  }
  // Wipe any FLIP transforms left on peers.
  if (active.listEl) {
    for (const c of active.listEl.querySelectorAll(':scope > .exec-cmd-card')) {
      c.style.transition = '';
      c.style.transform = '';
    }
  }
  clearGroupHighlight();
  active = null;
}
