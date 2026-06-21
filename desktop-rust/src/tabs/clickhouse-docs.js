import { call } from '../tauri-api.js';
import { showToast } from '../components/toast.js';
import { showModal } from '../components/modal.js';
import { marked } from '../lib/marked.min.js';

let root = null;
let tree = { pages: [], page_count: 0, section_count: 0, last_update_at: null };
let activePage = null;
let activeSectionPath = '';
let pageCache = new Map();
let sectionCache = new Map();
let searchTimer = null;
let updateProgress = null;
let updateUnlisten = null;
let updateElapsedTimer = null;
let treeLoadToken = 0;
let pageLoadToken = 0;

export function init(container) {
  root = container;
  pageCache = new Map();
  sectionCache = new Map();
  root.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);
  root.appendChild(buildShell());
  setupUpdateProgressListener();
  loadUpdateProgress();
  loadTree({ openFirst: false });
}

export function destroy() {
  clearTimeout(searchTimer);
  searchTimer = null;
  pageLoadToken += 1;
  treeLoadToken += 1;
  stopUpdateElapsedTimer();
  if (typeof updateUnlisten === 'function') {
    updateUnlisten();
  }
  updateUnlisten = null;
  if (root) root.innerHTML = '';
  root = null;
  tree = { pages: [], page_count: 0, section_count: 0, last_update_at: null };
  activePage = null;
  activeSectionPath = '';
  updateProgress = null;
  pageCache.clear();
  sectionCache.clear();
}

function buildShell() {
  const shell = el('div', { class: 'ch-docs-shell' });
  const header = el('div', { class: 'ch-header' });
  const titleBlock = el('div', { class: 'ch-title-block' });
  titleBlock.appendChild(el('div', { class: 'ch-docs-title', text: 'ClickHouse' }));
  titleBlock.appendChild(el('div', { class: 'ch-status', text: 'Loading local docs...' }));
  header.appendChild(titleBlock);

  const search = el('input', { class: 'ch-search-input' });
  search.type = 'search';
  search.placeholder = 'Search functions, syntax, statements...';
  search.autocomplete = 'off';
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(search.value), 180);
  });
  header.appendChild(search);

  const actions = el('div', { class: 'ch-actions' });
  const updateBtn = el('button', { class: 'ch-btn', text: 'Update docs' });
  updateBtn.type = 'button';
  updateBtn.dataset.action = 'update';
  updateBtn.addEventListener('click', () => updateDocs(updateBtn));
  actions.appendChild(updateBtn);

  const changelogBtn = el('button', { class: 'ch-btn ch-btn-secondary', text: 'Changelog' });
  changelogBtn.type = 'button';
  changelogBtn.dataset.action = 'changelog';
  changelogBtn.addEventListener('click', openChangelogModal);
  actions.appendChild(changelogBtn);
  header.appendChild(actions);
  shell.appendChild(header);
  shell.appendChild(el('section', { class: 'ch-update-progress', hidden: true }));

  const body = el('div', { class: 'ch-body' });
  body.appendChild(el('aside', { class: 'ch-nav' }));
  const main = el('main', { class: 'ch-main' });
  main.appendChild(el('div', { class: 'ch-loading', text: 'Loading...' }));
  body.appendChild(main);
  shell.appendChild(body);
  return shell;
}

async function loadTree({ openFirst = true } = {}) {
  const token = ++treeLoadToken;
  const slowTimer = setTimeout(() => {
    if (token !== treeLoadToken || activePage) return;
    renderSlowTreeState();
  }, getTreeLoadTimeoutMs());
  try {
    tree = await call('list_clickhouse_doc_tree');
    if (token !== treeLoadToken) return;
    renderStatus();
    renderUpdateProgress();
    renderNav();
    if (openFirst && !activePage && tree.pages?.[0]) {
      await openPage(tree.pages[0].id);
    } else if (tree.pages?.length && !activePage) {
      renderWelcomeState();
    } else if (!tree.pages?.length) {
      renderEmptyState();
    }
  } catch (err) {
    if (token !== treeLoadToken) return;
    renderError(`Failed to load ClickHouse docs: ${err}`);
  } finally {
    clearTimeout(slowTimer);
  }
}

