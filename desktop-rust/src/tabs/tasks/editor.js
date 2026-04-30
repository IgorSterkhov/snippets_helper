import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';
import { showModal } from '../../components/modal.js';
import { attachToolbar } from '../../components/md-toolbar.js';
import { el } from './index.js';
import { CARD_BG_PALETTE } from './tasks-css.js';
import { renderCheckboxes, loadCheckboxes, invalidateCheckboxCache } from './card.js';

// Per-session last-used copy mode: 'all' | 'unchecked' | 'checked'
let copyMode = 'all';

const COPY_MODES = [
  { id: 'all',       label: 'all',       icon: '📋', descr: 'Copy all' },
  { id: 'unchecked', label: '☐ undone',  icon: '☐',  descr: 'Copy unchecked' },
  { id: 'checked',   label: '☑ done',    icon: '☑',  descr: 'Copy checked' },
];

/**
 * Render the expanded editor body into `card` (after its head). All fields
 * save on blur / change; Delete button destroys the task; expand toggle
 * closes the editor.
 */
export function renderExpandedEditor(card, task, ctx) {
  const body = el('div', { class: 'task-editor-body' });

  // Title input
  const titleIn = document.createElement('input');
  titleIn.className = 'task-editor-title';
  titleIn.value = task.title || '';
  titleIn.placeholder = 'Task title';
  titleIn.addEventListener('blur', () => saveField('title', titleIn.value, task, ctx));
  body.appendChild(titleIn);

  // Category / Status / Pin row
  const metaRow = el('div', { class: 'task-editor-row' });

  metaRow.appendChild(el('span', { class: 'task-editor-label', text: 'Category' }));
  metaRow.appendChild(buildMetaDropdown('category', task, ctx));

  metaRow.appendChild(el('span', { class: 'task-editor-label', text: 'Status' }));
  metaRow.appendChild(buildMetaDropdown('status', task, ctx));

  const pinBtn = document.createElement('button');
  pinBtn.className = 'task-editor-btn';
  pinBtn.textContent = task.is_pinned ? '📌 Pinned' : '📍 Pin';
  pinBtn.addEventListener('click', async () => {
    const newVal = !task.is_pinned;
    await saveField('is_pinned', newVal, task, ctx);
    pinBtn.textContent = newVal ? '📌 Pinned' : '📍 Pin';
  });
  metaRow.appendChild(pinBtn);

  body.appendChild(metaRow);

  // Tracker URL row
  const trackerRow = el('div', { class: 'task-editor-row' });
  trackerRow.appendChild(el('span', { class: 'task-editor-label', text: 'Tracker' }));
  const trackerIn = document.createElement('input');
  trackerIn.className = 'task-editor-input';
  trackerIn.placeholder = 'https://youtrack.example.com/issue/T-123';
  trackerIn.value = task.tracker_url || '';
  trackerIn.addEventListener('blur', () => saveField('tracker_url', trackerIn.value || null, task, ctx));
  trackerRow.appendChild(trackerIn);
  const openTrkBtn = document.createElement('button');
  openTrkBtn.className = 'task-editor-btn';
  openTrkBtn.textContent = '🎫 Open';
  openTrkBtn.addEventListener('click', () => {
    if (trackerIn.value) window.open(trackerIn.value, '_blank', 'noopener');
  });
  trackerRow.appendChild(openTrkBtn);
  body.appendChild(trackerRow);

  // Links row
  const linksRow = el('div', { class: 'task-editor-row top' });
  linksRow.appendChild(el('span', { class: 'task-editor-label', text: 'Links', style: 'padding-top:6px;min-width:80px' }));
  const linksArea = el('div', { class: 'task-editor-links' });
  linksRow.appendChild(linksArea);
  body.appendChild(linksRow);
  loadAndRenderLinks(linksArea, task);

  // Color palette
  const colorRow = el('div', { class: 'task-editor-row' });
  colorRow.appendChild(el('span', { class: 'task-editor-label', text: 'Color' }));
  const palette = el('div', { class: 'task-editor-palette' });
  // Clear swatch
  const clearSw = el('div', { class: 'task-editor-swatch clear', title: 'Default' });
  if (!task.bg_color) clearSw.classList.add('selected');
  clearSw.addEventListener('click', async () => {
    await saveField('bg_color', null, task, ctx);
    ctx.onTaskReload && ctx.onTaskReload();
  });
  palette.appendChild(clearSw);
  for (const c of CARD_BG_PALETTE.slice(1)) {
    const sw = document.createElement('div');
    sw.className = 'task-editor-swatch';
    sw.style.background = c.value;
    sw.title = c.name;
    if (task.bg_color === c.value) sw.classList.add('selected');
    sw.addEventListener('click', async () => {
      await saveField('bg_color', c.value, task, ctx);
      ctx.onTaskReload && ctx.onTaskReload();
    });
    palette.appendChild(sw);
  }
  // Custom
  const customSw = el('div', { class: 'task-editor-swatch custom', title: 'Custom…' });
  customSw.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = task.bg_color || '#161b22';
    inp.style.position = 'fixed';
    inp.style.left = '-9999px';
    document.body.appendChild(inp);
    inp.addEventListener('change', async () => {
      await saveField('bg_color', inp.value, task, ctx);
      inp.remove();
      ctx.onTaskReload && ctx.onTaskReload();
    });
    inp.click();
    setTimeout(() => { if (inp.parentNode) inp.remove(); }, 30000);
  });
  palette.appendChild(customSw);
  colorRow.appendChild(palette);
  body.appendChild(colorRow);

  // Checkboxes (editable)
  const cbHeader = el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px' });
  const cbLabel = el('div', { class: 'task-editor-label', text: 'Checkboxes' });
  cbHeader.appendChild(cbLabel);

  // Copy-to-markdown split button
  cbHeader.appendChild(buildCopyMdButton(task));

  body.appendChild(cbHeader);
  const cbArea = el('div', { class: 'task-editor-cb-area' });
  body.appendChild(cbArea);

  (async () => {
    try {
      const items = await loadCheckboxes(task.id);
      cbArea.innerHTML = '';
      renderCheckboxes(cbArea, task, items, ctx, { editable: true });
    } catch (err) {
      cbArea.textContent = 'Load error: ' + err;
    }
  })();

  // Notes (Markdown)
  const notesLabel = el('div', { class: 'task-editor-label', text: 'Notes', style: 'margin-bottom:4px' });
  body.appendChild(notesLabel);
  const notesWrap = el('div', { class: 'task-editor-notes-toolbar-wrap' });
  const notesTa = document.createElement('textarea');
  notesTa.className = 'task-editor-notes';
  notesTa.value = task.notes_md || '';
  notesTa.placeholder = 'Markdown supported.';
  notesWrap.appendChild(notesTa);
  body.appendChild(notesWrap);
  attachToolbar(notesTa);
  notesTa.addEventListener('blur', () => saveField('notes_md', notesTa.value, task, ctx));

  // Actions
  const actions = el('div', { class: 'task-editor-actions' });
  const delBtn = document.createElement('button');
  delBtn.className = 'task-editor-btn danger';
  delBtn.textContent = 'Delete task';
  delBtn.addEventListener('click', () => onDeleteTask(task, ctx));
  actions.appendChild(delBtn);

  actions.appendChild(el('div', { class: 'spacer' }));

  const closeBtn = document.createElement('button');
  closeBtn.className = 'task-editor-btn';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => ctx.onExpandToggle());
  actions.appendChild(closeBtn);

  body.appendChild(actions);

  card.appendChild(body);
}

