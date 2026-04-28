import { call } from '../tauri-api.js';
import { showModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { openTemplatePicker } from './exec-templates.js';
import { installExecDnd } from './exec-dnd.js';

let root = null;
let categories = [];
let commands = [];
let selectedCategoryId = null;
let isRunning = false;
let categoryCounts = new Map();   // categoryId -> command count
const runAll = {
  running: false,
  aborted: false,
};

export function init(container) {
  root = container;
  root.innerHTML = '';
  root.classList.add('exec-tab');     // scope for V1 CSS overrides

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  root.appendChild(buildLayout());
  loadCategories();

  installExecDnd(root, {
    onMoveCommit: async (cmdId, targetGroupId) => {
      try {
        await call('move_exec_command', { id: cmdId, targetCategoryId: targetGroupId, sortOrder: 0 });
        const target = categories.find(c => c.id === targetGroupId);
        showToast(`Moved to "${target ? target.name : '#' + targetGroupId}"`, 'success');
        pulseGroup(targetGroupId);
        await loadCommands();
      } catch (e) {
        showToast('Move failed: ' + e, 'error');
      }
    },
    onReorderCommit: async (idsInOrder) => {
      try {
        await call('reorder_exec_commands', { idsInOrder });
        await loadCommands();
      } catch (e) {
        showToast('Reorder failed: ' + e, 'error');
      }
    },
    onMoveContextMenu: (cmdId, anchorEl) => openMoveToPopover(cmdId, anchorEl),
  });
}

// ── Layout ─────────────────────────────────────────────────

function buildLayout() {
  const wrap = el('div', { class: 'exec-wrap' });

  // Crumb header (V1 terminal aesthetic): `exec › <selected group>`
  const crumb = el('div', { class: 'exec-crumb' });
  crumb.innerHTML = '<span class="exec-crumb-root">exec</span><span class="exec-crumb-sep">›</span><span id="exec-crumb-name" class="exec-crumb-current">—</span>';
  wrap.appendChild(crumb);

  // Top area: categories + commands
  const topArea = el('div', { class: 'exec-top' });

  // Left panel: categories
  const left = el('div', { class: 'exec-left' });
  const leftHeader = el('div', { class: 'exec-panel-header' });
  leftHeader.appendChild(el('span', { text: 'Groups', class: 'exec-panel-title' }));
  const addCatBtn = el('button', { text: '+', class: 'btn-small' });
  addCatBtn.addEventListener('click', onAddCategory);
  leftHeader.appendChild(addCatBtn);
  left.appendChild(leftHeader);

  const catList = el('div', { class: 'exec-cat-list', id: 'exec-cat-list' });
  left.appendChild(catList);

  // Right panel: commands
  const right = el('div', { class: 'exec-right' });
  const rightHeader = el('div', { class: 'exec-panel-header' });
  rightHeader.appendChild(el('span', { text: 'Commands', class: 'exec-panel-title' }));
  const headerActions = el('div', { class: 'exec-right-actions' });
  const runAllBtn = el('button', { text: '▶ Run all', class: 'btn-secondary btn-small', id: 'run-all-btn' });
  runAllBtn.style.display = 'none';
  runAllBtn.addEventListener('click', onRunAll);
  headerActions.appendChild(runAllBtn);
  const addCmdBtn = el('button', { text: '+', class: 'btn-small', id: 'add-cmd-btn' });
  addCmdBtn.addEventListener('click', onAddCommand);
  headerActions.appendChild(addCmdBtn);
  rightHeader.appendChild(headerActions);
  right.appendChild(rightHeader);

  const cmdList = el('div', { class: 'exec-cmd-list', id: 'exec-cmd-list' });
  cmdList.innerHTML = '<p style="padding:12px;color:var(--text-muted)">Select a group</p>';
  right.appendChild(cmdList);

  topArea.appendChild(left);
  topArea.appendChild(right);
  wrap.appendChild(topArea);

  // Bottom panel: output console
  const bottom = el('div', { class: 'exec-bottom' });
  const bottomHeader = el('div', { class: 'exec-panel-header' });
  bottomHeader.appendChild(el('span', { text: 'Output', class: 'exec-panel-title' }));
  const stopBtn = el('button', { text: 'Stop', class: 'btn-secondary btn-small', id: 'exec-stop-btn' });
  stopBtn.style.display = 'none';
  stopBtn.addEventListener('click', onStop);
  bottomHeader.appendChild(stopBtn);
  bottom.appendChild(bottomHeader);

  // Run-all progress bar (above the console; only visible during run-all).
  const progressBar = el('div', { class: 'exec-progress-bar', id: 'exec-progress-bar' });
  progressBar.style.display = 'none';
  progressBar.innerHTML = `
    <div class="exec-progress-fill" id="exec-progress-fill"></div>
    <div class="exec-progress-label" id="exec-progress-label"></div>
  `;
  bottom.appendChild(progressBar);

  const consoleEl = el('div', { class: 'exec-console', id: 'exec-console' });
  consoleEl.textContent = 'Ready.';
  bottom.appendChild(consoleEl);

  wrap.appendChild(bottom);
  return wrap;
}

// ── Categories ─────────────────────────────────────────────

async function loadCategories() {
  try {
    const [cats, counts] = await Promise.all([
      call('list_exec_categories'),
      call('list_exec_command_counts').catch(() => []),
    ]);
    categories = cats || [];
    // Mock returns `null` for unimplemented commands (not throw), so the
    // `.catch` above doesn't fire. Defend against null/undefined here.
    categoryCounts = new Map(Array.isArray(counts) ? counts.map(([id, n]) => [id, n]) : []);
    renderCategories();
    if (categories.length && !selectedCategoryId) {
      selectCategory(categories[0].id);
    } else if (selectedCategoryId) {
      const still = categories.find(c => c.id === selectedCategoryId);
      if (still) selectCategory(selectedCategoryId);
      else if (categories.length) selectCategory(categories[0].id);
      else { selectedCategoryId = null; renderCommandsEmpty(); }
    } else {
      renderCommandsEmpty();
    }
  } catch (e) {
    showToast('Failed to load groups: ' + e, 'error');
  }
}

function renderCategories() {
  const list = root.querySelector('#exec-cat-list');
  if (!list) return;
  list.innerHTML = '';
  for (const c of categories) {
    const item = el('div', {
      class: 'exec-cat-item' + (c.id === selectedCategoryId ? ' active' : ''),
    });
    item.dataset.groupId = String(c.id);

    // Auto-letter Slack-style icon — square, colour deterministically from name.
    const icon = el('span', { text: firstLetter(c.name), class: 'exec-cat-icon' });
    icon.style.background = `hsl(${nameToHue(c.name)}, 50%, 45%)`;
    item.appendChild(icon);

    const nameSpan = el('span', { text: c.name, class: 'cat-name' });
    item.appendChild(nameSpan);

    const cnt = categoryCounts.get(c.id);
    if (cnt != null) {
      item.appendChild(el('span', { text: String(cnt).padStart(2, '0'), class: 'exec-cat-count' }));
    }

    const actions = el('span', { class: 'cat-actions' });
    const editBtn = el('button', { text: '\u270E', class: 'btn-icon', title: 'Edit' });
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); onEditCategory(c); });
    const deleteBtn = el('button', { text: '\u2715', class: 'btn-icon btn-icon-danger', title: 'Delete' });
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); onDeleteCategory(c); });
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(actions);

    item.addEventListener('click', () => selectCategory(c.id));
    list.appendChild(item);
  }
  updateCrumb();
}

