import { call } from '../tauri-api.js';
import { showToast } from '../components/toast.js';
import { showModal } from '../components/modal.js';
import { ALL_ICONS, iconKey, renderIcon } from '../icons/index.js';

let root = null;
let searchType = 'files';   // files | content | git
let lastSearchType = 'files'; // what type was last search
let sortMode = 'name';      // name | date
let results = [];
let contentResults = [];
let gitResults = [];
let settingsOpen = false;
let activeRepos = new Set();  // names of selected repos
let allRepos = [];            // RepoEntry[]
let allGroups = [];           // RepoGroup[]
let activeTabId = 'all';      // 'all' | group.id (number) | 'ungrouped'
let contextLines = 3;
let draggingRepoName = null;  // populated during chip drag — tab drop-targets check this instead of dataTransfer (WebKit strips custom MIME types in dragover)

export function init(container) {
  root = container;
  root.innerHTML = '';
  root.style.position = 'relative';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  loadInitData().then(() => {
    root.appendChild(buildLayout());
    window.__rsRefreshAfterGroupDelete = reloadAndRerender;
  });
}

export function destroy() {
  if (root) root.innerHTML = '';
  results = [];
  activeTabId = 'all';   // reset so the next init starts clean
}

async function loadInitData() {
  try {
    allRepos = await call('list_repos');
    allGroups = await call('list_repo_groups');
    activeRepos = new Set(allRepos.map(r => r.name));
    // Clamp activeTabId if it points at a now-deleted group.
    if (typeof activeTabId === 'number' && !allGroups.some(g => g.id === activeTabId)) {
      activeTabId = 'all';
    }
  } catch {
    allRepos = []; allGroups = []; activeRepos = new Set(); activeTabId = 'all';
  }
  try {
    const val = await call('get_setting', { key: 'search_context_lines' });
    contextLines = parseInt(val) || 3;
  } catch { contextLines = 3; }
}

function reposForActiveTab() {
  if (activeTabId === 'all') return allRepos;
  if (activeTabId === 'ungrouped') return allRepos.filter(r => !r.group_id);
  return allRepos.filter(r => r.group_id === activeTabId);
}

function hasUngroupedRepos() {
  return allRepos.some(r => !r.group_id);
}

// ── Layout ─────────────────────────────────────────────────

