import { call } from '../tauri-api.js';
import { showModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { marked } from '../lib/marked.min.js';
import { attachToolbar } from '../components/md-toolbar.js';

let root = null;
let folders = [];
let notes = [];
let selectedFolderId = null;
let editingNote = null; // null = list view, object = editing
let previewMode = false;
let expandedFolderIds = new Set();
let expandedNoteIdx = null;
let expandMultiplier = 4;

export async function init(container) {
  root = container;
  root.innerHTML = '';
  root.appendChild(buildLayout());

  try {
    const em = await call('get_setting', { key: 'snippet_expand_multiplier' });
    if (em) expandMultiplier = parseInt(em) || 4;
  } catch {}

  loadFolders();
}

// ── Layout ────────────────────────────────────────────────────

function buildLayout() {
  const wrap = el('div', { class: 'notes-wrap' });

  // Left panel - folders
  const left = el('div', { class: 'notes-left' });
  const leftHeader = el('div', { class: 'notes-panel-header' });
  leftHeader.appendChild(el('span', { text: 'Folders', class: 'notes-panel-title' }));
  const addFolderBtn = el('button', { text: '+', class: 'btn-small' });
  addFolderBtn.addEventListener('click', () => onAddFolder(null));
  leftHeader.appendChild(addFolderBtn);
  left.appendChild(leftHeader);

  const folderList = el('div', { class: 'notes-folder-list', id: 'folder-list' });
  left.appendChild(folderList);

  // Right panel - notes
  const right = el('div', { class: 'notes-right', id: 'notes-right' });
  right.innerHTML = '<p style="padding:16px;color:var(--text-muted)">Select a folder</p>';

  wrap.appendChild(left);
  wrap.appendChild(right);

  // Inject scoped styles
  const style = document.createElement('style');
  style.textContent = notesCSS();
  wrap.appendChild(style);

  return wrap;
}

// ── Folder tree helpers ─────────────────────────────────────────

function buildFolderTree(flatFolders) {
  const map = new Map();
  const roots = [];
  for (const f of flatFolders) {
    map.set(f.id, { ...f, children: [] });
  }
  for (const f of flatFolders) {
    const node = map.get(f.id);
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return { roots, map };
}

function countDescendantFolders(node) {
  let count = node.children.length;
  for (const child of node.children) {
    count += countDescendantFolders(child);
  }
  return count;
}

function getAllDescendantIds(node) {
  const ids = [];
  for (const child of node.children) {
    ids.push(child.id);
    ids.push(...getAllDescendantIds(child));
  }
  return ids;
}

function getFolderPath(folderId, folderMap) {
  const parts = [];
  let current = folderMap.get(folderId);
  while (current) {
    parts.unshift(current.name);
    current = current.parent_id ? folderMap.get(current.parent_id) : null;
  }
  return parts.join(' / ');
}

// ── Folders ───────────────────────────────────────────────────

async function loadFolders() {
  try {
    folders = await call('list_note_folders');
    renderFolders();
    if (folders.length && !selectedFolderId) {
      selectFolder(folders[0].id);
    } else if (selectedFolderId) {
      const still = folders.find(f => f.id === selectedFolderId);
      if (still) selectFolder(selectedFolderId);
      else if (folders.length) selectFolder(folders[0].id);
      else { selectedFolderId = null; renderRightEmpty(); }
    } else {
      renderRightEmpty();
    }
  } catch (e) {
    showToast('Failed to load folders: ' + e, 'error');
  }
}

function renderFolders() {
  const list = root.querySelector('#folder-list');
  if (!list) return;
  list.innerHTML = '';

  const { roots, map } = buildFolderTree(folders);

  function renderNode(node, depth) {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedFolderIds.has(node.id);
    const isActive = node.id === selectedFolderId;

    const item = el('div', {
      class: 'notes-folder-item' + (isActive ? ' active' : ''),
    });
    item.style.paddingLeft = (10 + depth * 20) + 'px';

    // Tree connector line
    if (depth > 0) {
      const connector = el('span', { class: 'tree-connector' });
      connector.style.left = (depth * 20 - 6) + 'px';
      item.appendChild(connector);
      item.style.position = 'relative';
    }

    // Expand/collapse arrow
    const arrow = el('span', { class: 'folder-arrow' + (hasChildren ? '' : ' invisible') });
    arrow.textContent = isExpanded ? '\u25BC' : '\u25B6';
    if (hasChildren) {
      arrow.classList.add(isExpanded ? 'arrow-expanded' : 'arrow-collapsed');
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        if (expandedFolderIds.has(node.id)) {
          expandedFolderIds.delete(node.id);
        } else {
          expandedFolderIds.add(node.id);
        }
        renderFolders();
      });
    }
    item.appendChild(arrow);

    // Folder icon
    const icon = el('span', { class: 'folder-icon' });
    if (hasChildren && isExpanded) {
      icon.textContent = '\uD83D\uDCC2 ';
    } else if (hasChildren) {
      icon.textContent = '\uD83D\uDCC1 ';
    } else {
      icon.textContent = '\uD83D\uDCC4 ';
    }
    item.appendChild(icon);

    // Folder name
    const nameSpan = el('span', { text: node.name, class: 'folder-name' });
    item.appendChild(nameSpan);

    // Sub-folder count badge
    const totalChildren = countDescendantFolders(node);
    if (totalChildren > 0) {
      const badge = el('span', { text: String(totalChildren), class: 'folder-badge' });
      item.appendChild(badge);
    }

    // Actions
    const actions = el('span', { class: 'folder-actions' });
    const addSubBtn = el('button', { text: '+', class: 'btn-icon', title: 'Add sub-folder' });
    addSubBtn.addEventListener('click', (e) => { e.stopPropagation(); onAddFolder(node.id); });
    const renameBtn = el('button', { text: '\u270E', class: 'btn-icon', title: 'Rename' });
    renameBtn.addEventListener('click', (e) => { e.stopPropagation(); onRenameFolder(node); });
    const deleteBtn = el('button', { text: '\u2715', class: 'btn-icon btn-icon-danger', title: 'Delete' });
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); onDeleteFolder(node); });
    actions.appendChild(addSubBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(actions);

    item.addEventListener('click', () => selectFolder(node.id));
    list.appendChild(item);

    // Render children if expanded
    if (hasChildren && isExpanded) {
      for (const child of node.children) {
        renderNode(child, depth + 1);
      }
    }
  }

  for (const r of roots) {
    renderNode(r, 0);
  }
}

