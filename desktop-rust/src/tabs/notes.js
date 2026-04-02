import { call } from '../tauri-api.js';
import { showModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

let root = null;
let folders = [];
let notes = [];
let selectedFolderId = null;
let editingNote = null; // null = list view, object = editing
let previewMode = false;

export function init(container) {
  root = container;
  root.innerHTML = '';
  root.appendChild(buildLayout());
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
  addFolderBtn.addEventListener('click', onAddFolder);
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

// ── Folders ───────────────────────────────────────────────────

async function loadFolders() {
  try {
    folders = await call('list_note_folders');
    renderFolders();
    if (folders.length && !selectedFolderId) {
      selectFolder(folders[0].id);
    } else if (selectedFolderId) {
      // re-select to refresh note counts display
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
  for (const f of folders) {
    const item = el('div', {
      class: 'notes-folder-item' + (f.id === selectedFolderId ? ' active' : ''),
    });
    const nameSpan = el('span', { text: f.name, class: 'folder-name' });
    item.appendChild(nameSpan);

    const actions = el('span', { class: 'folder-actions' });
    const renameBtn = el('button', { text: '\u270E', class: 'btn-icon', title: 'Rename' });
    renameBtn.addEventListener('click', (e) => { e.stopPropagation(); onRenameFolder(f); });
    const deleteBtn = el('button', { text: '\u2715', class: 'btn-icon btn-icon-danger', title: 'Delete' });
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); onDeleteFolder(f); });
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(actions);

    item.addEventListener('click', () => selectFolder(f.id));
    list.appendChild(item);
  }
}

function selectFolder(id) {
  selectedFolderId = id;
  editingNote = null;
  previewMode = false;
  renderFolders();
  loadNotes();
}

async function onAddFolder() {
  const body = document.createElement('div');
  body.innerHTML = '<label style="display:block;margin-bottom:6px;color:var(--text)">Folder name</label>';
  const input = document.createElement('input');
  input.style.width = '100%';
  input.placeholder = 'New folder';
  body.appendChild(input);

  try {
    await showModal({
      title: 'New Folder',
      body,
      onConfirm: async () => {
        const name = input.value.trim();
        if (!name) throw new Error('Name is required');
        await call('create_note_folder', { name, sortOrder: folders.length });
        showToast('Folder created', 'success');
      },
    });
    await loadFolders();
  } catch (_) { /* cancelled */ }
}

async function onRenameFolder(folder) {
  const body = document.createElement('div');
  body.innerHTML = '<label style="display:block;margin-bottom:6px;color:var(--text)">Folder name</label>';
  const input = document.createElement('input');
  input.style.width = '100%';
  input.value = folder.name;
  body.appendChild(input);

  try {
    await showModal({
      title: 'Rename Folder',
      body,
      onConfirm: async () => {
        const name = input.value.trim();
        if (!name) throw new Error('Name is required');
        await call('update_note_folder', { id: folder.id, name, sortOrder: folder.sort_order });
        showToast('Folder renamed', 'success');
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

  const list = el('div', { class: 'notes-list' });
  for (const n of notes) {
    const card = el('div', { class: 'note-card' });
    const titleRow = el('div', { class: 'note-card-title' });
    if (n.is_pinned) {
      titleRow.appendChild(el('span', { text: '\uD83D\uDCCC ', class: 'pin-icon' }));
    }
    titleRow.appendChild(el('strong', { text: n.title || '(untitled)' }));
    card.appendChild(titleRow);

    const preview = (n.content || '').replace(/\n/g, ' ').substring(0, 120);
    card.appendChild(el('div', { text: preview || '(empty)', class: 'note-card-preview' }));

    card.addEventListener('click', () => openEditor(n));
    list.appendChild(card);
  }
  right.appendChild(list);
}

// ── Note editor ─────────────────────────────────────────────

function onNewNote() {
  editingNote = { id: null, title: '', content: '', is_pinned: false, folder_id: selectedFolderId };
  previewMode = false;
  renderEditor();
}

function openEditor(note) {
  editingNote = { ...note };
  previewMode = false;
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
    const previewDiv = el('div', { class: 'note-preview' });
    previewDiv.innerHTML = renderMarkdown(editingNote.content);
    right.appendChild(previewDiv);
  } else {
    const textarea = document.createElement('textarea');
    textarea.className = 'note-content-input';
    textarea.placeholder = 'Write your note here... (Markdown supported)';
    textarea.value = editingNote.content;
    textarea.addEventListener('input', () => { editingNote.content = textarea.value; });
    right.appendChild(textarea);
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

// ── Basic Markdown renderer ─────────────────────────────────

function renderMarkdown(text) {
  if (!text) return '<p style="color:var(--text-muted)">(empty)</p>';

  let html = escapeHtml(text);

  // Headers (must be at line start)
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Unordered list items
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');

  // Newlines to <br> (but not after block elements)
  html = html.replace(/\n/g, '<br>');

  // Clean up <br> after block elements
  html = html.replace(/(<\/h[2-4]>)<br>/g, '$1');
  html = html.replace(/(<hr>)<br>/g, '$1');
  html = html.replace(/(<\/li>)<br>/g, '$1');

  return html;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  width: 250px;
  min-width: 250px;
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
  padding: 4px 8px;
}

.notes-folder-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 2px;
}

.notes-folder-item:hover {
  background: var(--bg-secondary);
}

.notes-folder-item.active {
  background: var(--bg-secondary);
  border-left: 3px solid var(--accent);
  padding-left: 7px;
}

.folder-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-actions {
  display: none;
  gap: 2px;
}

.notes-folder-item:hover .folder-actions {
  display: flex;
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
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.note-card {
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 10px 14px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: border-color 0.15s;
}

.note-card:hover {
  border-left-color: var(--accent);
}

.note-card-title {
  margin-bottom: 4px;
  font-size: 14px;
}

.pin-icon {
  font-size: 12px;
}

.note-card-preview {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-title-input {
  width: 100%;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
  padding: 10px 12px;
}

.note-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.note-content-input {
  width: 100%;
  flex: 1;
  min-height: 300px;
  resize: vertical;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.5;
  padding: 12px;
  margin-bottom: 12px;
}

.note-preview {
  flex: 1;
  min-height: 300px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 12px;
  overflow-y: auto;
  line-height: 1.6;
}

.note-preview h2 { font-size: 18px; margin: 12px 0 8px 0; }
.note-preview h3 { font-size: 16px; margin: 10px 0 6px 0; }
.note-preview h4 { font-size: 14px; margin: 8px 0 4px 0; }
.note-preview code {
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
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

.note-actions {
  display: flex;
  gap: 8px;
}
`;
}
