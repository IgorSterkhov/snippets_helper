import { call } from '../tauri-api.js';
import { showModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { marked } from '../lib/marked.min.js';
import { attachToolbar } from '../components/md-toolbar.js';
import { enhanceMarkdownFigures } from '../components/markdown-figures.js';
import { installWrappedChipDnd } from '../components/wrapped-chip-dnd.js';
import { openShareLinkModal } from '../components/share-link-modal.js';

let root = null;
let folders = [];
let notes = [];
let pinnedNotes = [];
let selectedFolderId = null;
let editingNote = null; // null = list view, object = editing
let previewMode = false;
let expandedFolderIds = new Set();
let expandedNoteIdx = null;
let expandMultiplier = 4;
let aiNoteListenerInstalled = false;
let activeFolderDrag = null;

const FOLDER_DRAG_START_PX = 5;
const FOLDER_DROP_EDGE_RATIO = 0.28;

export async function init(container) {
  root = container;
  root.innerHTML = '';
  root.appendChild(buildLayout());

  try {
    const em = await call('get_setting', { key: 'snippet_expand_multiplier' });
    if (em) expandMultiplier = parseInt(em) || 4;
  } catch {}

  installAiNoteListener();
  loadFolders();
}

// ── Layout ────────────────────────────────────────────────────

function buildLayout() {
  const wrap = el('div', { class: 'notes-wrap' });

  // Pinned notes chip strip — spans full width above folders + notes.
  const chips = el('div', { class: 'pinned-chips-row empty', id: 'pinned-chips' });
  wrap.appendChild(chips);

  const body = el('div', { class: 'notes-body' });

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

  body.appendChild(left);
  body.appendChild(right);
  wrap.appendChild(body);

  // Inject scoped styles
  const style = document.createElement('style');
  style.textContent = notesCSS();
  wrap.appendChild(style);

  return wrap;
}

async function loadPinnedNotes() {
  try {
    const results = await Promise.all(
      folders.map(f => call('list_notes', { folderId: f.id }).catch(() => []))
    );
    pinnedNotes = results
      .flat()
      .filter(n => n && n.is_pinned)
      .sort((a, b) => (
        (Number(a.pinned_sort_order) || 0) - (Number(b.pinned_sort_order) || 0)
        || String(a.title || '').localeCompare(String(b.title || ''))
      ));
  } catch {
    pinnedNotes = [];
  }
  renderPinnedChips();
}

function renderPinnedChips() {
  const row = root && root.querySelector('#pinned-chips');
  if (!row) return;
  row.innerHTML = '';
  if (!pinnedNotes.length) {
    row.classList.add('empty');
    return;
  }
  row.classList.remove('empty');
  for (const n of pinnedNotes) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'pinned-chip';
    chip.title = n.title || '(untitled)';
    chip.dataset.noteId = String(n.id);
    const icon = el('span', { class: 'pinned-chip-icon' });
    icon.textContent = '📌';
    chip.appendChild(icon);
    chip.appendChild(el('span', { text: n.title || '(untitled)', class: 'pinned-chip-label' }));
    chip.addEventListener('click', (event) => {
      if (chip.dataset.dragSuppressClick === '1') {
        event.preventDefault();
        event.stopPropagation();
        delete chip.dataset.dragSuppressClick;
        return;
      }
      if (n.folder_id != null) selectedFolderId = n.folder_id;
      openEditor(n);
    });
    row.appendChild(chip);
  }
  installWrappedChipDnd(row, {
    chipSelector: '.pinned-chip',
    datasetKey: 'noteId',
    placeholderClass: 'notes-chip-dnd-placeholder',
    sourceClass: 'notes-chip-dnd-source',
    onReorder: async (ids) => {
      await call('reorder_pinned_notes', { ids });
      await loadPinnedNotes();
    },
  });
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
  const sortNodes = (nodes) => {
    nodes.sort((a, b) => (
      (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
      || String(a.name || '').localeCompare(String(b.name || ''))
      || Number(a.id) - Number(b.id)
    ));
    for (const node of nodes) sortNodes(node.children);
  };
  sortNodes(roots);
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
    await loadPinnedNotes();
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
    item.dataset.folderId = String(node.id);
    item.dataset.parentId = node.parent_id == null ? '' : String(node.parent_id);
    item.dataset.depth = String(depth);
    item.style.setProperty('--folder-depth', String(depth));
    item.style.setProperty('--folder-indent', (6 + depth * 18) + 'px');

    const grip = el('button', { text: '\u22EE', class: 'folder-grip', title: 'Drag folder' });
    grip.type = 'button';
    grip.dataset.folderDragHandle = '1';
    item.appendChild(grip);

    // Expand/collapse arrow
    const arrow = el('button', { class: 'folder-arrow' + (hasChildren ? '' : ' invisible') });
    arrow.type = 'button';
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

    const meta = el('span', { class: 'folder-meta' });
    // Sub-folder count badge
    const totalChildren = countDescendantFolders(node);
    if (totalChildren > 0) {
      const badge = el('span', { text: String(totalChildren), class: 'folder-badge' });
      meta.appendChild(badge);
    }
    item.appendChild(meta);

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

    item.addEventListener('click', (event) => {
      if (item.dataset.dragSuppressClick === '1') {
        event.preventDefault();
        event.stopPropagation();
        delete item.dataset.dragSuppressClick;
        return;
      }
      selectFolder(node.id);
    });
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
  installFolderTreeDnd(list);
}

function installFolderTreeDnd(list) {
  list.onpointerdown = (event) => {
    const handle = event.target.closest('[data-folder-drag-handle]');
    if (!handle || event.button !== 0) return;
    const source = handle.closest('.notes-folder-item');
    if (!source) return;

    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;

    const onMove = (moveEvent) => {
      if (!started) {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (Math.hypot(dx, dy) < FOLDER_DRAG_START_PX) return;
        moveEvent.preventDefault();
        startFolderDrag(source, moveEvent);
        started = !!activeFolderDrag;
      }
      if (started) updateFolderDrag(moveEvent);
    };

    const onUp = async (upEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (!started) return;
      upEvent.preventDefault();
      try {
        await commitFolderDrag();
      } finally {
        cleanupFolderDrag();
        source.dataset.dragSuppressClick = '1';
        setTimeout(() => {
          if (source.dataset.dragSuppressClick === '1') delete source.dataset.dragSuppressClick;
        }, 350);
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };
}

function startFolderDrag(source, event) {
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true);
  ghost.classList.add('notes-folder-drag-ghost');
  ghost.style.position = 'fixed';
  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';
  ghost.style.width = rect.width + 'px';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '10000';
  for (const child of ghost.querySelectorAll('button')) child.disabled = true;
  document.body.appendChild(ghost);

  const line = document.createElement('div');
  line.className = 'notes-folder-drop-line';
  line.style.display = 'none';

  source.classList.add('folder-drag-source');
  activeFolderDrag = {
    source,
    list: source.closest('#folder-list'),
    ghost,
    line,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    intent: null,
  };
}

function updateFolderDrag(event) {
  if (!activeFolderDrag) return;
  const { ghost } = activeFolderDrag;
  ghost.style.left = (event.clientX - activeFolderDrag.offsetX) + 'px';
  ghost.style.top = (event.clientY - activeFolderDrag.offsetY) + 'px';

  const intent = getFolderDropIntent(event.clientX, event.clientY);
  activeFolderDrag.intent = intent;
  renderFolderDropIntent(intent);
}

function getFolderDropIntent(clientX, clientY) {
  const drag = activeFolderDrag;
  if (!drag || !drag.list) return null;
  const listRect = drag.list.getBoundingClientRect();
  if (clientX < listRect.left || clientX > listRect.right || clientY < listRect.top || clientY > listRect.bottom) {
    return null;
  }

  const under = document.elementFromPoint(clientX, clientY);
  const targetRow = under && under.closest('.notes-folder-item');
  if (!targetRow || !drag.list.contains(targetRow) || targetRow === drag.source) return null;

  const sourceId = Number(drag.source.dataset.folderId);
  const targetId = Number(targetRow.dataset.folderId);
  if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) return null;
  if (isDescendantFolder(targetId, sourceId)) return null;

  const rowRect = targetRow.getBoundingClientRect();
  const relY = rowRect.height > 0 ? (clientY - rowRect.top) / rowRect.height : 0.5;
  const targetDepth = Number(targetRow.dataset.depth) || 0;
  const targetParentId = targetRow.dataset.parentId ? Number(targetRow.dataset.parentId) : null;

  if (relY < FOLDER_DROP_EDGE_RATIO) {
    return {
      mode: 'before',
      parentId: targetParentId,
      beforeId: targetId,
      lineBefore: targetRow,
      lineDepth: targetDepth,
      highlightRow: null,
    };
  }

  if (relY > 1 - FOLDER_DROP_EDGE_RATIO) {
    const branchEndBefore = nextVisibleRowAfterBranch(targetRow);
    const siblingBeforeId = branchEndBefore
      && Number(branchEndBefore.dataset.depth) === targetDepth
      && (branchEndBefore.dataset.parentId ? Number(branchEndBefore.dataset.parentId) : null) === targetParentId
        ? Number(branchEndBefore.dataset.folderId)
        : null;
    return {
      mode: 'after',
      parentId: targetParentId,
      beforeId: siblingBeforeId,
      lineBefore: branchEndBefore,
      lineDepth: targetDepth,
      highlightRow: null,
    };
  }

  return {
    mode: 'inside',
    parentId: targetId,
    beforeId: null,
    lineBefore: null,
    lineDepth: targetDepth + 1,
    highlightRow: targetRow,
  };
}

function isDescendantFolder(candidateId, ancestorId) {
  let current = folders.find(f => Number(f.id) === Number(candidateId));
  while (current && current.parent_id != null) {
    if (Number(current.parent_id) === Number(ancestorId)) return true;
    current = folders.find(f => Number(f.id) === Number(current.parent_id));
  }
  return false;
}

function nextVisibleRowAfterBranch(row) {
  const depth = Number(row.dataset.depth) || 0;
  let next = row.nextElementSibling;
  while (next && !next.classList.contains('notes-folder-item')) {
    next = next.nextElementSibling;
  }
  while (next && next.classList.contains('notes-folder-item') && (Number(next.dataset.depth) || 0) > depth) {
    next = next.nextElementSibling;
    while (next && !next.classList.contains('notes-folder-item')) {
      next = next.nextElementSibling;
    }
  }
  return next && next.classList.contains('notes-folder-item') ? next : null;
}

function renderFolderDropIntent(intent) {
  if (!activeFolderDrag) return;
  const { list, line } = activeFolderDrag;
  for (const row of list.querySelectorAll('.notes-folder-item.folder-drop-inside')) {
    row.classList.remove('folder-drop-inside');
  }

  if (!intent) {
    if (line.parentElement) line.remove();
    line.style.display = 'none';
    return;
  }

  if (intent.mode === 'inside') {
    if (line.parentElement) line.remove();
    line.style.display = 'none';
    if (intent.highlightRow) intent.highlightRow.classList.add('folder-drop-inside');
    return;
  }

  line.style.display = '';
  line.style.setProperty('--folder-drop-depth', String(Math.max(0, intent.lineDepth || 0)));
  line.style.setProperty('--folder-drop-indent', (28 + Math.max(0, intent.lineDepth || 0) * 18) + 'px');
  moveFolderDropLine(list, line, intent.lineBefore || null);
}

function moveFolderDropLine(list, line, beforeRow) {
  if (line.parentElement === list && line.nextElementSibling === beforeRow) return;

  const tracked = [...list.querySelectorAll('.notes-folder-item'), line].filter(el => el.parentElement === list);
  const oldTops = new Map();
  for (const el of tracked) oldTops.set(el, el.getBoundingClientRect().top);

  list.insertBefore(line, beforeRow);

  for (const el of tracked) {
    if (!el.parentElement) continue;
    const oldTop = oldTops.get(el);
    const newTop = el.getBoundingClientRect().top;
    const delta = oldTop - newTop;
    if (!delta) continue;
    el.style.transition = 'none';
    el.style.transform = `translateY(${delta}px)`;
    void el.offsetHeight;
    el.style.transition = 'transform 160ms ease';
    el.style.transform = '';
  }
}

async function commitFolderDrag() {
  const drag = activeFolderDrag;
  if (!drag || !drag.intent) return;
  const sourceId = Number(drag.source.dataset.folderId);
  const intent = drag.intent;
  if (!Number.isFinite(sourceId)) return;

  await call('move_note_folder', {
    id: sourceId,
    parentId: intent.parentId,
    beforeId: intent.beforeId,
  });
  if (intent.mode === 'inside' && intent.parentId != null) {
    expandedFolderIds.add(intent.parentId);
  }
  await loadFolders();
}

function cleanupFolderDrag() {
  if (!activeFolderDrag) return;
  const { list, source, ghost, line } = activeFolderDrag;
  if (ghost && ghost.parentElement) ghost.remove();
  if (line && line.parentElement) line.remove();
  if (source) source.classList.remove('folder-drag-source');
  if (list) {
    for (const row of list.querySelectorAll('.notes-folder-item')) {
      row.classList.remove('folder-drop-inside');
      row.style.transition = '';
      row.style.transform = '';
    }
  }
  activeFolderDrag = null;
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

function installAiNoteListener() {
  if (aiNoteListenerInstalled) return;
  aiNoteListenerInstalled = true;
  window.addEventListener('ai:notes-open', async (event) => {
    if (!root) return;
    try {
      await openNoteFromAi(event.detail || {});
    } catch (err) {
      showToast('Failed to open AI note target: ' + err, 'error');
    }
  });
  window.addEventListener('ai:notes-search', async (event) => {
    if (!root) return;
    try {
      const target = await findNoteForAi(event.detail || {});
      if (target) {
        selectedFolderId = target.folder_id;
        editingNote = null;
        previewMode = false;
        notes = await call('list_notes', { folderId: selectedFolderId });
        renderFolders();
        renderNotesList();
      }
    } catch (err) {
      showToast('Failed to search notes from AI: ' + err, 'error');
    }
  });
  window.addEventListener('view-history:open', async (event) => {
    if (!root) return;
    const detail = event.detail || {};
    if (detail.moduleId !== 'notes') return;
    try {
      await openNoteFromViewHistory(detail);
    } catch (err) {
      showToast('Failed to restore note view: ' + err, 'error');
    }
  });
}

async function collectAllNotesForAi() {
  if (!folders.length) await loadFolders();
  const result = [];
  for (const folder of folders) {
    const rows = await call('list_notes', { folderId: folder.id }).catch(() => []);
    result.push(...rows);
  }
  return result;
}

async function findNoteForAi(detail) {
  const allNotes = await collectAllNotesForAi();
  if (detail.noteUuid) {
    return allNotes.find(n => n.uuid === detail.noteUuid) || null;
  }
  const query = String(detail.query || '').trim().toLowerCase();
  if (!query) return null;
  return allNotes.find(n => (
    String(n.title || '').toLowerCase().includes(query)
    || String(n.content || '').toLowerCase().includes(query)
  )) || null;
}

async function findNoteForViewHistory(detail) {
  const allNotes = await collectAllNotesForAi();
  if (detail.objectUuid) {
    return allNotes.find(note => note.uuid === detail.objectUuid) || null;
  }
  if (detail.objectId != null) {
    return allNotes.find(note => Number(note.id) === Number(detail.objectId)) || null;
  }
  if (detail.title) {
    return allNotes.find(note => String(note.title || '') === String(detail.title)) || null;
  }
  return null;
}

async function openNoteFromAi(detail) {
  const target = await findNoteForAi(detail);
  if (!target) {
    showToast('AI note target not found', 'error');
    return;
  }
  selectedFolderId = target.folder_id;
  notes = await call('list_notes', { folderId: selectedFolderId });
  renderFolders();
  openEditor(target);
}

async function openNoteFromViewHistory(detail) {
  const target = await findNoteForViewHistory(detail);
  if (!target) {
    showToast('Note from history was deleted', 'error');
    return;
  }
  selectedFolderId = target.folder_id;
  notes = await call('list_notes', { folderId: selectedFolderId });
  renderFolders();
  openEditor(target);
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
        enhanceMarkdownFigures(mdDiv);
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
  return /^#{1,6}\s|^\*\*|^- |\*\*|```|^\|.*\||!\[[^\]]*]\(/m.test(text);
}

function openEditor(note) {
  editingNote = { ...note };
  // Always open existing notes in preview — double-click switches to edit.
  // Empty notes fall back to edit so the user can type straight away.
  previewMode = !!(note.content && note.content.trim());
  renderEditor();
  recordCurrentNoteView(editingNote);
}

function recordCurrentNoteView(note) {
  if (!note || !note.id || window.__keyboardHelperActiveTab !== 'notes') return;
  window.dispatchEvent(new CustomEvent('view-history:record', {
    detail: {
      key: `note:${note.uuid || note.id}`,
      moduleId: 'notes',
      objectType: 'note',
      objectId: note.id,
      objectUuid: note.uuid || null,
      title: note.title || '(untitled)',
      label: 'Notes',
      icon: '🗒️',
      detail: {},
    },
  }));
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
    text: '\uD83D\uDCCC',
    class: editingNote.is_pinned ? 'note-icon-action active' : 'note-icon-action',
    title: editingNote.is_pinned ? 'Unpin note' : 'Pin note',
  });
  pinBtn.addEventListener('click', () => {
    editingNote.is_pinned = !editingNote.is_pinned;
    renderEditor();
  });
  toolbar.appendChild(pinBtn);

  const shareBtn = el('button', {
    text: '\uD83D\uDD17',
    class: 'note-icon-action',
    title: editingNote.uuid ? 'Share public link' : 'Save note before sharing',
  });
  shareBtn.disabled = !editingNote.uuid;
  shareBtn.addEventListener('click', () => openShareLinkModal({
    itemType: 'note',
    itemUuid: editingNote.uuid,
    title: editingNote.title || 'Shared note',
    onBeforeCreate: saveEditingNoteForShare,
  }));
  toolbar.appendChild(shareBtn);

  const copyBtn = el('button', {
    text: 'Copy',
    class: 'btn-secondary',
    style: 'font-size:12px;padding:4px 10px',
  });
  copyBtn.addEventListener('click', async () => {
    const ta = right.querySelector('.note-content-input');
    if (ta) editingNote.content = ta.value;
    await navigator.clipboard.writeText(editingNote.content || '');
    showToast('Copied to clipboard', 'success');
  });
  toolbar.appendChild(copyBtn);

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
    enhanceMarkdownFigures(previewDiv);
    previewDiv.title = 'Double-click to edit';
    previewDiv.addEventListener('dblclick', () => {
      previewMode = false;
      renderEditor();
    });
    right.appendChild(previewDiv);
  } else {
    const textarea = document.createElement('textarea');
    textarea.className = 'note-content-input';
    textarea.placeholder = 'Write your note here... (Markdown supported)';
    textarea.value = editingNote.content;
    textarea.addEventListener('input', () => { editingNote.content = textarea.value; });
    right.appendChild(textarea);
    attachToolbar(textarea, { enableImageUpload: true });
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
    await loadPinnedNotes();
  } catch (e) {
    showToast('Failed to save note: ' + e, 'error');
  }
}