function buildLayout() {
  const wrap = el('div', { class: 'rs-wrap' });

  // Top bar: search input + type selector + settings gear
  const topBar = el('div', { class: 'rs-topbar' });

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.id = 'rs-search-input';
  searchInput.className = 'rs-search-input';
  searchInput.placeholder = 'Search pattern...';
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
  topBar.appendChild(searchInput);

  const searchBtn = el('button', { text: 'Search', class: 'rs-search-btn' });
  searchBtn.addEventListener('click', doSearch);
  topBar.appendChild(searchBtn);

  // Type toggle group
  const typeGroup = el('div', { class: 'rs-type-group' });
  for (const t of [
    { id: 'files', label: 'Files' },
    { id: 'content', label: 'Content' },
    { id: 'git', label: 'Git' },
  ]) {
    const btn = el('button', {
      text: t.label,
      class: 'rs-type-btn' + (t.id === searchType ? ' active' : ''),
    });
    btn.dataset.type = t.id;
    btn.addEventListener('click', () => {
      searchType = t.id;
      typeGroup.querySelectorAll('.rs-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updatePlaceholder();
    });
    typeGroup.appendChild(btn);
  }
  topBar.appendChild(typeGroup);

  // Settings gear
  const gearBtn = el('button', { text: '\u2699', class: 'rs-gear-btn', title: 'Settings' });
  gearBtn.addEventListener('click', () => {
    settingsOpen = !settingsOpen;
    const panel = root.querySelector('#rs-settings-panel');
    if (panel) {
      panel.style.display = settingsOpen ? '' : 'none';
      if (settingsOpen) loadSettingsPanel();
    }
  });
  topBar.appendChild(gearBtn);

  // topBar is appended to searchPanel (created below, after the chip strip)

  const tabStrip = el('div', { class: 'rs-tab-strip', id: 'rs-tab-strip' });
  wrap.appendChild(tabStrip);
  renderTabStrip(tabStrip);

  // Repo chips bar
  const repoBar = el('div', { class: 'rs-repo-bar', id: 'rs-repo-bar' });
  wrap.appendChild(repoBar);
  renderRepoChips(repoBar);

  // Inner tab strip: Search | Manage
  const innerTabs = el('div', { class: 'rs-inner-tabs' });
  const searchInner = el('button', { text: 'Search', class: 'rs-inner-tab active' });
  const manageInner = el('button', { text: 'Manage', class: 'rs-inner-tab' });
  innerTabs.appendChild(searchInner);
  innerTabs.appendChild(manageInner);
  wrap.appendChild(innerTabs);

  // Search panel — houses topbar + settings + sort + results
  const searchPanel = el('div', { class: 'rs-inner-panel', id: 'rs-search-panel' });
  // Manage panel
  const managePanel = el('div', { class: 'rs-inner-panel', id: 'rs-manage-panel' });
  managePanel.style.display = 'none';
  wrap.appendChild(searchPanel);
  wrap.appendChild(managePanel);

  // Move topBar into search panel (was deferred above)
  searchPanel.appendChild(topBar);

  // Settings panel (collapsible) — inside search panel
  const settingsPanel = el('div', { class: 'rs-settings-panel', id: 'rs-settings-panel' });
  settingsPanel.style.display = 'none';
  searchPanel.appendChild(settingsPanel);

  // Sort bar — inside search panel
  const sortBar = el('div', { class: 'rs-sortbar' });
  const sortLabel = el('span', { text: 'Sort:', class: 'rs-sort-label' });
  sortBar.appendChild(sortLabel);

  for (const s of [
    { id: 'name', label: 'Name' },
    { id: 'date', label: 'Date' },
  ]) {
    const btn = el('button', {
      text: s.label,
      class: 'rs-sort-btn' + (s.id === sortMode ? ' active' : ''),
    });
    btn.dataset.sort = s.id;
    btn.addEventListener('click', () => {
      sortMode = s.id;
      sortBar.querySelectorAll('.rs-sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      reRenderCurrentResults();
    });
    sortBar.appendChild(btn);
  }

  const countLabel = el('span', { text: '', class: 'rs-count', id: 'rs-count' });
  sortBar.appendChild(countLabel);
  searchPanel.appendChild(sortBar);

  // Results area — inside search panel
  const resultsList = el('div', { class: 'rs-results', id: 'rs-results' });
  resultsList.innerHTML = '<p class="rs-placeholder">Enter a search pattern and press Enter</p>';
  // Delegated expand handler — works for both real and test-injected cards
  resultsList.addEventListener('click', (e) => {
    const expandTgt = e.target.closest('[data-role="rs-expand"]');
    if (expandTgt) {
      e.stopPropagation();
      expandFileCard(expandTgt.dataset.path || '');
    }
  });
  searchPanel.appendChild(resultsList);

  // ── Manage panel contents ──────────────────────────────────

  const manageToolbar = el('div', { class: 'rs-manage-toolbar' });
  const refreshBtn = el('button', { text: '⟲ Refresh', class: 'btn-secondary' });
  const pullBtn = el('button', { text: 'Pull all to main' });
  const dryWrap = document.createElement('label');
  dryWrap.className = 'rs-dry-wrap';
  dryWrap.innerHTML = '<input type="checkbox" id="rs-dry-run"/> Dry-run';
  manageToolbar.appendChild(refreshBtn);
  manageToolbar.appendChild(pullBtn);
  manageToolbar.appendChild(dryWrap);
  managePanel.appendChild(manageToolbar);

  const tableWrap = el('div', { id: 'rs-manage-table', class: 'rs-manage-table-wrap' });
  managePanel.appendChild(tableWrap);

  // Manage state
  let manageStatuses = null;
  let manageOutcomes = null;
  let manageLoaded = false;

  async function loadManage() {
    const scope = reposForActiveTab().filter(r => activeRepos.has(r.name));
    if (!scope.length) {
      tableWrap.innerHTML = '<p class="rs-manage-empty">No active repos in the current scope.</p>';
      manageStatuses = null;
      return;
    }
    tableWrap.innerHTML = '<p class="rs-manage-empty">Loading…</p>';
    try {
      // Pass only the scope's paths — backend skips all other repos, saves
      // N × 4 git spawns on large repo lists (and on Windows, N × 4 cmd-window
      // flashes without CREATE_NO_WINDOW).
      const paths = scope.map(r => r.path);
      manageStatuses = await call('repo_search_status', { paths });
    } catch (e) {
      tableWrap.innerHTML = `<p class="rs-manage-empty rs-err">${e}</p>`;
      return;
    }
    renderManageTable();
  }

  function renderManageTable() {
    if (!manageStatuses) return;
    if (!manageStatuses.length) {
      tableWrap.innerHTML = '<p class="rs-manage-empty">No active repos in the current scope.</p>';
      return;
    }
    const rows = manageStatuses.map(s => {
      const outcome = manageOutcomes?.find(o => o.name === s.name);
      const date = s.last_commit_iso ? new Date(s.last_commit_iso).toLocaleDateString() : '';
      const statusBadge = statusBadgeFor(s, outcome);
      const resetBtn = s.is_dirty
        ? `<button class="rs-row-btn rs-reset-btn" data-name="${escapeHtml(s.name)}" title="Discard uncommitted changes (git reset --hard)">Reset</button>`
        : '';
      return `<tr class="${s.error ? 'rs-row-err' : s.is_dirty ? 'rs-row-dirty' : ''}">
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.branch || '—')}</td>
        <td title="${escapeHtml(s.last_commit_subject)}">${escapeHtml(s.last_commit_subject || '—')}</td>
        <td>${escapeHtml(date)}</td>
        <td>${statusBadge}</td>
        <td class="rs-row-actions">${resetBtn}</td>
      </tr>`;
    }).join('');
    tableWrap.innerHTML = `
      <table class="rs-manage">
        <thead><tr><th>Name</th><th>Branch</th><th>Last commit</th><th>Date</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    for (const btn of tableWrap.querySelectorAll('.rs-reset-btn')) {
      btn.addEventListener('click', () => onResetClick(btn.dataset.name));
    }
  }

  async function onResetClick(repoName) {
    const repo = allRepos.find(r => r.name === repoName);
    if (!repo) return;
    const body = document.createElement('div');
    body.innerHTML = `
      <p style="margin:0 0 8px">Discard all uncommitted changes in <b>${escapeHtml(repoName)}</b>?</p>
      <p style="margin:0 0 6px;font-size:11px;color:var(--text-muted)">Runs <code>git reset --hard HEAD</code>.</p>
      <label style="display:flex;align-items:center;gap:6px;margin:6px 0;font-size:12px">
        <input type="checkbox" id="rs-reset-clean" checked/>
        Also remove untracked files (<code>git clean -fd</code>)
      </label>
      <p style="margin:0;font-size:11px;color:var(--danger,#f85149)">This cannot be undone.</p>
    `;
    try {
      let result = null;
      await showModal({
        title: 'Discard changes?',
        body,
        onConfirm: async () => {
          const clean = body.querySelector('#rs-reset-clean')?.checked !== false;
          result = await call('repo_search_reset_hard', { path: repo.path, clean });
        },
      });
      if (manageOutcomes) manageOutcomes = manageOutcomes.filter(o => o.name !== repoName);
      await loadManage();
      if (result) {
        const label = result.cleaned ? 'Reset + cleaned' : 'Reset';
        if (result.dirty_after) {
          showToast(`${label} ${repoName}: tree still dirty — ${result.output || '(no output)'}`, 'error');
        } else {
          showToast(`${label} ${repoName}: ${result.output || 'clean'}`, 'success');
        }
      } else {
        showToast(`Reset ${repoName}`, 'success');
      }
    } catch { /* cancelled or modal reported error */ }
  }

  function statusBadgeFor(s, outcome) {
    if (outcome) {
      if (outcome.skipped) return `<span class="rs-badge rs-badge-skip">⚠ ${escapeHtml(outcome.message)}</span>`;
      if (outcome.success) return `<span class="rs-badge rs-badge-ok">✓ ${escapeHtml(outcome.message)}</span>`;
      return `<span class="rs-badge rs-badge-err">✗ ${escapeHtml(outcome.message)}</span>`;
    }
    if (s.error) return `<span class="rs-badge rs-badge-err">${escapeHtml(s.error)}</span>`;
    if (s.is_dirty) return '<span class="rs-badge rs-badge-skip">⚠ dirty</span>';
    return '<span class="rs-badge rs-badge-ok">✓ clean</span>';
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  refreshBtn.addEventListener('click', () => { manageOutcomes = null; loadManage(); });

  pullBtn.addEventListener('click', async () => {
    if (!manageStatuses?.length) return;
    const dryRun = document.getElementById('rs-dry-run').checked;
    const pathsForNames = new Map(allRepos.map(r => [r.name, r.path]));
    const paths = manageStatuses
      .map(s => pathsForNames.get(s.name))
      .filter(Boolean);
    pullBtn.disabled = true;
    const origLabel = pullBtn.textContent;
    pullBtn.textContent = dryRun ? 'Previewing…' : 'Pulling…';
    try {
      manageOutcomes = await call('repo_search_pull_main', { paths, dryRun });
      renderManageTable();
      if (dryRun) {
        const body = document.createElement('div');
        body.innerHTML = manageOutcomes.map(o =>
          `<div style="margin-bottom:8px"><strong>${escapeHtml(o.name)}</strong>${o.skipped ? ' — ' + escapeHtml(o.message) : ''}${(o.commands_run || []).map(c => `<div style="font-family:monospace;font-size:11px;color:var(--text-muted);margin-left:10px">${escapeHtml(c)}</div>`).join('')}</div>`
        ).join('');
        try { await showModal({ title: 'Dry-run — planned git commands', body, onConfirm: async () => {} }); } catch {}
      }
    } catch (e) {
      showToast('Pull failed: ' + e, 'error');
    } finally {
      pullBtn.disabled = false;
      pullBtn.textContent = origLabel;
    }
  });

  manageInner.addEventListener('click', () => {
    searchPanel.style.display = 'none';
    managePanel.style.display = '';
    manageInner.classList.add('active');
    searchInner.classList.remove('active');
    if (!manageLoaded) { manageLoaded = true; loadManage(); }
  });

  searchInner.addEventListener('click', () => {
    searchPanel.style.display = '';
    managePanel.style.display = 'none';
    searchInner.classList.add('active');
    manageInner.classList.remove('active');
  });

  return wrap;
}

function updatePlaceholder() {
  const input = root.querySelector('#rs-search-input');
  if (!input) return;
  switch (searchType) {
    case 'files':
      input.placeholder = 'Filename pattern (e.g. *.rs, config*)';
      break;
    case 'content':
      input.placeholder = 'Search text in file contents...';
      break;
    case 'git':
      input.placeholder = 'Search commits (message or code changes)...';
      break;
  }
}

// ── Repo Chips ────────────────────────────────────────────

function renderRepoChips(barEl) {
  const bar = barEl || root.querySelector('#rs-repo-bar');
  if (!bar) return;
  bar.innerHTML = '';

  // Select-all / deselect-all for the current tab's scope. Placed at the
  // start of the chip row so they're always in the same spot regardless of
  // active tab.
  const selAll = document.createElement('button');
  selAll.className = 'rs-sel-btn';
  selAll.textContent = '✓';
  selAll.title = 'Select all in tab';
  selAll.addEventListener('click', () => scopeSelect(true));
  bar.appendChild(selAll);

  const selNone = document.createElement('button');
  selNone.className = 'rs-sel-btn';
  selNone.textContent = '⊘';
  selNone.title = 'Deselect all in tab';
  selNone.addEventListener('click', () => scopeSelect(false));
  bar.appendChild(selNone);

  const divider = document.createElement('span');
  divider.className = 'rs-sel-divider';
  bar.appendChild(divider);

  const scope = reposForActiveTab();
  for (const repo of scope) {
    const isActive = activeRepos.has(repo.name);
    const chip = document.createElement('div');
    chip.className = 'rs-repo-chip' + (isActive ? ' active' : '');
    chip.style.opacity = isActive ? '1' : '0.45';
    if (isActive) {
      chip.style.background = '#161b22';
    }

    const barEl = document.createElement('span');
    barEl.className = 'rs-chip-bar';
    barEl.style.background = repo.color;
    if (isActive) {
      barEl.style.boxShadow = `0 0 6px ${repo.color}`;
    }
    chip.appendChild(barEl);

    const label = document.createElement('span');
    label.textContent = repo.name;
    chip.appendChild(label);

    chip.addEventListener('click', () => {
      if (activeRepos.has(repo.name)) {
        activeRepos.delete(repo.name);
      } else {
        activeRepos.add(repo.name);
      }
      renderRepoChips();
    });

    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showRepoContextMenu(e.clientX, e.clientY, repo);
    });

    // Pointer-event-based drag: HTML5 DnD is unreliable inside Tauri on some
    // platforms (Windows WebView2 eats drag events for file-drop; macOS WebKit
    // strips custom MIME types in dragover). This runs identically everywhere.
    chip.addEventListener('pointerdown', (e) => onChipPointerDown(e, repo, chip));

    chip.title = repo.path;
    bar.appendChild(chip);
  }

  // "+" button
  const addBtn = document.createElement('div');
  addBtn.className = 'rs-repo-chip rs-repo-add';
  addBtn.textContent = '+';
  addBtn.title = 'Add repository';
  addBtn.addEventListener('click', async () => {
    try {
      const { open } = window.__TAURI__.dialog;
      const picked = await open({ multiple: true, directory: true });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      const existingNames = new Set(allRepos.map(r => r.name));
      const groupId = (typeof activeTabId === 'number') ? activeTabId : null;
      const addedNames = [];
      for (const p of paths) {
        let base = p.split(/[\\/]/).filter(Boolean).pop() || 'repo';
        let name = base;
        let n = 2;
        while (existingNames.has(name)) name = `${base} (${n++})`;
        existingNames.add(name);
        try {
          await call('add_repo', { name, path: p, color: randomPaletteColor(), groupId });
          addedNames.push(name);
        } catch (e) {
          showToast(`Skipped ${base}: ${e}`, 'error');
        }
      }
      allRepos = await call('list_repos');
      // Activate only what we just added (matching by the literal name we chose,
      // not fuzzy path-suffix matching — that's broken for auto-deduped names).
      for (const n of addedNames) activeRepos.add(n);
      renderTabStrip();
      renderRepoChips();
    } catch (e) {
      showToast('Error: ' + e, 'error');
    }
  });
  bar.appendChild(addBtn);
}

// ── Pointer-based drag-drop (chip → tab) ──────────────────────

function onChipPointerDown(e, repo, chipEl) {
  // Only primary button; ignore text-selection drags.
  if (e.button !== 0) return;
  const startX = e.clientX, startY = e.clientY;
  const DRAG_THRESHOLD = 4;   // px
  let dragging = false;
  let ghost = null;
  let lastHoveredTab = null;

  function moveGhost(x, y) {
    if (!ghost) return;
    ghost.style.left = (x + 8) + 'px';
    ghost.style.top  = (y + 8) + 'px';
  }

  function onMove(ev) {
    if (!dragging) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      dragging = true;
      draggingRepoName = repo.name;
      chipEl.classList.add('rs-chip-dragging');
      ghost = chipEl.cloneNode(true);
      ghost.classList.add('rs-chip-ghost');
      ghost.style.cssText += 'position:fixed;pointer-events:none;z-index:99999;opacity:0.85;';
      document.body.appendChild(ghost);
    }
    moveGhost(ev.clientX, ev.clientY);
    const tab = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-drop-target-for="repo"]');
    if (tab !== lastHoveredTab) {
      lastHoveredTab?.classList.remove('rs-tab-drop');
      lastHoveredTab = tab;
      lastHoveredTab?.classList.add('rs-tab-drop');
    }
  }

  async function onUp(ev) {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    if (!dragging) return;  // plain click — let click handler do its thing
    ev.preventDefault();
    ev.stopPropagation();
    chipEl.classList.remove('rs-chip-dragging');
    ghost?.remove();
    lastHoveredTab?.classList.remove('rs-tab-drop');
    const tab = lastHoveredTab;
    draggingRepoName = null;
    if (!tab) return;
    const targetId = tab.dataset.tabId;
    const target = targetId === 'ungrouped'
      ? null
      : (Number.isFinite(+targetId) ? +targetId : null);
    const r = allRepos.find(x => x.name === repo.name);
    if (!r || r.group_id === target) return;
    try {
      await call('update_repo', {
        oldName: r.name, name: r.name, path: r.path, color: r.color, groupId: target,
      });
      allRepos = await call('list_repos');
      renderTabStrip();
      renderRepoChips();
    } catch (err) {
      showToast('Move failed: ' + err, 'error');
    }
    // Suppress the chip's click handler that would otherwise toggle active state.
    chipEl.addEventListener('click', function kill(ev2) {
      ev2.stopPropagation();
      ev2.preventDefault();
      chipEl.removeEventListener('click', kill, true);
    }, { capture: true, once: true });
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function renderTabStrip(containerEl) {
  const bar = containerEl || root.querySelector('#rs-tab-strip');
  if (!bar) return;
  bar.innerHTML = '';

  const tabs = [{ id: 'all', name: 'All', icon: '', color: '' }];
  const sorted = [...allGroups].sort((a, b) => a.name.localeCompare(b.name));
  tabs.push(...sorted.map(g => ({ id: g.id, name: g.name, icon: g.icon || '', color: g.color || '' })));
  if (hasUngroupedRepos()) {
    tabs.push({ id: 'ungrouped', name: 'Ungrouped', icon: '◌', color: '' });
  }

  for (const t of tabs) {
    const btn = document.createElement('button');
    btn.className = 'rs-tab' + (t.id === activeTabId ? ' active' : '');
    btn.dataset.tabId = t.id;
    if (t.icon) {
      const ic = document.createElement('span');
      ic.className = 'rs-tab-icon';
      renderIcon(t.icon, ic, { size: 14, color: t.color || 'currentColor' });
      btn.appendChild(ic);
    }
    btn.appendChild(document.createTextNode(t.name));
    btn.addEventListener('click', () => {
      activeTabId = t.id;
      renderTabStrip();
      renderRepoChips();
    });
    if (typeof t.id === 'number') {
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showGroupContextMenu(e.clientX, e.clientY, allGroups.find(g => g.id === t.id));
      });
    }
    // Drag-drop targets: all tabs except "All". Markers only — actual drop
    // handling runs in the global pointerup from onChipPointerDown.
    if (t.id !== 'all') {
      btn.dataset.dropTargetFor = 'repo';
    }
    bar.appendChild(btn);
  }

  // "+" at the end
  const addBtn = document.createElement('button');
  addBtn.className = 'rs-tab rs-tab-add';
  addBtn.textContent = '+';
  addBtn.title = 'New group';
  addBtn.addEventListener('click', () => showNewGroupModal());
  bar.appendChild(addBtn);
}

function scopeSelect(select) {
  const scope = reposForActiveTab();
  for (const r of scope) {
    if (select) activeRepos.add(r.name);
    else activeRepos.delete(r.name);
  }
  renderRepoChips();
}

async function removeRepo(name) {
  try {
    await call('remove_repo', { name });
    allRepos = allRepos.filter(r => r.name !== name);
    activeRepos.delete(name);
    renderRepoChips();
    showToast('Repo removed', 'success');
  } catch (e) {
    showToast('Error: ' + e, 'error');
  }
}

// ── Add Repo Modal ────────────────────────────────────────

function showAddRepoModal(existing = null) {
  const isEdit = existing !== null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay rs-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal rs-add-modal';

  // Header
  const header = el('div', { class: 'rs-modal-header' });
  header.appendChild(el('h3', { text: isEdit ? 'Edit Repository' : 'Add Repository' }));
  const closeBtn = el('button', { text: '\u2715', class: 'btn-secondary rs-modal-close' });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = el('div', { class: 'rs-modal-body' });

  // Name
  const nameRow = el('div', { class: 'rs-form-row' });
  nameRow.appendChild(el('label', { text: 'Name:', class: 'rs-form-label' }));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'rs-form-input';
  nameInput.placeholder = 'my-project';
  nameRow.appendChild(nameInput);
  body.appendChild(nameRow);

  // Path
  const pathRow = el('div', { class: 'rs-form-row' });
  pathRow.appendChild(el('label', { text: 'Path:', class: 'rs-form-label' }));
  const pathInput = document.createElement('input');
  pathInput.type = 'text';
  pathInput.className = 'rs-form-input';
  pathInput.placeholder = '/home/user/projects/my-project';
  pathInput.style.flex = '1';
  pathRow.appendChild(pathInput);

  const browseBtn = el('button', { text: 'Browse', class: 'btn-secondary' });
  browseBtn.style.marginLeft = '6px';
  browseBtn.addEventListener('click', async () => {
    try {
      const { open } = window.__TAURI__.dialog;
      const selected = await open({ directory: true, multiple: false, title: 'Select repository folder' });
      if (selected) {
        pathInput.value = selected;
        // Auto-fill name from folder name if empty
        if (!nameInput.value.trim()) {
          const parts = selected.replace(/\\/g, '/').split('/');
          nameInput.value = parts.filter(p => p).pop() || '';
        }
      }
    } catch (e) {
      showToast('Folder picker error: ' + e, 'error');
    }
  });
  pathRow.appendChild(browseBtn);
  body.appendChild(pathRow);

  // Color
  const colorRow = el('div', { class: 'rs-form-row' });
  colorRow.appendChild(el('label', { text: 'Color:', class: 'rs-form-label' }));
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = isEdit ? existing.color : randomColor();
  colorInput.className = 'rs-color-input';
  colorRow.appendChild(colorInput);
  body.appendChild(colorRow);

  // Pre-fill for edit
  if (isEdit) {
    nameInput.value = existing.name;
    pathInput.value = existing.path;
  }

  modal.appendChild(body);

  // Actions
  const actions = el('div', { class: 'rs-modal-actions' });
  const saveBtn = el('button', { text: isEdit ? 'Update' : 'Save' });
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const path = pathInput.value.trim();
    const color = colorInput.value;
    if (!name || !path) {
      showToast('Name and path are required', 'error');
      return;
    }
    try {
      if (isEdit) {
        // Remove old, add new
        await call('remove_repo', { name: existing.name });
        await call('add_repo', { name, path, color });
        const idx = allRepos.findIndex(r => r.name === existing.name);
        if (idx >= 0) allRepos[idx] = { name, path, color };
        activeRepos.delete(existing.name);
        activeRepos.add(name);
        showToast('Repo updated', 'success');
      } else {
        await call('add_repo', { name, path, color });
        allRepos.push({ name, path, color });
        activeRepos.add(name);
        showToast('Repo added', 'success');
      }
      renderRepoChips();
      loadSettingsPanel();
      overlay.remove();
    } catch (e) {
      showToast('Error: ' + e, 'error');
    }
  });
  actions.appendChild(saveBtn);

  const cancelBtn = el('button', { text: 'Cancel', class: 'btn-secondary' });
  cancelBtn.addEventListener('click', () => overlay.remove());
  actions.appendChild(cancelBtn);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    }
  }
  document.addEventListener('keydown', onKey, true);

  nameInput.focus();
}

function randomColor() {
  const colors = ['#f0883e', '#3fb950', '#58a6ff', '#d2a8ff', '#f778ba', '#79c0ff', '#ffa657', '#7ee787'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ── Group CRUD UI ──────────────────────────────────────────

const PALETTE_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#a855f7','#14b8a6','#f43f5e','#6366f1','#eab308','#8b949e'];
function randomPaletteColor() { return PALETTE_COLORS[Math.floor(Math.random() * PALETTE_COLORS.length)]; }

async function showNewGroupModal(existing) {
  const body = document.createElement('div');
  body.innerHTML = `
    <label style="display:block;margin-bottom:4px">Name</label>
    <input id="g-name" style="width:100%" placeholder="e.g. Databases" />
    <label style="display:block;margin-top:10px;margin-bottom:4px">Icon</label>
    <input id="g-icon-search" style="width:100%;margin-bottom:6px" placeholder="Search: clickhouse, python, docker…" />
    <div id="g-icon-grid" style="display:flex;flex-wrap:wrap;gap:3px;max-height:180px;overflow-y:auto;padding:4px;border:1px solid var(--border);border-radius:4px"></div>
    <input id="g-icon-custom" style="width:100%;margin-top:6px" maxlength="2" placeholder="or type 1-2 chars / emoji" />
    <label style="display:block;margin-top:10px;margin-bottom:4px">Color</label>
    <div id="g-color-grid" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px"></div>
    <input id="g-color" type="color" style="width:100%;height:30px" />
  `;
  body.querySelector('#g-name').value = existing?.name || '';
  body.querySelector('#g-color').value = existing?.color || randomPaletteColor();

  // Selected icon state — stored prefixed ("emoji:🗄" / "logo:python" / "text:DB").
  let selectedKey = existing?.icon || '';
  // Legacy bare-emoji support: normalise on open.
  if (selectedKey && !selectedKey.includes(':')) {
    selectedKey = `emoji:${selectedKey}`;
  }

  const iconGrid = body.querySelector('#g-icon-grid');
  const searchInput = body.querySelector('#g-icon-search');
  const customInput = body.querySelector('#g-icon-custom');

  function renderIconGrid(filter) {
    iconGrid.innerHTML = '';
    const q = (filter || '').trim().toLowerCase();
    const entries = q
      ? ALL_ICONS.filter(ic => ic.label.toLowerCase().includes(q) || (ic.slug || '').includes(q))
      : ALL_ICONS;
    for (const ic of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = ic.label;
      const key = iconKey(ic);
      btn.style.cssText = 'padding:4px;background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;font-size:16px';
      if (key === selectedKey) { btn.style.borderColor = 'var(--accent, #3b82f6)'; btn.style.background = 'rgba(59,130,246,0.08)'; }
      renderIcon(key, btn, { size: 16, color: 'currentColor' });
      btn.addEventListener('click', () => {
        selectedKey = key;
        customInput.value = '';
        renderIconGrid(searchInput.value);
      });
      iconGrid.appendChild(btn);
    }
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px;color:var(--text-muted);font-size:12px';
      empty.textContent = 'No matches — try the free-text field below.';
      iconGrid.appendChild(empty);
    }
  }
  renderIconGrid('');
  searchInput.addEventListener('input', () => renderIconGrid(searchInput.value));
  customInput.addEventListener('input', () => {
    const v = customInput.value.trim();
    selectedKey = v ? `text:${v}` : '';
    renderIconGrid(searchInput.value);
  });
  // Preseed custom input if we opened with a text: value
  if (selectedKey.startsWith('text:')) customInput.value = selectedKey.slice(5);

  const colorGrid = body.querySelector('#g-color-grid');
  for (const c of PALETTE_COLORS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = `width:20px;height:20px;background:${c};border:1px solid var(--border);border-radius:3px;cursor:pointer;padding:0`;
    btn.addEventListener('click', () => { body.querySelector('#g-color').value = c; });
    colorGrid.appendChild(btn);
  }

  try {
    await showModal({
      title: existing ? 'Edit Group' : 'New Group',
      body,
      onConfirm: async () => {
        const name = body.querySelector('#g-name').value.trim();
        const color = body.querySelector('#g-color').value;
        const icon = selectedKey;
        if (!name) throw new Error('Name is required');
        if (existing) {
          await call('update_repo_group', { id: existing.id, name, icon, color });
        } else {
          const g = await call('add_repo_group', { name, icon, color });
          activeTabId = g.id;
        }
        allGroups = await call('list_repo_groups');
        renderTabStrip();
        renderRepoChips();
      },
    });
  } catch { /* user cancelled */ }
}

async function reloadAndRerender() {
  allGroups = await call('list_repo_groups');
  allRepos = await call('list_repos');
  // Clamp activeTabId if it points at a now-deleted group.
  if (typeof activeTabId === 'number' && !allGroups.some(g => g.id === activeTabId)) {
    activeTabId = 'all';
  }
  renderTabStrip();
  renderRepoChips();
}

function showGroupContextMenu(x, y, group) {
  if (!group) return;
  const menu = document.createElement('div');
  menu.className = 'rs-ctx-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:4px 0;z-index:9999;min-width:140px`;
  const make = (text, handler) => {
    const item = document.createElement('div');
    item.textContent = text;
    item.style.cssText = 'padding:6px 14px;cursor:pointer;font-size:12px';
    item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.05)');
    item.addEventListener('mouseleave', () => item.style.background = 'transparent');
    item.addEventListener('click', () => { menu.remove(); handler(); });
    return item;
  };
  menu.appendChild(make('Edit group', () => showNewGroupModal(group)));
  menu.appendChild(make('Delete group', async () => {
    try {
      await showModal({
        title: 'Delete Group',
        body: `Delete group "${group.name}"? Repos will move to Ungrouped.`,
        onConfirm: async () => { await call('remove_repo_group', { id: group.id }); },
      });
      if (activeTabId === group.id) activeTabId = 'all';
      await reloadAndRerender();
    } catch { /* cancelled */ }
  }));
  document.body.appendChild(menu);
  const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}

function showRepoContextMenu(x, y, repo) {
  const menu = document.createElement('div');
  menu.className = 'rs-ctx-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:4px 0;z-index:9999;min-width:140px`;
  const make = (text, handler) => {
    const item = document.createElement('div');
    item.textContent = text;
    item.style.cssText = 'padding:6px 14px;cursor:pointer;font-size:12px';
    item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.05)');
    item.addEventListener('mouseleave', () => item.style.background = 'transparent');
    item.addEventListener('click', () => { menu.remove(); handler(); });
    return item;
  };
  menu.appendChild(make('Edit repo', () => showEditRepoModal(repo)));
  menu.appendChild(make('Remove repo', () => { if (confirm(`Remove "${repo.name}"?`)) removeRepo(repo.name); }));
  document.body.appendChild(menu);
  const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}

async function showEditRepoModal(repo) {
  const body = document.createElement('div');
  body.innerHTML = `
    <label style="display:block;margin-bottom:4px">Name</label>
    <input id="r-name" style="width:100%" />
    <label style="display:block;margin-top:10px;margin-bottom:4px">Color</label>
    <input id="r-color" type="color" style="width:100%;height:30px" />
    <label style="display:block;margin-top:10px;margin-bottom:4px">Group</label>
    <select id="r-group" style="width:100%"></select>
  `;
  body.querySelector('#r-name').value = repo.name;
  body.querySelector('#r-color').value = repo.color;
  const sel = body.querySelector('#r-group');
  sel.innerHTML = '<option value="">Ungrouped</option>' +
    allGroups.map(g => {
      // <option> can't render SVG, so only inline emoji/text prefixes.
      let prefix = '';
      if (g.icon && g.icon.startsWith('emoji:')) prefix = g.icon.slice(6) + ' ';
      else if (g.icon && g.icon.startsWith('text:')) prefix = g.icon.slice(5) + ' ';
      else if (g.icon && !g.icon.includes(':')) prefix = g.icon + ' ';  // legacy bare emoji
      return `<option value="${g.id}" ${g.id === repo.group_id ? 'selected' : ''}>${prefix}${g.name}</option>`;
    }).join('');

  try {
    await showModal({
      title: 'Edit Repo',
      body,
      onConfirm: async () => {
        const name = body.querySelector('#r-name').value.trim();
        const color = body.querySelector('#r-color').value;
        const groupId = body.querySelector('#r-group').value ? parseInt(body.querySelector('#r-group').value) : null;
        if (!name) throw new Error('Name is required');
        await call('update_repo', { oldName: repo.name, name, path: repo.path, color, groupId });
      },
    });
    allRepos = await call('list_repos');
    renderTabStrip();
    renderRepoChips();
  } catch { /* cancelled */ }
}

// ── Settings Panel ─────────────────────────────────────────

async function loadSettingsPanel() {
  const panel = root.querySelector('#rs-settings-panel');
  if (!panel) return;
  panel.innerHTML = '';

  const header = el('div', { class: 'rs-settings-header' });
  header.appendChild(el('span', { text: 'Settings', class: 'rs-settings-title' }));
  panel.appendChild(header);

  // Repo list
  const repoSection = el('div', { class: 'rs-settings-section' });
  repoSection.appendChild(el('span', { text: 'Repositories', class: 'rs-settings-subtitle' }));

  const list = el('div', { class: 'rs-paths-list' });
  for (const r of allRepos) {
    const item = el('div', { class: 'rs-path-item' });
    const colorDot = el('span', { class: 'rs-color-dot' });
    colorDot.style.background = r.color;
    item.appendChild(colorDot);
    item.appendChild(el('span', { text: r.name, class: 'rs-repo-name-label', style: 'font-weight:600;margin-right:8px' }));
    item.appendChild(el('span', { text: r.path, class: 'rs-path-text' }));
    const editBtn = el('button', { text: '\u270E', class: 'rs-path-edit', title: 'Edit' });
    editBtn.addEventListener('click', () => {
      showAddRepoModal(r);
    });
    item.appendChild(editBtn);
    const removeBtn = el('button', { text: '\u2715', class: 'rs-path-remove', title: 'Remove' });
    removeBtn.addEventListener('click', async () => {
      await removeRepo(r.name);
      loadSettingsPanel();
    });
    item.appendChild(removeBtn);
    list.appendChild(item);
  }
  if (allRepos.length === 0) {
    list.appendChild(el('p', { text: 'No repos configured', style: 'color:var(--text-muted);padding:4px 0' }));
  }
  repoSection.appendChild(list);

  const addRepoBtn = el('button', { text: '+ Add repository', class: 'rs-settings-add-btn' });
  addRepoBtn.style.cssText = 'margin-top:8px;padding:4px 12px;font-size:12px';
  addRepoBtn.addEventListener('click', () => showAddRepoModal());
  repoSection.appendChild(addRepoBtn);

  panel.appendChild(repoSection);

  // Context lines setting
  const ctxSection = el('div', { class: 'rs-settings-section' });
  ctxSection.appendChild(el('span', { text: 'Search', class: 'rs-settings-subtitle' }));

  const ctxRow = el('div', { class: 'rs-form-row' });
  ctxRow.appendChild(el('label', { text: 'Context lines:', class: 'rs-form-label' }));
  const ctxInput = document.createElement('input');
  ctxInput.type = 'number';
  ctxInput.className = 'rs-form-input';
  ctxInput.min = '0';
  ctxInput.max = '10';
  ctxInput.value = contextLines;
  ctxInput.style.width = '80px';
  ctxInput.addEventListener('change', async () => {
    contextLines = parseInt(ctxInput.value) || 3;
    try {
      await call('set_setting', { key: 'search_context_lines', value: String(contextLines) });
    } catch {}
  });
  ctxRow.appendChild(ctxInput);
  ctxSection.appendChild(ctxRow);
  panel.appendChild(ctxSection);
}

// ── Search ─────────────────────────────────────────────────

async function doSearch() {
  const input = root.querySelector('#rs-search-input');
  const resultsList = root.querySelector('#rs-results');
  const countLabel = root.querySelector('#rs-count');
  if (!input || !resultsList) return;

  const query = input.value.trim();
  if (!query) return;

  resultsList.innerHTML = '<p class="rs-placeholder">Searching...</p>';
  if (countLabel) countLabel.textContent = '';

  const repos = [...activeRepos];

  try {
    lastSearchType = searchType;
    if (searchType === 'files') {
      results = await call('search_filenames', { pattern: query, repos });
      contentResults = []; gitResults = [];
      renderResults();
    } else if (searchType === 'content') {
      contentResults = await call('search_content', { query, repos });
      results = []; gitResults = [];
      renderContentResults(contentResults);
    } else if (searchType === 'git') {
      gitResults = await call('search_git_history', { query, repos });
      results = []; contentResults = [];
      renderGitResults(gitResults);
    }
  } catch (e) {
    resultsList.innerHTML = '';
    resultsList.appendChild(el('p', { text: 'Error: ' + e, class: 'rs-placeholder', style: 'color:var(--danger)' }));
  }
}

function reRenderCurrentResults() {
  if (lastSearchType === 'files') renderResults();
  else if (lastSearchType === 'content') renderContentResults(contentResults);
  else if (lastSearchType === 'git') renderGitResults(gitResults);
}

// ── Render file search results ────────────────────────────

function renderResults() {
  const resultsList = root.querySelector('#rs-results');
  const countLabel = root.querySelector('#rs-count');
  if (!resultsList) return;
  resultsList.innerHTML = '';

  if (countLabel) {
    countLabel.textContent = results.length + ' result' + (results.length !== 1 ? 's' : '') +
      (results.length >= 200 ? ' (limit reached)' : '');
  }

  if (!results.length) {
    resultsList.appendChild(el('p', { text: 'No results found', class: 'rs-placeholder' }));
    return;
  }

  const sorted = [...results];
  if (sortMode === 'name') {
    sorted.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  } else {
    sorted.sort((a, b) => (b.modified_at || '').localeCompare(a.modified_at || ''));
  }

  for (const r of sorted) {
    const card = el('div', { class: 'rs-result-card' });

    const topLine = el('div', { class: 'rs-result-top' });
    const badge = buildRepoBadge(r.repo_name);
    topLine.appendChild(badge);
    topLine.appendChild(el('span', { text: r.relative_path, class: 'rs-result-path' }));
    if (r.modified_at) {
      topLine.appendChild(el('span', { text: formatDate(r.modified_at), class: 'rs-result-date' }));
    }
    card.appendChild(topLine);

    if (r.match_line) {
      const matchEl = el('div', { class: 'rs-match-line' });
      if (r.match_line_num) {
        matchEl.appendChild(el('span', { text: 'L' + r.match_line_num + ': ', class: 'rs-line-num' }));
      }
      const lineText = r.match_line.length > 200 ? r.match_line.substring(0, 200) + '...' : r.match_line;
      matchEl.appendChild(el('span', { text: lineText }));
      card.appendChild(matchEl);
    }

    // Clicking the card opens the detail modal (same UX as content-search cards).
    const hitLine = r.match_line_num || 1;
    card.addEventListener('click', () => showDetailModal({
      repo_name: r.repo_name,
      relative_path: r.relative_path,
      file_path: r.file_path,
      matches: [{ file_path: r.file_path, line_num: hitLine, line_text: r.match_line || '' }],
    }));
    card.title = 'Click to view context';

    resultsList.appendChild(card);
  }
}

// ── Render content results (grouped by file) ──────────────

function renderContentResults(fileResults) {
  const resultsList = root.querySelector('#rs-results');
  const countLabel = root.querySelector('#rs-count');
  if (!resultsList) return;
  resultsList.innerHTML = '';

  const totalMatches = fileResults.reduce((sum, f) => sum + f.total_matches, 0);
  if (countLabel) {
    countLabel.textContent = totalMatches + ' match' + (totalMatches !== 1 ? 'es' : '') +
      ' in ' + fileResults.length + ' file' + (fileResults.length !== 1 ? 's' : '') +
      (totalMatches >= 200 ? ' (limit reached)' : '');
  }

  if (!fileResults.length) {
    resultsList.appendChild(el('p', { text: 'No results found', class: 'rs-placeholder' }));
    return;
  }

  const sorted = [...fileResults];
  if (sortMode === 'name') {
    sorted.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  } else {
    sorted.sort((a, b) => (b.modified_at || '').localeCompare(a.modified_at || ''));
  }

  const MAX_SHOWN = 3;

  for (const f of sorted) {
    const card = el('div', { class: 'rs-result-card rs-content-card' });

    // Top line: repo badge + path + date
    const topLine = el('div', { class: 'rs-result-top' });
    const badge = buildRepoBadge(f.repo_name);
    topLine.appendChild(badge);
    topLine.appendChild(el('span', { text: f.relative_path, class: 'rs-result-path' }));
    if (f.modified_at) {
      topLine.appendChild(el('span', { text: formatDate(f.modified_at), class: 'rs-result-date' }));
    }
    card.appendChild(topLine);

    // Match lines (show first 3)
    const shown = f.matches.slice(0, MAX_SHOWN);
    for (const m of shown) {
      const matchEl = el('div', { class: 'rs-match-line' });
      matchEl.appendChild(el('span', { text: 'L' + m.line_num + ': ', class: 'rs-line-num' }));
      const lineText = m.line_text.length > 200 ? m.line_text.substring(0, 200) + '...' : m.line_text;
      matchEl.appendChild(el('span', { text: lineText }));
      card.appendChild(matchEl);
    }

    // "+N more" label
    if (f.total_matches > MAX_SHOWN) {
      const more = el('div', { text: '+' + (f.total_matches - MAX_SHOWN) + ' more', class: 'rs-more-label' });
      card.appendChild(more);
    }

    // Click card to show detail modal (buttons live inside it now).
    card.addEventListener('click', () => showDetailModal(f));
    card.title = 'Click to view all matches with context';

    resultsList.appendChild(card);
  }
}

// ── Detail Modal (context view) ───────────────────────────

async function showDetailModal(fileResult) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay rs-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal rs-detail-modal';

  // Header: left = repo badge + path, right = action buttons + close.
  const header = el('div', { class: 'rs-modal-header' });
  const headerLeft = el('div', { style: 'display:flex;align-items:center;gap:8px;overflow:hidden;flex:1;min-width:0' });
  headerLeft.appendChild(buildRepoBadge(fileResult.repo_name));
  headerLeft.appendChild(el('span', { text: fileResult.relative_path, class: 'rs-detail-path' }));
  header.appendChild(headerLeft);

  const headerActions = el('div', { class: 'rs-detail-actions' });
  const detailHitLine = fileResult.matches?.[0]?.line_num || 1;

  const openBtn = el('button', { text: 'Open in editor', class: 'rs-card-btn' });
  openBtn.dataset.role = 'rs-open';
  openBtn.dataset.path = fileResult.file_path;
  openBtn.dataset.line = String(detailHitLine);
  openBtn.addEventListener('click', () => {
    call('open_in_editor', { path: fileResult.file_path, line: detailHitLine })
      .catch(err => showToast('Editor error: ' + err, 'error'));
  });
  headerActions.appendChild(openBtn);

  const copyBtn = el('button', { text: 'Copy path', class: 'rs-card-btn' });
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(fileResult.file_path)
      .then(() => showToast('Path copied', 'success'))
      .catch(() => {});
  });
  headerActions.appendChild(copyBtn);

  const expandBtn = el('button', { text: 'Expand ▸', class: 'rs-card-btn' });
  expandBtn.dataset.role = 'rs-expand';
  expandBtn.dataset.path = fileResult.file_path;
  expandBtn.addEventListener('click', () => expandFileCard(fileResult.file_path));
  headerActions.appendChild(expandBtn);

  const closeBtn = el('button', { text: '✕', class: 'btn-secondary rs-modal-close' });
  closeBtn.addEventListener('click', () => overlay.remove());
  headerActions.appendChild(closeBtn);

  header.appendChild(headerActions);
  modal.appendChild(header);

  // Read-only full path as subheader.
  const pathRow = el('div', { class: 'rs-detail-copy-row' });
  pathRow.appendChild(el('span', { text: fileResult.file_path, class: 'rs-detail-fullpath' }));
  modal.appendChild(pathRow);

  // Body with context
  const body = el('div', { class: 'rs-detail-body' });
  body.innerHTML = '<p class="rs-placeholder">Loading context...</p>';
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    }
  }
  document.addEventListener('keydown', onKey, true);

  // Load context for all match lines, merge overlapping ranges, and render
  // as a single stream with "…" separators between non-contiguous chunks.
  try {
    body.innerHTML = '';
    const matchLineNums = new Set(fileResult.matches.map(m => m.line_num));

    if (fileResult.matches.length === 0) {
      body.appendChild(el('p', { text: 'No matches', class: 'rs-placeholder' }));
    } else {
      // Fetch contexts for every match in parallel.
      const blocks = await Promise.all(fileResult.matches.map(m =>
        call('get_file_context', {
          filePath: m.file_path || fileResult.file_path,
          lineNum: m.line_num,
          contextLines: contextLines,
        }).catch(err => ({ __err: String(err), line_num: m.line_num }))
      ));

      // Deduplicate: collapse all lines into a Map keyed by line_num.
      const linesByNum = new Map();
      const errors = [];
      for (const b of blocks) {
        if (b && b.__err !== undefined) { errors.push(b); continue; }
        for (const line of b) {
          if (!linesByNum.has(line.line_num)) {
            linesByNum.set(line.line_num, line.text);
          }
        }
      }
      for (const e of errors) {
        body.appendChild(el('p', { text: `Error loading context for L${e.line_num}: ${e.__err}`, style: 'color:var(--danger);font-size:12px' }));
      }

      const sorted = [...linesByNum.keys()].sort((a, b) => a - b);
      const block = el('div', { class: 'rs-context-block' });
      let prev = null;
      for (const n of sorted) {
        if (prev != null && n > prev + 1) {
          const gap = el('div', { class: 'rs-context-gap' });
          gap.textContent = '···';
          block.appendChild(gap);
        }
        const lineEl = el('div', { class: 'rs-context-line' + (matchLineNums.has(n) ? ' is-match' : '') });
        lineEl.appendChild(el('span', { text: String(n).padStart(4, ' '), class: 'rs-ctx-linenum' }));
        lineEl.appendChild(el('span', { text: linesByNum.get(n), class: 'rs-ctx-text' }));
        block.appendChild(lineEl);
        prev = n;
      }
      body.appendChild(block);
    }
  } catch (e) {
    body.innerHTML = '';
    body.appendChild(el('p', { text: 'Error: ' + e, style: 'color:var(--danger)' }));
  }
}