function renderStatus() {
  const status = root?.querySelector('.ch-status');
  if (!status) return;
  const last = tree.last_update_at ? ` · updated ${formatDate(tree.last_update_at)}` : '';
  status.textContent = `${tree.page_count || 0} pages · ${tree.section_count || 0} sections${last}`;
}

function renderNav() {
  const nav = root?.querySelector('.ch-nav');
  if (!nav) return;
  nav.innerHTML = '';
  const groups = new Map();
  for (const page of tree.pages || []) {
    if (!groups.has(page.category)) groups.set(page.category, []);
    groups.get(page.category).push(page);
  }
  for (const [category, pages] of groups) {
    const group = el('div', { class: 'ch-nav-group' });
    group.appendChild(el('div', { class: 'ch-nav-category', text: category }));
    for (const page of pages) {
      const isActivePage = activePage?.id === page.id;
      const btn = el('button', {
        class: 'ch-nav-page' + (isActivePage ? ' active' : ''),
        text: page.title,
      });
      btn.type = 'button';
      btn.addEventListener('click', () => openPage(page.id));
      group.appendChild(btn);
      if (isActivePage && activePage?.sections?.length) {
        const sections = el('div', { class: 'ch-nav-sections' });
        for (const section of activePage.sections) {
          const sectionBtn = el('button', {
            class: 'ch-nav-section' + (activeSectionPath === section.section_path ? ' active' : ''),
            text: section.title,
          });
          sectionBtn.type = 'button';
          sectionBtn.addEventListener('click', () => openPage(page.id, section.section_path));
          sections.appendChild(sectionBtn);
        }
        group.appendChild(sections);
      }
    }
    nav.appendChild(group);
  }
}

async function openPage(pageId, sectionPath = '') {
  const token = ++pageLoadToken;
  try {
    activePage = await loadPage(pageId);
    if (token !== pageLoadToken) return;
    activeSectionPath = sectionPath || '';
    renderNav();
    await renderPageContent(token);
  } catch (err) {
    if (token !== pageLoadToken) return;
    renderError(`Failed to open ClickHouse page: ${err}`);
  }
}

async function loadPage(pageId) {
  const key = String(pageId);
  if (!pageCache.has(key)) {
    pageCache.set(key, await call('get_clickhouse_doc_page', { pageId }));
  }
  return pageCache.get(key);
}

async function loadSection(pageId, sectionPath) {
  const key = `${pageId}:${sectionPath}`;
  if (!sectionCache.has(key)) {
    sectionCache.set(key, await call('get_clickhouse_doc_section', { pageId, sectionPath }));
  }
  return sectionCache.get(key);
}

async function runSearch(query) {
  const q = (query || '').trim();
  if (!q) {
    if (activePage) renderPageContent();
    else renderEmptyState();
    return;
  }
  if (q.length < 2) return;
  const main = root?.querySelector('.ch-main');
  if (main) main.innerHTML = '<div class="ch-loading">Searching...</div>';
  try {
    const results = await call('search_clickhouse_docs', { query: q, limit: 50 });
    renderSearchResults(q, results || []);
  } catch (err) {
    renderError(`ClickHouse search failed: ${err}`);
  }
}

function renderSearchResults(query, results) {
  const main = root?.querySelector('.ch-main');
  if (!main) return;
  main.innerHTML = '';
  const head = el('div', { class: 'ch-results-head' });
  head.appendChild(el('div', { class: 'ch-results-title', text: `Results for "${query}"` }));
  head.appendChild(el('div', { class: 'ch-results-count', text: `${results.length} match${results.length === 1 ? '' : 'es'}` }));
  main.appendChild(head);
  if (!results.length) {
    main.appendChild(el('div', { class: 'ch-empty', text: 'No matching sections in local docs.' }));
    return;
  }
  const list = el('div', { class: 'ch-results-list' });
  for (const result of results) {
    const card = el('button', { class: 'ch-result-card' });
    card.type = 'button';
    card.innerHTML = `
      <div class="ch-result-meta">${escapeHtml(result.category)} / ${escapeHtml(result.page_title)}</div>
      <div class="ch-result-title">${escapeHtml(result.section_title)}</div>
      <div class="ch-result-excerpt">${escapeHtml(result.excerpt || '')}</div>
    `;
    card.addEventListener('click', async () => {
      await openPage(result.page_id, result.section_path);
      const input = root?.querySelector('.ch-search-input');
      if (input) input.value = '';
    });
    list.appendChild(card);
  }
  main.appendChild(list);
}

