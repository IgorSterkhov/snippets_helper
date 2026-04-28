import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';
import { el } from './index.js';
import { renderExpandedEditor } from './editor.js';
import { CARD_BG_PALETTE } from './tasks-css.js';

// In-memory cache of checkbox lists per task, to avoid round-trip on every
// render. Populated lazily as cards render.
const checkboxCache = new Map();

export function invalidateCheckboxCache(taskId) {
  checkboxCache.delete(taskId);
}

/**
 * Render a single task card. Returns the outer DOM node.
 *   renderCard(task, {
 *     expanded: bool,
 *     state,             // global tasks state
 *     onExpandToggle,    // () => void
 *     onTaskReload,      // () => void
 *   })
 */
export function renderCard(task, ctx) {
  const card = el('div', { class: 'task-card' });
  card.dataset.taskId = String(task.id);
  if (ctx.expanded) card.classList.add('expanded');
  applyBgColor(card, task.bg_color);

  card.appendChild(buildHead(task, ctx));

  if (ctx.expanded) {
    renderExpandedEditor(card, task, ctx);
  } else {
    card.appendChild(buildCollapsedBody(task, ctx));
  }

  return card;
}

function applyBgColor(card, hex) {
  if (!hex) return;
  // Overlay a 10% tint of `hex` over --bg-secondary via linear-gradient.
  const rgba = hexToRgba(hex, 0.10);
  if (rgba) {
    card.style.background = `linear-gradient(0deg, ${rgba}, ${rgba}), var(--bg-secondary)`;
  }
}

function hexToRgba(hex, alpha) {
  if (!hex || !hex.startsWith('#')) return null;
  const h = hex.slice(1);
  let r, g, b;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else if (h.length === 6) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    return null;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildHead(task, ctx) {
  const head = el('div', { class: 'task-card-head' });
  if (ctx.expanded) head.classList.add('no-border');

  // Drag-handle
  const handle = el('span', { class: 'task-drag-handle', text: '⋮⋮', title: 'Drag to reorder / drop on Category/Status' });
  handle.dataset.dragKind = 'card';
  handle.dataset.taskId = String(task.id);
  head.appendChild(handle);

  // Title
  const title = el('span', { class: 'task-title', text: task.title || '(untitled)' });
  title.addEventListener('click', () => ctx.onExpandToggle());
  head.appendChild(title);

  // Badges (not in expanded — editor has dropdowns instead)
  if (!ctx.expanded) {
    const cat = ctx.state.categories.find(c => c.id === task.category_id);
    if (cat) head.appendChild(buildBadge(cat));
    const st = ctx.state.statuses.find(s => s.id === task.status_id);
    if (st) head.appendChild(buildBadge(st));
  }

  // Tracker button (collapsed only)
  if (!ctx.expanded && task.tracker_url) {
    const trk = document.createElement('a');
    trk.className = 'task-tracker-btn';
    trk.href = task.tracker_url;
    trk.target = '_blank';
    trk.rel = 'noopener noreferrer';
    trk.textContent = '🎫 Tracker';
    trk.title = task.tracker_url;
    trk.addEventListener('click', (e) => e.stopPropagation());
    head.appendChild(trk);
  }

  // Pin marker (collapsed only)
  if (!ctx.expanded && task.is_pinned) {
    head.appendChild(el('span', { text: '📌', style: 'font-size:12px' }));
  }

  // Expand / collapse button
  const expandBtn = document.createElement('button');
  expandBtn.className = 'task-icon-btn';
  expandBtn.title = ctx.expanded ? 'Collapse' : 'Expand';
  expandBtn.textContent = ctx.expanded ? '▲' : '▼';
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.onExpandToggle();
  });
  head.appendChild(expandBtn);

  return head;
}

function buildBadge(item) {
  const b = el('span', { class: 'task-badge' });
  const dot = el('span', { class: 'tasks-dot' });
  dot.style.background = item.color;
  b.appendChild(dot);
  b.appendChild(el('span', { text: item.name }));
  return b;
}

// ── Collapsed body (checkbox list only) ──────────────────────

function buildCollapsedBody(task, ctx) {
  const body = el('div', { class: 'task-card-body' });

  // Dynamic max-height based on setting (default 10 items × 26px).
  applyMaxHeight(body);

  const ph = el('div', { text: '…', style: 'padding:8px 12px;color:var(--text-muted);font-style:italic' });
  body.appendChild(ph);

  // Load checkboxes (cached).
  loadCheckboxes(task.id).then((items) => {
    body.innerHTML = '';
    // editable=true in collapsed mode too: inline-add + rename +
    // Tab/Shift+Tab/Enter shortcuts all work without expanding the card.
    renderCheckboxes(body, task, items, ctx, { editable: true });
  }).catch((e) => {
    body.innerHTML = '';
    body.appendChild(el('div', { text: 'Load error: ' + e, style: 'padding:8px 12px;color:var(--danger)' }));
  });

  return body;
}