async function saveEditingNoteForShare() {
  if (!editingNote) return null;
  const right = root.querySelector('#notes-right');
  const titleInput = right?.querySelector('.note-title-input');
  const textarea = right?.querySelector('.note-content-input');
  if (titleInput) editingNote.title = titleInput.value;
  if (textarea) editingNote.content = textarea.value;

  if (editingNote.id) {
    await call('update_note', {
      id: editingNote.id,
      title: editingNote.title,
      content: editingNote.content || '',
      isPinned: editingNote.is_pinned,
    });
    notes = notes.map(n => n.id === editingNote.id ? { ...n, ...editingNote } : n);
    return { itemUuid: editingNote.uuid, title: editingNote.title || 'Shared note' };
  }

  const created = await call('create_note', {
    folderId: selectedFolderId,
    title: editingNote.title || '',
    content: editingNote.content || '',
  });
  editingNote = { ...created };
  notes = [created, ...notes.filter(n => n.id !== created.id)];
  await loadPinnedNotes();
  return { itemUuid: created.uuid, title: created.title || 'Shared note' };
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
    await loadPinnedNotes();
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
  flex-direction: column;
  height: 100%;
  gap: 0;
}

.notes-body {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 0;
}

.pinned-chips-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
  min-height: 36px;
}
.pinned-chips-row.empty { display: none; }