// Deterministic name -> hue (0..359) so the same group name always renders
// in the same colour. Tiny FNV-32a hash, kept inline.
function nameToHue(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s || '')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

function firstLetter(s) {
  const m = String(s || '').match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : '?';
}

function updateCrumb() {
  const crumbName = root && root.querySelector('#exec-crumb-name');
  if (!crumbName) return;
  const cat = categories.find(c => c.id === selectedCategoryId);
  crumbName.textContent = cat ? cat.name : '—';
}

function selectCategory(id) {
  selectedCategoryId = id;
  renderCategories();
  updateCrumb();
  loadCommands();
}

async function onAddCategory() {
  const body = document.createElement('div');
  body.innerHTML = `
    <label style="display:block;margin-bottom:6px;color:var(--text)">Name</label>
    <input id="cat-name-input" style="width:100%" placeholder="Group name" />
    <label style="display:block;margin-top:8px;margin-bottom:6px;color:var(--text)">Sort order</label>
    <input id="cat-sort-input" type="number" style="width:100%" value="${categories.length}" />
  `;
  try {
    await showModal({
      title: 'New group',
      body,
      onConfirm: async () => {
        const name = document.getElementById('cat-name-input').value.trim();
        const sortOrder = parseInt(document.getElementById('cat-sort-input').value) || 0;
        if (!name) throw new Error('Name is required');
        await call('create_exec_category', { name, sortOrder });
        showToast('Group created', 'success');
      },
    });
    await loadCategories();
  } catch (_) { /* cancelled */ }
}

async function onEditCategory(cat) {
  const body = document.createElement('div');
  body.innerHTML = `
    <label style="display:block;margin-bottom:6px;color:var(--text)">Name</label>
    <input id="cat-name-input" style="width:100%" />
    <label style="display:block;margin-top:8px;margin-bottom:6px;color:var(--text)">Sort order</label>
    <input id="cat-sort-input" type="number" style="width:100%" />
  `;
  body.querySelector('#cat-name-input').value = cat.name || '';
  body.querySelector('#cat-sort-input').value = cat.sort_order ?? 0;
  try {
    await showModal({
      title: 'Edit group',
      body,
      onConfirm: async () => {
        const name = document.getElementById('cat-name-input').value.trim();
        const sortOrder = parseInt(document.getElementById('cat-sort-input').value) || 0;
        if (!name) throw new Error('Name is required');
        await call('update_exec_category', { id: cat.id, name, sortOrder });
        showToast('Group updated', 'success');
      },
    });
    await loadCategories();
  } catch (_) { /* cancelled */ }
}

async function onDeleteCategory(cat) {
  try {
    await showModal({
      title: 'Delete group',
      body: `Delete group "${cat.name}" and all its commands?`,
      onConfirm: async () => {
        await call('delete_exec_category', { id: cat.id });
        showToast('Group deleted', 'success');
      },
    });
    if (selectedCategoryId === cat.id) selectedCategoryId = null;
    await loadCategories();
  } catch (_) { /* cancelled */ }
}

// ── Commands ───────────────────────────────────────────────

async function loadCommands() {
  if (!selectedCategoryId) { renderCommandsEmpty(); return; }
  try {
    commands = await call('list_exec_commands', { categoryId: selectedCategoryId });
    renderCommands();
  } catch (e) {
    showToast('Failed to load commands: ' + e, 'error');
  }
}

function renderCommandsEmpty() {
  const list = root.querySelector('#exec-cmd-list');
  if (!list) return;
  list.innerHTML = '<p style="padding:12px;color:var(--text-muted)">Select a category</p>';
}

const RUN_ICON_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true"><polygon points="3,2 10,6 3,10"/></svg>';