function selectFolder(id) {
  selectedFolderId = id;
  editingNote = null;
  previewMode = false;
  expandedNoteIdx = null;
  renderFolders();
  loadNotes();
}

async function onAddFolder(parentId) {
  const { map } = buildFolderTree(folders);

  const body = document.createElement('div');

  // Folder name
  const nameLabel = document.createElement('label');
  nameLabel.style.cssText = 'display:block;margin-bottom:6px;color:var(--text)';
  nameLabel.textContent = 'Folder name';
  body.appendChild(nameLabel);
  const input = document.createElement('input');
  input.style.width = '100%';
  input.placeholder = 'New folder';
  body.appendChild(input);

  // Parent folder dropdown
  const parentLabel = document.createElement('label');
  parentLabel.style.cssText = 'display:block;margin:12px 0 6px 0;color:var(--text)';
  parentLabel.textContent = 'Parent folder';
  body.appendChild(parentLabel);
  const select = document.createElement('select');
  select.style.width = '100%';
  const rootOpt = document.createElement('option');
  rootOpt.value = '';
  rootOpt.textContent = '(Root)';
  select.appendChild(rootOpt);

  for (const f of folders) {
    const opt = document.createElement('option');
    opt.value = String(f.id);
    opt.textContent = getFolderPath(f.id, map);
    if (parentId !== null && f.id === parentId) opt.selected = true;
    select.appendChild(opt);
  }
  body.appendChild(select);

  try {
    await showModal({
      title: 'New Folder',
      body,
      onConfirm: async () => {
        const name = input.value.trim();
        if (!name) throw new Error('Name is required');
        const selParent = select.value ? Number(select.value) : null;
        await call('create_note_folder', { name, sortOrder: folders.length, parentId: selParent });
        // Auto-expand parent so the new folder is visible
        if (selParent) expandedFolderIds.add(selParent);
        showToast('Folder created', 'success');
      },
    });
    await loadFolders();
  } catch (_) { /* cancelled */ }
}