.pinned-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  background: transparent;
  color: var(--text);
  user-select: none;
  max-width: 240px;
}
.pinned-chip:hover {
  border-color: var(--text-muted);
  background: var(--bg-secondary);
}
.pinned-chip-icon {
  font-size: 11px;
  line-height: 1;
}
.pinned-chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notes-chip-dnd-placeholder {
  display: inline-flex;
  border: 2px dashed var(--accent);
  border-radius: 4px;
  opacity: 0.55;
  pointer-events: none;
  flex-shrink: 0;
  background: rgba(56, 139, 253, 0.05);
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
  padding: 6px;
}

.notes-folder-item {
  display: flex;
  align-items: center;
  min-height: 30px;
  padding: 0 6px 0 var(--folder-indent, 6px);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  margin-bottom: 2px;
  position: relative;
  gap: 4px;
  border: 1px solid transparent;
  user-select: none;
}

.notes-folder-item:hover {
  background: var(--bg-secondary);
  border-color: var(--border);
}

.notes-folder-item.active {
  background: var(--bg-tertiary);
  border-color: rgba(56, 139, 253, 0.55);
  box-shadow: inset 2px 0 0 var(--accent);
}

.notes-folder-item.folder-drag-source {
  opacity: 0.38;
}

.notes-folder-item.folder-drop-inside {
  background: rgba(56, 139, 253, 0.14);
  border-color: var(--accent);
}

