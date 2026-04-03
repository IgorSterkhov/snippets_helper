import { call } from '../tauri-api.js';
import { createSearchBar } from '../components/search-bar.js';
import { showModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

let shortcuts = [];
let selectedIndex = -1;
let listEl = null;
let detailEl = null;
let currentQuery = '';
let fontSize = 14;
let listWidth = 260;
let descOpen = false;

export async function init(container) {
  container.innerHTML = '';
  container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden';

  // Load font size settings
  try {
    const fs = await call('get_setting', { key: 'snippets_font_size' });
    if (fs) fontSize = parseInt(fs) || 14;
    const lw = await call('get_setting', { key: 'snippets_left_width' });
    if (lw) listWidth = parseInt(lw) || 260;
  } catch {}

  // Header row: search + add button (fixed)
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--bg-secondary);flex-shrink:0';

  const searchBar = createSearchBar(onSearch);
  searchBar.style.flex = '1';
  searchBar.style.marginBottom = '0';
  header.appendChild(searchBar);

  const addBtn = document.createElement('button');
  addBtn.textContent = '+';
  addBtn.title = 'Add shortcut';
  addBtn.style.cssText = 'min-width:32px;height:32px;padding:0;font-size:18px';
  addBtn.addEventListener('click', () => openEditor(null));
  header.appendChild(addBtn);

  container.appendChild(header);

  // Two-panel layout (fills remaining space)
  const panels = document.createElement('div');
  panels.style.cssText = 'display:flex;flex:1;overflow:hidden';

  // Left panel: name list (independent scroll)
  listEl = document.createElement('div');
  listEl.style.cssText = `width:${listWidth}px;min-width:180px;overflow-y:auto;border-right:1px solid var(--border);flex-shrink:0`;

  // Right panel: detail view (fixed layout, internal scrolls)
  detailEl = document.createElement('div');
  detailEl.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';

  panels.appendChild(listEl);
  panels.appendChild(detailEl);
  container.appendChild(panels);

  // Keyboard navigation
  document.addEventListener('keydown', onKeydown);

  loadShortcuts();
}

async function onSearch(query) {
  currentQuery = query;
  selectedIndex = -1;
  await loadShortcuts();
}

async function loadShortcuts() {
  try {
    if (currentQuery.trim()) {
      shortcuts = await call('search_shortcuts', { query: currentQuery });
    } else {
      shortcuts = await call('list_shortcuts');
    }
    if (selectedIndex < 0 && shortcuts.length > 0) selectedIndex = 0;
    if (selectedIndex >= shortcuts.length) selectedIndex = shortcuts.length - 1;
    renderList();
    renderDetail();
  } catch (err) {
    showToast('Failed to load shortcuts: ' + err, 'error');
  }
}

function renderList() {
  listEl.innerHTML = '';

  if (shortcuts.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = currentQuery ? 'No matches' : 'No shortcuts yet';
    empty.style.cssText = 'text-align:center;margin-top:32px;color:var(--text-muted);font-size:13px';
    listEl.appendChild(empty);
    return;
  }

  shortcuts.forEach((shortcut, index) => {
    const item = document.createElement('div');
    item.style.cssText = `padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:${fontSize}px;transition:background 0.1s;border-left:3px solid transparent`;

    if (index === selectedIndex) {
      item.style.background = 'var(--bg-tertiary)';
      item.style.borderLeftColor = 'var(--accent)';
    } else {
      item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg-secondary)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
    }

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    nameEl.textContent = shortcut.name;
    item.appendChild(nameEl);

    item.addEventListener('click', () => {
      selectedIndex = index;
      descOpen = false;
      renderList();
      renderDetail();
    });

    listEl.appendChild(item);
  });
}

