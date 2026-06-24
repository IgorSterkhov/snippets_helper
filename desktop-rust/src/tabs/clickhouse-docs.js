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
let navCollapsedBranches = new Set();

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
  navCollapsedBranches = new Set();
  pageCache.clear();
  sectionCache.clear();
}

function buildShell() {
  const shell = el('div', { class: 'ch-docs-shell ch-reference-console' });
  const header = el('div', { class: 'ch-header' });
  const titleBlock = el('div', { class: 'ch-title-block' });
  const logo = el('div', { class: 'ch-logo-mark' });
  for (let i = 0; i < 5; i += 1) logo.appendChild(el('span'));
  const titleText = el('div', { class: 'ch-title-text' });
  titleText.appendChild(el('div', { class: 'ch-docs-title', text: 'ClickHouse' }));
  titleText.appendChild(el('div', { class: 'ch-status', text: 'Loading local docs...' }));
  titleBlock.append(logo, titleText);
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
  const updateControl = el('div', { class: 'ch-update-control idle' });
  const updateBtn = el('button', { class: 'ch-update-run', text: 'Update docs' });
  updateBtn.type = 'button';
  updateBtn.dataset.action = 'update';
  updateBtn.addEventListener('click', () => updateDocs(updateBtn));
  const updateDetailsBtn = el('button', { class: 'ch-update-details', text: 'not updated' });
  updateDetailsBtn.type = 'button';
  updateDetailsBtn.dataset.action = 'update-details';
  updateDetailsBtn.setAttribute('aria-expanded', 'false');
  updateDetailsBtn.addEventListener('click', () => toggleUpdatePopover());
  const updateMeter = el('span', { class: 'ch-update-control-meter' });
  updateMeter.appendChild(el('span', { class: 'ch-update-control-fill' }));
  updateControl.append(updateBtn, updateDetailsBtn, updateMeter);
  actions.appendChild(updateControl);

  const changelogBtn = el('button', { class: 'ch-btn ch-btn-secondary', text: 'Update log' });
  changelogBtn.type = 'button';
  changelogBtn.dataset.action = 'changelog';
  changelogBtn.title = 'Docs update history';
  changelogBtn.addEventListener('click', openChangelogModal);
  actions.appendChild(changelogBtn);
  actions.appendChild(el('div', { class: 'ch-update-popover', hidden: true }));
  header.appendChild(actions);
  shell.appendChild(header);
  shell.appendChild(el('section', { class: 'ch-update-progress', hidden: true }));

  const body = el('div', { class: 'ch-body' });
  body.appendChild(el('aside', { class: 'ch-nav' }));
  const main = el('main', { class: 'ch-main' });
  main.appendChild(el('div', { class: 'ch-loading', text: 'Loading...' }));
  body.appendChild(main);
  body.appendChild(el('aside', { class: 'ch-inspector-rail' }));
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
  renderInspectorRail();
  renderUpdateControl();
  renderUpdatePopover();
}

function renderInspectorRail() {
  const rail = root?.querySelector('.ch-inspector-rail');
  if (!rail) return;
  const last = tree.last_update_at ? formatDate(tree.last_update_at) : 'Never';
  const summary = updateProgress?.summary || updateProgress?.message || 'Local cache ready';
  const phase = updateProgress?.running ? 'Updating' : updateProgress?.error ? 'Error' : 'Ready';
  rail.innerHTML = `
    <div class="ch-inspector-title">Local index</div>
    <div class="ch-inspector-card"><b>${tree.section_count || 0}</b><span>sections</span></div>
    <div class="ch-inspector-card"><b>${tree.page_count || 0}</b><span>pages</span></div>
    <div class="ch-inspector-card"><b>${escapeHtml(phase)}</b><span>cache state</span></div>
    <div class="ch-inspector-card"><b>${escapeHtml(last)}</b><span>last update</span></div>
    <div class="ch-inspector-note">${escapeHtml(summary)}</div>
  `;
}

function renderNav() {
  const nav = root?.querySelector('.ch-nav');
  if (!nav) return;
  nav.innerHTML = '';
  const treeRoot = buildNavTree(tree.pages || []);
  const wrapper = el('div', { class: 'ch-nav-tree' });
  renderNavNode(wrapper, treeRoot, 0);
  nav.appendChild(wrapper);
}