// ── Render git results ────────────────────────────────────

function renderGitResults(gitResults) {
  const resultsList = root.querySelector('#rs-results');
  const countLabel = root.querySelector('#rs-count');
  if (!resultsList) return;
  resultsList.innerHTML = '';

  if (countLabel) {
    countLabel.textContent = gitResults.length + ' commit' + (gitResults.length !== 1 ? 's' : '') +
      (gitResults.length >= 200 ? ' (limit reached)' : '');
  }

  if (!gitResults.length) {
    resultsList.appendChild(el('p', { text: 'No commits found', class: 'rs-placeholder' }));
    return;
  }

  for (const r of gitResults) {
    const card = el('div', { class: 'rs-result-card' });

    const topLine = el('div', { class: 'rs-result-top' });
    const badge = buildRepoBadge(r.repo_name);
    topLine.appendChild(badge);
    topLine.appendChild(el('span', { text: r.commit_hash.substring(0, 8), class: 'rs-commit-hash' }));
    topLine.appendChild(el('span', { text: r.author, class: 'rs-commit-author' }));
    card.appendChild(topLine);

    card.appendChild(el('div', { text: r.message, class: 'rs-commit-message' }));

    if (r.files_changed && r.files_changed.length) {
      const filesEl = el('div', { class: 'rs-commit-files' });
      const count = r.files_changed.length;
      const shown = r.files_changed.slice(0, 5);
      filesEl.textContent = shown.join(', ') + (count > 5 ? ` (+${count - 5} more)` : '');
      card.appendChild(filesEl);
    }

    const metaLine = el('div', { class: 'rs-result-meta' });
    metaLine.appendChild(el('span', { text: formatDate(r.commit_date) }));
    card.appendChild(metaLine);

    card.addEventListener('click', () => showCommitModal(r));
    card.title = 'Click to view diff';

    resultsList.appendChild(card);
  }
}