function renderDetail() {
  detailEl.innerHTML = '';

  if (selectedIndex < 0 || selectedIndex >= shortcuts.length) {
    const hint = document.createElement('p');
    hint.textContent = 'Select a snippet from the list';
    hint.style.cssText = 'color:var(--text-muted);text-align:center;margin-top:32px';
    detailEl.appendChild(hint);
    return;
  }

  const shortcut = shortcuts[selectedIndex];
  const hasDesc = shortcut.description && shortcut.description.trim();

  // Header with name + actions (fixed)
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0';

  const nameEl = document.createElement('h3');
  nameEl.style.cssText = `margin:0;font-size:${fontSize + 1}px;color:var(--text)`;
  nameEl.textContent = shortcut.name;
  header.appendChild(nameEl);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:6px';

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.style.cssText = 'padding:4px 12px;font-size:12px';
  copyBtn.addEventListener('click', () => copyToClipboard(shortcut.value));

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-secondary';
  editBtn.textContent = 'Edit';
  editBtn.style.cssText = 'padding:4px 12px;font-size:12px';
  editBtn.addEventListener('click', () => openEditor(shortcut));

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-danger';
  delBtn.textContent = 'Delete';
  delBtn.style.cssText = 'padding:4px 12px;font-size:12px';
  delBtn.addEventListener('click', () => confirmDelete(shortcut));

  actions.appendChild(copyBtn);
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  header.appendChild(actions);
  detailEl.appendChild(header);

  // Value — independent scroll, takes available space
  const valueEl = document.createElement('pre');
  valueEl.style.cssText = `flex:1;overflow-y:auto;min-height:0;font-family:'SF Mono','Fira Code','Cascadia Code',monospace;font-size:${fontSize}px;color:var(--text);padding:12px 16px;white-space:pre-wrap;word-break:break-word;margin:0`;
  valueEl.textContent = shortcut.value;
  detailEl.appendChild(valueEl);

  // Description section — collapsible, independent scroll
  const descSection = document.createElement('div');
  descSection.style.cssText = 'border-top:1px solid var(--border);flex-shrink:0';

  // Auto-open if has content when first selecting
  const showDesc = hasDesc ? descOpen || hasDesc : descOpen;

  // Toggle bar
  const toggle = document.createElement('div');
  toggle.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 16px;cursor:pointer;font-size:12px;color:var(--text-muted);user-select:none';
  toggle.addEventListener('mouseenter', () => { toggle.style.background = 'var(--bg-secondary)'; });
  toggle.addEventListener('mouseleave', () => { toggle.style.background = ''; });

  const arrow = document.createElement('span');
  arrow.textContent = '\u25B6';
  arrow.style.cssText = `font-size:10px;display:inline-block;transition:transform 0.2s;${showDesc ? 'transform:rotate(90deg)' : ''}`;

  const label = document.createElement('span');
  label.textContent = 'Description';

  const badge = document.createElement('span');
  badge.style.cssText = 'background:var(--bg-tertiary);padding:1px 6px;border-radius:8px;font-size:10px;color:var(--text-muted)';
  badge.textContent = hasDesc ? 'filled' : 'empty';
  if (!hasDesc) badge.style.opacity = '0.5';

  toggle.appendChild(arrow);
  toggle.appendChild(label);
  toggle.appendChild(badge);

  // Content — scrolls independently
  const descContent = document.createElement('div');
  descContent.style.cssText = `max-height:160px;overflow-y:auto;padding:0 16px 10px 16px;font-size:${fontSize - 1}px;color:var(--text);white-space:pre-wrap;word-break:break-word;display:${showDesc ? 'block' : 'none'}`;

  if (hasDesc) {
    descContent.textContent = shortcut.description;
  } else {
    descContent.innerHTML = '<span style="color:var(--text-muted);font-style:italic">No description. Click Edit to add one.</span>';
  }

  toggle.addEventListener('click', () => {
    descOpen = !descOpen;
    arrow.style.transform = descOpen ? 'rotate(90deg)' : '';
    descContent.style.display = descOpen ? 'block' : 'none';
  });

  descSection.appendChild(toggle);
  descSection.appendChild(descContent);
  detailEl.appendChild(descSection);
}

function onKeydown(e) {
  if (!listEl || !listEl.offsetParent) return;
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (document.querySelector('.modal-overlay')) return;
  if (activeTag === 'textarea') return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (shortcuts.length === 0) return;
    selectedIndex = Math.min(selectedIndex + 1, shortcuts.length - 1);
    descOpen = false;
    renderList();
    renderDetail();
    scrollToSelected();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (shortcuts.length === 0) return;
    selectedIndex = Math.max(selectedIndex - 1, 0);
    descOpen = false;
    renderList();
    renderDetail();
    scrollToSelected();
  } else if (e.key === 'Enter' && activeTag !== 'input') {
    e.preventDefault();
    if (selectedIndex >= 0 && selectedIndex < shortcuts.length) {
      copyAndHide(shortcuts[selectedIndex].value);
    }
  }
}

function scrollToSelected() {
  if (selectedIndex < 0 || !listEl) return;
  const items = listEl.children;
  if (items[selectedIndex]) {
    items[selectedIndex].scrollIntoView({ block: 'nearest' });
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'success');
  } catch (err) {
    showToast('Failed to copy: ' + err, 'error');
  }
}

async function copyAndHide(text) {
  try {
    await navigator.clipboard.writeText(text);
    await call('hide_and_sync');
  } catch (err) {
    showToast('Failed to copy: ' + err, 'error');
  }
}

function openEditor(shortcut) {
  const isEdit = shortcut !== null;

  const form = document.createElement('div');
  form.style.cssText = 'display:flex;flex-direction:column;gap:12px';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Name';
  nameInput.value = isEdit ? shortcut.name : '';
  form.appendChild(nameInput);

  const valueInput = document.createElement('textarea');
  valueInput.placeholder = 'Value (text to copy)';
  valueInput.rows = 6;
  valueInput.value = isEdit ? shortcut.value : '';
  form.appendChild(valueInput);

  const descInput = document.createElement('textarea');
  descInput.placeholder = 'Description (optional — documentation, notes, context)';
  descInput.rows = 3;
  descInput.value = isEdit ? shortcut.description : '';
  form.appendChild(descInput);

  showModal({
    title: isEdit ? 'Edit Shortcut' : 'New Shortcut',
    body: form,
    onConfirm: async () => {
      const name = nameInput.value.trim();
      const value = valueInput.value;
      const description = descInput.value.trim();

      if (!name) { showToast('Name is required', 'error'); return; }
      if (!value) { showToast('Value is required', 'error'); return; }

      try {
        if (isEdit) {
          await call('update_shortcut', { id: shortcut.id, name, value, description });
          showToast('Shortcut updated', 'success');
        } else {
          await call('create_shortcut', { name, value, description });
          showToast('Shortcut created', 'success');
        }
        await loadShortcuts();
      } catch (err) {
        showToast('Error: ' + err, 'error');
      }
    },
  }).catch(() => {});
}

function confirmDelete(shortcut) {
  const msg = document.createElement('p');
  msg.textContent = `Delete "${shortcut.name}"?`;

  showModal({
    title: 'Confirm Delete',
    body: msg,
    onConfirm: async () => {
      try {
        await call('delete_shortcut', { id: shortcut.id });
        showToast('Shortcut deleted', 'success');
        selectedIndex = Math.min(selectedIndex, shortcuts.length - 2);
        await loadShortcuts();
      } catch (err) {
        showToast('Error: ' + err, 'error');
      }
    },
  }).catch(() => {});
}