async function onRenameFolder(folder) {
  const { map } = buildFolderTree(folders);

  const body = document.createElement('div');

  // Name
  const nameLabel = document.createElement('label');
  nameLabel.style.cssText = 'display:block;margin-bottom:6px;color:var(--text)';
  nameLabel.textContent = 'Folder name';
  body.appendChild(nameLabel);
  const input = document.createElement('input');
  input.style.width = '100%';
  input.value = folder.name;
  body.appendChild(input);

  // Parent folder dropdown
  const parentLabel = document.createElement('label');
  parentLabel.style.cssText = 'display:block;margin:12px 0 6px 0;color:var(--text)';
  parentLabel.textContent = 'Parent folder';
  body.appendChild(parentLabel);
  const select = document.createElement('select');
  select.style.width = '100%';
  const rootOpt = document.createElement('option');
  rootOpt.value = '';
  rootOpt.textContent = '(Root)';
  if (!folder.parent_id) rootOpt.selected = true;
  select.appendChild(rootOpt);

  // Exclude this folder and its descendants from parent options
  const excludeIds = new Set([folder.id, ...getAllDescendantIds(map.get(folder.id) || { children: [] })]);

  for (const f of folders) {
    if (excludeIds.has(f.id)) continue;
    const opt = document.createElement('option');
    opt.value = String(f.id);
    opt.textContent = getFolderPath(f.id, map);
    if (folder.parent_id && f.id === folder.parent_id) opt.selected = true;
    select.appendChild(opt);
  }
  body.appendChild(select);

  try {
    await showModal({
      title: 'Edit Folder',
      body,
      onConfirm: async () => {
        const name = input.value.trim();
        if (!name) throw new Error('Name is required');
        const selParent = select.value ? Number(select.value) : null;
        await call('update_note_folder', { id: folder.id, name, sortOrder: folder.sort_order, parentId: selParent });
        showToast('Folder updated', 'success');
      },
    });
    await loadFolders();
  } catch (_) { /* cancelled */ }
}

async function onDeleteFolder(folder) {
  try {
    await showModal({
      title: 'Delete Folder',
      body: `Delete folder "${folder.name}" and all its notes?`,
      onConfirm: async () => {
        await call('delete_note_folder', { id: folder.id });
        showToast('Folder deleted', 'success');
      },
    });
    if (selectedFolderId === folder.id) selectedFolderId = null;
    await loadFolders();
  } catch (_) { /* cancelled */ }
}

// ── Notes list ──────────────────────────────────────────────

async function loadNotes() {
  if (!selectedFolderId) { renderRightEmpty(); return; }
  try {
    notes = await call('list_notes', { folderId: selectedFolderId });
    renderNotesList();
  } catch (e) {
    showToast('Failed to load notes: ' + e, 'error');
  }
}

function renderRightEmpty() {
  const right = root.querySelector('#notes-right');
  if (!right) return;
  right.innerHTML = '<p style="padding:16px;color:var(--text-muted)">Select a folder</p>';
}