// ── Commit diff modal ──────────────────────────────────────

async function showCommitModal(gitResult) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay rs-modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal rs-detail-modal';

  // Header
  const header = el('div', { class: 'rs-modal-header' });
  const headerLeft = el('div', { style: 'display:flex;align-items:center;gap:8px;overflow:hidden;flex:1;min-width:0' });
  headerLeft.appendChild(buildRepoBadge(gitResult.repo_name));
  headerLeft.appendChild(el('span', { text: gitResult.commit_hash.substring(0, 10), class: 'rs-commit-hash' }));
  headerLeft.appendChild(el('span', { text: gitResult.message, class: 'rs-detail-path' }));
  header.appendChild(headerLeft);

  const headerActions = el('div', { class: 'rs-detail-actions' });

  const copyBtn = el('button', { text: 'Copy hash', class: 'rs-card-btn' });
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(gitResult.commit_hash)
      .then(() => showToast('Hash copied', 'success'))
      .catch(() => {});
  });
  headerActions.appendChild(copyBtn);

  let fullCtx = false;
  const fullBtn = el('button', { text: 'Full file ▸', class: 'rs-card-btn' });
  fullBtn.addEventListener('click', async () => {
    fullCtx = !fullCtx;
    fullBtn.textContent = fullCtx ? 'Hunks ◂' : 'Full file ▸';
    fullBtn.classList.toggle('active', fullCtx);
    await renderDiff();
  });
  headerActions.appendChild(fullBtn);

  const expandBtn = el('button', { text: 'Expand ▸', class: 'rs-card-btn' });
  expandBtn.addEventListener('click', () => expandGitResults(gitResults, gitResult.commit_hash));
  headerActions.appendChild(expandBtn);

  const closeBtn = el('button', { text: '✕', class: 'btn-secondary rs-modal-close' });
  closeBtn.addEventListener('click', () => overlay.remove());
  headerActions.appendChild(closeBtn);

  header.appendChild(headerActions);
  modal.appendChild(header);

  // Metadata subheader (author + date)
  const meta = el('div', { class: 'rs-detail-copy-row' });
  meta.appendChild(el('span', { text: `${gitResult.author} — ${formatDate(gitResult.commit_date)}`, class: 'rs-detail-fullpath' }));
  modal.appendChild(meta);

  // Body: diff
  const body = el('div', { class: 'rs-detail-body' });
  body.innerHTML = '<p class="rs-placeholder">Loading diff...</p>';
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); overlay.remove(); document.removeEventListener('keydown', onKey, true); }
  }
  document.addEventListener('keydown', onKey, true);

  // Cache diffs per mode for instant toggle after the first load of each.
  const modeCache = new Map();

  async function renderDiff() {
    try {
      await ensureHighlight();
      const repoPath = (allRepos.find(r => r.name === gitResult.repo_name) || {}).path;
      if (!repoPath) throw new Error('Repo path not found for ' + gitResult.repo_name);
      body.innerHTML = '<p class="rs-placeholder">Loading diff...</p>';
      const key = fullCtx ? 'full' : 'short';
      let diff = modeCache.get(key);
      if (diff === undefined) {
        diff = await call('repo_search_commit_diff', {
          repoPath, hash: gitResult.commit_hash, fullContext: fullCtx,
        });
        modeCache.set(key, diff);
      }
      body.innerHTML = '';
      const pre = document.createElement('pre');
      pre.className = 'rs-fs-pre';
      const code = document.createElement('code');
      code.className = 'hljs language-diff';
      try { code.innerHTML = window.hljs.highlight(diff, { language: 'diff', ignoreIllegals: true }).value; }
      catch { code.textContent = diff; }
      pre.appendChild(code);
      body.appendChild(pre);
    } catch (e) {
      body.innerHTML = '';
      body.appendChild(el('p', { text: 'Error: ' + e, style: 'color:var(--danger)' }));
    }
  }
  try {
    await renderDiff();
  } catch (e) {
    body.innerHTML = '';
    body.appendChild(el('p', { text: 'Error: ' + e, style: 'color:var(--danger)' }));
  }
}