async function renderPageContent(token = pageLoadToken) {
  if (!activePage) {
    renderEmptyState();
    return;
  }
  if (activeSectionPath) {
    await renderSection(activeSectionPath, token);
    return;
  }
  if (activePage.sections?.length) {
    renderSectionIndex();
    return;
  }
  renderFullArticle();
}

async function renderSection(sectionPath, token = pageLoadToken) {
  const summary = activePage?.sections?.find(s => s.section_path === sectionPath);
  if (!summary) {
    renderSectionIndex();
    return;
  }
  const main = root?.querySelector('.ch-main');
  if (!main) return;
  main.innerHTML = '';
  main.appendChild(articleHeader(activePage, summary.title));
  main.appendChild(el('div', { class: 'ch-loading', text: 'Loading section...' }));
  const section = await loadSection(activePage.id, sectionPath);
  if (token !== pageLoadToken) return;
  main.innerHTML = '';
  main.appendChild(articleHeader(activePage, section.title || summary.title));
  const article = el('article', { class: 'ch-article' });
  article.innerHTML = renderMarkdown(`## ${section.title || summary.title}\n\n${section.body || ''}`);
  main.appendChild(article);
}

function renderSectionIndex() {
  const main = root?.querySelector('.ch-main');
  if (!main || !activePage) return;
  main.innerHTML = '';
  main.appendChild(articleHeader(activePage));
  const index = el('div', { class: 'ch-section-index' });
  index.appendChild(el('div', {
    class: 'ch-section-index-head',
    text: `${activePage.sections.length} section${activePage.sections.length === 1 ? '' : 's'}`,
  }));
  const list = el('div', { class: 'ch-section-index-list' });
  for (const section of activePage.sections) {
    const card = el('button', { class: 'ch-section-card' });
    card.type = 'button';
    card.dataset.sectionPath = section.section_path;
    card.innerHTML = `
      <div class="ch-section-card-title">${escapeHtml(section.title)}</div>
      <div class="ch-section-card-excerpt">${escapeHtml(sectionExcerpt(section))}</div>
    `;
    card.addEventListener('click', () => openPage(activePage.id, section.section_path));
    list.appendChild(card);
  }
  index.appendChild(list);
  main.appendChild(index);
}

function renderFullArticle() {
  const main = root?.querySelector('.ch-main');
  if (!main || !activePage) return;
  main.innerHTML = '';
  main.appendChild(articleHeader(activePage));
  const article = el('article', { class: 'ch-article' });
  article.innerHTML = renderMarkdown(activePage.markdown || '');
  main.appendChild(article);
}

function articleHeader(page, sectionTitle = '') {
  const header = el('div', { class: 'ch-article-header' });
  const left = el('div');
  left.appendChild(el('div', { class: 'ch-article-kicker', text: page.category }));
  left.appendChild(el('h2', { text: sectionTitle || page.title }));
  header.appendChild(left);
  if (page.public_url) {
    const link = el('a', { class: 'ch-source-link', text: 'Open official docs' });
    link.href = page.public_url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    header.appendChild(link);
  }
  return header;
}

function renderEmptyState() {
  const main = root?.querySelector('.ch-main');
  if (!main) return;
  main.innerHTML = '<div class="ch-empty">Local ClickHouse docs are empty. Click Update docs to fetch the curated reference set.</div>';
}

function renderWelcomeState() {
  const main = root?.querySelector('.ch-main');
  if (!main) return;
  main.innerHTML = '<div class="ch-empty">Choose a ClickHouse page from the navigation tree. Large pages open as section indexes first.</div>';
}

function renderSlowTreeState() {
  const main = root?.querySelector('.ch-main');
  if (!main || activePage) return;
  main.innerHTML = `
    <div class="ch-empty">
      <div class="ch-empty-title">ClickHouse docs are still loading</div>
      <div class="ch-empty-subtitle">The local documentation index is being read in the background. You can switch to another module and come back here.</div>
    </div>
  `;
}

