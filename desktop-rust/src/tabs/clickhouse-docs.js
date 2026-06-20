import { call } from '../tauri-api.js';
import { showToast } from '../components/toast.js';
import { showModal } from '../components/modal.js';
import { marked } from '../lib/marked.min.js';

let root = null;
let tree = { pages: [], page_count: 0, section_count: 0, last_update_at: null };
let activePage = null;
let activeSectionPath = '';
let searchTimer = null;

export function init(container) {
  root = container;
  root.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);
  root.appendChild(buildShell());
  loadTree();
}

export function destroy() {
  clearTimeout(searchTimer);
  searchTimer = null;
  if (root) root.innerHTML = '';
  root = null;
  tree = { pages: [], page_count: 0, section_count: 0, last_update_at: null };
  activePage = null;
  activeSectionPath = '';
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

  const body = el('div', { class: 'ch-body' });
  body.appendChild(el('aside', { class: 'ch-nav' }));
  const main = el('main', { class: 'ch-main' });
  main.appendChild(el('div', { class: 'ch-loading', text: 'Loading...' }));
  body.appendChild(main);
  shell.appendChild(body);
  return shell;
}

async function loadTree({ openFirst = true } = {}) {
  try {
    tree = await call('list_clickhouse_doc_tree');
    renderStatus();
    renderNav();
    if (openFirst && !activePage && tree.pages?.[0]) {
      await openPage(tree.pages[0].id);
    } else if (!tree.pages?.length) {
      renderEmptyState();
    }
  } catch (err) {
    renderError(`Failed to load ClickHouse docs: ${err}`);
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
      const btn = el('button', {
        class: 'ch-nav-page' + (activePage?.id === page.id ? ' active' : ''),
        text: page.title,
      });
      btn.type = 'button';
      btn.addEventListener('click', () => openPage(page.id));
      group.appendChild(btn);
    }
    nav.appendChild(group);
  }
}

async function openPage(pageId, sectionPath = '') {
  try {
    activePage = await call('get_clickhouse_doc_page', { pageId });
    activeSectionPath = sectionPath || '';
    renderNav();
    renderArticle();
  } catch (err) {
    renderError(`Failed to open ClickHouse page: ${err}`);
  }
}

async function runSearch(query) {
  const q = (query || '').trim();
  if (!q) {
    if (activePage) renderArticle();
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
      renderSectionResult(result);
    });
    list.appendChild(card);
  }
  main.appendChild(list);
}

function renderSectionResult(result) {
  const section = activePage?.sections?.find(s => s.section_path === result.section_path);
  if (!section) {
    renderArticle();
    return;
  }
  const main = root?.querySelector('.ch-main');
  if (!main) return;
  main.innerHTML = '';
  main.appendChild(articleHeader(activePage, section.title));
  const article = el('article', { class: 'ch-article' });
  article.innerHTML = renderMarkdown(`## ${section.title}\n\n${section.body || ''}`);
  main.appendChild(article);
}

function renderArticle() {
  const main = root?.querySelector('.ch-main');
  if (!main || !activePage) return;
  main.innerHTML = '';
  main.appendChild(articleHeader(activePage));
  const article = el('article', { class: 'ch-article' });
  if (activeSectionPath) {
    const section = activePage.sections?.find(s => s.section_path === activeSectionPath);
    article.innerHTML = section
      ? renderMarkdown(`## ${section.title}\n\n${section.body || ''}`)
      : renderMarkdown(activePage.markdown || '');
  } else {
    article.innerHTML = renderMarkdown(activePage.markdown || '');
  }
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
    showToast(run.summary || 'ClickHouse docs updated');
    activePage = null;
    await loadTree({ openFirst: false });
    renderUpdateState(run);
  } catch (err) {
    renderError(`ClickHouse docs update failed: ${err}`);
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
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