async function applyMaxHeight(body) {
  let maxItems = 10;
  try {
    const s = await call('get_setting', { key: 'tasks_card_max_checkboxes' });
    if (s) maxItems = Math.max(3, parseInt(s, 10) || 10);
  } catch { /* default */ }
  // approx 26px per row.
  body.style.maxHeight = (maxItems * 26 + 12) + 'px';
}

// ── Checkbox list rendering ──────────────────────────────────

/**
 * Build a nested checkbox list into `target`. `items` is a flat array
 * (from DB); we re-nest by parent_id. Renders with optional inline edit.
 *
 *   renderCheckboxes(targetDiv, task, items, ctx, { editable: bool })
 */
export function renderCheckboxes(target, task, items, ctx, opts = {}) {
  const { editable } = opts;
  // Build tree
  const byId = new Map();
  items.forEach(it => byId.set(it.id, { ...it, children: [] }));
  const roots = [];
  for (const it of byId.values()) {
    if (it.parent_id != null && byId.has(it.parent_id)) {
      byId.get(it.parent_id).children.push(it);
    } else {
      roots.push(it);
    }
  }
  // Sort at each level
  const sortFn = (a, b) => a.sort_order - b.sort_order;
  roots.sort(sortFn);
  for (const node of byId.values()) node.children.sort(sortFn);

  function renderNode(node, depth) {
    target.appendChild(buildCheckboxRow(node, task, ctx, depth, { editable }));
    for (const c of node.children) renderNode(c, depth + 1);
  }
  for (const r of roots) renderNode(r, 0);

  // "+ Add item…" as last row
  const add = el('div', { class: 'tcb-add' });
  add.innerHTML = '<span>➕</span><span>Add item…</span>';
  add.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await call('create_task_checkbox', { taskId: task.id, parentId: null, text: '' });
      invalidateCheckboxCache(task.id);
      ctx.onTaskReload && ctx.onTaskReload();
    } catch (err) {
      showToast('Add failed: ' + err, 'error');
    }
  });
  target.appendChild(add);
}

function buildCheckboxRow(node, task, ctx, depth, { editable }) {
  const depthSafe = Math.min(3, depth);
  const row = el('div', { class: 'tcb-item depth-' + depthSafe });
  row.dataset.cbId = String(node.id);
  row.dataset.cbDepth = String(depthSafe);

  // drag handle
  const handle = el('span', { class: 'tcb-handle', text: '⋮⋮', title: 'Drag to reorder' });
  handle.dataset.dragKind = 'checkbox';
  handle.dataset.cbId = String(node.id);
  handle.dataset.taskId = String(task.id);
  row.appendChild(handle);

  // checkbox
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!node.is_checked;
  cb.addEventListener('change', async () => {
    try {
      await call('update_task_checkbox', { id: node.id, text: node.text, isChecked: cb.checked });
      invalidateCheckboxCache(task.id);
      // visual flip without full reload
      textEl.classList.toggle('checked', cb.checked);
      node.is_checked = cb.checked;
    } catch (err) {
      showToast('Update failed: ' + err, 'error');
      cb.checked = !cb.checked;
    }
  });
  row.appendChild(cb);

  // text — contenteditable <div> so long labels wrap instead of
  // scrolling horizontally (an <input type=text> doesn't wrap).
  let textEl;
  if (editable) {
    textEl = document.createElement('div');
    textEl.className = 'tcb-text';
    textEl.contentEditable = 'true';
    textEl.spellcheck = false;
    textEl.textContent = node.text;
    if (cb.checked) textEl.classList.add('checked');

    let committedText = node.text;
    const readText = () => textEl.textContent.replace(/\r/g, '');
    const commit = async () => {
      const newText = readText();
      if (newText === committedText) return;
      committedText = newText;
      try {
        await call('update_task_checkbox', { id: node.id, text: newText, isChecked: cb.checked });
        invalidateCheckboxCache(task.id);
        node.text = newText;
      } catch (err) {
        showToast('Save failed: ' + err, 'error');
      }
    };
    textEl.addEventListener('blur', commit);

    // Keyboard: Enter = new item (same parent); Tab = indent; Shift+Tab = outdent.
    textEl.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        await commit();
        try {
          const created = await call('create_task_checkbox', {
            taskId: task.id,
            parentId: node.parent_id,
            text: '',
          });
          invalidateCheckboxCache(task.id);
          ctx.onTaskReload && ctx.onTaskReload();
          // Focus new row after re-render.
          setTimeout(() => {
            const el = document.querySelector(`[data-cb-id="${created.id}"] .tcb-text[contenteditable="true"]`);
            if (el) {
              el.focus();
              // Put caret at end
              const range = document.createRange();
              range.selectNodeContents(el);
              range.collapse(false);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }, 30);
        } catch (err) {
          showToast('New item failed: ' + err, 'error');
        }
      } else if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        await commit();
        const savedId = node.id;
        await nestUnderPrev(task, node, ctx);
        // nestUnderPrev triggers ctx.onTaskReload → DOM rebuild; restore focus
        setTimeout(() => {
          const el = document.querySelector(`[data-cb-id="${savedId}"] .tcb-text[contenteditable="true"]`);
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
      } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        await commit();
        const savedId = node.id;
        await outdent(task, node, ctx);
        setTimeout(() => {
          const el = document.querySelector(`[data-cb-id="${savedId}"] .tcb-text[contenteditable="true"]`);
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
      } else if (e.key === 'Backspace' && readText() === '') {
        e.preventDefault();
        // Find fallback focus target before deletion
        const row = textEl.closest('.tcb-item');
        const container = row ? row.parentElement : null;
        let fallbackId = null;
        if (container) {
          const rows = Array.from(container.querySelectorAll(':scope > .tcb-item'));
          const idx = rows.indexOf(row);
          if (idx > 0) {
            fallbackId = Number(rows[idx - 1].dataset.cbId);
          } else if (node.parent_id != null) {
            fallbackId = node.parent_id;
          } else if (idx < rows.length - 1) {
            fallbackId = Number(rows[idx + 1].dataset.cbId);
          }
        }
        try {
          await call('delete_task_checkbox', { id: node.id });
          invalidateCheckboxCache(task.id);
          ctx.onTaskReload && ctx.onTaskReload();
          // Restore focus after DOM rebuild
          if (fallbackId != null) {
            setTimeout(() => {
              const el = document.querySelector(`[data-cb-id="${fallbackId}"] .tcb-text[contenteditable="true"]`)
                      || document.querySelector(`[data-cb-id="${fallbackId}"]`);
              if (el) {
                if (el.contentEditable === 'true') {
                  el.focus();
                  const range = document.createRange();
                  range.selectNodeContents(el);
                  range.collapse(false);
                  const sel = window.getSelection();
                  sel.removeAllRanges();
                  sel.addRange(range);
                } else {
                  el.scrollIntoView({ block: 'center' });
                }
              }
            }, 30);
          }
        } catch (err) {
          showToast('Delete failed: ' + err, 'error');
        }
      }
    });
  } else {
    textEl = el('span', { class: 'tcb-text', text: node.text });
    if (cb.checked) textEl.classList.add('checked');
  }
  row.appendChild(textEl);

  // Delete button (editable only)
  if (editable) {
    const del = document.createElement('button');
    del.className = 'tcb-delete';
    del.type = 'button';
    del.title = 'Delete';
    del.textContent = '✕';
    del.addEventListener('click', async () => {
      try {
        await call('delete_task_checkbox', { id: node.id });
        invalidateCheckboxCache(task.id);
        ctx.onTaskReload && ctx.onTaskReload();
      } catch (err) {
        showToast('Delete failed: ' + err, 'error');
      }
    });
    row.appendChild(del);
  }

  return row;
}

