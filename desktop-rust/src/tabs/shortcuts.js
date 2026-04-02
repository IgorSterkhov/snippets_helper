import { call } from '../tauri-api.js';
import { createSearchBar } from '../components/search-bar.js';
import { showModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

let shortcuts = [];
let selectedIndex = -1;
let listEl = null;
let currentQuery = '';

export function init(container) {
  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.height = '100%';

  // Header row: search + add button
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.gap = '8px';
  header.style.alignItems = 'flex-start';
  header.style.marginBottom = '4px';

  const searchBar = createSearchBar(onSearch);
  searchBar.style.flex = '1';
  searchBar.style.marginBottom = '0';
  header.appendChild(searchBar);

  const addBtn = document.createElement('button');
  addBtn.textContent = '+';
  addBtn.title = 'Add shortcut';
  addBtn.style.minWidth = '36px';
  addBtn.style.height = '36px';
  addBtn.style.padding = '0';
  addBtn.style.fontSize = '18px';
  addBtn.addEventListener('click', () => openEditor(null));
  header.appendChild(addBtn);

  container.appendChild(header);

  // List
  listEl = document.createElement('div');
  listEl.className = 'shortcuts-list';
  listEl.style.flex = '1';
  listEl.style.overflowY = 'auto';
  container.appendChild(listEl);

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
    renderList();
  } catch (err) {
    showToast('Failed to load shortcuts: ' + err, 'error');
  }
}

function renderList() {
  listEl.innerHTML = '';

  if (shortcuts.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = currentQuery ? 'No shortcuts found' : 'No shortcuts yet. Click + to add one.';
    empty.style.textAlign = 'center';
    empty.style.marginTop = '32px';
    listEl.appendChild(empty);
    return;
  }

  shortcuts.forEach((shortcut, index) => {
    const card = document.createElement('div');
    card.className = 'list-item';
    if (index === selectedIndex) {
      card.style.borderLeftColor = 'var(--accent)';
      card.style.background = 'var(--bg-tertiary)';
    }

    // Content area
    const content = document.createElement('div');
    content.style.flex = '1';
    content.style.minWidth = '0';

    const nameEl = document.createElement('div');
    nameEl.style.fontWeight = '600';
    nameEl.style.marginBottom = '2px';
    nameEl.textContent = shortcut.name;
    content.appendChild(nameEl);

    const valueEl = document.createElement('div');
    valueEl.style.fontFamily = 'monospace';
    valueEl.style.fontSize = '12px';
    valueEl.style.color = 'var(--text-muted)';
    valueEl.style.whiteSpace = 'nowrap';
    valueEl.style.overflow = 'hidden';
    valueEl.style.textOverflow = 'ellipsis';
    valueEl.textContent = shortcut.value;
    content.appendChild(valueEl);

    if (shortcut.description) {
      const descEl = document.createElement('div');
      descEl.style.fontSize = '12px';
      descEl.style.color = 'var(--text-muted)';
      descEl.style.marginTop = '2px';
      descEl.textContent = shortcut.description;
      content.appendChild(descEl);
    }

    // Actions
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '4px';
    actions.style.alignItems = 'center';
    actions.style.marginLeft = '8px';
    actions.style.flexShrink = '0';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-secondary';
    editBtn.textContent = '\u270E';
    editBtn.title = 'Edit';
    editBtn.style.padding = '4px 8px';
    editBtn.style.fontSize = '12px';
    editBtn.style.minWidth = 'auto';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditor(shortcut);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.textContent = '\u2716';
    delBtn.title = 'Delete';
    delBtn.style.padding = '4px 8px';
    delBtn.style.fontSize = '12px';
    delBtn.style.minWidth = 'auto';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDelete(shortcut);
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    // Layout
    card.style.display = 'flex';
    card.style.alignItems = 'center';
    card.appendChild(content);
    card.appendChild(actions);

    card.addEventListener('click', () => {
      selectedIndex = index;
      renderList();
      copyToClipboard(shortcut.value);
    });

    listEl.appendChild(card);
  });
}

function onKeydown(e) {
  // Only handle when shortcuts tab is visible
  if (!listEl || !listEl.offsetParent) return;
  // Don't intercept when modal is open or focus is in an input/textarea
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (document.querySelector('.modal-overlay')) return;
  if (activeTag === 'textarea') return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (shortcuts.length === 0) return;
    selectedIndex = Math.min(selectedIndex + 1, shortcuts.length - 1);
    renderList();
    scrollToSelected();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (shortcuts.length === 0) return;
    selectedIndex = Math.max(selectedIndex - 1, 0);
    renderList();
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
  const items = listEl.querySelectorAll('.list-item');
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
  form.style.display = 'flex';
  form.style.flexDirection = 'column';
  form.style.gap = '12px';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Name';
  nameInput.value = isEdit ? shortcut.name : '';
  form.appendChild(nameInput);

  const valueInput = document.createElement('textarea');
  valueInput.placeholder = 'Value (text to copy)';
  valueInput.rows = 4;
  valueInput.value = isEdit ? shortcut.value : '';
  form.appendChild(valueInput);

  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.placeholder = 'Description (optional)';
  descInput.value = isEdit ? shortcut.description : '';
  form.appendChild(descInput);

  showModal({
    title: isEdit ? 'Edit Shortcut' : 'New Shortcut',
    body: form,
    onConfirm: async () => {
      const name = nameInput.value.trim();
      const value = valueInput.value;
      const description = descInput.value.trim();

      if (!name) {
        showToast('Name is required', 'error');
        return;
      }
      if (!value) {
        showToast('Value is required', 'error');
        return;
      }

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
        await loadShortcuts();
      } catch (err) {
        showToast('Error: ' + err, 'error');
      }
    },
  }).catch(() => {});
}
