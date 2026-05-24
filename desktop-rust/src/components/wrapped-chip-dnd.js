const DRAG_START_PX = 5;
const ROW_TOLERANCE_PX = 8;

const installs = new WeakMap();

export function installWrappedChipDnd(container, {
  chipSelector,
  datasetKey,
  placeholderClass = 'wrapped-chip-dnd-placeholder',
  sourceClass = 'wrapped-chip-dnd-source',
  onReorder,
}) {
  if (!container || !chipSelector || !datasetKey) return;

  const previous = installs.get(container);
  if (previous) previous();

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    const source = event.target.closest(chipSelector);
    if (!source || !container.contains(source)) return;
    startAfterThreshold(container, source, event, {
      chipSelector,
      datasetKey,
      placeholderClass,
      sourceClass,
      onReorder,
    });
  };

  container.addEventListener('pointerdown', onPointerDown);
  installs.set(container, () => container.removeEventListener('pointerdown', onPointerDown));
}

function startAfterThreshold(container, source, startEvent, opts) {
  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  let active = null;

  const onMove = (event) => {
    if (!active) {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.hypot(dx, dy) < DRAG_START_PX) return;
      event.preventDefault();
      active = startDrag(container, source, startEvent, opts);
      if (!active) return;
      source.dataset.dragSuppressClick = '1';
    }
    updateDrag(active, event);
  };

  const onUp = async (event) => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    if (!active) return;
    event.preventDefault();
    try {
      await finishDrag(active);
    } finally {
      cleanup(active);
      setTimeout(() => {
        if (source.dataset.dragSuppressClick === '1') delete source.dataset.dragSuppressClick;
      }, 350);
    }
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function startDrag(container, source, event, opts) {
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true);
  ghost.classList.add('wrapped-chip-dnd-ghost');
  ghost.style.position = 'fixed';
  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';
  ghost.style.width = rect.width + 'px';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '10000';
  ghost.style.opacity = '0.92';
  ghost.style.transform = 'rotate(-0.7deg)';
  ghost.style.boxShadow = '0 14px 28px rgba(0,0,0,0.5)';
  for (const el of ghost.querySelectorAll('input, button, textarea, select')) {
    el.disabled = true;
  }
  document.body.appendChild(ghost);

  const placeholder = document.createElement('div');
  placeholder.className = opts.placeholderClass;
  placeholder.style.height = rect.height + 'px';
  placeholder.style.width = rect.width + 'px';
  source.parentElement.insertBefore(placeholder, source);
  source.classList.add(opts.sourceClass);
  source.style.display = 'none';

  return {
    container,
    source,
    ghost,
    placeholder,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    mode: 'reorder',
    ...opts,
  };
}

function updateDrag(active, event) {
  active.ghost.style.left = (event.clientX - active.offsetX) + 'px';
  active.ghost.style.top = (event.clientY - active.offsetY) + 'px';

  const rect = active.container.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom;
  active.mode = inside ? 'reorder' : null;
  active.placeholder.style.display = inside ? '' : 'none';
  if (inside) updatePlaceholder(active, event);
}

function updatePlaceholder(active, event) {
  const peers = Array.from(active.container.querySelectorAll(`:scope > ${active.chipSelector}`))
    .filter(el => el !== active.source);

  let beforeEl = null;
  if (peers.length > 0) {
    const rows = [];
    for (const peer of peers) {
      const rect = peer.getBoundingClientRect();
      let row = rows.find(r => Math.abs(r.top - rect.top) <= ROW_TOLERANCE_PX);
      if (!row) {
        row = { top: rect.top, bottom: rect.bottom, items: [] };
        rows.push(row);
      }
      row.top = Math.min(row.top, rect.top);
      row.bottom = Math.max(row.bottom, rect.bottom);
      row.items.push({ el: peer, rect });
    }
    rows.sort((a, b) => a.top - b.top);
    rows.forEach(row => row.items.sort((a, b) => a.rect.left - b.rect.left));

    const targetRow = rows.find(row => event.clientY <= row.bottom + ROW_TOLERANCE_PX);
    if (targetRow) {
      const beforeInRow = targetRow.items.find(({ rect }) => event.clientX < rect.left + rect.width / 2);
      if (beforeInRow) {
        beforeEl = beforeInRow.el;
      } else {
        const rowLast = targetRow.items[targetRow.items.length - 1].el;
        const rowLastIndex = peers.indexOf(rowLast);
        beforeEl = peers[rowLastIndex + 1] || null;
      }
    }
  }

  if (beforeEl === nextSiblingExcept(active.placeholder, active.source)) return;
  if (beforeEl === null && nextSiblingExcept(active.placeholder, active.source) === null) return;

  const tracked = [...peers, active.placeholder];
  const oldRects = new Map();
  for (const el of tracked) {
    const rect = el.getBoundingClientRect();
    oldRects.set(el, { left: rect.left, top: rect.top });
  }

  active.container.insertBefore(active.placeholder, beforeEl);

  for (const el of tracked) {
    const oldRect = oldRects.get(el);
    const newRect = el.getBoundingClientRect();
    const dx = oldRect.left - newRect.left;
    const dy = oldRect.top - newRect.top;
    if (dx === 0 && dy === 0) continue;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    void el.offsetHeight;
    el.style.transition = 'transform 180ms ease';
    el.style.transform = '';
  }
}

async function finishDrag(active) {
  if (active.mode !== 'reorder') return;
  active.container.insertBefore(active.source, active.placeholder);
  active.placeholder.remove();
  active.placeholder = null;
  active.source.style.display = '';

  const ids = Array.from(active.container.querySelectorAll(`:scope > ${active.chipSelector}`))
    .map(chip => Number(chip.dataset[active.datasetKey]))
    .filter(Number.isFinite);
  if (ids.length >= 2 && typeof active.onReorder === 'function') {
    await active.onReorder(ids);
  }
}

function cleanup(active) {
  if (active.ghost?.parentNode) active.ghost.remove();
  if (active.placeholder?.parentNode) {
    active.placeholder.parentNode.insertBefore(active.source, active.placeholder);
    active.placeholder.remove();
  }
  if (active.source) {
    active.source.classList.remove(active.sourceClass);
    active.source.style.display = '';
  }
  for (const el of active.container.querySelectorAll(`:scope > ${active.chipSelector}`)) {
    el.style.transition = '';
    el.style.transform = '';
  }
}

function nextSiblingExcept(el, except) {
  let next = el ? el.nextElementSibling : null;
  while (next && next === except) next = next.nextElementSibling;
  return next;
}