// ── Meta dropdown (category / status inside expanded card) ───

function buildMetaDropdown(kind, task, ctx) {
  const items = kind === 'category' ? ctx.state.categories : ctx.state.statuses;
  const curId = kind === 'category' ? task.category_id : task.status_id;

  const dd = el('div', { class: 'tasks-dropdown' });
  const cur = items.find(x => x.id === curId);
  if (cur) {
    const dot = el('span', { class: 'tasks-dot' });
    dot.style.background = cur.color;
    dd.appendChild(dot);
    dd.appendChild(el('span', { text: cur.name }));
  } else {
    dd.appendChild(el('span', { text: '—', style: 'color:var(--text-muted);font-style:italic' }));
  }
  dd.appendChild(el('span', { class: 'tasks-dropdown-chevron', text: '▾' }));

  dd.addEventListener('click', (e) => {
    e.stopPropagation();
    // close any existing menu
    for (const m of document.querySelectorAll('.tasks-dropdown-menu')) m.remove();
    const menu = document.createElement('div');
    menu.className = 'tasks-dropdown-menu';
    // "None" item
    const noneItem = buildItem('—', null, curId == null, async () => {
      const field = kind === 'category' ? 'category_id' : 'status_id';
      await saveField(field, null, task, ctx);
      ctx.onTaskReload && ctx.onTaskReload();
    });
    menu.appendChild(noneItem);
    for (const it of items) {
      const item = buildItem(it.name, it.color, String(it.id) === String(curId), async () => {
        const field = kind === 'category' ? 'category_id' : 'status_id';
        await saveField(field, it.id, task, ctx);
        ctx.onTaskReload && ctx.onTaskReload();
      });
      menu.appendChild(item);
    }
    dd.appendChild(menu);

    const close = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  });

  return dd;
}