function renderError(message) {
  const main = root?.querySelector('.ch-main');
  if (main) main.innerHTML = `<div class="ch-error">${escapeHtml(message)}</div>`;
}

async function updateDocs(button) {
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = 'Updating...';
  try {
    const run = await call('update_clickhouse_docs');
    if (!root) return;
    showToast(run.summary || 'ClickHouse docs updated');
    activePage = null;
    activeSectionPath = '';
    pageCache.clear();
    sectionCache.clear();
    await loadTree({ openFirst: false });
    renderUpdateState(run);
  } catch (err) {
    await loadUpdateProgress();
    if (root) renderError(`ClickHouse docs update failed: ${err}`);
  } finally {
    if (button?.isConnected) {
      if (updateProgress?.running) {
        button.disabled = true;
        button.textContent = 'Updating...';
      } else {
        button.disabled = false;
        button.textContent = oldText;
      }
    }
  }
}

async function loadUpdateProgress() {
  try {
    updateProgress = await call('get_clickhouse_doc_update_progress');
    renderUpdateProgress();
    if (updateProgress?.running) startUpdateElapsedTimer();
  } catch (err) {
    console.warn('[clickhouse-docs] failed to load update progress', err);
  }
}

async function setupUpdateProgressListener() {
  const listen = await waitForEventListen();
  if (!listen || !root) return;
  try {
    updateUnlisten = await listen('clickhouse-doc-update-progress', async (event) => {
      updateProgress = event?.payload || null;
      renderUpdateProgress();
      if (updateProgress?.running) {
        startUpdateElapsedTimer();
        return;
      }
      stopUpdateElapsedTimer();
      if (root && updateProgress?.phase === 'done') {
        activePage = null;
        activeSectionPath = '';
        pageCache.clear();
        sectionCache.clear();
        await loadTree({ openFirst: false });
        renderUpdateState(updateProgress);
      }
    });
  } catch (err) {
    console.warn('[clickhouse-docs] failed to subscribe to update progress', err);
  }
}

async function waitForEventListen(timeoutMs = 2500) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const listen = window.__TAURI__?.event?.listen;
    if (typeof listen === 'function') return listen;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

function startUpdateElapsedTimer() {
  if (updateElapsedTimer) return;
  updateElapsedTimer = setInterval(() => {
    if (!updateProgress?.running) {
      stopUpdateElapsedTimer();
      return;
    }
    if (updateProgress.started_at_ms) {
      updateProgress.elapsed_ms = Math.max(0, Date.now() - updateProgress.started_at_ms);
    }
    renderUpdateProgress();
  }, 1000);
}

function stopUpdateElapsedTimer() {
  if (!updateElapsedTimer) return;
  clearInterval(updateElapsedTimer);
  updateElapsedTimer = null;
}