function renderCommands() {
  const list = root.querySelector('#exec-cmd-list');
  if (!list) return;
  list.innerHTML = '';

  // Run-all button is only meaningful when the group has commands AND
  // we're not already in the middle of a run-all sequence.
  const runAllBtn = root.querySelector('#run-all-btn');
  if (runAllBtn && !runAll.running) {
    runAllBtn.style.display = commands.length > 0 ? '' : 'none';
  }

  if (!commands.length) {
    list.innerHTML = '<p style="padding:12px;color:var(--text-muted)">No commands yet</p>';
    return;
  }

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const card = el('div', { class: 'exec-cmd-card' });
    card.dataset.cmdId = String(cmd.id);

    // Drag-grip (leftmost): drag → move/reorder; click → "Move to" popover.
    const grip = el('span', { class: 'exec-cmd-grip', text: '⋮⋮', title: 'Drag to move/reorder · click for menu' });
    grip.dataset.dragKind = 'cmd';
    grip.dataset.cmdId = String(cmd.id);
    card.appendChild(grip);

    // Run-button (left): green play triangle inside a flat square (V1E).
    const runBtn = el('button', { class: 'exec-cmd-run', title: `Run ${cmd.name}` });
    runBtn.setAttribute('aria-label', `Run ${cmd.name}`);
    runBtn.innerHTML = RUN_ICON_SVG;
    runBtn.addEventListener('click', () => onRunCommand(cmd));
    card.appendChild(runBtn);

    // Body (centre): clickable name + WSL badge -> description -> command code.
    const body = el('div', { class: 'exec-cmd-body' });
    const header = el('div', { class: 'exec-cmd-header' });
    // Dim numeric prefix: 01, 02, … — quiet "what number is this in the
    // group" affordance. Lives inside the clickable name span so its
    // grouping is correct visually.
    const nameWrap = el('span', { class: 'exec-cmd-name-wrap' });
    const numEl = el('span', { text: String(i + 1).padStart(2, '0'), class: 'exec-cmd-num-prefix' });
    nameWrap.appendChild(numEl);
    const nameEl = el('span', { text: cmd.name, class: 'exec-cmd-name' });
    nameEl.setAttribute('role', 'button');
    nameEl.setAttribute('tabindex', '0');
    nameEl.title = 'Click to edit';
    nameEl.addEventListener('click', () => onEditCommand(cmd));
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEditCommand(cmd); }
    });
    nameWrap.appendChild(nameEl);
    header.appendChild(nameWrap);

    if (cmd.shell === 'wsl') {
      const label = cmd.wsl_distro ? `WSL · ${cmd.wsl_distro}` : 'WSL';
      const badge = el('span', { text: label });
      badge.style.cssText = 'padding:1px 7px;background:rgba(56,139,253,0.12);border:1px solid rgba(56,139,253,0.35);color:var(--accent);border-radius:10px;font-size:10px;font-weight:500';
      header.appendChild(badge);
    }
    body.appendChild(header);

    if (cmd.description) {
      body.appendChild(el('div', { text: cmd.description, class: 'exec-cmd-desc' }));
    }
    body.appendChild(el('code', { text: cmd.command, class: 'exec-cmd-code' }));
    card.appendChild(body);

    // Right: delete only. Edit lives behind the clickable name.
    const cardActions = el('div', { class: 'cmd-actions' });
    const delBtn = el('button', { text: '\u2715', class: 'btn-icon btn-icon-danger', title: 'Delete' });
    delBtn.addEventListener('click', () => onDeleteCommand(cmd));
    cardActions.appendChild(delBtn);
    card.appendChild(cardActions);

    list.appendChild(card);
  }
}

async function onAddCommand() {
  if (!selectedCategoryId) {
    showToast('Select a group first', 'info');
    return;
  }
  const body = buildCommandForm({});
  try {
    await showModal({
      title: 'New Command',
      body,
      onConfirm: async () => {
        const vals = readCommandForm();
        if (!vals.name) throw new Error('Name is required');
        const targetGroup = vals.groupId ?? selectedCategoryId;
        await call('create_exec_command', {
          categoryId: targetGroup,
          name: vals.name,
          command: vals.command,
          description: vals.description,
          sortOrder: vals.sortOrder,
          hideAfterRun: vals.hideAfterRun,
          shell: vals.shell,
          wslDistro: vals.wslDistro,
        });
        showToast('Command created', 'success');
      },
    });
    await loadCommands();
  } catch (_) { /* cancelled */ }
}

async function onEditCommand(cmd) {
  const body = buildCommandForm(cmd);
  try {
    await showModal({
      title: 'Edit Command',
      body,
      onConfirm: async () => {
        const vals = readCommandForm();
        if (!vals.name) throw new Error('Name is required');
        // If the user picked a different group in the dropdown — move
        // the command to that group first, then save the rest of the
        // form in-place. Two sequential awaits are fine here (single
        // user, single edit modal).
        if (vals.groupId != null && vals.groupId !== cmd.category_id) {
          await call('move_exec_command', {
            id: cmd.id,
            targetCategoryId: vals.groupId,
            sortOrder: vals.sortOrder,
          });
        }
        await call('update_exec_command', {
          id: cmd.id,
          name: vals.name,
          command: vals.command,
          description: vals.description,
          sortOrder: vals.sortOrder,
          hideAfterRun: vals.hideAfterRun,
          shell: vals.shell,
          wslDistro: vals.wslDistro,
        });
        showToast('Command updated', 'success');
      },
    });
    await loadCommands();
  } catch (_) { /* cancelled */ }
}

async function onDeleteCommand(cmd) {
  try {
    await showModal({
      title: 'Delete Command',
      body: `Delete command "${cmd.name}"?`,
      onConfirm: async () => {
        await call('delete_exec_command', { id: cmd.id });
        showToast('Command deleted', 'success');
      },
    });
    await loadCommands();
  } catch (_) { /* cancelled */ }
}