function buildNavTree(pages) {
  const rootNode = { key: '', label: '', children: new Map(), pages: [] };
  for (const page of pages) {
    const parts = splitCategoryPath(page.category);
    let node = rootNode;
    let key = '';
    for (const part of parts) {
      key = key ? `${key}/${part}` : part;
      if (!node.children.has(part)) {
        node.children.set(part, { key, label: part, children: new Map(), pages: [] });
      }
      node = node.children.get(part);
    }
    node.pages.push(page);
  }
  return rootNode;
}

function renderNavNode(parent, node, depth) {
  for (const child of node.children.values()) {
    const expanded = !navCollapsedBranches.has(child.key);
    const branch = el('button', {
      class: `ch-nav-branch ${expanded ? 'expanded' : 'collapsed'}${branchContainsActivePage(child) ? ' has-active' : ''}`,
    });
    branch.type = 'button';
    branch.dataset.branchKey = child.key;
    branch.dataset.navDepth = String(depth);
    branch.style.setProperty('--nav-depth', String(depth));
    branch.innerHTML = `
      <span class="ch-nav-disclosure">${expanded ? '▾' : '▸'}</span>
      <span class="ch-nav-label">${escapeHtml(child.label)}</span>
      <span class="ch-nav-count">${countBranchPages(child)}</span>
    `;
    branch.addEventListener('click', () => {
      if (navCollapsedBranches.has(child.key)) navCollapsedBranches.delete(child.key);
      else navCollapsedBranches.add(child.key);
      renderNav();
    });
    parent.appendChild(branch);
    if (expanded) renderNavNode(parent, child, depth + 1);
  }

  for (const page of node.pages) {
    const isActivePage = activePage?.id === page.id;
    const pageDepth = depth;
    const btn = el('button', {
      class: 'ch-nav-page' + (isActivePage ? ' active' : ''),
      text: page.title,
    });
    btn.type = 'button';
    btn.dataset.navDepth = String(pageDepth);
    btn.style.setProperty('--nav-depth', String(pageDepth));
    btn.addEventListener('click', () => openPage(page.id));
    parent.appendChild(btn);
    if (isActivePage && activePage?.sections?.length) {
      const sections = el('div', { class: 'ch-nav-sections' });
      sections.style.setProperty('--nav-depth', String(pageDepth + 1));
      for (const section of activePage.sections) {
        const sectionBtn = el('button', {
          class: 'ch-nav-section' + (activeSectionPath === section.section_path ? ' active' : ''),
          text: section.title,
        });
        sectionBtn.type = 'button';
        sectionBtn.dataset.navDepth = String(pageDepth + 1);
        sectionBtn.style.setProperty('--nav-depth', String(pageDepth + 1));
        sectionBtn.addEventListener('click', () => openPage(page.id, section.section_path));
        sections.appendChild(sectionBtn);
      }
      parent.appendChild(sections);
    }
  }
}

function splitCategoryPath(category) {
  const parts = String(category || 'General')
    .split(/\s*\/\s*/g)
    .map(part => part.trim())
    .filter(Boolean);
  return parts.length ? parts : ['General'];
}

function countBranchPages(node) {
  let count = node.pages.length;
  for (const child of node.children.values()) count += countBranchPages(child);
  return count;
}

function branchContainsActivePage(node) {
  if (!activePage) return false;
  if (node.pages.some(page => page.id === activePage.id)) return true;
  for (const child of node.children.values()) {
    if (branchContainsActivePage(child)) return true;
  }
  return false;
}

function ensurePageAncestorsExpanded(page) {
  for (const key of categoryBranchKeys(page?.category)) {
    navCollapsedBranches.delete(key);
  }
}

function categoryBranchKeys(category) {
  const parts = splitCategoryPath(category);
  const keys = [];
  let key = '';
  for (const part of parts) {
    key = key ? `${key}/${part}` : part;
    keys.push(key);
  }
  return keys;
}

async function openPage(pageId, sectionPath = '') {
  const token = ++pageLoadToken;
  try {
    activePage = await loadPage(pageId);
    if (token !== pageLoadToken) return;
    ensurePageAncestorsExpanded(activePage);
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
  if (updateProgress?.running) return;
  button.disabled = true;
  renderUpdateControl();
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
      } else {
        button.disabled = false;
      }
      renderUpdateControl();
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
  renderInspectorRail();
  renderUpdateControl();
  renderUpdatePopover();
  if (!panel) return;
  const progress = updateProgress || {};
  const phase = progress.phase || 'idle';
  const hasResult = Boolean(progress.summary || progress.error || progress.finished_at);
  setUpdateButtonRunning(Boolean(progress.running));
  panel.hidden = true;
  panel.innerHTML = '';
  if (phase === 'idle' && !progress.running && !hasResult) return;
}

