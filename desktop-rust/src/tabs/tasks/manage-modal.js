import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';
import { el } from './index.js';
import { reloadAll } from './index.js';
import { CATEGORY_COLORS } from './tasks-css.js';

/**
 * Open the Manage modal for either 'category' or 'status'. Allows full CRUD
 * + color change + DnD reorder. Closes on Save/Cancel/Escape.
 */
export async function openManageModal(kind) {
  const isCat = kind === 'category';
  const listCmd    = isCat ? 'list_task_categories'   : 'list_task_statuses';
  const createCmd  = isCat ? 'create_task_category'   : 'create_task_status';
  const updateCmd  = isCat ? 'update_task_category'   : 'update_task_status';
  const deleteCmd  = isCat ? 'delete_task_category'   : 'delete_task_status';
  const reorderCmd = isCat ? 'reorder_task_categories' : 'reorder_task_statuses';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal tasks-manage-modal';

  const h3 = document.createElement('h3');
  h3.textContent = isCat ? 'Manage categories' : 'Manage statuses';
  modal.appendChild(h3);

  const body = document.createElement('div');
  body.className = 'modal-body';
  modal.appendChild(body);

  // Local editable snapshot. Rendered rows; on Save we diff and apply.
  let items = [];
  // For new items (no id yet) we keep a `_new: true` flag.
  // Track deletions separately.
  const deletedIds = new Set();

  async function load() {
    try {
      items = (await call(listCmd)).map(x => ({ ...x }));
      render();
    } catch (e) {
      showToast('Load failed: ' + e, 'error');
    }
  }

  function render() {
    body.innerHTML = '';
    for (let idx = 0; idx < items.length; idx++) {
      body.appendChild(buildRow(items[idx], idx));
    }
  }

  function buildRow(item, idx) {
    const row = document.createElement('div');
    row.className = 'tasks-manage-row';
    row.dataset.rowIdx = String(idx);

    const handle = el('span', { class: 'handle', text: '⋮⋮', title: 'Drag to reorder' });
    wireRowDrag(handle, row);
    row.appendChild(handle);

    const dot = document.createElement('span');
    dot.className = 'dot-btn';
    dot.style.background = item.color || '#8b949e';
    dot.title = 'Click to change color';
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      openColorPopover(dot, item.color, (newColor) => {
        item.color = newColor;
        dot.style.background = newColor;
      });
    });
    row.appendChild(dot);

    const nameIn = document.createElement('input');
    nameIn.type = 'text';
    nameIn.value = item.name;
    nameIn.placeholder = 'Name';
    nameIn.addEventListener('input', () => { item.name = nameIn.value; });
    row.appendChild(nameIn);

    const delBtn = document.createElement('button');
    delBtn.className = 'task-icon-btn';
    delBtn.title = 'Delete';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', () => {
      if (item.id) deletedIds.add(item.id);
      items = items.filter(x => x !== item);
      render();
    });
    row.appendChild(delBtn);

    return row;
  }

  function wireRowDrag(handle, row) {
    let startY = 0;
    let origIdx = 0;
    let dragging = false;
    let rows = [];

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      rows = Array.from(body.children);
      origIdx = rows.indexOf(row);
      row.style.opacity = '0.5';

      const onMove = (ev) => {
        if (!dragging) return;
        const y = ev.clientY;
        let newIdx = origIdx;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (r === row) continue;
          const box = r.getBoundingClientRect();
          const mid = box.top + box.height / 2;
          if (y < mid && i < newIdx) { newIdx = i; break; }
          if (y > mid && i > newIdx) newIdx = i;
        }
        if (newIdx !== origIdx) {
          const [moved] = items.splice(origIdx, 1);
          items.splice(newIdx, 0, moved);
          origIdx = newIdx;
          render();
          // Rebind to new row element
          const newRow = body.children[newIdx];
          rows = Array.from(body.children);
          row = newRow;
          row.style.opacity = '0.5';
          const newHandle = row.querySelector('.handle');
          // Re-bind by re-attaching events is unneeded — pointer capture stays on old element
        }
      };
      const onUp = () => {
        dragging = false;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        // restore opacity on all
        for (const r of body.children) r.style.opacity = '';
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  // Footer
  const footer = document.createElement('div');
  footer.className = 'tasks-manage-footer';
  const addBtn = document.createElement('button');
  addBtn.className = 'task-editor-btn';
  addBtn.textContent = isCat ? '+ Add category' : '+ Add status';
  addBtn.addEventListener('click', () => {
    const palette = CATEGORY_COLORS;
    const color = palette[items.length % palette.length];
    items.push({ id: null, name: '', color, _new: true });
    render();
    // focus last input
    setTimeout(() => {
      const rows = body.querySelectorAll('.tasks-manage-row');
      const last = rows[rows.length - 1];
      const inp = last && last.querySelector('input[type="text"]');
      if (inp) inp.focus();
    }, 30);
  });
  footer.appendChild(addBtn);

  const rightBtns = document.createElement('div');
  rightBtns.style.display = 'flex';
  rightBtns.style.gap = '6px';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'task-editor-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => close());
  rightBtns.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'task-editor-btn primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    try {
      // 1. delete removed
      for (const id of deletedIds) {
        await call(deleteCmd, { id });
      }
      // 2. create new, update existing
      const idsInOrder = [];
      for (const it of items) {
        if (!it.name.trim()) continue;
        if (it._new) {
          const created = await call(createCmd, { name: it.name.trim(), color: it.color });
          idsInOrder.push(created.id);
        } else {
          await call(updateCmd, { id: it.id, name: it.name.trim(), color: it.color });
          idsInOrder.push(it.id);
        }
      }
      // 3. reorder
      if (idsInOrder.length > 1) {
        await call(reorderCmd, { ids: idsInOrder });
      }
      close();
      await reloadAll();
      showToast('Saved', 'success');
    } catch (e) {
      showToast('Save failed: ' + e, 'error');
    }
  });
  rightBtns.appendChild(saveBtn);
  footer.appendChild(rightBtns);
  modal.appendChild(footer);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);

  await load();
}

// ── Color popover (palette + custom) ─────────────────────────

function openColorPopover(anchor, currentColor, onPick) {
  // Close any existing
  for (const p of document.querySelectorAll('.tasks-color-popover')) p.remove();

  const box = anchor.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'tasks-color-popover';
  pop.style.left = box.left + 'px';
  pop.style.top  = (box.bottom + 4) + 'px';

  for (const c of CATEGORY_COLORS) {
    const sw = document.createElement('div');
    sw.className = 'sw';
    sw.style.background = c;
    if (c === currentColor) sw.style.borderColor = 'var(--accent)';
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      onPick(c);
      pop.remove();
    });
    pop.appendChild(sw);
  }
  // Custom swatch
  const custom = document.createElement('div');
  custom.className = 'sw custom';
  custom.title = 'Pick any color';
  custom.addEventListener('click', (e) => {
    e.stopPropagation();
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = currentColor || '#8b949e';
    inp.style.position = 'fixed';
    inp.style.left = '-9999px';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      onPick(inp.value);
      inp.remove();
      pop.remove();
    });
    inp.click();
    setTimeout(() => { if (inp.parentNode) inp.remove(); }, 30000);
  });
  pop.appendChild(custom);

  document.body.appendChild(pop);
  setTimeout(() => {
    document.addEventListener('click', () => pop.remove(), { once: true });
  }, 0);
}