function renderNotesList() {
  const right = root.querySelector('#notes-right');
  if (!right) return;
  right.innerHTML = '';

  const folder = folders.find(f => f.id === selectedFolderId);
  const header = el('div', { class: 'notes-panel-header' });
  header.appendChild(el('span', { text: folder ? folder.name : 'Notes', class: 'notes-panel-title' }));
  const newBtn = el('button', { text: '+ New Note' });
  newBtn.addEventListener('click', onNewNote);
  header.appendChild(newBtn);
  right.appendChild(header);

  if (!notes.length) {
    right.appendChild(el('p', { text: 'No notes yet', style: 'padding:12px;color:var(--text-muted)' }));
    return;
  }

  const baseItemHeight = 36;
  const list = el('div', { class: 'notes-list' });

  notes.forEach((n, index) => {
    const isExpanded = expandedNoteIdx === index;
    const hasMarkdown = hasMarkdownMarkers(n.content);

    const card = el('div', { class: 'note-card' });

    // Title row (click -> open editor)
    const titleRow = el('div', { class: 'note-card-title' });
    if (n.is_pinned) {
      titleRow.appendChild(el('span', { class: 'pin-dot' }));
    }
    const titleText = el('span', { class: 'note-card-title-text' });
    titleText.textContent = n.title || '(untitled)';
    titleRow.appendChild(titleText);
    card.appendChild(titleRow);

    // Preview subtitle (first line, truncated)
    const firstLine = (n.content || '').split('\n').find(l => l.trim()) || '';
    const previewText = firstLine.replace(/^#+\s*/, '').substring(0, 120);
    card.appendChild(el('div', { text: previewText || '(empty)', class: 'note-card-preview' }));

    // Expandable content area
    if (isExpanded) {
      const expandContent = el('div', { class: 'expand-content' });
      expandContent.style.height = (baseItemHeight * expandMultiplier) + 'px';

      if (hasMarkdown) {
        const mdDiv = el('div', { class: 'markdown-body' });
        mdDiv.style.fontSize = '13px';
        mdDiv.innerHTML = marked(n.content);
        expandContent.appendChild(mdDiv);
      } else {
        const pre = document.createElement('pre');
        pre.style.cssText = "font-family:'SF Mono','Fira Code',monospace;font-size:13px;color:var(--text);white-space:pre-wrap;word-break:break-word;margin:0;padding:6px 0";
        pre.textContent = n.content;
        expandContent.appendChild(pre);
      }
      card.appendChild(expandContent);
      card.style.background = 'var(--bg-secondary)';
      card.style.borderLeftColor = 'var(--accent)';
    }

    // Expand handle (thin bar at bottom, matches snippets exactly)
    const handle = el('div', { class: 'expand-handle' + (isExpanded ? ' open' : '') });
    handle.textContent = isExpanded ? '\u25B2' : '\u25BC';
    handle.addEventListener('click', (e) => {
      e.stopPropagation();
      expandedNoteIdx = isExpanded ? null : index;
      renderNotesList();
    });
    card.appendChild(handle);

    // Click title area -> open editor
    titleRow.style.cursor = 'pointer';
    titleRow.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditor(n);
    });

    // Click preview -> also open editor
    card.querySelector('.note-card-preview').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditor(n);
    });

    list.appendChild(card);
  });

  right.appendChild(list);
}

// ── Note editor ─────────────────────────────────────────────

function onNewNote() {
  editingNote = { id: null, title: '', content: '', is_pinned: false, folder_id: selectedFolderId };
  previewMode = false;
  renderEditor();
}

function hasMarkdownMarkers(text) {
  if (!text) return false;
  return /^#{1,6}\s|^\*\*|^- |\*\*|```|^\|.*\|/m.test(text);
}

function openEditor(note) {
  editingNote = { ...note };
  previewMode = hasMarkdownMarkers(note.content);
  renderEditor();
}

