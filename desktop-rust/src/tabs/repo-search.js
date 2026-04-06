import { call } from '../tauri-api.js';
import { showToast } from '../components/toast.js';

let root = null;
let searchType = 'files';   // files | content | git
let sortMode = 'name';      // name | date
let results = [];
let settingsOpen = false;

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  root.appendChild(buildLayout());
}

export function destroy() {
  if (root) {
    root.innerHTML = '';
  }
  results = [];
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
  const gearBtn = el('button', { text: '\u2699', class: 'rs-gear-btn', title: 'Repo paths' });
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

// ── Settings Panel ─────────────────────────────────────────

async function loadSettingsPanel() {
  const panel = root.querySelector('#rs-settings-panel');
  if (!panel) return;
  panel.innerHTML = '<p style="padding:8px;color:var(--text-muted)">Loading...</p>';

  try {
    const paths = await call('list_repo_paths');
    panel.innerHTML = '';

    const header = el('div', { class: 'rs-settings-header' });
    header.appendChild(el('span', { text: 'Repository paths', class: 'rs-settings-title' }));
    panel.appendChild(header);

    const list = el('div', { class: 'rs-paths-list' });
    for (const p of paths) {
      const item = el('div', { class: 'rs-path-item' });
      item.appendChild(el('span', { text: p, class: 'rs-path-text' }));
      const removeBtn = el('button', { text: '\u2715', class: 'rs-path-remove', title: 'Remove' });
      removeBtn.addEventListener('click', async () => {
        try {
          await call('remove_repo_path', { path: p });
          showToast('Path removed', 'success');
          loadSettingsPanel();
        } catch (e) {
          showToast('Error: ' + e, 'error');
        }
      });
      item.appendChild(removeBtn);
      list.appendChild(item);
    }
    if (paths.length === 0) {
      list.appendChild(el('p', { text: 'No paths configured', style: 'color:var(--text-muted);padding:4px 0' }));
    }
    panel.appendChild(list);

    // Add path row
    const addRow = el('div', { class: 'rs-add-row' });
    const pathInput = document.createElement('input');
    pathInput.type = 'text';
    pathInput.className = 'rs-path-input';
    pathInput.placeholder = '/path/to/repo';
    addRow.appendChild(pathInput);

    const addBtn = el('button', { text: 'Add', class: 'rs-add-btn' });
    addBtn.addEventListener('click', async () => {
      const val = pathInput.value.trim();
      if (!val) return;
      try {
        await call('add_repo_path', { path: val });
        showToast('Path added', 'success');
        pathInput.value = '';
        loadSettingsPanel();
      } catch (e) {
        showToast('Error: ' + e, 'error');
      }
    });
    pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addBtn.click();
    });
    addRow.appendChild(addBtn);
    panel.appendChild(addRow);
  } catch (e) {
    panel.innerHTML = '';
    panel.appendChild(el('p', { text: 'Error loading paths: ' + e, style: 'color:var(--danger)' }));
  }
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

  try {
    if (searchType === 'files') {
      results = await call('search_filenames', { pattern: query });
      renderResults();
    } else if (searchType === 'content') {
      results = await call('search_content', { query });
      renderResults();
    } else if (searchType === 'git') {
      const gitResults = await call('search_git_history', { query });
      renderGitResults(gitResults);
    }
  } catch (e) {
    resultsList.innerHTML = '';
    resultsList.appendChild(el('p', { text: 'Error: ' + e, class: 'rs-placeholder', style: 'color:var(--danger)' }));
  }
}

// ── Render results ─────────────────────────────────────────

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

  // Sort
  const sorted = [...results];
  if (sortMode === 'name') {
    sorted.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  } else {
    sorted.sort((a, b) => (b.modified_at || '').localeCompare(a.modified_at || ''));
  }

  for (const r of sorted) {
    const card = el('div', { class: 'rs-result-card' });

    const topLine = el('div', { class: 'rs-result-top' });
    const badge = el('span', { text: r.repo_name, class: 'rs-repo-badge' });
    badge.style.backgroundColor = stringToColor(r.repo_name);
    topLine.appendChild(badge);
    topLine.appendChild(el('span', { text: r.relative_path, class: 'rs-result-path' }));
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

    const metaLine = el('div', { class: 'rs-result-meta' });
    if (r.modified_at) {
      metaLine.appendChild(el('span', { text: formatDate(r.modified_at) }));
    }
    if (r.size != null) {
      metaLine.appendChild(el('span', { text: formatSize(r.size) }));
    }
    card.appendChild(metaLine);

    // Click to copy path
    card.addEventListener('click', () => {
      navigator.clipboard.writeText(r.file_path).then(() => {
        showToast('Path copied', 'success');
      }).catch(() => {});
    });
    card.title = r.file_path;

    resultsList.appendChild(card);
  }
}

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
    const badge = el('span', { text: r.repo_name, class: 'rs-repo-badge' });
    badge.style.backgroundColor = stringToColor(r.repo_name);
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

    // Click to copy commit hash
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

function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 40%)`;
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
.rs-paths-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
.rs-path-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
.rs-add-row {
  display: flex;
  gap: 6px;
}
.rs-path-input {
  flex: 1;
  padding: 5px 8px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
}
.rs-path-input:focus {
  border-color: var(--accent);
  outline: none;
}
.rs-add-btn {
  padding: 5px 12px;
  font-size: 12px;
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
  border-radius: 10px;
  font-size: 11px;
  color: #fff;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}
.rs-result-path {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-match-line {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11px;
  color: var(--text-muted);
  padding: 3px 6px;
  margin: 4px 0 2px;
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
`;
}