.folder-grip {
  width: 16px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: grab;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  flex-shrink: 0;
  opacity: 0.62;
}

.folder-grip:hover {
  background: var(--bg-tertiary);
  color: var(--text);
  opacity: 1;
}

.folder-grip:active {
  cursor: grabbing;
}

.folder-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
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
  width: 18px;
  font-size: 13px;
  flex-shrink: 0;
  text-align: center;
  margin-right: 0;
}

.folder-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  min-width: 0;
}

.folder-meta {
  width: 24px;
  height: 22px;
  display: inline-flex;
  justify-content: flex-end;
  align-items: center;
  flex-shrink: 0;
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
  margin-left: 0;
  transition: opacity 0.15s;
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
  display: flex;
  width: 70px;
  gap: 2px;
  flex-shrink: 0;
  justify-content: flex-end;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
}

.notes-folder-item:hover .folder-actions,
.notes-folder-item:focus-within .folder-actions {
  opacity: 1;
  pointer-events: auto;
}

.notes-folder-item:hover .folder-badge,
.notes-folder-item:focus-within .folder-badge {
  opacity: 0.25;
}

.notes-folder-drop-line {
  height: 0;
  border-top: 2px solid var(--accent);
  margin: 2px 6px 4px var(--folder-drop-indent, 28px);
  border-radius: 999px;
  box-shadow: 0 0 0 1px rgba(56, 139, 253, 0.18);
  pointer-events: none;
}

.notes-folder-drag-ghost {
  background: var(--bg-secondary);
  border: 1px solid var(--accent);
  border-radius: 4px;
  opacity: 0.94;
  transform: rotate(-0.6deg);
  box-shadow: 0 16px 32px rgba(0,0,0,0.5);
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