function renderEditor() {
  const right = root.querySelector('#notes-right');
  if (!right) return;
  right.innerHTML = '';

  // Back button
  const backBtn = el('button', { text: '\u2190 Back', class: 'btn-secondary', style: 'margin-bottom:12px' });
  backBtn.addEventListener('click', () => { editingNote = null; previewMode = false; renderNotesList(); });
  right.appendChild(backBtn);

  // Title
  const titleInput = document.createElement('input');
  titleInput.className = 'note-title-input';
  titleInput.placeholder = 'Note title';
  titleInput.value = editingNote.title;
  titleInput.addEventListener('input', () => { editingNote.title = titleInput.value; });
  right.appendChild(titleInput);

  // Toolbar
  const toolbar = el('div', { class: 'note-toolbar' });
  const pinBtn = el('button', {
    text: editingNote.is_pinned ? '\uD83D\uDCCC Pinned' : 'Pin',
    class: editingNote.is_pinned ? '' : 'btn-secondary',
    style: 'font-size:12px;padding:4px 10px',
  });
  pinBtn.addEventListener('click', () => {
    editingNote.is_pinned = !editingNote.is_pinned;
    renderEditor();
  });
  toolbar.appendChild(pinBtn);

  const previewBtn = el('button', {
    text: previewMode ? 'Edit' : 'Preview',
    class: 'btn-secondary',
    style: 'font-size:12px;padding:4px 10px',
  });
  previewBtn.addEventListener('click', () => {
    if (!previewMode) {
      // save current textarea content before switching
      const ta = right.querySelector('.note-content-input');
      if (ta) editingNote.content = ta.value;
    }
    previewMode = !previewMode;
    renderEditor();
  });
  toolbar.appendChild(previewBtn);
  right.appendChild(toolbar);

  // Content area
  if (previewMode) {
    const previewDiv = el('div', { class: 'note-preview markdown-body' });
    previewDiv.innerHTML = editingNote.content ? marked(editingNote.content) : '<p style="color:var(--text-muted)">(empty)</p>';
    right.appendChild(previewDiv);
  } else {
    const textarea = document.createElement('textarea');
    textarea.className = 'note-content-input';
    textarea.placeholder = 'Write your note here... (Markdown supported)';
    textarea.value = editingNote.content;
    textarea.addEventListener('input', () => { editingNote.content = textarea.value; });
    right.appendChild(textarea);
    attachToolbar(textarea);
  }

  // Action buttons
  const actions = el('div', { class: 'note-actions' });
  const saveBtn = el('button', { text: 'Save' });
  saveBtn.addEventListener('click', onSaveNote);
  actions.appendChild(saveBtn);

  const cancelBtn = el('button', { text: 'Cancel', class: 'btn-secondary' });
  cancelBtn.addEventListener('click', () => { editingNote = null; previewMode = false; renderNotesList(); });
  actions.appendChild(cancelBtn);

  if (editingNote.id) {
    const delBtn = el('button', { text: 'Delete', class: 'btn-danger' });
    delBtn.addEventListener('click', onDeleteNote);
    actions.appendChild(delBtn);
  }
  right.appendChild(actions);
}

async function onSaveNote() {
  try {
    if (editingNote.id) {
      await call('update_note', {
        id: editingNote.id,
        title: editingNote.title,
        content: editingNote.content,
        isPinned: editingNote.is_pinned,
      });
      showToast('Note updated', 'success');
    } else {
      await call('create_note', {
        folderId: selectedFolderId,
        title: editingNote.title,
        content: editingNote.content,
      });
      showToast('Note created', 'success');
    }
    editingNote = null;
    previewMode = false;
    await loadNotes();
  } catch (e) {
    showToast('Failed to save note: ' + e, 'error');
  }
}

async function onDeleteNote() {
  try {
    await showModal({
      title: 'Delete Note',
      body: `Delete "${editingNote.title || '(untitled)'}"?`,
      onConfirm: async () => {
        await call('delete_note', { id: editingNote.id });
        showToast('Note deleted', 'success');
      },
    });
    editingNote = null;
    previewMode = false;
    await loadNotes();
  } catch (_) { /* cancelled */ }
}

// ── DOM helper ──────────────────────────────────────────────