// ── Multi-commit expand view ───────────────────────────────

async function expandGitResults(allCommits, startHash) {
  if (!root) return;
  if (document.getElementById('rs-fullscreen-overlay')) return;
  await ensureHighlight();

  // Overlay-local state.
  const enabled = new Set(allCommits.map(c => c.commit_hash));
  // Cache key = `${hash}|${mode}` where mode = 'short' | 'full'
  const diffs = new Map();
  let fullContext = false;

  const overlay = document.createElement('div');
  overlay.id = 'rs-fullscreen-overlay';
  overlay.className = 'rs-fullscreen';

  const header = document.createElement('div');
  header.className = 'rs-fullscreen-header';
  const titleEl = el('div', { text: `${allCommits.length} commits`, class: 'rs-fs-path' });
  header.appendChild(titleEl);

  const headerRight = el('div', { style: 'display:flex;align-items:center;gap:10px' });
  const fullCtxLabel = document.createElement('label');
  fullCtxLabel.className = 'rs-fs-toggle';
  fullCtxLabel.innerHTML = '<input type="checkbox" id="rs-fs-fullctx"/> Full file context';
  headerRight.appendChild(fullCtxLabel);

  const collapse = document.createElement('button');
  collapse.className = 'rs-card-btn';
  collapse.textContent = 'Collapse ◂';
  collapse.dataset.role = 'rs-collapse';
  collapse.addEventListener('click', closeFs);
  headerRight.appendChild(collapse);
  header.appendChild(headerRight);
  overlay.appendChild(header);

  // Wire toggle after mount (need the checkbox DOM ref)
  setTimeout(() => {
    const cb = overlay.querySelector('#rs-fs-fullctx');
    if (cb) cb.addEventListener('change', () => { fullContext = cb.checked; renderBody(); });
  }, 0);

  const split = document.createElement('div');
  split.className = 'rs-fs-split';
  overlay.appendChild(split);

  // Sidebar
  const sidebar = document.createElement('div');
  sidebar.className = 'rs-fs-sidebar';
  split.appendChild(sidebar);

  // Sidebar controls
  const sbCtrl = document.createElement('div');
  sbCtrl.className = 'rs-fs-sidebar-ctrl';
  const allBtn = el('button', { text: 'All', class: 'rs-card-btn' });
  const noneBtn = el('button', { text: 'None', class: 'rs-card-btn' });
  allBtn.addEventListener('click', () => { allCommits.forEach(c => enabled.add(c.commit_hash)); renderSidebar(); renderBody(); });
  noneBtn.addEventListener('click', () => { enabled.clear(); renderSidebar(); renderBody(); });
  sbCtrl.appendChild(allBtn);
  sbCtrl.appendChild(noneBtn);
  sidebar.appendChild(sbCtrl);

  const sbList = document.createElement('div');
  sbList.className = 'rs-fs-sidebar-list';
  sidebar.appendChild(sbList);

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'rs-fs-body';
  split.appendChild(bodyWrap);

  function renderSidebar() {
    sbList.innerHTML = '';
    for (const c of allCommits) {
      const row = document.createElement('div');
      row.className = 'rs-fs-cmt' + (enabled.has(c.commit_hash) ? ' on' : '');
      const check = document.createElement('span');
      check.className = 'rs-fs-cmt-check';
      check.textContent = enabled.has(c.commit_hash) ? '✓' : '';
      row.appendChild(check);
      const info = document.createElement('div');
      info.className = 'rs-fs-cmt-info';
      info.innerHTML = `<div class="rs-fs-cmt-hash">${c.commit_hash.substring(0,8)}</div>
        <div class="rs-fs-cmt-msg" title="${c.message.replace(/"/g, '&quot;')}">${c.message}</div>
        <div class="rs-fs-cmt-meta">${c.author} — ${formatDate(c.commit_date)}</div>`;
      row.appendChild(info);
      row.addEventListener('click', () => {
        if (enabled.has(c.commit_hash)) enabled.delete(c.commit_hash);
        else enabled.add(c.commit_hash);
        renderSidebar();
        renderBody();
      });
      sbList.appendChild(row);
    }
  }

  async function renderBody() {
    bodyWrap.innerHTML = '';
    const active = allCommits.filter(c => enabled.has(c.commit_hash));
    if (!active.length) {
      bodyWrap.innerHTML = '<p class="rs-placeholder" style="padding:20px">No commits selected — click entries in the sidebar.</p>';
      return;
    }
    for (const c of active) {
      const section = document.createElement('div');
      section.className = 'rs-fs-cmt-section';
      const dt = formatDateTime(c.commit_date);
      section.innerHTML = `<div class="rs-fs-cmt-section-head">
        <strong>${c.commit_hash.substring(0,10)}</strong>
        <span class="rs-fs-cmt-section-dt">${dt}</span>
        — ${escapeHtmlCommit(c.message)}
        <span class="rs-fs-cmt-section-meta">${escapeHtmlCommit(c.author)}</span>
      </div>`;
      const pre = document.createElement('pre');
      pre.className = 'rs-fs-pre';
      const code = document.createElement('code');
      code.className = 'hljs language-diff';
      pre.appendChild(code);
      section.appendChild(pre);
      bodyWrap.appendChild(section);

      const cacheKey = `${c.commit_hash}|${fullContext ? 'full' : 'short'}`;
      if (!diffs.has(cacheKey)) {
        code.textContent = 'Loading…';
        try {
          const repoPath = (allRepos.find(r => r.name === c.repo_name) || {}).path;
          const diff = await call('repo_search_commit_diff', {
            repoPath,
            hash: c.commit_hash,
            fullContext,
          });
          diffs.set(cacheKey, diff);
        } catch (e) {
          diffs.set(cacheKey, `Error loading diff: ${e}`);
        }
      }
      const diff = diffs.get(cacheKey);
      try { code.innerHTML = window.hljs.highlight(diff, { language: 'diff', ignoreIllegals: true }).value; }
      catch { code.textContent = diff; }
    }
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return iso; }
  }
  function escapeHtmlCommit(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
  }

  function closeFs() { overlay.remove(); document.removeEventListener('keydown', onFsKey); }
  function onFsKey(e) { if (e.key === 'Escape') closeFs(); }
  document.addEventListener('keydown', onFsKey);

  root.appendChild(overlay);
  renderSidebar();
  renderBody();

  // Scroll the start commit into view in the sidebar.
  if (startHash) {
    setTimeout(() => {
      const rows = sbList.querySelectorAll('.rs-fs-cmt');
      const idx = allCommits.findIndex(c => c.commit_hash === startHash);
      if (idx >= 0) rows[idx]?.scrollIntoView({ block: 'start' });
    }, 30);
  }
}