function buildItem(text, color, selected, onClick) {
  const item = document.createElement('div');
  item.className = 'tasks-dropdown-item';
  if (selected) item.classList.add('selected');
  if (color) {
    const dot = el('span', { class: 'tasks-dot' });
    dot.style.background = color;
    item.appendChild(dot);
  } else {
    item.appendChild(el('span', { text: '—', style: 'width:10px;color:var(--text-muted)' }));
  }
  item.appendChild(el('span', { text }));
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
    for (const m of document.querySelectorAll('.tasks-dropdown-menu')) m.remove();
  });
  return item;
}

// ── Links editor (expanded only) ─────────────────────────────

async function loadAndRenderLinks(area, task) {
  area.innerHTML = '';
  const ph = el('div', { text: 'Loading…', style: 'color:var(--text-muted);font-style:italic;padding:4px 0' });
  area.appendChild(ph);

  let links = [];
  try {
    links = await call('list_task_links', { taskId: task.id });
  } catch (e) {
    area.innerHTML = '';
    area.appendChild(el('div', { text: 'Load error: ' + e, style: 'color:var(--danger)' }));
    return;
  }

  area.innerHTML = '';
  for (const link of links) {
    area.appendChild(buildLinkRow(link, task, () => loadAndRenderLinks(area, task)));
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'task-editor-btn';
  addBtn.textContent = '+ Add link';
  addBtn.style.alignSelf = 'flex-start';
  addBtn.addEventListener('click', async () => {
    try {
      await call('create_task_link', { taskId: task.id, url: '', label: null });
      loadAndRenderLinks(area, task);
    } catch (e) {
      showToast('Add failed: ' + e, 'error');
    }
  });
  area.appendChild(addBtn);
}

function buildLinkRow(link, task, onReload) {
  const row = el('div', { class: 'task-editor-link-row' });

  row.appendChild(el('span', { class: 'task-drag-handle', text: '⋮⋮' }));

  const urlIn = document.createElement('input');
  urlIn.type = 'text';
  urlIn.className = 'task-editor-input url-in';
  urlIn.placeholder = 'https://…';
  urlIn.value = link.url || '';
  urlIn.addEventListener('blur', async () => {
    try {
      await call('update_task_link', {
        id: link.id, url: urlIn.value, label: labelIn.value || null,
      });
    } catch (e) {
      showToast('Save failed: ' + e, 'error');
    }
  });
  row.appendChild(urlIn);

  const labelIn = document.createElement('input');
  labelIn.type = 'text';
  labelIn.className = 'task-editor-input label-in';
  labelIn.placeholder = '(label — optional)';
  labelIn.value = link.label || '';
  labelIn.addEventListener('blur', async () => {
    try {
      await call('update_task_link', {
        id: link.id, url: urlIn.value, label: labelIn.value || null,
      });
    } catch (e) {
      showToast('Save failed: ' + e, 'error');
    }
  });
  row.appendChild(labelIn);

  const openBtn = document.createElement('button');
  openBtn.className = 'task-icon-btn';
  openBtn.title = 'Open';
  openBtn.textContent = '↗';
  openBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (urlIn.value) window.open(urlIn.value, '_blank', 'noopener');
  });
  row.appendChild(openBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'task-icon-btn';
  delBtn.title = 'Delete';
  delBtn.textContent = '🗑';
  delBtn.addEventListener('click', async () => {
    try {
      await call('delete_task_link', { id: link.id });
      onReload();
    } catch (e) {
      showToast('Delete failed: ' + e, 'error');
    }
  });
  row.appendChild(delBtn);

  return row;
}

// ── Task-field update helper ─────────────────────────────────