function renderUpdateControl() {
  const control = root?.querySelector('.ch-update-control');
  const runButton = root?.querySelector('[data-action="update"]');
  const detailsButton = root?.querySelector('[data-action="update-details"]');
  const fill = root?.querySelector('.ch-update-control-fill');
  if (!control || !runButton || !detailsButton) return;
  const progress = updateProgress || {};
  const phase = progress.phase || 'idle';
  const percent = clampPercent(progress.percent);
  const running = Boolean(progress.running);
  const isError = phase === 'error' || Boolean(progress.error);
  const state = running ? 'running' : isError ? 'error' : (progress.finished_at || progress.summary || tree.last_update_at) ? 'done' : 'idle';
  control.className = `ch-update-control ${state}`;
  runButton.disabled = running;
  runButton.textContent = 'Update docs';
  if (running) {
    detailsButton.textContent = `${Math.round(percent)}% · ${progress.current || 0}/${progress.total || 0}`;
  } else if (isError) {
    detailsButton.textContent = 'failed';
  } else {
    const last = progress.finished_at || tree.last_update_at;
    detailsButton.textContent = last ? `updated ${formatShortDateTime(last)}` : 'not updated';
  }
  if (fill) fill.style.width = `${running || percent > 0 ? percent : 0}%`;
  const popover = root?.querySelector('.ch-update-popover');
  detailsButton.setAttribute('aria-expanded', popover && !popover.hidden ? 'true' : 'false');
}

function setUpdateButtonRunning(running) {
  const button = root?.querySelector('[data-action="update"]');
  if (!button) return;
  button.disabled = Boolean(running);
  button.textContent = 'Update docs';
}

function toggleUpdatePopover(forceOpen = null) {
  const popover = root?.querySelector('.ch-update-popover');
  if (!popover) return;
  const shouldOpen = forceOpen === null ? popover.hidden : Boolean(forceOpen);
  popover.hidden = !shouldOpen;
  renderUpdatePopover();
  renderUpdateControl();
}