// ── Expand / fullscreen view ───────────────────────────────

async function expandFileCard(path) {
  if (document.getElementById('rs-fullscreen-overlay')) return;
  if (!root) return;
  await ensureHighlight();

  const overlay = document.createElement('div');
  overlay.id = 'rs-fullscreen-overlay';
  overlay.className = 'rs-fullscreen';

  const header = document.createElement('div');
  header.className = 'rs-fullscreen-header';
  const fsPath = document.createElement('div');
  fsPath.className = 'rs-fs-path';
  fsPath.title = path;
  fsPath.textContent = path.split(/[\\/]/).pop();
  header.appendChild(fsPath);

  const collapse = document.createElement('button');
  collapse.className = 'rs-card-btn';
  collapse.textContent = 'Collapse ◂';
  collapse.dataset.role = 'rs-collapse';
  collapse.addEventListener('click', closeFullscreen);
  header.appendChild(collapse);
  overlay.appendChild(header);

  const codeWrap = document.createElement('div');
  codeWrap.className = 'rs-fullscreen-code';
  overlay.appendChild(codeWrap);

  root.appendChild(overlay);
  document.addEventListener('keydown', onFsKey);

  let data;
  try {
    data = await call('read_full_file', { path });
  } catch (e) {
    codeWrap.innerHTML = `<div style="padding:20px;color:var(--danger)">Read error: ${e}</div>`;
    return;
  }

  if (data.truncated) {
    codeWrap.innerHTML = `<div style="padding:20px;color:var(--text-muted)">File too large (${(data.size / (1024 * 1024)).toFixed(1)} MB) — open in editor instead.</div>`;
    return;
  }

  const lang = guessLang(path);
  const pre = document.createElement('pre');
  pre.className = 'rs-fs-pre';
  const code = document.createElement('code');

  if (lang && window.hljs?.getLanguage(lang)) {
    code.className = `hljs language-${lang}`;
    try {
      code.innerHTML = window.hljs.highlight(data.content, { language: lang, ignoreIllegals: true }).value;
    } catch {
      code.textContent = data.content;
    }
  } else {
    code.className = 'hljs';
    try {
      code.innerHTML = window.hljs.highlightAuto(data.content).value;
    } catch {
      code.textContent = data.content;
    }
  }

  pre.appendChild(code);
  codeWrap.appendChild(pre);
}