function buildCopyMdButton(task) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;border:1px solid var(--border);border-radius:4px;overflow:hidden';

  // Main copy button
  const btn = document.createElement('button');
  btn.className = 'task-editor-btn';
  btn.style.cssText = 'border:none;border-right:1px solid var(--border);border-radius:0;padding:2px 8px;font-size:11px;white-space:nowrap';
  btn.textContent = '📋 Copy';
  btn.title = `Copy checkboxes as markdown (${copyMode})`;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await copyCheckboxesAsMd(task);
  });
  wrap.appendChild(btn);

  // Mode display + dropdown toggle
  const mode = COPY_MODES.find(m => m.id === copyMode) || COPY_MODES[0];
  const modeBtn = document.createElement('button');
  modeBtn.className = 'task-editor-btn';
  modeBtn.style.cssText = 'border:none;border-radius:0;padding:2px 6px;font-size:10px;color:var(--accent);display:flex;align-items:center;gap:2px;white-space:nowrap';
  modeBtn.innerHTML = `<span class="copy-mode-label">${mode.label}</span><span style="font-size:8px">▾</span>`;
  modeBtn.title = 'Select copy mode';
  modeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close any existing popover
    for (const p of document.querySelectorAll('.copy-mode-popover')) p.remove();
    if (modeBtn.querySelector('.copy-mode-popover')) return;

    const menu = document.createElement('div');
    menu.className = 'copy-mode-popover';
    menu.style.cssText = 'position:absolute;background:var(--bg-primary);border:1px solid var(--border);border-radius:6px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,0.5);z-index:200;min-width:180px';
    const rect = modeBtn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = (rect.right - 180) + 'px';

    for (const m of COPY_MODES) {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:3px;cursor:pointer;font-size:11px;white-space:nowrap';
      if (m.id === copyMode) {
        item.style.color = 'var(--accent)';
        item.innerHTML = `<span style="font-size:10px">●</span> ${m.icon} ${m.descr}`;
      } else {
        item.style.color = 'var(--text)';
        item.innerHTML = `<span style="visibility:hidden;font-size:10px">●</span> ${m.icon} ${m.descr}`;
      }
      item.addEventListener('click', async () => {
        copyMode = m.id;
        modeBtn.querySelector('.copy-mode-label').textContent = m.label;
        btn.title = `Copy checkboxes as markdown (${copyMode})`;
        menu.remove();
      });
      menu.appendChild(item);
    }
    modeBtn.appendChild(menu);
    // Close on outside click
    setTimeout(() => {
      const close = (ev) => {
        if (!menu.contains(ev.target) && ev.target !== modeBtn) {
          menu.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  });
  wrap.appendChild(modeBtn);

  return wrap;
}

async function copyCheckboxesAsMd(task) {
  try {
    const items = await loadCheckboxes(task.id, true);
    // Build tree, flatten in order, filter by mode
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
    const sortFn = (a, b) => a.sort_order - b.sort_order;
    roots.sort(sortFn);
    for (const node of byId.values()) node.children.sort(sortFn);

    const flat = [];
    (function walk(nodes, depth) {
      for (const n of nodes) {
        flat.push({ text: n.text, checked: n.is_checked, depth });
        walk(n.children, depth + 1);
      }
    })(roots, 0);

    let filtered;
    if (copyMode === 'checked') {
      filtered = flat.filter(x => x.checked);
    } else if (copyMode === 'unchecked') {
      filtered = flat.filter(x => !x.checked);
    } else {
      filtered = flat;
    }

    if (filtered.length === 0) {
      showToast('Nothing to copy', 'info');
      return;
    }

    const md = filtered.map(x => {
      const indent = '  '.repeat(Math.min(3, x.depth));
      const mark = x.checked ? '[x]' : '[ ]';
      return `${indent}- ${mark} ${x.text}`;
    }).join('\n');

    await navigator.clipboard.writeText(md);
    showToast(`Copied ${filtered.length} item(s)`, 'success');
  } catch (err) {
    showToast('Copy failed: ' + err, 'error');
  }
}

async function saveField(field, value, task, ctx) {
  task[field] = value;
  try {
    await call('update_task', {
      id: task.id,
      title: task.title || '',
      categoryId: task.category_id,
      statusId: task.status_id,
      isPinned: !!task.is_pinned,
      bgColor: task.bg_color,
      trackerUrl: task.tracker_url,
      notesMd: task.notes_md || '',
    });
  } catch (e) {
    showToast('Save failed: ' + e, 'error');
  }
}

async function onDeleteTask(task, ctx) {
  try {
    await showModal({
      title: 'Delete task',
      body: `Delete "${task.title || '(untitled)'}"?`,
      onConfirm: async () => {
        await call('delete_task', { id: task.id });
        invalidateCheckboxCache(task.id);
      },
    });
    showToast('Task deleted', 'success');
    ctx.onTaskReload && ctx.onTaskReload();
  } catch { /* cancelled */ }
}

export { saveField };