function renderUpdatePopover() {
  const popover = root?.querySelector('.ch-update-popover');
  if (!popover) return;
  const progress = updateProgress || {};
  const phase = progress.phase || 'idle';
  const running = Boolean(progress.running);
  const isError = phase === 'error' || Boolean(progress.error);
  const percent = clampPercent(progress.percent);
  const hasResult = Boolean(progress.summary || progress.error || progress.finished_at || progress.started_at);
  const title = running ? 'Updating ClickHouse docs' : isError ? 'Update failed' : hasResult ? 'Complete' : 'Docs update details';
  const elapsed = formatDuration(progress.elapsed_ms || 0);
  const summary = progress.summary || progress.error || progress.message || 'The local documentation cache is ready.';
  const countLine = running
    ? `${progress.current || 0}/${progress.total || 0} source page(s) · ${progress.remaining || 0} remaining · ${Math.round(percent)}% · ${elapsed}`
    : hasResult
      ? `Last update ${formatDate(progress.finished_at || progress.started_at)} · ${Math.round(percent)}% · ${tree.page_count || 0} page(s) · ${tree.section_count || 0} section(s) · ${elapsed}`
      : 'No update run has been recorded in this session.';
  popover.innerHTML = `
    <div class="ch-update-popover-head">
      <strong>${escapeHtml(title)}</strong>
      <span class="${isError ? 'error' : running ? 'running' : 'done'}">${escapeHtml(running ? 'Running' : isError ? 'Error' : hasResult ? 'Complete' : 'Idle')}</span>
    </div>
    <div class="ch-update-popover-meta">${escapeHtml(countLine)}</div>
    <div class="ch-update-popover-summary">${escapeHtml(summary)}</div>
    <div class="ch-update-popover-meter" aria-label="ClickHouse update progress">
      <div class="ch-update-popover-fill" style="width: ${percent}%"></div>
    </div>
  `;
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
  body.appendChild(el('div', { class: 'ch-loading', text: 'Loading update log...' }));
  showModal({
    title: 'ClickHouse Docs Update Log',
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
    body.appendChild(el('div', { class: 'ch-empty', text: 'No docs update runs yet. Run Update docs first.' }));
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

function formatShortDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

  /* Reference Console redesign overrides */
  .ch-reference-console {
    background: #07090d;
    --ch-ink: #07090d;
    --ch-panel: #0d1117;
    --ch-panel-raised: #101722;
    --ch-line: #26313e;
    --ch-yellow: #ffcc02;
    --ch-yellow-soft: rgba(255, 204, 2, 0.1);
    --ch-yellow-line: rgba(255, 204, 2, 0.48);
    --ch-text: #e8edf2;
    --ch-muted: #96a3b1;
    --ch-soft: #b9c4cf;
  }
  .ch-reference-console .ch-header {
    grid-template-columns: minmax(220px, 310px) minmax(260px, 1fr) auto;
    padding: 10px 12px;
    border-bottom-color: var(--ch-line);
    background: linear-gradient(180deg, #101722, #0d131b);
  }
  .ch-reference-console .ch-title-block {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .ch-reference-console .ch-title-text {
    min-width: 0;
  }
  .ch-reference-console .ch-logo-mark {
    width: 43px;
    height: 34px;
    display: grid;
    grid-template-columns: repeat(5, 6px);
    align-items: end;
    gap: 3px;
    padding: 5px;
    border: 1px solid var(--ch-line);
    background: var(--ch-ink);
    flex: 0 0 auto;
  }
  .ch-reference-console .ch-logo-mark span {
    display: block;
    width: 6px;
    background: var(--ch-yellow);
  }
  .ch-reference-console .ch-logo-mark span:nth-child(1),
  .ch-reference-console .ch-logo-mark span:nth-child(3),
  .ch-reference-console .ch-logo-mark span:nth-child(5) {
    height: 22px;
  }
  .ch-reference-console .ch-logo-mark span:nth-child(2) {
    height: 14px;
  }
  .ch-reference-console .ch-logo-mark span:nth-child(4) {
    height: 8px;
  }
  .ch-reference-console .ch-docs-title {
    color: var(--ch-text);
    font-size: 17px;
    font-weight: 800;
  }
  .ch-reference-console .ch-status {
    color: var(--ch-muted);
    font-size: 11px;
  }
  .ch-reference-console .ch-search-input {
    min-height: 34px;
    border-color: #394657;
    border-radius: 0;
    padding: 0 12px;
    background: #070b11;
    color: var(--ch-text);
    font-size: 13px;
  }
  .ch-reference-console .ch-search-input:focus {
    border-color: var(--ch-yellow);
    box-shadow: 0 0 0 3px rgba(255, 204, 2, 0.09);
  }
  .ch-reference-console .ch-btn {
    min-height: 32px;
    border-color: var(--ch-yellow-line);
    border-radius: 0;
    background: var(--ch-yellow-soft);
    color: #ffdf5f;
    font-size: 12px;
  }
  .ch-reference-console .ch-btn-secondary {
    border-color: #394657;
    background: var(--ch-panel-raised);
    color: var(--ch-text);
  }
  .ch-reference-console .ch-actions {
    align-items: center;
    position: relative;
  }
  .ch-reference-console .ch-update-control {
    position: relative;
    min-width: 214px;
    min-height: 32px;
    display: grid;
    grid-template-columns: minmax(92px, auto) minmax(92px, 1fr);
    align-items: stretch;
    overflow: hidden;
    border: 1px solid var(--ch-yellow-line);
    background: var(--ch-yellow-soft);
  }
  .ch-reference-console .ch-update-control.error {
    border-color: rgba(255, 107, 117, 0.55);
    background: rgba(255, 107, 117, 0.1);
  }
  .ch-reference-console .ch-update-run,
  .ch-reference-console .ch-update-details {
    min-height: 32px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: #ffdf5f;
    font-size: 12px;
    font-weight: 760;
    cursor: pointer;
  }
  .ch-reference-console .ch-update-run {
    padding: 0 10px;
    text-align: left;
  }
  .ch-reference-console .ch-update-details {
    min-width: 0;
    border-left: 1px solid rgba(255, 204, 2, 0.22);
    padding: 0 9px;
    color: #fff6c7;
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .ch-reference-console .ch-update-run:hover,
  .ch-reference-console .ch-update-details:hover {
    background: rgba(255, 204, 2, 0.08);
  }
  .ch-reference-console .ch-update-run:disabled {
    cursor: default;
    opacity: 0.65;
  }
  .ch-reference-console .ch-update-control-meter {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: rgba(255, 204, 2, 0.11);
  }
  .ch-reference-console .ch-update-control-fill {
    display: block;
    width: 0;
    height: 100%;
    background: linear-gradient(90deg, #ffcc02, #f59e0b);
    transition: width 160ms ease;
  }
  .ch-reference-console .ch-update-control.error .ch-update-control-fill {
    background: rgba(255, 107, 117, 0.9);
  }
  .ch-reference-console .ch-update-popover {
    position: absolute;
    top: 42px;
    right: 82px;
    z-index: 10;
    width: 340px;
    border: 1px solid #374557;
    background: #0b1017;
    box-shadow: 0 22px 60px rgba(0, 0, 0, 0.48);
    padding: 12px;
    color: var(--ch-text);
  }
  .ch-reference-console .ch-update-popover[hidden] {
    display: none;
  }
  .ch-reference-console .ch-update-popover::before {
    content: "";
    position: absolute;
    top: -7px;
    right: 74px;
    width: 12px;
    height: 12px;
    transform: rotate(45deg);
    border-left: 1px solid #374557;
    border-top: 1px solid #374557;
    background: #0b1017;
  }
  .ch-reference-console .ch-update-popover-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 9px;
  }
  .ch-reference-console .ch-update-popover-head strong {
    font-size: 13px;
    font-weight: 820;
  }
  .ch-reference-console .ch-update-popover-head span {
    color: #31d085;
    font-size: 11px;
    font-weight: 820;
    text-transform: uppercase;
  }
  .ch-reference-console .ch-update-popover-head span.error {
    color: #ff6b75;
  }
  .ch-reference-console .ch-update-popover-head span.running {
    color: #ffdf5f;
  }
  .ch-reference-console .ch-update-popover-meta,
  .ch-reference-console .ch-update-popover-summary {
    color: var(--ch-soft);
    font-size: 12px;
    line-height: 1.4;
  }
  .ch-reference-console .ch-update-popover-summary {
    margin-top: 7px;
    border: 1px solid rgba(255, 204, 2, 0.22);
    background: rgba(255, 204, 2, 0.055);
    padding: 8px;
  }
  .ch-reference-console .ch-update-popover-meter {
    height: 4px;
    margin-top: 8px;
    background: #1b2531;
  }
  .ch-reference-console .ch-update-popover-fill {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #ffcc02, #f59e0b);
  }
  .ch-reference-console .ch-update-progress {
    display: none !important;
  }
  .ch-reference-console .ch-update-progress-title {
    color: var(--ch-text);
    font-weight: 800;
  }
  .ch-reference-console .ch-update-progress-message,
  .ch-reference-console .ch-update-progress-summary {
    color: var(--ch-soft);
  }
  .ch-reference-console .ch-update-progress-meta {
    color: var(--ch-muted);
  }
  .ch-reference-console .ch-update-progress-meter {
    background: #1b2531;
  }
  .ch-reference-console .ch-update-progress-fill {
    background: linear-gradient(90deg, #ffcc02, #f59e0b);
  }
  .ch-reference-console .ch-body {
    grid-template-columns: 260px minmax(0, 1fr) 220px;
  }
  .ch-reference-console .ch-nav {
    padding: 10px;
    border-right-color: var(--ch-line);
    background: var(--ch-panel);
  }
  .ch-reference-console .ch-nav-tree {
    display: grid;
    gap: 2px;
  }
  .ch-reference-console .ch-nav-category {
    color: #748291;
    font-weight: 800;
  }
  .ch-reference-console .ch-nav-branch {
    width: 100%;
    min-height: 28px;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 5px;
    border: 1px solid transparent;
    border-radius: 0;
    padding: 0 7px 0 calc(7px + (var(--nav-depth, 0) * 14px));
    background: transparent;
    color: var(--ch-soft);
    text-align: left;
    cursor: pointer;
    font-size: 12px;
    font-weight: 740;
  }
  .ch-reference-console .ch-nav-branch:hover {
    background: rgba(255, 255, 255, 0.045);
    color: var(--ch-text);
  }
  .ch-reference-console .ch-nav-branch.has-active {
    color: #fff6c7;
  }
  .ch-reference-console .ch-nav-disclosure {
    color: #7d8b9b;
    font-size: 10px;
  }
  .ch-reference-console .ch-nav-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ch-reference-console .ch-nav-count {
    color: #6e7d8f;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .ch-reference-console .ch-nav-page {
    min-height: 28px;
    border-radius: 0;
    color: var(--ch-text);
    font-size: 12px;
    padding: 0 8px 0 calc(25px + (var(--nav-depth, 0) * 14px));
    line-height: 28px;
    text-align: left;
  }
  .ch-reference-console .ch-nav-page.active {
    border-color: var(--ch-yellow-line);
    background: var(--ch-yellow-soft);
    box-shadow: inset 3px 0 0 var(--ch-yellow);
    color: #fff6c7;
  }
  .ch-reference-console .ch-nav-sections {
    margin: 2px 0 2px calc(25px + (var(--nav-depth, 0) * 14px));
    padding-left: 8px;
    border-left-color: rgba(255, 204, 2, 0.26);
  }
  .ch-reference-console .ch-nav-section {
    border-radius: 0;
    color: var(--ch-soft);
    padding: 3px 7px;
    text-align: left;
  }
  .ch-reference-console .ch-nav-section.active {
    border-color: var(--ch-yellow-line);
    color: #ffdf5f;
    background: var(--ch-yellow-soft);
  }
  .ch-reference-console .ch-main {
    padding: 16px 20px 28px;
    background: #0b1017;
  }
  .ch-reference-console .ch-results-title,
  .ch-reference-console .ch-article-header h2,
  .ch-reference-console .ch-section-card-title,
  .ch-reference-console .ch-result-title,
  .ch-reference-console .ch-update-title {
    color: var(--ch-text);
    font-weight: 800;
  }
  .ch-reference-console .ch-results-count,
  .ch-reference-console .ch-article-kicker,
  .ch-reference-console .ch-section-index-head,
  .ch-reference-console .ch-result-meta,
  .ch-reference-console .ch-loading,
  .ch-reference-console .ch-empty,
  .ch-reference-console .ch-update-hint,
  .ch-reference-console .ch-run-head {
    color: var(--ch-muted);
  }
  .ch-reference-console .ch-result-card,
  .ch-reference-console .ch-section-card,
  .ch-reference-console .ch-update-state,
  .ch-reference-console .ch-run {
    border-color: #2b3644;
    border-radius: 0;
    background: var(--ch-panel-raised);
    color: var(--ch-text);
  }
  .ch-reference-console .ch-result-card:hover,
  .ch-reference-console .ch-section-card:hover {
    border-color: var(--ch-yellow-line);
    background: var(--ch-yellow-soft);
  }
  .ch-reference-console .ch-result-excerpt,
  .ch-reference-console .ch-section-card-excerpt,
  .ch-reference-console .ch-article,
  .ch-reference-console .ch-update-summary,
  .ch-reference-console .ch-change-list,
  .ch-reference-console .ch-run-summary {
    color: var(--ch-soft);
  }
  .ch-reference-console .ch-source-link {
    color: var(--ch-yellow);
  }
  .ch-reference-console .ch-article pre {
    border-color: #2c3745;
    border-radius: 0;
    background: #05080d;
  }
  .ch-reference-console .ch-article th,
  .ch-reference-console .ch-article td {
    border-color: var(--ch-line);
  }
  .ch-reference-console .ch-inspector-rail {
    min-height: 0;
    overflow: auto;
    border-left: 1px solid var(--ch-line);
    padding: 12px;
    background: var(--ch-panel);
  }
  .ch-reference-console .ch-inspector-title {
    margin-bottom: 8px;
    color: #748291;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }
  .ch-reference-console .ch-inspector-card {
    border: 1px solid #2b3644;
    background: var(--ch-panel-raised);
    padding: 9px 10px;
    margin-bottom: 8px;
  }
  .ch-reference-console .ch-inspector-card b {
    display: block;
    color: #ffdf5f;
    font-size: 17px;
    font-weight: 850;
    line-height: 1.2;
    word-break: break-word;
  }
  .ch-reference-console .ch-inspector-card span {
    display: block;
    margin-top: 2px;
    color: var(--ch-muted);
    font-size: 11px;
  }
  .ch-reference-console .ch-inspector-note {
    border: 1px solid rgba(255, 204, 2, 0.24);
    background: rgba(255, 204, 2, 0.055);
    padding: 9px 10px;
    color: var(--ch-soft);
    font-size: 12px;
    line-height: 1.35;
  }
  @media (max-width: 900px) {
    .ch-reference-console .ch-header,
    .ch-reference-console .ch-body {
      grid-template-columns: 1fr;
    }
    .ch-reference-console .ch-nav {
      border-right: 0;
      border-bottom: 1px solid var(--ch-line);
    }
    .ch-reference-console .ch-inspector-rail {
      display: none;
    }
  }
  `;
}