function closeFullscreen() {
  document.getElementById('rs-fullscreen-overlay')?.remove();
  document.removeEventListener('keydown', onFsKey);
}

function onFsKey(e) {
  if (e.key === 'Escape') closeFullscreen();
}

function guessLang(path) {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const m = {
    md: 'markdown', py: 'python', js: 'javascript', ts: 'typescript',
    rs: 'rust', go: 'go', sql: 'sql', json: 'json',
    yml: 'yaml', yaml: 'yaml', sh: 'bash', toml: 'toml',
    xml: 'xml', html: 'html', css: 'css', dockerfile: 'dockerfile',
    java: 'java', kt: 'kotlin',
  };
  return m[ext] || null;
}

let highlightLoaded = false;

async function ensureHighlight() {
  if (highlightLoaded) return;
  await Promise.all([
    loadScript('lib/highlight/highlight.min.js'),
    loadStyle('lib/highlight/github-dark.min.css'),
  ]);
  highlightLoaded = true;
}

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = fail;
    document.head.appendChild(s);
  });
}

function loadStyle(href) {
  return new Promise((ok) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onload = ok;
    l.onerror = ok;
    document.head.appendChild(l);
  });
}

// ── Helpers ────────────────────────────────────────────────

function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.class) e.className = opts.class;
  if (opts.text) e.textContent = opts.text;
  if (opts.id) e.id = opts.id;
  if (opts.style) e.setAttribute('style', opts.style);
  if (opts.title) e.title = opts.title;
  return e;
}

function buildRepoBadge(repoName) {
  const repo = allRepos.find(r => r.name === repoName);
  const color = repo ? repo.color : stringToColor(repoName);

  const badge = document.createElement('span');
  badge.className = 'rs-repo-badge';
  badge.style.background = color + '22';
  badge.style.color = color;
  badge.style.borderColor = color + '44';
  badge.textContent = repoName;
  return badge;
}

function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 50%)`;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── CSS ────────────────────────────────────────────────────

function css() {
  return `
.rs-tab-strip {
  display: flex;
  gap: 2px;
  padding: 6px 12px 0;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}