function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.class) e.className = opts.class;
  if (opts.text) e.textContent = opts.text;
  if (opts.id) e.id = opts.id;
  if (opts.style) e.setAttribute('style', opts.style);
  if (opts.title) e.title = opts.title;
  return e;
}

// ── Scoped CSS ──────────────────────────────────────────────

function notesCSS() {
  return `
.notes-wrap {
  display: flex;
  height: 100%;
  gap: 0;
}

.notes-left {
  width: 260px;
  min-width: 260px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.notes-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0 16px 16px 16px;
  overflow: auto;
}

.notes-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 8px 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}

.notes-panel-title {
  font-weight: 600;
  font-size: 15px;
}

.notes-folder-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 4px;
}

.notes-folder-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 1px;
  position: relative;
  gap: 2px;
}

.notes-folder-item:hover {
  background: var(--bg-secondary);
}

.notes-folder-item.active {
  background: var(--bg-tertiary);
  border-left: 2px solid var(--accent);
}

.folder-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 10px;
  color: var(--text-muted);
  cursor: pointer;
  transition: transform 0.15s;
  flex-shrink: 0;
  user-select: none;
}

.folder-arrow.invisible {
  visibility: hidden;
}

.folder-arrow:hover {
  color: var(--text);
}

.folder-icon {
  font-size: 13px;
  flex-shrink: 0;
  margin-right: 2px;
}

.folder-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.folder-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--bg-tertiary, rgba(128,128,128,0.15));
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  margin-left: 4px;
}

.tree-connector {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  border-left: 1px dashed var(--border);
  background: transparent;
  opacity: 0.7;
}

.folder-actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}

.notes-folder-item:hover .folder-actions {
  display: flex;
}

.notes-folder-item:hover .folder-badge {
  display: none;
}

.btn-icon {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
  font-size: 13px;
  border-radius: 4px;
  min-width: 0;
}

.btn-icon:hover {
  background: var(--bg-tertiary);
  color: var(--text);
}

.btn-icon-danger:hover {
  color: var(--danger);
}

.btn-small {
  padding: 4px 10px;
  font-size: 16px;
  line-height: 1;
}

.notes-list {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.note-card {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  border-left: 2px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
  overflow: hidden;
}

.note-card:hover {
  background: var(--bg-secondary);
  border-left-color: var(--accent);
}

.note-card-title {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.note-card-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-card-preview {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pin-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f0883e;
  flex-shrink: 0;
}

.note-card .expand-handle {
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 0.15s;
  cursor: pointer;
}

.note-card:hover .expand-handle {
  opacity: 0.6;
}

.note-card .expand-handle.open {
  opacity: 0.8;
}

.note-card .expand-content {
  border-top: 1px solid var(--border);
  overflow-y: auto;
  padding: 8px 0;
  animation: note-expand 0.2s ease-out;
}

@keyframes note-expand {
  from { height: 0; opacity: 0; }
  to { opacity: 1; }
}

.note-title-input {
  font-size: 18px;
  font-weight: 600;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  padding: 8px 0;
  margin-bottom: 12px;
  width: 100%;
  outline: none;
}

.note-title-input:focus {
  border-bottom-color: var(--accent);
}

.note-content-input {
  flex: 1;
  resize: none;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 14px;
  line-height: 1.6;
  width: 100%;
  min-height: 300px;
  padding: 12px;
  margin-bottom: 12px;
}

.note-preview {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
  min-height: 300px;
}

.note-preview h2 { font-size: 18px; margin: 12px 0 8px 0; }
.note-preview h3 { font-size: 16px; margin: 10px 0 6px 0; }
.note-preview h4 { font-size: 14px; margin: 8px 0 4px 0; }
.note-preview code {
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
}
.note-preview hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}
.note-preview li {
  margin-left: 16px;
  list-style: disc;
}
.note-preview strong { color: var(--text); }

.note-toolbar {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.note-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
`;
}