async function nestUnderPrev(task, node, ctx) {
  // Find previous sibling (same parent).
  const items = await loadCheckboxes(task.id, true);
  const siblings = items
    .filter(x => x.parent_id === node.parent_id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const idx = siblings.findIndex(x => x.id === node.id);
  if (idx <= 0) return; // no previous sibling
  const prev = siblings[idx - 1];
  // Compute new depth: depth(prev) + 1 must be ≤ 3.
  const depthPrev = await chainDepth(prev.id, items);
  if (depthPrev + 1 > 3) {
    showToast('Max nesting depth is 3', 'info');
    return;
  }
  try {
    await call('reorder_task_checkboxes', {
      taskId: task.id,
      entries: [{ id: node.id, parent_id: prev.id, sort_order: 9999 }],
    });
    invalidateCheckboxCache(task.id);
    ctx.onTaskReload && ctx.onTaskReload();
  } catch (err) {
    showToast('Nest failed: ' + err, 'error');
  }
}

async function outdent(task, node, ctx) {
  if (node.parent_id == null) return; // already root
  const items = await loadCheckboxes(task.id, true);
  const parent = items.find(x => x.id === node.parent_id);
  const newParent = parent ? parent.parent_id : null;
  try {
    await call('reorder_task_checkboxes', {
      taskId: task.id,
      entries: [{ id: node.id, parent_id: newParent, sort_order: 9999 }],
    });
    invalidateCheckboxCache(task.id);
    ctx.onTaskReload && ctx.onTaskReload();
  } catch (err) {
    showToast('Outdent failed: ' + err, 'error');
  }
}

async function chainDepth(id, items) {
  const byId = new Map(items.map(x => [x.id, x]));
  let depth = 0;
  let cur = id;
  while (cur != null && depth < 10) {
    const n = byId.get(cur);
    if (!n || n.parent_id == null) break;
    cur = n.parent_id;
    depth += 1;
  }
  return depth;
}

// ── Checkbox data loader ─────────────────────────────────────

async function loadCheckboxes(taskId, force = false) {
  if (!force && checkboxCache.has(taskId)) {
    return checkboxCache.get(taskId);
  }
  const items = await call('list_task_checkboxes', { taskId });
  checkboxCache.set(taskId, items);
  return items;
}

export { loadCheckboxes };