.rs-tab {
  padding: 5px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 5px 5px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.rs-tab.active {
  background: var(--bg-secondary);
  border-color: var(--border);
  color: var(--text);
}
.rs-tab-icon { display: inline-flex; font-size: 11px; }
.rs-sel-btn {
  padding: 3px 7px;
  font-size: 12px;
  line-height: 1;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  margin-right: 2px;
}
.rs-sel-btn:hover { color: var(--text); border-color: #484f58; }
.rs-sel-divider {
  display: inline-block;
  width: 1px;
  height: 16px;
  background: var(--border);
  margin: 0 6px 0 2px;
  vertical-align: middle;
}
.rs-tab-add { color: var(--text-muted); font-weight: bold; padding: 5px 8px; }
.rs-tab-add:hover { color: var(--text); }
.rs-tab.rs-tab-drop {
  background: rgba(59,130,246,0.18);
  border-color: var(--accent, #3b82f6);
  outline: 1px dashed var(--accent, #3b82f6);
  outline-offset: -2px;
}
.rs-chip-dragging { opacity: 0.45; }
.rs-logo-icon { transition: background-color 0.15s; }
.rs-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}
.rs-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.rs-search-input {
  flex: 1;
  padding: 7px 12px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text);
}
.rs-search-input:focus {
  border-color: var(--accent);
  outline: none;
}
.rs-search-btn {
  padding: 7px 16px;
  font-size: 13px;
}
.rs-type-group {
  display: flex;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.rs-type-btn {
  background: transparent;
  border: none;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  border-right: 1px solid var(--border);
  border-radius: 0;
  transition: background 0.15s, color 0.15s;
}
.rs-type-btn:last-child {
  border-right: none;
}
.rs-type-btn:hover {
  background: var(--bg-secondary);
  color: var(--text);
}
.rs-type-btn.active {
  background: var(--accent);
  color: #fff;
}
.rs-gear-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 16px;
  cursor: pointer;
  color: var(--text-muted);
  transition: color 0.15s;
}
.rs-gear-btn:hover {
  color: var(--text);
  background: var(--bg-secondary);
}
/* Repo chips bar */
.rs-repo-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
  min-height: 36px;
}
.rs-repo-chip {
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
  touch-action: none;  /* keep pointer events exclusive during drag */
}
.rs-chip-ghost {
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  transform: translateZ(0);
}
.rs-repo-chip:hover {
  border-color: var(--text-muted);
}
.rs-repo-chip.active {
  background: #161b22;
}
.rs-chip-bar {
  width: 3px;
  height: 16px;
  border-radius: 2px;
  flex-shrink: 0;
}
.rs-repo-add {
  font-size: 16px;
  font-weight: 400;
  padding: 3px 10px;
  color: var(--text-muted);
  opacity: 1 !important;
}
.rs-repo-add:hover {
  color: var(--accent);
  border-color: var(--accent);
}
/* Settings panel */
.rs-settings-panel {
  border-bottom: 1px solid var(--border);
  padding: 10px 12px;
  background: var(--bg-secondary);
  flex-shrink: 0;
}
.rs-settings-header {
  margin-bottom: 8px;
}
.rs-settings-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-muted);
}
.rs-settings-section {
  margin-bottom: 12px;
}
.rs-settings-subtitle {
  font-weight: 600;
  font-size: 12px;
  color: var(--text-muted);
  display: block;
  margin-bottom: 6px;
}
.rs-paths-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
.rs-path-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-tertiary, var(--bg));
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
}
.rs-path-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}
.rs-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.rs-path-remove {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
  font-size: 12px;
  border-radius: 4px;
  min-width: 0;
}
.rs-path-remove:hover {
  color: var(--danger);
  background: var(--bg-secondary);
}
/* Form rows */
.rs-form-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.rs-form-label {
  font-weight: 600;
  font-size: 12px;
  color: var(--text-muted);
  min-width: 80px;
  flex-shrink: 0;
}
.rs-form-input {
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  flex: 1;
}
.rs-form-input:focus {
  border-color: var(--accent);
  outline: none;
}
.rs-color-input {
  width: 40px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  background: transparent;
}
/* Sort bar */
.rs-sortbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.rs-sort-label {
  font-size: 12px;
  color: var(--text-muted);
}
.rs-sort-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
}
.rs-sort-btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.rs-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
}
/* Results */
.rs-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rs-placeholder {
  color: var(--text-muted);
  padding: 20px;
  text-align: center;
  font-size: 13px;
}
.rs-result-card {
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: border-color 0.15s;
}
.rs-result-card:hover {
  border-left-color: var(--accent);
}
.rs-result-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.rs-repo-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  border: 1px solid;
}
.rs-result-path {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.rs-result-date {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.rs-match-line {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11px;
  color: var(--text-muted);
  padding: 3px 6px;
  margin: 2px 0;
  background: var(--bg-tertiary, var(--bg));
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-line-num {
  color: var(--accent);
  font-weight: 600;
}
.rs-more-label {
  font-size: 11px;
  color: var(--accent);
  padding: 2px 6px;
  cursor: pointer;
}
.rs-result-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}
.rs-commit-hash {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  color: var(--accent);
}
.rs-commit-author {
  font-size: 12px;
  color: var(--text-muted);
}
.rs-commit-message {
  font-size: 12px;
  color: var(--text);
  margin: 4px 0;
}
.rs-commit-files {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Add repo modal */
.rs-add-modal {
  max-width: 500px;
  width: 95%;
  padding: 0;
}
.rs-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border);
}
.rs-modal-header h3 { margin: 0; font-size: 15px; }
.rs-modal-close {
  padding: 4px 10px;
  min-width: auto;
  font-size: 14px;
}
.rs-modal-body {
  padding: 16px;
}
.rs-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 16px 16px;
}
/* Detail modal */
.rs-detail-modal {
  max-width: 800px;
  width: 95%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  padding: 0;
}
.rs-detail-path {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-detail-copy-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
}
.rs-detail-fullpath {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.rs-copy-btn {
  padding: 3px 10px;
  font-size: 11px;
  min-width: auto;
  flex-shrink: 0;
}
.rs-detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.rs-context-separator {
  border-top: 1px dashed var(--border);
  margin: 8px 0;
}
.rs-context-block {
  margin: 4px 0;
}
.rs-context-line {
  display: flex;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.5;
  padding: 0 4px;
  border-left: 3px solid transparent;
  color: var(--text-muted);
}
.rs-context-line.is-match {
  color: var(--text);
  background: var(--bg-secondary);
  border-left-color: var(--accent);
}
.rs-ctx-linenum {
  color: var(--text-muted);
  margin-right: 12px;
  user-select: none;
  min-width: 36px;
  text-align: right;
  flex-shrink: 0;
  opacity: 0.6;
}
.rs-ctx-text {
  white-space: pre;
  overflow-x: auto;
}
/* Inner tab strip */
.rs-inner-tabs {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px 0;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.rs-inner-tab {
  padding: 8px 28px;
  font-size: 13px;
  font-weight: 500;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;       /* overlap container's bottom border */
  color: var(--text-muted);
  cursor: pointer;
  letter-spacing: 0.2px;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.rs-inner-tab:hover:not(.active) { color: var(--text); }
.rs-inner-tab.active {
  color: var(--accent, #3b82f6);
  border-bottom-color: var(--accent, #3b82f6);
  font-weight: 600;
}
.rs-inner-panel { flex:1; min-height:0; display:flex; flex-direction:column; overflow:hidden; }
/* Manage panel */
.rs-manage-toolbar { display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--border); flex-shrink:0; }
.rs-dry-wrap { font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:4px; cursor:pointer; }
.rs-manage-table-wrap { flex:1; overflow:auto; padding:6px 14px; }
.rs-manage-empty { padding:14px; color:var(--text-muted); }
.rs-err { color:var(--danger, #f85149); }
.rs-manage { width:100%; border-collapse:collapse; font-size:12px; }
.rs-manage th, .rs-manage td { text-align:left; padding:6px 10px; border-bottom:1px solid var(--border); }
.rs-manage th { color:var(--text-muted); font-weight:500; }
.rs-manage tbody tr:hover { background:rgba(255,255,255,0.03); }
.rs-row-dirty td { color:var(--text); }
.rs-row-err td { color:var(--danger, #f85149); }
.rs-badge { padding:1px 8px; border-radius:10px; font-size:11px; }
.rs-badge-ok   { background:rgba(63,185,80,0.12); color:#3fb950; }
.rs-badge-skip { background:rgba(245,158,11,0.12); color:#f59e0b; }
.rs-badge-err  { background:rgba(248,81,73,0.12); color:#f85149; }
.rs-detail-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.rs-detail-actions .rs-card-btn { margin: 0; }
.rs-row-actions { text-align: right; }
.rs-row-btn {
  padding: 2px 8px;
  font-size: 11px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
}
.rs-row-btn:hover { color: var(--text); border-color: #484f58; }
.rs-reset-btn:hover { color: var(--danger, #f85149); border-color: rgba(248,81,73,0.5); }
/* Card action buttons */
.rs-card-actions {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}
.rs-card-btn {
  padding: 4px 10px;
  font-size: 11px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  margin-right: 0;
}
.rs-card-btn:hover { color: var(--text); border-color: #484f58; }
.rs-card-btn.active {
  color: var(--accent, #3b82f6);
  border-color: rgba(59,130,246,0.5);
  background: rgba(59,130,246,0.08);
}
/* Fullscreen overlay */
.rs-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 2000;           /* above modal-overlay (~1000) so fullscreen covers the source modal */
  background: var(--bg, #0d1117);
  display: flex;
  flex-direction: column;
}
.rs-fullscreen-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.rs-fs-path {
  font-family: monospace;
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-fullscreen-code {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.rs-fs-pre {
  margin: 0;
  padding: 14px 18px;
  font-size: 12px;
  line-height: 1.5;
}
.rs-fs-pre code {
  font-family: 'SF Mono','Consolas','Menlo',monospace;
  white-space: pre;
}

/* Multi-commit expand overlay */
.rs-fs-toggle {
  font-size: 12px; color: var(--text-muted);
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
  user-select: none;
}
.rs-fs-split {
  display: flex;
  flex: 1;
  min-height: 0;
}
.rs-fs-sidebar {
  width: 260px;
  min-width: 220px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg, #0d1117);
}
.rs-fs-sidebar-ctrl {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.rs-fs-sidebar-ctrl button { flex: 1; padding: 3px 8px; font-size: 11px; }
.rs-fs-sidebar-list { flex: 1; overflow-y: auto; padding: 4px; }
.rs-fs-cmt {
  display: flex; gap: 6px; padding: 6px 8px; border-radius: 4px;
  margin-bottom: 2px; cursor: pointer; font-size: 11px;
  align-items: flex-start;
}
.rs-fs-cmt:hover { background: rgba(255,255,255,0.04); }
.rs-fs-cmt.on { background: rgba(59,130,246,0.10); }
.rs-fs-cmt-check {
  width: 14px; text-align: center; color: transparent; font-weight: bold;
  flex-shrink: 0; margin-top: 1px;
}
.rs-fs-cmt.on .rs-fs-cmt-check { color: #3fb950; }
.rs-fs-cmt-info { flex: 1; min-width: 0; }
.rs-fs-cmt-hash { font-family: monospace; font-size: 10px; color: #f0883e; }
.rs-fs-cmt-msg { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs-fs-cmt-meta { color: var(--text-muted); font-size: 10px; }
.rs-fs-body { flex: 1; overflow: auto; padding: 10px 14px; }
.rs-fs-cmt-section { margin-bottom: 16px; }
.rs-fs-cmt-section-head {
  font-size: 12px; color: var(--text-muted);
  padding: 6px 0; border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
}
.rs-fs-cmt-section-head strong { color: #f0883e; font-family: monospace; }
.rs-fs-cmt-section-dt {
  font-family: monospace; font-size: 11px; color: var(--text-muted);
  padding: 1px 6px; background: var(--bg-secondary); border-radius: 3px;
}
.rs-fs-cmt-section-meta { color: var(--text-muted); font-size: 11px; margin-left: auto; }
`;
}