function buildCommandForm(cmd) {
  const body = document.createElement('div');
  // Build group <option>s from the in-memory categories[] cache. Falls
  // back to selectedCategoryId for the New-command flow when cmd has no
  // category_id yet.
  const currentGroupId = cmd.category_id ?? selectedCategoryId;
  const groupOptions = categories.map(g =>
    `<option value="${g.id}" ${g.id === currentGroupId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
  ).join('');
  body.innerHTML = `
    <label style="display:block;margin-bottom:4px;color:var(--text)">Name</label>
    <input id="cmd-name" style="width:100%" placeholder="Command name" />
    <label style="display:block;margin-top:8px;margin-bottom:4px;color:var(--text)">Group</label>
    <select id="cmd-group" style="width:100%">${groupOptions}</select>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;margin-bottom:4px">
      <label style="color:var(--text)">Command</label>
      <button type="button" id="cmd-tpl-btn" class="btn-secondary" style="padding:2px 8px;font-size:12px">Use template</button>
    </div>
    <textarea id="cmd-command" style="width:100%;min-height:60px;font-family:monospace" placeholder="echo hello"></textarea>
    <div style="display:flex;gap:8px;margin-top:8px;align-items:flex-start">
      <div style="flex:1">
        <label style="display:block;margin-bottom:4px;color:var(--text)">Shell</label>
        <select id="cmd-shell" style="width:100%">
          <option value="host">Host (cmd / sh)</option>
          <option value="wsl">WSL (Windows only)</option>
        </select>
      </div>
      <div id="cmd-distro-wrap" style="flex:1;display:none">
        <label style="display:block;margin-bottom:4px;color:var(--text)">WSL distro</label>
        <select id="cmd-distro" style="width:100%">
          <option value="">(default)</option>
        </select>
      </div>
    </div>
    <label style="display:block;margin-top:8px;margin-bottom:4px;color:var(--text)">Description</label>
    <input id="cmd-desc" style="width:100%" placeholder="Optional description" />
    <label style="display:block;margin-top:8px;margin-bottom:4px;color:var(--text)">Sort order</label>
    <input id="cmd-sort" type="number" style="width:100%" />
    <label style="display:flex;align-items:center;gap:6px;margin-top:8px;color:var(--text)">
      <input type="checkbox" id="cmd-hide" /> Hide window after run
    </label>
  `;
  body.querySelector('#cmd-name').value = cmd.name || '';
  body.querySelector('#cmd-command').value = cmd.command || '';
  body.querySelector('#cmd-desc').value = cmd.description || '';
  body.querySelector('#cmd-sort').value = cmd.sort_order ?? 0;
  body.querySelector('#cmd-hide').checked = !!cmd.hide_after_run;

  const shellSel = body.querySelector('#cmd-shell');
  const distroWrap = body.querySelector('#cmd-distro-wrap');
  const distroSel = body.querySelector('#cmd-distro');
  shellSel.value = cmd.shell || 'host';

  // Lazy-populate the distro list from wsl.exe -l -q. On Mac/Linux the
  // call returns [] and we disable the WSL option with a hint.
  (async () => {
    let distros = [];
    try { distros = await call('list_wsl_distros'); } catch { distros = []; }
    if (distros && distros.length) {
      for (const d of distros) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        distroSel.appendChild(opt);
      }
      if (cmd.wsl_distro) distroSel.value = cmd.wsl_distro;
    } else {
      // No distros found (either no WSL installed, or on non-Windows).
      // Keep WSL selectable so sync'd commands from Windows still save
      // — but show a hint in the option.
      const wslOpt = shellSel.querySelector('option[value="wsl"]');
      if (wslOpt) wslOpt.textContent = 'WSL (not available on this machine)';
    }
    updateDistroVisibility();
  })();

  function updateDistroVisibility() {
    distroWrap.style.display = shellSel.value === 'wsl' ? '' : 'none';
  }
  shellSel.addEventListener('change', updateDistroVisibility);

  body.querySelector('#cmd-tpl-btn').addEventListener('click', async () => {
    const result = await openTemplatePicker();
    if (!result) return;
    const nameInput = document.getElementById('cmd-name');
    const cmdInput = document.getElementById('cmd-command');
    if (cmdInput) cmdInput.value = result.command;
    if (nameInput && !nameInput.value.trim()) nameInput.value = result.name;
  });

  return body;
}

function readCommandForm() {
  const shell = document.getElementById('cmd-shell').value || 'host';
  const distroVal = document.getElementById('cmd-distro').value || '';
  const groupSel = document.getElementById('cmd-group');
  const groupId = groupSel ? parseInt(groupSel.value) : null;
  return {
    name: document.getElementById('cmd-name').value.trim(),
    command: document.getElementById('cmd-command').value.trim(),
    description: document.getElementById('cmd-desc').value.trim(),
    sortOrder: parseInt(document.getElementById('cmd-sort').value) || 0,
    hideAfterRun: document.getElementById('cmd-hide').checked,
    shell,
    // Empty string = use default distro; store as null in DB.
    wslDistro: shell === 'wsl' && distroVal ? distroVal : null,
    groupId: Number.isFinite(groupId) ? groupId : null,
  };
}

// ── Run / Stop ─────────────────────────────────────────────

async function onRunCommand(cmd) {
  const console_ = root.querySelector('#exec-console');
  const stopBtn = root.querySelector('#exec-stop-btn');
  if (!console_ || isRunning) return;

  isRunning = true;
  stopBtn.style.display = '';
  console_.textContent = `Running: ${cmd.command}\n...\n`;

  try {
    const output = await call('run_command', {
      command: cmd.command,
      shell: cmd.shell || 'host',
      wslDistro: cmd.wsl_distro || null,
    });
    console_.textContent = output;
  } catch (e) {
    console_.textContent = `Error: ${e}`;
  } finally {
    isRunning = false;
    stopBtn.style.display = 'none';
  }
}

async function onStop() {
  try {
    await call('stop_command');
    showToast('Stop signal sent', 'info');
  } catch (e) {
    showToast('Stop error: ' + e, 'error');
  }
}

// ── Run-all ────────────────────────────────────────────────

async function onRunAll() {
  if (runAll.running || isRunning) return;
  if (!commands.length) { showToast('No commands in group', 'info'); return; }

  runAll.running = true;
  runAll.aborted = false;
  isRunning = true;        // gates single-card Run during the sequence
  setRunAllUI(true);
  clearConsole();
  // SNAPSHOT: take an immutable copy of the queue so the loop can't be
  // corrupted if the user (or any other code path) mutates `commands`
  // mid-run — e.g. by switching to a different group, which calls
  // loadCommands and reassigns the module-level array. Without this
  // snapshot, a switch mid-run causes a TypeError on `commands[i]` when
  // the new group is shorter, leaving the tab permanently locked.
  const queue = commands.slice();
  appendConsoleHeader(`══════ Run all started — ${queue.length} commands ══════`);
  const groupStartT = performance.now();
  let allOk = true;
  let stoppedAt = -1;

  try {
    for (let i = 0; i < queue.length; i++) {
      if (runAll.aborted) break;
      const cmd = queue[i];
      setProgressBar(i, queue.length, `Running ${i+1}/${queue.length}: ${cmd.name}`);
      highlightCard(cmd.id);
      const sec = appendConsoleSection(cmd, i + 1, queue.length);
      const t0 = performance.now();
      try {
        const output = await call('run_command', {
          command: cmd.command,
          shell: cmd.shell || 'host',
          wslDistro: cmd.wsl_distro || null,
        });
        const ms = performance.now() - t0;
        sec.outputEl.textContent = output;
        sec.markOk(ms);
        sec.autoCollapse();
      } catch (e) {
        const ms = performance.now() - t0;
        sec.outputEl.textContent = String(e);
        sec.markFail(String(e), ms);
        stoppedAt = i + 1;
        allOk = false;
        break;       // RA1=a fail-fast
      }
    }
  } finally {
    // ALWAYS reset state — even on unexpected error in the loop above —
    // so the tab can't get stuck with isRunning=true.
    unhighlightCard();
    hideProgressBar();
    runAll.running = false;
    isRunning = false;
    setRunAllUI(false);
  }

  if (runAll.aborted) {
    appendConsoleHeader(`⊘ Stopped by user`);
  } else if (!allOk) {
    appendConsoleHeader(`══════ Sequence stopped at ${stoppedAt}/${queue.length} ══════`);
  } else {
    const totalMs = performance.now() - groupStartT;
    appendConsoleHeader(`✓ All ${queue.length} commands done in ${(totalMs/1000).toFixed(1)}s`);
  }
}

async function onStopAll() {
  if (!runAll.running) return;
  runAll.aborted = true;
  try { await call('stop_command'); } catch (_) { /* non-fatal */ }
  showToast('Run-all stopped', 'info');
}

function setRunAllUI(running) {
  const btn = root.querySelector('#run-all-btn');
  if (!btn) return;
  if (running) {
    btn.textContent = '⏹ Stop all';
    btn.onclick = onStopAll;
  } else {
    btn.textContent = '▶ Run all';
    btn.onclick = onRunAll;
    // Visibility back to "shown only when commands exist".
    btn.style.display = commands.length > 0 ? '' : 'none';
  }
}

// Console builders (used by run-all). Single-run still uses textContent.

function clearConsole() {
  const c = root.querySelector('#exec-console');
  if (c) c.innerHTML = '';
}

function appendConsoleHeader(text) {
  const c = root.querySelector('#exec-console');
  if (!c) return;
  const line = document.createElement('div');
  line.className = 'exec-console-header';
  line.textContent = text;
  c.appendChild(line);
  c.scrollTop = c.scrollHeight;
}

function appendConsoleSection(cmd, idx, total) {
  const c = root.querySelector('#exec-console');
  const det = document.createElement('details');
  det.className = 'exec-console-section';
  det.open = true;
  const summary = document.createElement('summary');
  const shellLabel = cmd.shell === 'wsl' ? `wsl${cmd.wsl_distro ? ' · ' + cmd.wsl_distro : ''}` : 'host';
  summary.textContent = `▶ ${idx}/${total}: ${cmd.name}  (${shellLabel})`;
  summary.className = 'exec-console-section-summary running';
  det.appendChild(summary);
  const outputEl = document.createElement('pre');
  outputEl.className = 'exec-console-section-output';
  det.appendChild(outputEl);
  c.appendChild(det);
  c.scrollTop = c.scrollHeight;

  return {
    detailsEl: det,
    outputEl,
    markOk: (ms) => {
      summary.classList.remove('running');
      summary.classList.add('ok');
      summary.textContent = `✓ ${idx}/${total}: ${cmd.name}  (${shellLabel})  · ${(ms/1000).toFixed(1)}s`;
    },
    markFail: (_err, ms) => {
      summary.classList.remove('running');
      summary.classList.add('fail');
      summary.textContent = `✗ ${idx}/${total}: ${cmd.name}  (${shellLabel})  · failed in ${(ms/1000).toFixed(1)}s`;
    },
    autoCollapse: () => {
      // Auto-collapse successful sections after a short delay so the user
      // sees the green tick, then the section folds to keep the console
      // tidy. Failed sections stay expanded so the error is visible.
      setTimeout(() => { det.open = false; }, 800);
    },
  };
}

function setProgressBar(currentIdx, total, label) {
  const bar = root.querySelector('#exec-progress-bar');
  const fill = root.querySelector('#exec-progress-fill');
  const lbl = root.querySelector('#exec-progress-label');
  if (!bar || !fill || !lbl) return;
  bar.style.display = '';
  fill.style.width = `${Math.round((currentIdx / Math.max(total, 1)) * 100)}%`;
  lbl.textContent = label;
}

function hideProgressBar() {
  const bar = root.querySelector('#exec-progress-bar');
  if (bar) bar.style.display = 'none';
  const fill = root.querySelector('#exec-progress-fill');
  if (fill) fill.style.width = '0%';
}

function highlightCard(cmdId) {
  unhighlightCard();
  const card = root.querySelector(`.exec-cmd-card[data-cmd-id="${cmdId}"]`);
  if (card) {
    card.classList.add('exec-cmd-running');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function unhighlightCard() {
  for (const c of root.querySelectorAll('.exec-cmd-card.exec-cmd-running')) {
    c.classList.remove('exec-cmd-running');
  }
}

// ── Helpers ────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Briefly pulse a group's left-panel item so the user can spot where a
// command was just moved (per spec Q3=c).
function pulseGroup(groupId) {
  if (!root) return;
  const item = root.querySelector(`.exec-cat-item[data-group-id="${groupId}"]`);
  if (!item) return;
  item.classList.add('exec-dnd-target-pulse');
  setTimeout(() => item.classList.remove('exec-dnd-target-pulse'), 1500);
}

// Pop-up menu anchored to a grip handle; lets the user move the command to
// any group without using DnD (accessibility / touchpad alternative, Q5=b).
function openMoveToPopover(cmdId, anchorEl) {
  // Close any existing popover first.
  const stale = document.querySelector('.exec-move-popover');
  if (stale) stale.remove();

  const cmd = commands.find(c => c.id === cmdId);
  const currentGroupId = cmd ? cmd.category_id : null;

  const pop = document.createElement('div');
  pop.className = 'exec-move-popover';
  const rect = anchorEl.getBoundingClientRect();
  pop.style.cssText = `position:fixed;left:${Math.round(rect.right + 4)}px;top:${Math.round(rect.top)}px;`
    + 'background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;'
    + 'box-shadow:0 8px 24px rgba(0,0,0,0.45);padding:6px 0;z-index:9000;min-width:200px;font-size:13px';

  const header = document.createElement('div');
  header.textContent = 'Move to:';
  header.style.cssText = 'padding:4px 12px 6px;color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border);margin-bottom:4px';
  pop.appendChild(header);

  for (const g of categories) {
    const isCurrent = g.id === currentGroupId;
    const row = document.createElement('div');
    row.style.cssText = `padding:6px 12px;cursor:${isCurrent ? 'default' : 'pointer'};color:${isCurrent ? 'var(--text-muted)' : 'var(--text)'}`;
    row.textContent = g.name + (isCurrent ? '   · current' : '');
    if (!isCurrent) {
      row.addEventListener('mouseenter', () => { row.style.background = 'var(--bg-tertiary)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('click', async () => {
        pop.remove();
        try {
          await call('move_exec_command', { id: cmdId, targetCategoryId: g.id, sortOrder: 0 });
          showToast(`Moved to "${g.name}"`, 'success');
          pulseGroup(g.id);
          await loadCommands();
        } catch (e) {
          showToast('Move failed: ' + e, 'error');
        }
      });
    }
    pop.appendChild(row);
  }

  document.body.appendChild(pop);

  // Dismiss on outside click / Esc.
  const onDoc = (e) => {
    if (!pop.contains(e.target)) cleanup();
  };
  const onKey = (e) => { if (e.key === 'Escape') cleanup(); };
  function cleanup() {
    pop.remove();
    document.removeEventListener('mousedown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
  }
  // Defer attach so the originating pointerup doesn't immediately close us.
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
}

function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.class) e.className = opts.class;
  if (opts.text) e.textContent = opts.text;
  if (opts.id) e.id = opts.id;
  if (opts.style) e.setAttribute('style', opts.style);
  if (opts.title) e.title = opts.title;
  return e;
}

function css() {
  return `
.exec-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.exec-top {
  display: flex;
  flex: 1;
  min-height: 0;
}
.exec-left {
  width: 220px;
  min-width: 220px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.exec-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.exec-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px 12px;
  border-bottom: 1px solid var(--border);
}
.exec-panel-title {
  font-weight: 600;
  font-size: 14px;
}
.exec-cat-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}
.exec-cat-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 2px;
}
.exec-cat-item:hover {
  background: var(--bg-secondary);
}
.exec-cat-item.active {
  background: var(--bg-secondary);
  border-left: 3px solid var(--accent);
  padding-left: 7px;
}
.exec-cat-item.exec-dnd-drop-target-group {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
}
.exec-cat-item.exec-dnd-target-pulse {
  animation: exec-dnd-pulse 1.5s ease-out;
}
@keyframes exec-dnd-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(56,139,253,0.55); background: rgba(56,139,253,0.18); }
  60%  { box-shadow: 0 0 0 6px rgba(56,139,253,0.0);  background: rgba(56,139,253,0.10); }
  100% { box-shadow: 0 0 0 0 rgba(56,139,253,0.0);    background: transparent; }
}
.cat-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cat-actions {
  display: none;
  gap: 2px;
}
.exec-cat-item:hover .cat-actions {
  display: flex;
}
.exec-cmd-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.exec-cmd-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 10px 12px;
  border-left: 3px solid transparent;
  transition: border-color 0.15s;
}
.exec-cmd-card:hover {
  border-left-color: var(--accent);
}
.exec-cmd-card:hover .exec-cmd-grip {
  opacity: 1;
}
.exec-cmd-grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 14px;
  min-height: 32px;
  color: var(--text-muted);
  cursor: grab;
  font-size: 14px;
  line-height: 1;
  user-select: none;
  opacity: 0.4;
  transition: opacity 0.12s, color 0.12s;
}
.exec-cmd-grip:hover { color: var(--text); }
.exec-cmd-grip:active { cursor: grabbing; }
/* Drag visuals (used by exec-dnd.js). */
.exec-dnd-drag-clone {
  /* Floating ghost — exec-dnd.js sets position/left/top/width inline. */
  pointer-events: none;
  border-radius: 6px;
}
.exec-dnd-source-dimmed {
  opacity: 0.4;
}
.exec-dnd-insertion-line {
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
  margin: 1px 0;
  pointer-events: none;
}
.exec-cmd-run {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  background: rgba(63, 185, 80, 0.10);
  border: 1px solid var(--green, #3fb950);
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  clip-path: polygon(20% 0%, 80% 0%, 100% 20%, 100% 80%, 80% 100%, 20% 100%, 0% 80%, 0% 20%);
  transition: background 0.15s, transform 0.1s;
}
.exec-cmd-run:hover { background: rgba(63, 185, 80, 0.22); }
.exec-cmd-run:active { transform: scale(0.94); }
.exec-cmd-run svg { width: 14px; height: 14px; fill: var(--green, #3fb950); }
.exec-cmd-run:disabled { opacity: 0.4; cursor: not-allowed; }
.exec-cmd-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.exec-cmd-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.exec-cmd-name {
  font-weight: 600;
  cursor: pointer;
  color: var(--text);
  transition: color 0.12s;
}
.exec-cmd-name:hover { color: var(--accent); text-decoration: underline; }
.exec-cmd-name:focus { outline: 1px solid var(--accent); outline-offset: 2px; }
.cmd-actions {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-shrink: 0;
}
.exec-cmd-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.exec-cmd-code {
  display: block;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  padding: 4px 8px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.exec-bottom {
  height: 200px;
  min-height: 120px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
.exec-console {
  flex: 1;
  margin: 0;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.5;
  background: #1e1e2e;
  color: #cdd6f4;
  overflow: auto;
  white-space: pre-wrap;
}
/* Run-all artefacts inside the console. */
.exec-console-header {
  color: #6e7681;
  margin: 4px 0;
  white-space: pre-wrap;
}
.exec-console-section {
  margin: 2px 0;
  border-left: 2px solid #30363d;
  padding-left: 8px;
}
.exec-console-section-summary {
  cursor: pointer;
  list-style: none;
  user-select: none;
  font-weight: 500;
  padding: 2px 0;
}
.exec-console-section-summary::-webkit-details-marker { display: none; }
.exec-console-section-summary.running { color: var(--accent); }
.exec-console-section-summary.ok      { color: var(--green, #3fb950); }
.exec-console-section-summary.fail    { color: var(--red, #f85149); }
.exec-console-section[open] {
  border-left-color: var(--accent);
}
.exec-console-section-output {
  margin: 4px 0 8px 0;
  padding: 4px 0;
  white-space: pre-wrap;
  color: #cdd6f4;
  font-family: inherit;
  font-size: inherit;
}
/* Run-all progress strip. */
.exec-progress-bar {
  position: relative;
  height: 22px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  flex-shrink: 0;
}
.exec-progress-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0%;
  background: rgba(56, 139, 253, 0.18);
  transition: width 200ms linear;
}
.exec-progress-label {
  position: relative;
  z-index: 1;
  padding: 3px 12px;
  font-size: 11px;
  color: var(--text-muted);
  font-family: inherit;
}
/* Highlight on the currently-running card during run-all. */
.exec-cmd-card.exec-cmd-running {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
  animation: exec-cmd-running-pulse 1.4s ease-in-out infinite;
}
@keyframes exec-cmd-running-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(56,139,253,0.0); }
  50%      { box-shadow: 0 0 0 4px rgba(56,139,253,0.18); }
}
.exec-right-actions {
  display: flex;
  gap: 6px;
  align-items: center;
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
  font-size: 14px;
  line-height: 1;
}

/* ════════════════════════════════════════════════════════════════════════
   V1E SKIN — Terminal · Brutalist · spacious + inline numbers
   Scoped under .exec-tab so it doesn't leak to other tabs.
   ════════════════════════════════════════════════════════════════════════ */
.exec-tab {
  --v1-bg: #0a0a0a;
  --v1-bg-2: #050505;
  --v1-fg: #e8e8e8;
  --v1-dim: #6e7681;
  --v1-line: #2a2a2a;
  --v1-line-strong: #3d3d3d;
  --v1-accent: #00ff88;
  --v1-accent-soft: rgba(0,255,136,0.12);
  --v1-amber: #ffb454;
  --v1-red: #ff5555;
  background: var(--v1-bg);
  color: var(--v1-fg);
  font-family: 'JetBrains Mono', 'IBM Plex Mono', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
  font-feature-settings: 'tnum';
}
.exec-tab .exec-wrap { background: var(--v1-bg); }
.exec-tab .exec-top { background: var(--v1-bg); }
.exec-tab .exec-left {
  border-right: 1px solid var(--v1-line);
  background: var(--v1-bg);
}
.exec-tab .exec-right { background: var(--v1-bg); }

/* Top crumb header */
.exec-tab .exec-crumb {
  background: var(--v1-bg-2);
  border-bottom: 1px solid var(--v1-line);
  padding: 4px 12px;
  font-size: 11px;
  color: var(--v1-dim);
  display: flex;
  gap: 8px;
  align-items: center;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}
.exec-tab .exec-crumb-current { color: var(--v1-fg); font-weight: 500; }
.exec-tab .exec-crumb-sep { color: #444; }

/* Panel headers */
.exec-tab .exec-panel-header {
  background: var(--v1-bg-2);
  border-bottom: 1px solid var(--v1-line);
  padding: 8px 12px;
}
.exec-tab .exec-panel-title {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--v1-dim);
  font-weight: 500;
}

/* Left: groups list */
.exec-tab .exec-cat-list { padding: 4px 0; }
.exec-tab .exec-cat-item {
  display: grid;
  grid-template-columns: 22px 1fr auto auto;
  gap: 8px;
  align-items: center;
  padding: 4px 12px;
  margin-bottom: 0;
  border-radius: 0;
  border-left: 2px solid transparent;
  font-variant-numeric: tabular-nums;
  transition: background 0.12s;
}
.exec-tab .exec-cat-item:hover { background: rgba(255,255,255,0.025); }
.exec-tab .exec-cat-item.active {
  background: rgba(0,255,136,0.04);
  border-left-color: var(--v1-accent);
  padding-left: 10px;
}
.exec-tab .exec-cat-icon {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 10px;
  color: #050505;
  font-family: 'JetBrains Mono', monospace;
  border-radius: 0;
  flex-shrink: 0;
}
.exec-tab .cat-name {
  font-size: 12px;
  color: var(--v1-fg);
  font-family: 'JetBrains Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.exec-tab .exec-cat-count {
  color: var(--v1-dim);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.exec-tab .exec-cat-item .cat-actions { display: none; }
.exec-tab .exec-cat-item:hover .cat-actions { display: flex; }
.exec-tab .btn-icon { color: var(--v1-dim); }
.exec-tab .btn-icon:hover { color: var(--v1-fg); background: transparent; }
.exec-tab .btn-icon-danger:hover { color: var(--v1-red); }

/* Right header: actions */
.exec-tab .exec-right-actions { gap: 6px; align-items: center; }
.exec-tab #run-all-btn,
.exec-tab #add-cmd-btn,
.exec-tab #exec-stop-btn {
  background: transparent;
  color: var(--v1-accent);
  border: 1px solid var(--v1-accent);
  border-radius: 0;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.05em;
  padding: 3px 8px;
  cursor: pointer;
  text-transform: uppercase;
}
.exec-tab #run-all-btn:hover,
.exec-tab #add-cmd-btn:hover { background: var(--v1-accent-soft); }
.exec-tab #exec-stop-btn { color: var(--v1-red); border-color: var(--v1-red); }
.exec-tab .exec-panel-header > button { color: var(--v1-accent); }

/* Right: command list — V1E (spacious, per-row borders, inline numbers) */
.exec-tab .exec-cmd-list {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--v1-bg);
}
.exec-tab .exec-cmd-card {
  display: grid;
  grid-template-columns: 18px 32px 1fr 24px;
  align-items: stretch;
  gap: 0;
  padding: 0;
  background: rgba(255,255,255,0.012);
  border: 1px solid var(--v1-line);
  border-radius: 0;
  border-left: 1px solid var(--v1-line);
  transition: background 0.12s, border-color 0.12s;
}
.exec-tab .exec-cmd-card:hover {
  background: rgba(255,255,255,0.025);
  border-color: var(--v1-line-strong);
  border-left-color: var(--v1-accent);
}
.exec-tab .exec-cmd-grip {
  width: 18px;
  min-height: auto;
  color: #444;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  align-self: stretch;
  display: grid;
  place-items: center;
  opacity: 0.6;
}
.exec-tab .exec-cmd-card:hover .exec-cmd-grip { opacity: 1; }
.exec-tab .exec-cmd-grip:hover { color: var(--v1-fg); }
.exec-tab .exec-cmd-run {
  width: 32px;
  height: auto;
  background: var(--v1-accent-soft);
  border: 0;
  border-right: 1px solid var(--v1-line);
  clip-path: none;
  border-radius: 0;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background 0.12s;
}
.exec-tab .exec-cmd-run:hover {
  background: var(--v1-accent);
  transform: none;
}
.exec-tab .exec-cmd-run svg { width: 12px; height: 12px; fill: var(--v1-accent); transition: fill 0.12s; }
.exec-tab .exec-cmd-run:hover svg { fill: #050505; }
.exec-tab .exec-cmd-body {
  padding: 6px 10px;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  display: flex;
}
.exec-tab .exec-cmd-header { gap: 8px; align-items: baseline; flex-wrap: wrap; }
.exec-tab .exec-cmd-name-wrap {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  cursor: default;
}
.exec-tab .exec-cmd-num-prefix {
  color: #444;
  font-weight: 400;
  font-size: 10px;
  letter-spacing: 0.05em;
  font-variant-numeric: tabular-nums;
  font-family: 'JetBrains Mono', monospace;
  user-select: none;
  pointer-events: none;     /* clicks fall through to the name span */
}
.exec-tab .exec-cmd-name {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 500;
  font-size: 12px;
  color: var(--v1-fg);
}
.exec-tab .exec-cmd-name:hover {
  color: var(--v1-accent);
  text-decoration: none;
}
.exec-tab .exec-cmd-desc {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--v1-dim);
  margin-bottom: 0;
}
.exec-tab .exec-cmd-code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--v1-dim);
  background: transparent;
  padding: 0;
  border-radius: 0;
}
.exec-tab .exec-cmd-card .cmd-actions { padding: 0; }
.exec-tab .exec-cmd-card .cmd-actions .btn-icon {
  border-left: 1px solid var(--v1-line);
  height: 100%;
  width: 24px;
  border-radius: 0;
  font-size: 12px;
  display: grid;
  place-items: center;
  padding: 0;
}

/* Running highlight (during run-all) */
.exec-tab .exec-cmd-card.exec-cmd-running {
  background: rgba(0,255,136,0.06);
  border-color: var(--v1-accent);
  outline: none;
  box-shadow: inset 2px 0 0 var(--v1-accent);
  animation: none;
}
.exec-tab .exec-cmd-card.exec-cmd-running .exec-cmd-name { color: var(--v1-accent); }
.exec-tab .exec-cmd-card.exec-cmd-running .exec-cmd-num-prefix { color: var(--v1-accent); opacity: 0.55; }

/* Drop-target highlights */
.exec-tab .exec-cat-item.exec-dnd-drop-target-group {
  outline: 1px dashed var(--v1-accent);
  outline-offset: -1px;
  background: rgba(0,255,136,0.05);
}
.exec-tab .exec-dnd-source-dimmed { opacity: 0.35; }
.exec-tab .exec-dnd-insertion-line {
  height: 2px;
  background: var(--v1-accent);
  margin: 1px 0;
  pointer-events: none;
}
.exec-tab .exec-dnd-drag-clone {
  background: var(--v1-bg-2);
  border: 1px solid var(--v1-accent) !important;
  box-shadow: 0 8px 22px rgba(0,255,136,0.25);
}

/* Console — V1 phosphor look */
.exec-tab .exec-bottom {
  border-top: 1px solid var(--v1-line-strong);
  background: var(--v1-bg-2);
}
.exec-tab .exec-console {
  background: var(--v1-bg-2);
  color: #cdd6f4;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  line-height: 1.55;
}
.exec-tab .exec-progress-bar {
  background: var(--v1-bg-2);
  border-bottom: 1px solid var(--v1-line);
  height: 22px;
}
.exec-tab .exec-progress-fill {
  background: rgba(0,255,136,0.20);
}
.exec-tab .exec-progress-label {
  color: var(--v1-accent);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.05em;
}
.exec-tab .exec-console-header { color: var(--v1-dim); }
.exec-tab .exec-console-section { border-left-color: var(--v1-line); }
.exec-tab .exec-console-section[open] { border-left-color: var(--v1-accent); }
.exec-tab .exec-console-section-summary.running { color: var(--v1-accent); }
.exec-tab .exec-console-section-summary.ok { color: var(--v1-accent); }
.exec-tab .exec-console-section-summary.fail { color: var(--v1-red); }
.exec-tab .exec-console-section-output { color: #cdd6f4; }

/* Group icon hover-highlight when DnD is over the group */
.exec-tab .exec-cat-item.exec-dnd-target-pulse {
  animation: exec-v1-pulse 1.4s ease-out;
}
@keyframes exec-v1-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(0,255,136,0.55); background: rgba(0,255,136,0.16); }
  60%  { box-shadow: 0 0 0 6px rgba(0,255,136,0.0);  background: rgba(0,255,136,0.08); }
  100% { box-shadow: 0 0 0 0 rgba(0,255,136,0.0);    background: transparent; }
}

/* Move-to popover (context menu from grip click) */
.exec-tab .exec-move-popover,
body .exec-move-popover {
  background: var(--v1-bg-2, #050505) !important;
  border: 1px solid var(--v1-accent, #00ff88) !important;
  border-radius: 0 !important;
  font-family: 'JetBrains Mono', monospace !important;
}
`;
}