function renderUpdateProgress() {
  const panel = root?.querySelector('.ch-update-progress');
  if (!panel) return;
  const progress = updateProgress || {};
  const phase = progress.phase || 'idle';
  const hasResult = Boolean(progress.summary || progress.error || progress.finished_at);
  if (phase === 'idle' && !progress.running && !hasResult) {
    setUpdateButtonRunning(false);
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  const percent = clampPercent(progress.percent);
  const running = Boolean(progress.running);
  const isError = phase === 'error' || Boolean(progress.error);
  const title = running ? 'Updating ClickHouse docs' : isError ? 'Update failed' : 'Complete';
  const summary = progress.summary || progress.error || progress.message || 'The local documentation cache is up to date.';
  const elapsed = formatDuration(progress.elapsed_ms || 0);
  const countLine = running
    ? `${progress.current || 0}/${progress.total || 0} source page(s) · ${progress.remaining || 0} remaining · ${Math.round(percent)}% · ${elapsed}`
    : `Last update ${formatDate(progress.finished_at || progress.started_at)} · ${Math.round(percent)}% · ${tree.page_count || 0} page(s) · ${tree.section_count || 0} section(s) · ${elapsed}`;
  panel.hidden = false;
  panel.className = `ch-update-progress ${running ? 'running' : isError ? 'error' : 'done'}`;
  setUpdateButtonRunning(running);
  panel.innerHTML = `
    <div class="ch-update-progress-main">
      <div class="ch-update-progress-title">${escapeHtml(title)}</div>
      <div class="ch-update-progress-message">${escapeHtml(progress.message || summary)}</div>
      <div class="ch-update-progress-meta">${escapeHtml(countLine)}</div>
      <div class="ch-update-progress-summary">${escapeHtml(summary)}</div>
    </div>
    <div class="ch-update-progress-meter" aria-label="ClickHouse update progress">
      <div class="ch-update-progress-fill" style="width: ${percent}%"></div>
    </div>
  `;
}

function setUpdateButtonRunning(running) {
  const button = root?.querySelector('[data-action="update"]');
  if (!button) return;
  button.disabled = Boolean(running);
  button.textContent = running ? 'Updating...' : 'Update docs';
}

function renderUpdateState(run) {
  const main = root?.querySelector('.ch-main');
  if (!main) return;
  main.innerHTML = '';
  const state = el('div', { class: 'ch-update-state' });
  state.appendChild(el('div', { class: 'ch-update-title', text: 'ClickHouse docs updated' }));
  state.appendChild(el('div', { class: 'ch-update-summary', text: run?.summary || 'The local documentation cache is up to date.' }));
  state.appendChild(el('div', { class: 'ch-update-hint', text: 'Use search or choose a page from the navigation tree.' }));
  main.appendChild(state);
}

async function openChangelogModal() {
  const body = el('div', { class: 'ch-changelog-modal' });
  body.appendChild(el('div', { class: 'ch-loading', text: 'Loading changelog...' }));
  showModal({
    title: 'ClickHouse Docs Changelog',
    body,
    confirmText: 'OK',
    cancelText: 'Close',
    onConfirm: () => true,
  }).catch(() => {});
  try {
    const runs = await call('list_clickhouse_doc_update_runs');
    await renderChangelog(body, runs || []);
  } catch (err) {
    body.innerHTML = `<div class="ch-error">Failed to load changelog: ${escapeHtml(String(err))}</div>`;
  }
}

async function renderChangelog(body, runs) {
  body.innerHTML = '';
  if (!runs.length) {
    body.appendChild(el('div', { class: 'ch-empty', text: 'No update runs yet. Run Update docs first.' }));
    return;
  }
  for (const run of runs.slice(0, 10)) {
    const block = el('div', { class: 'ch-run' });
    block.innerHTML = `
      <div class="ch-run-head">
        <span class="ch-run-status ${escapeHtml(run.status)}">${escapeHtml(run.status)}</span>
        <span>${escapeHtml(formatDate(run.finished_at))}</span>
      </div>
      <div class="ch-run-summary">${escapeHtml(run.summary || '')}</div>
    `;
    const changes = await call('list_clickhouse_doc_changes', { runId: run.id }).catch(() => []);
    const list = el('div', { class: 'ch-change-list' });
    for (const change of (changes || []).slice(0, 20)) {
      list.appendChild(el('div', {
        class: `ch-change ${change.change_type || ''}`,
        text: `${change.change_type}: ${change.title}${change.details ? ` - ${change.details}` : ''}`,
      }));
    }
    if (!list.childElementCount) {
      list.appendChild(el('div', { class: 'ch-change muted', text: 'No section-level changes.' }));
    }
    block.appendChild(list);
    body.appendChild(block);
  }
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function clampPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function sectionExcerpt(section) {
  const raw = String(section?.excerpt || section?.body || '');
  return raw.slice(0, 600).replace(/\s+/g, ' ').trim().slice(0, 180);
}

function getTreeLoadTimeoutMs() {
  const override = Number(window.__CLICKHOUSE_DOCS_LOAD_TIMEOUT_MS);
  if (Number.isFinite(override) && override >= 0) return override;
  return 1200;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderMarkdown(markdown) {
  return marked(normalizeClickHouseMarkdownForRender(markdown || ''));
}

export function normalizeClickHouseMarkdownForRender(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  let inFence = false;
  let fenceMarker = '';
  let fenceLength = 0;
  return lines.map((line) => {
    const trimmed = line.trimStart();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
    if (!fenceMatch) return line;

    const marker = fenceMatch[1];
    if (!inFence) {
      inFence = true;
      fenceMarker = marker[0];
      fenceLength = marker.length;
      const info = fenceMatch[2].trim();
      const lang = sanitizeFenceLanguage(info.split(/\s+/)[0] || '');
      const indent = line.slice(0, line.length - trimmed.length);
      return `${indent}${marker}${lang ? lang : ''}`;
    }

    if (marker[0] === fenceMarker && marker.length >= fenceLength) {
      inFence = false;
      fenceMarker = '';
      fenceLength = 0;
    }
    return line;
  }).join('\n');
}

function sanitizeFenceLanguage(lang) {
  return String(lang || '').replace(/[^\w#+.-]/g, '');
}

function el(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.hidden) node.hidden = true;
  return node;
}

function css() {
  return `
  .ch-docs-shell {
    height: 100%;
    display: flex;
    flex-direction: column;
    color: var(--text-primary);
    background: var(--bg-primary);
  }
  .ch-header {
    display: grid;
    grid-template-columns: minmax(180px, 260px) minmax(260px, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
  }
  .ch-docs-title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0;
  }
  .ch-status {
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ch-search-input {
    width: 100%;
    min-height: 34px;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0 11px;
    background: var(--bg-primary);
    color: var(--text-primary);
    outline: none;
  }
  .ch-search-input:focus {
    border-color: var(--accent, #f4c430);
    box-shadow: 0 0 0 2px rgba(244, 196, 48, 0.16);
  }
  .ch-actions {
    display: flex;
    gap: 8px;
  }
  .ch-btn {
    min-height: 34px;
    border: 1px solid rgba(244, 196, 48, 0.6);
    border-radius: 6px;
    padding: 0 12px;
    background: rgba(244, 196, 48, 0.14);
    color: var(--text-primary);
    cursor: pointer;
  }
  .ch-btn-secondary {
    border-color: var(--border);
    background: var(--bg-primary);
  }
  .ch-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .ch-update-progress {
    border-bottom: 1px solid var(--border);
    padding: 9px 14px 10px;
    background: rgba(244, 196, 48, 0.08);
  }
  .ch-update-progress[hidden] {
    display: none;
  }
  .ch-update-progress.error {
    background: rgba(239, 68, 68, 0.11);
  }
  .ch-update-progress-main {
    display: grid;
    grid-template-columns: minmax(150px, 220px) minmax(180px, 1fr) auto;
    gap: 10px;
    align-items: baseline;
  }
  .ch-update-progress-title {
    font-size: 13px;
    font-weight: 700;
  }
  .ch-update-progress-message,
  .ch-update-progress-summary {
    min-width: 0;
    color: var(--text-secondary);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ch-update-progress-meta {
    color: var(--text-muted);
    font-size: 12px;
    white-space: nowrap;
  }
  .ch-update-progress-meter {
    height: 5px;
    margin-top: 7px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
  }
  .ch-update-progress-fill {
    height: 100%;
    width: 0;
    border-radius: inherit;
    background: linear-gradient(90deg, rgba(244, 196, 48, 0.85), rgba(96, 165, 250, 0.85));
    transition: width 160ms ease;
  }
  .ch-update-progress.error .ch-update-progress-fill {
    background: rgba(239, 68, 68, 0.85);
  }
  .ch-body {
    min-height: 0;
    flex: 1;
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr);
  }
  .ch-nav {
    min-height: 0;
    overflow: auto;
    padding: 12px;
    border-right: 1px solid var(--border);
    background: var(--bg-secondary);
  }
  .ch-nav-group + .ch-nav-group {
    margin-top: 14px;
  }
  .ch-nav-category {
    margin: 0 0 6px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .ch-nav-page {
    width: 100%;
    display: block;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 7px 8px;
    background: transparent;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
  }
  .ch-nav-page:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .ch-nav-page.active {
    border-color: rgba(244, 196, 48, 0.45);
    background: rgba(244, 196, 48, 0.12);
  }
  .ch-nav-sections {
    margin: 4px 0 2px 10px;
    padding-left: 9px;
    border-left: 1px solid rgba(244, 196, 48, 0.24);
    display: grid;
    gap: 2px;
  }
  .ch-nav-section {
    width: 100%;
    min-height: 24px;
    border: 1px solid transparent;
    border-radius: 5px;
    padding: 3px 7px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.25;
    text-align: left;
    cursor: pointer;
  }
  .ch-nav-section:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.045);
  }
  .ch-nav-section.active {
    border-color: rgba(244, 196, 48, 0.38);
    color: var(--text-primary);
    background: rgba(244, 196, 48, 0.1);
  }
  .ch-main {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 16px 18px 28px;
  }
  .ch-results-head,
  .ch-article-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .ch-results-title {
    font-size: 16px;
    font-weight: 700;
  }
  .ch-results-count,
  .ch-article-kicker {
    color: var(--text-muted);
    font-size: 12px;
  }
  .ch-results-list {
    display: grid;
    gap: 8px;
  }
  .ch-result-card {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 11px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
  }
  .ch-result-card:hover {
    border-color: rgba(244, 196, 48, 0.5);
    background: rgba(244, 196, 48, 0.08);
  }
  .ch-result-meta {
    margin-bottom: 4px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .ch-result-title {
    font-size: 15px;
    font-weight: 700;
  }
  .ch-result-excerpt {
    margin-top: 6px;
    color: var(--text-secondary);
    line-height: 1.45;
  }
  .ch-section-index {
    max-width: 1040px;
  }
  .ch-section-index-head {
    margin-bottom: 8px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .ch-section-index-list {
    display: grid;
    gap: 7px;
  }
  .ch-section-card {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
  }
  .ch-section-card:hover {
    border-color: rgba(244, 196, 48, 0.45);
    background: rgba(244, 196, 48, 0.08);
  }
  .ch-section-card-title {
    font-size: 14px;
    font-weight: 700;
  }
  .ch-section-card-excerpt {
    margin-top: 4px;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.35;
  }
  .ch-article-header h2 {
    margin: 2px 0 0;
    font-size: 20px;
    letter-spacing: 0;
  }
  .ch-source-link {
    color: var(--accent, #f4c430);
    font-size: 12px;
    text-decoration: none;
  }
  .ch-article {
    max-width: 1040px;
    line-height: 1.55;
  }
  .ch-article h1,
  .ch-article h2,
  .ch-article h3 {
    letter-spacing: 0;
  }
  .ch-article pre {
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    background: #0d1117;
  }
  .ch-article code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .ch-article table {
    border-collapse: collapse;
    width: 100%;
  }
  .ch-article th,
  .ch-article td {
    border: 1px solid var(--border);
    padding: 6px 8px;
  }
  .ch-loading,
  .ch-empty,
  .ch-error,
  .ch-update-state {
    color: var(--text-muted);
    padding: 12px;
  }
  .ch-update-state {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-secondary);
  }
  .ch-update-title {
    color: var(--text-primary);
    font-size: 16px;
    font-weight: 700;
  }
  .ch-update-summary {
    margin-top: 6px;
    color: var(--text-secondary);
  }
  .ch-update-hint {
    margin-top: 8px;
    font-size: 12px;
  }
  .ch-error {
    color: var(--danger, #f85149);
    white-space: pre-wrap;
  }
  .ch-changelog-modal {
    width: min(720px, 78vw);
    max-height: 62vh;
    overflow: auto;
  }
  .ch-run {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 8px;
    background: var(--bg-secondary);
  }
  .ch-run-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .ch-run-status {
    color: var(--text-primary);
    font-weight: 700;
  }
  .ch-run-summary {
    margin-top: 6px;
  }
  .ch-change-list {
    margin-top: 8px;
    display: grid;
    gap: 4px;
    color: var(--text-secondary);
    font-size: 12px;
  }
  .ch-change.failed {
    color: var(--danger, #f85149);
  }
  .ch-change.muted {
    color: var(--text-muted);
  }
  @media (max-width: 900px) {
    .ch-header {
      grid-template-columns: 1fr;
    }
    .ch-body {
      grid-template-columns: 1fr;
    }
    .ch-nav {
      max-height: 170px;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
  }
  `;
}
