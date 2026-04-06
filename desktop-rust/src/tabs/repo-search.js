import { call } from '../tauri-api.js';
import { showToast } from '../components/toast.js';

let root = null;
let searchType = 'files';   // files | content | git
let sortMode = 'name';      // name | date
let results = [];
let settingsOpen = false;
let activeRepos = new Set();  // names of selected repos
let allRepos = [];            // RepoEntry[]
let contextLines = 3;

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  loadInitData().then(() => {
    root.appendChild(buildLayout());
  });
}

export function destroy() {
  if (root) {
    root.innerHTML = '';
  }
  results = [];
}

async function loadInitData() {
  try {
    allRepos = await call('list_repos');
    // All repos active by default
    activeRepos = new Set(allRepos.map(r => r.name));
  } catch {
    allRepos = [];
    activeRepos = new Set();
  }
  try {
    const val = await call('get_setting', { key: 'search_context_lines' });
    contextLines = parseInt(val) || 3;
  } catch {
    contextLines = 3;
  }
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

  wrap.appendChild(topBar);

  // Repo chips bar
  const repoBar = el('div', { class: 'rs-repo-bar', id: 'rs-repo-bar' });
  wrap.appendChild(repoBar);
  renderRepoChips();

  // Settings panel (collapsible)
  const settingsPanel = el('div', { class: 'rs-settings-panel', id: 'rs-settings-panel' });
  settingsPanel.style.display = 'none';
  wrap.appendChild(settingsPanel);

  // Sort bar
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
      renderResults();
    });
    sortBar.appendChild(btn);
  }

  const countLabel = el('span', { text: '', class: 'rs-count', id: 'rs-count' });
  sortBar.appendChild(countLabel);
  wrap.appendChild(sortBar);

  // Results area
  const resultsList = el('div', { class: 'rs-results', id: 'rs-results' });
  resultsList.innerHTML = '<p class="rs-placeholder">Enter a search pattern and press Enter</p>';
  wrap.appendChild(resultsList);

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

function renderRepoChips() {
  const bar = root.querySelector('#rs-repo-bar');
  if (!bar) return;
  bar.innerHTML = '';

  for (const repo of allRepos) {
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

    // Right-click to remove
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm(`Remove repo "${repo.name}"?`)) {
        removeRepo(repo.name);
      }
    });

    chip.title = repo.path;
    bar.appendChild(chip);
  }

  // "+" button
  const addBtn = document.createElement('div');
  addBtn.className = 'rs-repo-chip rs-repo-add';
  addBtn.textContent = '+';
  addBtn.title = 'Add repository';
  addBtn.addEventListener('click', showAddRepoModal);
  bar.appendChild(addBtn);
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

function showAddRepoModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay rs-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal rs-add-modal';

  // Header
  const header = el('div', { class: 'rs-modal-header' });
  header.appendChild(el('h3', { text: 'Add Repository' }));
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
  colorInput.value = randomColor();
  colorInput.className = 'rs-color-input';
  colorRow.appendChild(colorInput);
  body.appendChild(colorRow);

  modal.appendChild(body);

  // Actions
  const actions = el('div', { class: 'rs-modal-actions' });
  const saveBtn = el('button', { text: 'Save' });
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const path = pathInput.value.trim();
    const color = colorInput.value;
    if (!name || !path) {
      showToast('Name and path are required', 'error');
      return;
    }
    try {
      await call('add_repo', { name, path, color });
      allRepos.push({ name, path, color });
      activeRepos.add(name);
      renderRepoChips();
      showToast('Repo added', 'success');
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
    if (searchType === 'files') {
      results = await call('search_filenames', { pattern: query, repos });
      renderResults();
    } else if (searchType === 'content') {
      results = await call('search_content', { query, repos });
      renderContentResults(results);
    } else if (searchType === 'git') {
      const gitResults = await call('search_git_history', { query, repos });
      renderGitResults(gitResults);
    }
  } catch (e) {
    resultsList.innerHTML = '';
    resultsList.appendChild(el('p', { text: 'Error: ' + e, class: 'rs-placeholder', style: 'color:var(--danger)' }));
  }
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

    card.addEventListener('click', () => {
      navigator.clipboard.writeText(r.file_path).then(() => {
        showToast('Path copied', 'success');
      }).catch(() => {});
    });
    card.title = r.file_path;

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

    // Click card to show detail modal
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

  // Header
  const header = el('div', { class: 'rs-modal-header' });
  const headerLeft = el('div', { style: 'display:flex;align-items:center;gap:8px;overflow:hidden;flex:1' });
  headerLeft.appendChild(buildRepoBadge(fileResult.repo_name));
  headerLeft.appendChild(el('span', { text: fileResult.relative_path, class: 'rs-detail-path' }));
  header.appendChild(headerLeft);

  const closeBtn = el('button', { text: '\u2715', class: 'btn-secondary rs-modal-close' });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Copy path button
  const copyRow = el('div', { class: 'rs-detail-copy-row' });
  const fullPath = el('span', { text: fileResult.file_path, class: 'rs-detail-fullpath' });
  copyRow.appendChild(fullPath);
  const copyBtn = el('button', { text: 'Copy path', class: 'btn-secondary rs-copy-btn' });
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(fileResult.file_path).then(() => {
      showToast('Path copied', 'success');
    }).catch(() => {});
  });
  copyRow.appendChild(copyBtn);
  modal.appendChild(copyRow);

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

  // Load context for all match lines
  try {
    body.innerHTML = '';
    const matchLineNums = new Set(fileResult.matches.map(m => m.line_num));

    for (let i = 0; i < fileResult.matches.length; i++) {
      const m = fileResult.matches[i];

      if (i > 0) {
        body.appendChild(el('div', { class: 'rs-context-separator' }));
      }

      try {
        const lines = await call('get_file_context', {
          filePath: m.file_path || fileResult.file_path,
          lineNum: m.line_num,
          contextLines: contextLines,
        });

        const block = el('div', { class: 'rs-context-block' });
        for (const line of lines) {
          const lineEl = el('div', { class: 'rs-context-line' + (matchLineNums.has(line.line_num) ? ' is-match' : '') });
          lineEl.appendChild(el('span', { text: String(line.line_num).padStart(4, ' '), class: 'rs-ctx-linenum' }));
          lineEl.appendChild(el('span', { text: line.text, class: 'rs-ctx-text' }));
          block.appendChild(lineEl);
        }
        body.appendChild(block);
      } catch (err) {
        body.appendChild(el('p', { text: 'Error loading context for L' + m.line_num + ': ' + err, style: 'color:var(--danger);font-size:12px' }));
      }
    }

    if (fileResult.matches.length === 0) {
      body.appendChild(el('p', { text: 'No matches', class: 'rs-placeholder' }));
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

    card.addEventListener('click', () => {
      navigator.clipboard.writeText(r.commit_hash).then(() => {
        showToast('Hash copied', 'success');
      }).catch(() => {});
    });
    card.title = 'Click to copy hash: ' + r.commit_hash;

    resultsList.appendChild(card);
  }
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
.rs-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
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
`;
}
