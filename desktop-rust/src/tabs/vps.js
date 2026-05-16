import { call } from '../tauri-api.js';
import { showToast } from '../components/toast.js';

let root = null;
let environments = [];     // VpsEnvironment[]
let allServers = [];       // VpsServer[]
let expandedServer = null; // { envName, serverIndex, stats, loading, error }
let refreshTimers = {};    // envName -> { countdown, timer }
let tabVisible = true;
let contextMenu = null;    // current context menu element
let analysisModal = null; // { overlay, serverIndex, server, activeTab, loading, error, data, collapsed, drillRoot, selectedPath }
let analysisModalSeq = 0;
const ANALYSIS_WIDTH_SETTING = 'vps.analysis_modal_width';

// Stats cache per server gIdx — populated on successful fetch so the
// mini-bars on every tile stay visible between renders (re-renders
// happen on expand/collapse, environment reload, DnD, etc.).
const statsCache = new Map(); // gIdx → { stats, ts, error: string? }
// Per-tile UI flag: true while the 🔄 button is mid-fetch.
const fetchInFlight = new Set();

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  loadData().then(() => {
    root.appendChild(buildLayout());
    installTileDnd(root);
  });

  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('click', closeContextMenu);
  document.addEventListener('keydown', onGlobalKeydown);
}

export function destroy() {
  stopAllRefreshTimers();
  closeDetailedAnalysisModal();
  closeContextMenu();
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.removeEventListener('click', closeContextMenu);
  document.removeEventListener('keydown', onGlobalKeydown);
  if (root) root.innerHTML = '';
  environments = [];
  allServers = [];
  expandedServer = null;
}

function onVisibilityChange() {
  const wasVisible = tabVisible;
  tabVisible = document.visibilityState === 'visible';
  if (tabVisible && !wasVisible) {
    // Restart auto-refresh for all environments
    for (const env of environments) {
      const envServers = serversForEnv(env.name);
      if (envServers.some(s => s.auto_refresh)) {
        scheduleEnvRefresh(env.name);
      }
    }
  } else if (!tabVisible) {
    stopAllRefreshTimers();
  }
}

function onGlobalKeydown(e) {
  if (e.key === 'Escape') closeContextMenu();
}

async function loadData() {
  try {
    const [envs, servers] = await Promise.all([
      call('list_vps_environments'),
      call('list_vps_servers'),
    ]);
    environments = envs;
    allServers = servers;
  } catch (e) {
    environments = [];
    allServers = [];
  }
}

function serversForEnv(envName) {
  return allServers.filter(s => s.environment === envName);
}

function globalIndex(envName, localIdx) {
  let count = 0;
  for (let i = 0; i < allServers.length; i++) {
    if (allServers[i].environment === envName) {
      if (count === localIdx) return i;
      count++;
    }
  }
  return -1;
}

// ── Layout ─────────────────────────────────────────────────

function buildLayout() {
  const wrap = el('div', { class: 'vps-wrap' });

  // Toolbar
  const toolbar = el('div', { class: 'vps-toolbar' });

  const addServerBtn = el('button', { text: '+ Server', class: 'btn-secondary vps-toolbar-btn' });
  addServerBtn.addEventListener('click', () => showServerModal());
  toolbar.appendChild(addServerBtn);

  const addEnvBtn = el('button', { text: '+ Environment', class: 'btn-secondary vps-toolbar-btn' });
  addEnvBtn.addEventListener('click', () => promptAddEnvironment());
  toolbar.appendChild(addEnvBtn);

  const refreshAllBtn = el('button', { text: 'Refresh All', class: 'btn-secondary vps-toolbar-btn' });
  refreshAllBtn.addEventListener('click', () => refreshAllEnvironments());
  toolbar.appendChild(refreshAllBtn);

  wrap.appendChild(toolbar);

  // Environments container
  const envsContainer = el('div', { class: 'vps-envs', id: 'vps-envs' });
  wrap.appendChild(envsContainer);

  renderEnvironments(envsContainer);

  return wrap;
}

function renderEnvironments(container) {
  const envsEl = container || root.querySelector('#vps-envs');
  if (!envsEl) return;
  envsEl.innerHTML = '';

  for (const env of environments) {
    const envServers = serversForEnv(env.name);
    const envBlock = buildEnvBlock(env, envServers);
    envsEl.appendChild(envBlock);
  }

  // If no environments at all
  if (environments.length === 0) {
    envsEl.appendChild(el('div', {
      text: 'No environments. Click "+ Environment" to create one.',
      class: 'vps-placeholder',
    }));
  }
}

function buildEnvBlock(env, envServers) {
  const block = el('div', { class: 'vps-env-block' });

  // Header
  const header = el('div', { class: 'vps-env-header' });
  const titleWrap = el('div', { class: 'vps-env-title-wrap' });
  const title = el('span', { text: env.name, class: 'vps-env-title' });
  titleWrap.appendChild(title);

  const count = el('span', { text: `${envServers.length}`, class: 'vps-env-count' });
  titleWrap.appendChild(count);

  header.appendChild(titleWrap);

  // Env actions
  const envActions = el('div', { class: 'vps-env-actions' });

  // Countdown display
  const countdown = el('span', { class: 'vps-env-countdown', id: `vps-countdown-${env.name}` });
  envActions.appendChild(countdown);

  const refreshBtn = el('button', { text: '\u21BB', class: 'vps-env-action-btn', title: 'Refresh all in this environment' });
  refreshBtn.addEventListener('click', () => refreshEnvironment(env.name));
  envActions.appendChild(refreshBtn);

  const renameBtn = el('button', { text: '\u270E', class: 'vps-env-action-btn', title: 'Rename environment' });
  renameBtn.addEventListener('click', () => promptRenameEnvironment(env.name));
  envActions.appendChild(renameBtn);

  if (env.name !== 'Default') {
    const deleteBtn = el('button', { text: '\u2715', class: 'vps-env-action-btn vps-env-action-danger', title: 'Delete environment' });
    deleteBtn.addEventListener('click', () => promptDeleteEnvironment(env.name));
    envActions.appendChild(deleteBtn);
  }

  header.appendChild(envActions);
  block.appendChild(header);

  // Server tiles grid
  const grid = el('div', { class: 'vps-tiles-grid', id: `vps-grid-${env.name}` });

  envServers.forEach((srv, localIdx) => {
    const gIdx = globalIndex(env.name, localIdx);
    const tile = buildServerTile(srv, gIdx, env.name, localIdx);
    grid.appendChild(tile);
  });

  if (envServers.length === 0) {
    const emptyMsg = el('div', { text: 'No servers in this environment', class: 'vps-tiles-empty' });
    grid.appendChild(emptyMsg);
  }

  block.appendChild(grid);

  // Expanded detail panel (if a server in this env is expanded)
  if (expandedServer && expandedServer.envName === env.name) {
    const detailPanel = buildDetailPanel();
    block.appendChild(detailPanel);
  }

  return block;
}

function buildServerTile(srv, gIdx, envName, animIdx) {
  const isExpanded = expandedServer && expandedServer.serverIndex === gIdx;
  const tile = el('div', { class: 'vps-tile' + (isExpanded ? ' expanded' : '') });
  tile.dataset.gIdx = String(gIdx);
  tile.dataset.envName = envName;
  tile.style.animationDelay = `${animIdx * 40}ms`;

  // Color accent
  const accent = el('div', { class: 'vps-tile-accent' });
  accent.style.background = srv.color;
  tile.appendChild(accent);

  // Drag grip (left side) — pointer-based DnD to move between
  // environments. Guarded against accidental click-to-expand by the
  // DnD handler calling stopPropagation on its own events.
  const grip = el('div', { class: 'vps-tile-grip', title: 'Drag to move between environments' });
  grip.textContent = '⋮⋮';
  grip.dataset.dragGrip = '1';
  tile.appendChild(grip);

  // Content
  const content = el('div', { class: 'vps-tile-content' });

  const nameRow = el('div', { class: 'vps-tile-name-row' });
  const name = el('span', { text: srv.name, class: 'vps-tile-name' });
  nameRow.appendChild(name);
  const statusDot = el('span', { class: 'vps-tile-status', id: `vps-status-${gIdx}` });
  nameRow.appendChild(statusDot);
  content.appendChild(nameRow);

  const hostLine = el('div', {
    text: `${srv.user}@${srv.host}:${srv.port}`,
    class: 'vps-tile-host',
  });
  content.appendChild(hostLine);

  // Inline stat rows (CPU/RAM/Disk) — always rendered; shows a
  // placeholder until the first 🔄 fetch populates statsCache.
  const statBlock = el('div', { class: 'vps-tile-statblock', id: `vps-statblock-${gIdx}` });
  renderStatBlock(statBlock, gIdx);
  content.appendChild(statBlock);

  tile.appendChild(content);

  // Right-side controls — refresh + context-menu
  const controls = el('div', { class: 'vps-tile-controls' });

  const refreshBtn = el('button', {
    class: 'vps-tile-ctrl-btn',
    title: 'Refresh stats (connect via SSH)',
  });
  refreshBtn.textContent = '↻';
  refreshBtn.dataset.refresh = '1';
  refreshBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fetchStatsForTile(gIdx, envName);
  });
  controls.appendChild(refreshBtn);

  const menuBtn = el('button', {
    class: 'vps-tile-ctrl-btn',
    title: 'More actions',
  });
  menuBtn.textContent = '⋮';
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = menuBtn.getBoundingClientRect();
    showTileContextMenu({ clientX: rect.right, clientY: rect.bottom }, srv, gIdx, envName);
  });
  controls.appendChild(menuBtn);

  tile.appendChild(controls);

  // Click on the tile body toggles expand — does NOT auto-fetch.
  tile.addEventListener('click', (e) => {
    if (e.target.closest('.vps-tile-ctrl-btn')) return;
    if (e.target.closest('[data-drag-grip]')) return;
    toggleExpand(gIdx, envName);
  });

  // Right-click → context menu (Edit / Test / Move / Delete)
  tile.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showTileContextMenu(e, srv, gIdx, envName);
  });

  return tile;
}

/** Fill the per-tile stat block from the stats cache. */
function renderStatBlock(statBlock, gIdx) {
  statBlock.innerHTML = '';
  const entry = statsCache.get(gIdx);
  if (fetchInFlight.has(gIdx)) {
    statBlock.appendChild(el('div', { class: 'vps-tile-stat-placeholder', text: 'Refreshing…' }));
    return;
  }
  if (!entry) {
    statBlock.appendChild(el('div', {
      class: 'vps-tile-stat-placeholder',
      text: 'Stats not loaded — press ↻',
    }));
    return;
  }
  if (entry.error) {
    statBlock.appendChild(el('div', {
      class: 'vps-tile-stat-placeholder vps-tile-stat-error',
      text: 'Error: ' + entry.error,
    }));
    return;
  }
  const s = entry.stats;
  statBlock.appendChild(buildInlineBar('CPU', s.cpu_usage_pct, `${s.cpu_usage_pct.toFixed(0)}%`));
  statBlock.appendChild(buildInlineBar('RAM', s.ram_pct, `${s.ram_pct.toFixed(0)}% · ${s.ram_used}/${s.ram_total}`));
  statBlock.appendChild(buildInlineBar('Disk', s.disk_pct, `${s.disk_pct.toFixed(0)}% · ${s.disk_used}/${s.disk_total}`));

  if (entry.ts) {
    const ago = relativeTime(entry.ts);
    statBlock.appendChild(el('div', { class: 'vps-tile-stat-ts', text: ago }));
  }
}

function buildInlineBar(label, pct, valueText) {
  const row = el('div', { class: 'vps-tile-stat-row' });
  row.appendChild(el('span', { class: 'vps-tile-stat-label', text: label }));
  const bar = el('div', { class: 'vps-tile-stat-bar' });
  const fill = el('div', { class: 'vps-tile-stat-bar-fill' });
  fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  fill.style.background = getBarColor(pct);
  bar.appendChild(fill);
  row.appendChild(bar);
  row.appendChild(el('span', { class: 'vps-tile-stat-value', text: valueText }));
  return row;
}

function relativeTime(ts) {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 5000) return 'just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

/** Explicit 🔄 per tile — fetches stats, updates cache, re-renders that
 *  tile's stat block in-place (plus the detail panel if the server is
 *  currently expanded). Click on tile body does NOT trigger this. */
async function fetchStatsForTile(gIdx, envName) {
  const srv = allServers[gIdx];
  if (!srv) return;
  if (fetchInFlight.has(gIdx)) return;
  fetchInFlight.add(gIdx);

  const block = root && root.querySelector(`#vps-statblock-${gIdx}`);
  if (block) renderStatBlock(block, gIdx);

  try {
    const stats = await call('vps_get_stats', {
      host: srv.host, user: srv.user, port: srv.port, keyFile: srv.key_file,
    });
    statsCache.set(gIdx, { stats, ts: Date.now(), error: null });
    updateStatusDot(gIdx, 'online');
    // Sync expanded panel if this is the open one.
    if (expandedServer && expandedServer.serverIndex === gIdx) {
      expandedServer.stats = stats;
      expandedServer.loading = false;
      expandedServer.error = null;
    }
  } catch (e) {
    statsCache.set(gIdx, { stats: null, ts: Date.now(), error: String(e) });
    updateStatusDot(gIdx, 'error');
    if (expandedServer && expandedServer.serverIndex === gIdx) {
      expandedServer.error = String(e);
      expandedServer.loading = false;
    }
  } finally {
    fetchInFlight.delete(gIdx);
    const block2 = root && root.querySelector(`#vps-statblock-${gIdx}`);
    if (block2) renderStatBlock(block2, gIdx);
    // If expanded detail is open for this tile, rebuild it so the cards
    // pick up the fresh stats (or the error).
    if (expandedServer && expandedServer.serverIndex === gIdx) {
      renderEnvironments();
    }
  }
}

function buildDetailPanel() {
  const panel = el('div', { class: 'vps-detail-panel' });

  if (!expandedServer) return panel;

  const srv = allServers[expandedServer.serverIndex];
  if (!srv) return panel;

  if (expandedServer.loading) {
    const loader = el('div', { class: 'vps-detail-loading' });
    const spinner = el('span', { class: 'vps-spinner' });
    loader.appendChild(spinner);
    loader.appendChild(document.createTextNode(' Connecting...'));
    panel.appendChild(loader);
    return panel;
  }

  if (expandedServer.error) {
    const errWrap = el('div', { class: 'vps-detail-error' });
    errWrap.appendChild(el('div', { text: 'Connection failed', class: 'vps-error-title' }));
    errWrap.appendChild(el('div', { text: expandedServer.error, class: 'vps-error-msg' }));
    const retryBtn = el('button', { text: 'Retry', class: 'btn-secondary vps-retry-btn' });
    retryBtn.addEventListener('click', () => fetchStatsForExpanded());
    errWrap.appendChild(retryBtn);
    panel.appendChild(errWrap);
    return panel;
  }

  const stats = expandedServer.stats;
  if (!stats) return panel;

  // Info badges
  const infoLine = el('div', { class: 'vps-info-line' });
  if (stats.hostname) {
    const hostBadge = el('span', { class: 'vps-info-badge' });
    hostBadge.innerHTML = '<span class="vps-info-label">Host</span> ' + escapeHtml(stats.hostname);
    infoLine.appendChild(hostBadge);
  }
  if (stats.uptime) {
    const uptimeBadge = el('span', { class: 'vps-info-badge' });
    uptimeBadge.innerHTML = '<span class="vps-info-label">Uptime</span> ' + escapeHtml(formatUptime(stats.uptime));
    infoLine.appendChild(uptimeBadge);
  }
  panel.appendChild(infoLine);

  // Stats cards
  const cardsRow = el('div', { class: 'vps-cards-row' });
  cardsRow.appendChild(buildStatCard('CPU', stats.cpu_usage_pct, `${stats.cpu_usage_pct.toFixed(1)}%`, null));
  cardsRow.appendChild(buildStatCard('RAM', stats.ram_pct, `${stats.ram_pct.toFixed(1)}%`, `${stats.ram_used} / ${stats.ram_total}`));
  cardsRow.appendChild(buildStatCard('Disk', stats.disk_pct, `${stats.disk_pct.toFixed(1)}%`, `${stats.disk_used} / ${stats.disk_total}`));
  panel.appendChild(cardsRow);

  // Actions
  const actionsBar = el('div', { class: 'vps-detail-actions' });
  const refreshBtn = el('button', { text: 'Refresh', class: 'btn-secondary vps-action-btn' });
  refreshBtn.addEventListener('click', () => fetchStatsForExpanded());
  actionsBar.appendChild(refreshBtn);
  const analysisBtn = el('button', { text: 'Detailed analysis', class: 'btn-secondary vps-action-btn' });
  analysisBtn.addEventListener('click', () => showDetailedAnalysisModal(expandedServer.serverIndex));
  actionsBar.appendChild(analysisBtn);
  panel.appendChild(actionsBar);

  return panel;
}

function buildStatCard(label, pct, valueText, subText) {
  const card = el('div', { class: 'vps-stat-card' });

  const headerRow = el('div', { class: 'vps-stat-header' });
  headerRow.appendChild(el('span', { text: label, class: 'vps-stat-label' }));
  headerRow.appendChild(el('span', { text: valueText, class: 'vps-stat-value' }));
  card.appendChild(headerRow);

  // Progress bar
  const barBg = el('div', { class: 'vps-bar-bg' });
  const barFill = el('div', { class: 'vps-bar-fill' });
  const clampedPct = Math.min(100, Math.max(0, pct));
  barFill.style.width = clampedPct + '%';
  barFill.style.background = getBarColor(clampedPct);
  if (clampedPct > 0) {
    barFill.style.boxShadow = `0 0 8px ${getBarColor(clampedPct)}44`;
  }
  barBg.appendChild(barFill);
  card.appendChild(barBg);

  if (subText) {
    card.appendChild(el('div', { text: subText, class: 'vps-stat-sub' }));
  }

  card.style.setProperty('--card-accent', getBarColor(clampedPct));
  return card;
}

function getBarColor(pct) {
  if (pct > 80) return '#f85149';
  if (pct > 50) return '#f0883e';
  return '#3fb950';
}

// ── Expand / Collapse ──────────────────────────────────────

function toggleExpand(gIdx, envName) {
  if (expandedServer && expandedServer.serverIndex === gIdx) {
    expandedServer = null;
    renderEnvironments();
    return;
  }
  // Open detail panel using whatever's already in the cache — no
  // automatic SSH fetch. User clicks the ↻ button (on tile or inside
  // the panel) to refresh. Avoids the "click = connect" surprise and
  // the cmd-window flicker on Windows.
  const cached = statsCache.get(gIdx);
  expandedServer = {
    envName,
    serverIndex: gIdx,
    stats: cached && !cached.error ? cached.stats : null,
    loading: false,
    error: cached && cached.error ? cached.error : null,
  };
  renderEnvironments();
}

async function fetchStatsForExpanded() {
  if (!expandedServer) return;
  const gIdx = expandedServer.serverIndex;
  const envName = expandedServer.envName;
  // Route through fetchStatsForTile so statsCache + the tile's inline
  // bars stay in sync with the detail-panel state.
  await fetchStatsForTile(gIdx, envName);
}

function updateStatusDot(gIdx, status) {
  const dot = root ? root.querySelector(`#vps-status-${gIdx}`) : null;
  if (dot) {
    dot.className = 'vps-tile-status ' + (status === 'online' ? 'online' : status === 'error' ? 'error' : '');
  }
}

// ── Context Menu ───────────────────────────────────────────

function showTileContextMenu(e, srv, gIdx, envName) {
  closeContextMenu();

  const menu = el('div', { class: 'vps-ctx-menu' });

  // Edit
  const editItem = el('div', { text: 'Edit', class: 'vps-ctx-item' });
  editItem.addEventListener('click', () => {
    closeContextMenu();
    showServerModal(gIdx);
  });
  menu.appendChild(editItem);

  // Test connection
  const testItem = el('div', { text: 'Test Connection', class: 'vps-ctx-item' });
  testItem.addEventListener('click', async () => {
    closeContextMenu();
    try {
      const hostname = await call('vps_test_connection', {
        host: srv.host,
        user: srv.user,
        port: srv.port,
        keyFile: srv.key_file,
      });
      showToast('Connected: ' + hostname, 'success');
      updateStatusDot(gIdx, 'online');
    } catch (err) {
      showToast('Connection failed: ' + err, 'error');
      updateStatusDot(gIdx, 'error');
    }
  });
  menu.appendChild(testItem);

  // Detailed analysis
  const analysisItem = el('div', { text: 'Detailed analysis', class: 'vps-ctx-item' });
  analysisItem.addEventListener('click', () => {
    closeContextMenu();
    showDetailedAnalysisModal(gIdx);
  });
  menu.appendChild(analysisItem);

  // Move to... (nested flyout)
  if (environments.length > 1) {
    const moveItem = el('div', { class: 'vps-ctx-item vps-ctx-has-sub' });
    moveItem.textContent = 'Move to';
    const arrow = el('span', { text: '\u25B6', class: 'vps-ctx-arrow' });
    moveItem.appendChild(arrow);

    const subMenu = el('div', { class: 'vps-ctx-sub' });
    for (const env of environments) {
      if (env.name === envName) continue;
      const subItem = el('div', { text: env.name, class: 'vps-ctx-item' });
      subItem.addEventListener('click', async () => {
        closeContextMenu();
        await moveServer(gIdx, env.name);
      });
      subMenu.appendChild(subItem);
    }
    moveItem.appendChild(subMenu);
    menu.appendChild(moveItem);
  }

  // Separator
  menu.appendChild(el('div', { class: 'vps-ctx-sep' }));

  // Delete
  const deleteItem = el('div', { text: 'Delete', class: 'vps-ctx-item vps-ctx-danger' });
  deleteItem.addEventListener('click', () => {
    closeContextMenu();
    if (confirm(`Remove server "${srv.name}"?`)) {
      removeServer(gIdx);
    }
  });
  menu.appendChild(deleteItem);

  // Position
  document.body.appendChild(menu);
  contextMenu = menu;

  const menuRect = menu.getBoundingClientRect();
  let x = e.clientX;
  let y = e.clientY;
  if (x + menuRect.width > window.innerWidth) x = window.innerWidth - menuRect.width - 4;
  if (y + menuRect.height > window.innerHeight) y = window.innerHeight - menuRect.height - 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function closeContextMenu() {
  if (contextMenu) {
    contextMenu.remove();
    contextMenu = null;
  }
}

// ── Auto-Refresh per Environment ───────────────────────────

function scheduleEnvRefresh(envName) {
  stopEnvRefreshTimer(envName);
  const envServers = serversForEnv(envName);
  const autoServers = envServers.filter(s => s.auto_refresh);
  if (autoServers.length === 0 || !tabVisible) return;

  // Use the minimum refresh interval among auto-refresh servers
  const interval = Math.max(5, Math.min(...autoServers.map(s => s.refresh_interval)));
  let countdown = interval;

  const countdownEl = root ? root.querySelector(`#vps-countdown-${envName}`) : null;
  if (countdownEl) countdownEl.textContent = `${countdown}s`;

  const timer = setInterval(() => {
    countdown--;
    const cdEl = root ? root.querySelector(`#vps-countdown-${envName}`) : null;
    if (cdEl) cdEl.textContent = countdown > 0 ? `${countdown}s` : '';
    if (countdown <= 0) {
      stopEnvRefreshTimer(envName);
      refreshEnvironment(envName);
    }
  }, 1000);

  refreshTimers[envName] = { timer, countdown };
}

function stopEnvRefreshTimer(envName) {
  if (refreshTimers[envName]) {
    clearInterval(refreshTimers[envName].timer);
    delete refreshTimers[envName];
  }
  const cdEl = root ? root.querySelector(`#vps-countdown-${envName}`) : null;
  if (cdEl) cdEl.textContent = '';
}

function stopAllRefreshTimers() {
  for (const envName of Object.keys(refreshTimers)) {
    stopEnvRefreshTimer(envName);
  }
}

async function refreshEnvironment(envName) {
  stopEnvRefreshTimer(envName);
  const envServers = serversForEnv(envName);
  if (envServers.length === 0) return;

  // Fetch all servers in parallel — one SSH connection per server.
  const promises = envServers.map(async (srv, localIdx) => {
    const gIdx = globalIndex(envName, localIdx);
    if (fetchInFlight.has(gIdx)) return { gIdx, skipped: true };
    fetchInFlight.add(gIdx);
    const block = root && root.querySelector(`#vps-statblock-${gIdx}`);
    if (block) renderStatBlock(block, gIdx);
    try {
      const stats = await call('vps_get_stats', {
        host: srv.host,
        user: srv.user,
        port: srv.port,
        keyFile: srv.key_file,
      });
      statsCache.set(gIdx, { stats, ts: Date.now(), error: null });
      updateStatusDot(gIdx, 'online');
      if (expandedServer && expandedServer.serverIndex === gIdx) {
        expandedServer.stats = stats;
        expandedServer.loading = false;
        expandedServer.error = null;
      }
      return { gIdx, stats, ok: true };
    } catch (e) {
      statsCache.set(gIdx, { stats: null, ts: Date.now(), error: String(e) });
      updateStatusDot(gIdx, 'error');
      if (expandedServer && expandedServer.serverIndex === gIdx) {
        expandedServer.loading = false;
        expandedServer.error = String(e);
      }
      return { gIdx, error: e, ok: false };
    } finally {
      fetchInFlight.delete(gIdx);
      const block2 = root && root.querySelector(`#vps-statblock-${gIdx}`);
      if (block2) renderStatBlock(block2, gIdx);
    }
  });

  await Promise.allSettled(promises);

  // Re-render expanded panel if needed
  if (expandedServer && expandedServer.envName === envName) {
    renderEnvironments();
  }

  // Schedule next refresh
  if (tabVisible) {
    scheduleEnvRefresh(envName);
  }
}

function refreshAllEnvironments() {
  for (const env of environments) {
    refreshEnvironment(env.name);
  }
}

function updateMiniStats(gIdx, stats) {
  const miniEl = root ? root.querySelector(`#vps-mini-${gIdx}`) : null;
  if (!miniEl) return;
  miniEl.innerHTML = '';

  const cpu = el('span', { class: 'vps-mini-stat' });
  cpu.innerHTML = `<span class="vps-mini-label">CPU</span> <span style="color:${getBarColor(stats.cpu_usage_pct)}">${stats.cpu_usage_pct.toFixed(0)}%</span>`;
  miniEl.appendChild(cpu);

  const ram = el('span', { class: 'vps-mini-stat' });
  ram.innerHTML = `<span class="vps-mini-label">RAM</span> <span style="color:${getBarColor(stats.ram_pct)}">${stats.ram_pct.toFixed(0)}%</span>`;
  miniEl.appendChild(ram);

  const disk = el('span', { class: 'vps-mini-stat' });
  disk.innerHTML = `<span class="vps-mini-label">Disk</span> <span style="color:${getBarColor(stats.disk_pct)}">${stats.disk_pct.toFixed(0)}%</span>`;
  miniEl.appendChild(disk);
}

// ── Server CRUD ────────────────────────────────────────────

async function removeServer(gIdx) {
  try {
    await call('remove_vps_server', { index: gIdx });
    if (expandedServer && expandedServer.serverIndex === gIdx) {
      expandedServer = null;
    }
    await loadData();
    renderEnvironments();
    showToast('Server removed', 'success');
  } catch (e) {
    showToast('Error: ' + e, 'error');
  }
}

async function moveServer(gIdx, targetEnv) {
  try {
    await call('move_vps_server', { index: gIdx, targetEnv });
    if (expandedServer && expandedServer.serverIndex === gIdx) {
      expandedServer = null;
    }
    await loadData();
    renderEnvironments();
    showToast('Server moved', 'success');
  } catch (e) {
    showToast('Error: ' + e, 'error');
  }
}

async function showDetailedAnalysisModal(gIdx) {
  const srv = allServers[gIdx];
  if (!srv) return;
  closeDetailedAnalysisModal();

  const seq = ++analysisModalSeq;
  const overlay = el('div', { class: 'modal-overlay vps-analysis-overlay' });
  const modal = el('div', { class: 'modal vps-analysis-modal' });

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDetailedAnalysisModal();
    }
  }

  function onPointerUp() {
    persistAnalysisModalWidth(modal);
  }

  function onOverlayClick(e) {
    if (e.target === overlay) closeDetailedAnalysisModal();
  }

  analysisModal = {
    seq,
    overlay,
    modal,
    serverIndex: gIdx,
    server: srv,
    activeTab: 'disk',
    loading: true,
    error: null,
    data: null,
    collapsed: new Set(),
    drillRoot: '/',
    selectedPath: '/',
    onKey,
    onPointerUp,
    onOverlayClick,
  };

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey, true);
  modal.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('click', onOverlayClick);
  renderDetailedAnalysisModal();

  const savedWidth = await loadAnalysisModalWidth();
  if (!analysisModal || analysisModal.seq !== seq) return;
  if (savedWidth) modal.style.width = savedWidth;

  await fetchDetailedAnalysis();
}

function closeDetailedAnalysisModal() {
  if (analysisModal && analysisModal.onKey) {
    document.removeEventListener('keydown', analysisModal.onKey, true);
  }
  if (analysisModal && analysisModal.modal && analysisModal.onPointerUp) {
    analysisModal.modal.removeEventListener('pointerup', analysisModal.onPointerUp);
  }
  if (analysisModal && analysisModal.overlay && analysisModal.onOverlayClick) {
    analysisModal.overlay.removeEventListener('click', analysisModal.onOverlayClick);
  }
  if (analysisModal && analysisModal.overlay) {
    analysisModal.overlay.remove();
  }
  analysisModal = null;
}

async function loadAnalysisModalWidth() {
  try {
    const v = await call('get_setting', { key: ANALYSIS_WIDTH_SETTING });
    if (!v) return null;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return null;
    return Math.max(520, Math.min(window.innerWidth * 0.9, n)) + 'px';
  } catch {
    return null;
  }
}

async function persistAnalysisModalWidth(modal) {
  const width = Math.round(modal.getBoundingClientRect().width);
  if (!Number.isFinite(width)) return;
  try {
    await call('set_setting', { key: ANALYSIS_WIDTH_SETTING, value: String(width) });
  } catch {
    // Width persistence is non-critical.
  }
}

async function fetchDetailedAnalysis() {
  if (!analysisModal) return;
  const currentModal = analysisModal;
  const srv = analysisModal.server;
  analysisModal.loading = true;
  analysisModal.error = null;
  renderDetailedAnalysisModal();
  try {
    const data = await call('vps_get_detailed_analysis', {
      host: srv.host,
      user: srv.user,
      port: srv.port,
      keyFile: srv.key_file,
    });
    if (analysisModal !== currentModal) return;
    analysisModal.data = data;
    analysisModal.loading = false;
    analysisModal.error = null;
    analysisModal.selectedPath = '/';
    analysisModal.drillRoot = '/';
    analysisModal.collapsed = new Set();
  } catch (e) {
    if (analysisModal !== currentModal) return;
    analysisModal.loading = false;
    analysisModal.error = String(e);
  }
  renderDetailedAnalysisModal();
}

function renderDetailedAnalysisModal() {
  if (!analysisModal) return;
  const modal = analysisModal.overlay.querySelector('.vps-analysis-modal');
  if (!modal) return;
  modal.innerHTML = '';

  const header = el('div', { class: 'vps-analysis-header' });
  const titleWrap = el('div');
  titleWrap.appendChild(el('div', { class: 'vps-analysis-title', text: `${analysisModal.server.name} · Detailed analysis` }));
  titleWrap.appendChild(el('div', { class: 'vps-analysis-subtitle', text: `${analysisModal.server.user}@${analysisModal.server.host}:${analysisModal.server.port}` }));
  header.appendChild(titleWrap);

  const headActions = el('div', { class: 'vps-analysis-head-actions' });
  const refreshBtn = el('button', { text: '\u21BB', class: 'btn-secondary vps-analysis-icon-btn', title: 'Refresh analysis' });
  refreshBtn.addEventListener('click', fetchDetailedAnalysis);
  headActions.appendChild(refreshBtn);
  const closeBtn = el('button', { text: '\u2715', class: 'btn-secondary vps-analysis-icon-btn', title: 'Close' });
  closeBtn.addEventListener('click', closeDetailedAnalysisModal);
  headActions.appendChild(closeBtn);
  header.appendChild(headActions);
  modal.appendChild(header);

  const tabs = el('div', { class: 'vps-analysis-tabs' });
  for (const [key, label] of [['disk', 'Disk'], ['processes', 'Processes'], ['raw', 'Raw']]) {
    const tab = el('button', { text: label, class: 'vps-analysis-tab' + (analysisModal.activeTab === key ? ' active' : '') });
    tab.addEventListener('click', () => {
      analysisModal.activeTab = key;
      renderDetailedAnalysisModal();
    });
    tabs.appendChild(tab);
  }
  modal.appendChild(tabs);

  const body = el('div', { class: 'vps-analysis-body' });
  if (analysisModal.loading) {
    body.appendChild(el('div', { class: 'vps-detail-loading', text: 'Connecting and analyzing...' }));
  } else if (analysisModal.error) {
    const err = el('div', { class: 'vps-detail-error' });
    err.appendChild(el('div', { class: 'vps-error-title', text: 'Analysis failed' }));
    err.appendChild(el('div', { class: 'vps-error-msg', text: analysisModal.error }));
    const retry = el('button', { text: 'Retry', class: 'btn-secondary vps-retry-btn' });
    retry.addEventListener('click', fetchDetailedAnalysis);
    err.appendChild(retry);
    body.appendChild(err);
  } else if (analysisModal.data) {
    body.appendChild(el('div', { text: 'Detailed analysis loaded', class: 'vps-analysis-placeholder' }));
  }
  modal.appendChild(body);
}

function showServerModal(editIndex) {
  const isEdit = editIndex !== undefined;
  const existing = isEdit ? allServers[editIndex] : null;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay vps-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal vps-modal';

  // Header
  const header = el('div', { class: 'vps-modal-header' });
  header.appendChild(el('h3', { text: isEdit ? 'Edit Server' : 'Add Server' }));
  const closeBtn = el('button', { text: '\u2715', class: 'btn-secondary vps-modal-close' });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = el('div', { class: 'vps-modal-body' });

  // Name
  const nameRow = el('div', { class: 'vps-form-row' });
  nameRow.appendChild(el('label', { text: 'Name', class: 'vps-form-label' }));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'vps-form-input';
  nameInput.placeholder = 'Production';
  nameInput.value = existing ? existing.name : '';
  nameRow.appendChild(nameInput);
  body.appendChild(nameRow);

  // Host
  const hostRow = el('div', { class: 'vps-form-row' });
  hostRow.appendChild(el('label', { text: 'Host', class: 'vps-form-label' }));
  const hostInput = document.createElement('input');
  hostInput.type = 'text';
  hostInput.className = 'vps-form-input';
  hostInput.placeholder = '109.172.85.124';
  hostInput.value = existing ? existing.host : '';
  hostRow.appendChild(hostInput);
  body.appendChild(hostRow);

  // User + Port row
  const userPortRow = el('div', { class: 'vps-form-row vps-form-row-split' });
  const userCol = el('div', { class: 'vps-form-col' });
  userCol.appendChild(el('label', { text: 'User', class: 'vps-form-label' }));
  const userInput = document.createElement('input');
  userInput.type = 'text';
  userInput.className = 'vps-form-input';
  userInput.placeholder = 'root';
  userInput.value = existing ? existing.user : 'root';
  userCol.appendChild(userInput);
  userPortRow.appendChild(userCol);

  const portCol = el('div', { class: 'vps-form-col', style: 'max-width: 100px' });
  portCol.appendChild(el('label', { text: 'Port', class: 'vps-form-label' }));
  const portInput = document.createElement('input');
  portInput.type = 'number';
  portInput.className = 'vps-form-input';
  portInput.value = existing ? existing.port : 22;
  portCol.appendChild(portInput);
  userPortRow.appendChild(portCol);
  body.appendChild(userPortRow);

  // Key file
  const keyRow = el('div', { class: 'vps-form-row' });
  keyRow.appendChild(el('label', { text: 'SSH Key', class: 'vps-form-label' }));
  const keyWrap = el('div', { style: 'display:flex;gap:6px;flex:1' });
  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'vps-form-input';
  keyInput.placeholder = '~/.ssh/id_ed25519';
  keyInput.value = existing ? existing.key_file : '~/.ssh/id_ed25519';
  keyInput.style.flex = '1';
  keyWrap.appendChild(keyInput);

  const browseBtn = el('button', { text: 'Browse', class: 'btn-secondary' });
  browseBtn.addEventListener('click', async () => {
    try {
      const { open } = window.__TAURI__.dialog;
      const selected = await open({ multiple: false, title: 'Select SSH key file' });
      if (selected) keyInput.value = selected;
    } catch (e) {
      showToast('File picker error: ' + e, 'error');
    }
  });
  keyWrap.appendChild(browseBtn);
  keyRow.appendChild(keyWrap);
  body.appendChild(keyRow);

  // Environment
  const envRow = el('div', { class: 'vps-form-row' });
  envRow.appendChild(el('label', { text: 'Environment', class: 'vps-form-label' }));
  const envSelect = document.createElement('select');
  envSelect.className = 'vps-form-input';
  for (const env of environments) {
    const opt = document.createElement('option');
    opt.value = env.name;
    opt.textContent = env.name;
    if (existing && existing.environment === env.name) opt.selected = true;
    envSelect.appendChild(opt);
  }
  envRow.appendChild(envSelect);
  body.appendChild(envRow);

  // Color
  const colorRow = el('div', { class: 'vps-form-row' });
  colorRow.appendChild(el('label', { text: 'Color', class: 'vps-form-label' }));
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = existing ? existing.color : randomColor();
  colorInput.className = 'vps-color-input';
  colorRow.appendChild(colorInput);
  body.appendChild(colorRow);

  // Auto-refresh row
  const autoRow = el('div', { class: 'vps-form-row' });
  const autoLabel = el('label', { class: 'vps-form-label vps-checkbox-label' });
  const autoCheck = document.createElement('input');
  autoCheck.type = 'checkbox';
  autoCheck.checked = existing ? existing.auto_refresh : true;
  autoLabel.appendChild(autoCheck);
  autoLabel.appendChild(document.createTextNode(' Auto-refresh'));
  autoRow.appendChild(autoLabel);

  const intervalInput = document.createElement('input');
  intervalInput.type = 'number';
  intervalInput.className = 'vps-form-input';
  intervalInput.style.width = '80px';
  intervalInput.style.marginLeft = '8px';
  intervalInput.min = '5';
  intervalInput.value = existing ? existing.refresh_interval : 30;
  autoRow.appendChild(intervalInput);
  autoRow.appendChild(el('span', { text: 'sec', class: 'vps-form-hint' }));
  body.appendChild(autoRow);

  modal.appendChild(body);

  // Test connection + actions
  const actions = el('div', { class: 'vps-modal-actions' });

  const testBtn = el('button', { text: 'Test Connection', class: 'btn-secondary' });
  const testResult = el('span', { class: 'vps-test-result' });
  testBtn.addEventListener('click', async () => {
    testResult.textContent = 'Testing...';
    testResult.className = 'vps-test-result';
    try {
      const hostname = await call('vps_test_connection', {
        host: hostInput.value.trim(),
        user: userInput.value.trim(),
        port: parseInt(portInput.value) || 22,
        keyFile: keyInput.value.trim(),
      });
      testResult.textContent = 'OK: ' + hostname;
      testResult.className = 'vps-test-result vps-test-ok';
    } catch (e) {
      testResult.textContent = 'Failed: ' + e;
      testResult.className = 'vps-test-result vps-test-fail';
    }
  });
  actions.appendChild(testBtn);
  actions.appendChild(testResult);

  const spacer = el('div', { style: 'flex:1' });
  actions.appendChild(spacer);

  if (isEdit) {
    const deleteBtn = el('button', { text: 'Delete', class: 'btn-secondary vps-delete-btn' });
    deleteBtn.addEventListener('click', async () => {
      if (confirm(`Remove server "${existing.name}"?`)) {
        await removeServer(editIndex);
        overlay.remove();
      }
    });
    actions.appendChild(deleteBtn);
  }

  const saveBtn = el('button', { text: isEdit ? 'Update' : 'Save' });
  saveBtn.addEventListener('click', async () => {
    const serverData = {
      name: nameInput.value.trim(),
      host: hostInput.value.trim(),
      user: userInput.value.trim(),
      port: parseInt(portInput.value) || 22,
      key_file: keyInput.value.trim(),
      color: colorInput.value,
      auto_refresh: autoCheck.checked,
      refresh_interval: Math.max(5, parseInt(intervalInput.value) || 30),
      environment: envSelect.value,
    };

    if (!serverData.name || !serverData.host) {
      showToast('Name and host are required', 'error');
      return;
    }

    try {
      if (isEdit) {
        await call('update_vps_server', { index: editIndex, server: serverData });
        showToast('Server updated', 'success');
      } else {
        await call('add_vps_server', { server: serverData });
        showToast('Server added', 'success');
      }
      await loadData();
      renderEnvironments();
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

// ── Environment CRUD ───────────────────────────────────────

async function promptAddEnvironment() {
  const name = prompt('Environment name:');
  if (!name || !name.trim()) return;
  try {
    await call('add_vps_environment', { name: name.trim() });
    await loadData();
    renderEnvironments();
    showToast('Environment created', 'success');
  } catch (e) {
    showToast('Error: ' + e, 'error');
  }
}

async function promptRenameEnvironment(oldName) {
  const newName = prompt('New name:', oldName);
  if (!newName || !newName.trim() || newName.trim() === oldName) return;
  try {
    await call('rename_vps_environment', { oldName, newName: newName.trim() });
    await loadData();
    renderEnvironments();
    showToast('Environment renamed', 'success');
  } catch (e) {
    showToast('Error: ' + e, 'error');
  }
}

async function promptDeleteEnvironment(name) {
  const envServers = serversForEnv(name);
  const msg = envServers.length > 0
    ? `Delete environment "${name}"? ${envServers.length} server(s) will be moved to Default.`
    : `Delete environment "${name}"?`;
  if (!confirm(msg)) return;
  try {
    await call('remove_vps_environment', { name });
    if (expandedServer && expandedServer.envName === name) {
      expandedServer = null;
    }
    await loadData();
    renderEnvironments();
    showToast('Environment deleted', 'success');
  } catch (e) {
    showToast('Error: ' + e, 'error');
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

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function formatUptime(raw) {
  const match = raw.match(/up\s+(.+?)(?:,\s+\d+\s+user|$)/);
  return match ? match[1].trim().replace(/,\s*$/, '') : raw;
}

// ── Tile DnD (move between environments) ──────────────────────
//
// Pointer-based (not HTML5 DnD) — same rationale as Tasks tab. User grabs
// the ⋮⋮ grip on a tile, a floating semi-transparent clone follows the
// cursor, env-blocks under the cursor get a dashed accent border as drop
// target. On release: if the cursor is over a DIFFERENT env-block, call
// move_vps_server + reload. Else cancel.

let tileDragActive = null;

function installTileDnd(rootEl) {
  rootEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const grip = e.target.closest('[data-drag-grip]');
    if (!grip) return;
    const tile = grip.closest('.vps-tile');
    if (!tile) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = tile.getBoundingClientRect();
    const ghost = tile.cloneNode(true);
    ghost.style.position = 'fixed';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.width = rect.width + 'px';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '10000';
    ghost.style.opacity = '0.9';
    ghost.style.transform = 'rotate(-1deg)';
    ghost.style.boxShadow = '0 16px 32px rgba(0,0,0,0.55)';
    ghost.classList.add('vps-tile-drag-clone');
    document.body.appendChild(ghost);

    tile.classList.add('vps-tile-drag-source');

    tileDragActive = {
      tile, ghost,
      gIdx: Number(tile.dataset.gIdx),
      fromEnv: tile.dataset.envName,
      toEnv: null,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };

    const onMove = (ev) => onTileDragMove(ev);
    const onUp = async (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      await onTileDragUp(ev);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

function onTileDragMove(e) {
  if (!tileDragActive) return;
  const a = tileDragActive;
  a.ghost.style.left = (e.clientX - a.offsetX) + 'px';
  a.ghost.style.top = (e.clientY - a.offsetY) + 'px';

  for (const b of document.querySelectorAll('.vps-env-block.drop-target')) {
    b.classList.remove('drop-target');
  }
  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (!under) { a.toEnv = null; return; }
  const envBlock = under.closest('.vps-env-block');
  if (!envBlock) { a.toEnv = null; return; }
  // Extract env name from the grid id (`vps-grid-<name>`).
  const grid = envBlock.querySelector('[id^="vps-grid-"]');
  const envName = grid ? grid.id.replace('vps-grid-', '') : null;
  if (!envName || envName === a.fromEnv) { a.toEnv = null; return; }
  envBlock.classList.add('drop-target');
  a.toEnv = envName;
}

async function onTileDragUp() {
  const a = tileDragActive;
  tileDragActive = null;
  if (!a) return;
  // Cleanup visuals
  if (a.ghost && a.ghost.parentNode) a.ghost.remove();
  if (a.tile) a.tile.classList.remove('vps-tile-drag-source');
  for (const b of document.querySelectorAll('.vps-env-block.drop-target')) {
    b.classList.remove('drop-target');
  }
  if (a.toEnv && a.toEnv !== a.fromEnv) {
    await moveServer(a.gIdx, a.toEnv);
  }
}

function randomColor() {
  const colors = ['#f0883e', '#3fb950', '#58a6ff', '#d2a8ff', '#f778ba', '#79c0ff', '#ffa657', '#7ee787'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ── Styles ─────────────────────────────────────────────────

function css() {
  return `
.vps-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Toolbar */
.vps-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.vps-toolbar-btn {
  font-size: 12px;
  padding: 5px 12px;
}

/* Environments */
.vps-envs {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px 16px;
}
.vps-env-block {
  margin-bottom: 16px;
}
.vps-env-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.vps-env-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vps-env-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.vps-env-count {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  padding: 1px 7px;
  border-radius: 10px;
}
.vps-env-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.vps-env-action-btn {
  padding: 2px 6px;
  font-size: 13px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}
.vps-env-action-btn:hover {
  color: var(--text);
  background: var(--bg-tertiary);
}
.vps-env-action-danger:hover {
  color: var(--danger);
}
.vps-env-countdown {
  font-size: 11px;
  color: var(--text-muted);
  font-family: 'SF Mono', 'Cascadia Code', monospace;
  margin-right: 4px;
}

/* Tiles Grid */
.vps-tiles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 6px;
}
.vps-tiles-empty {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
  padding: 12px;
  opacity: 0.6;
}

/* Tile */
.vps-tile {
  display: flex;
  align-items: stretch;
  gap: 0;
  min-height: 92px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, opacity 0.15s;
  overflow: hidden;
  animation: vps-tile-in 0.25s ease both;
  position: relative;
}
.vps-tile:hover {
  border-color: var(--text-muted);
}
.vps-tile.expanded {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.vps-tile-drag-source {
  opacity: 0.35;
  pointer-events: none;
}
.vps-tile-drag-clone {
  cursor: grabbing !important;
  user-select: none;
}
.vps-env-block.drop-target {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
  border-radius: 6px;
  background: rgba(56, 139, 253, 0.05);
}
@keyframes vps-tile-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.vps-tile-accent {
  width: 4px;
  flex-shrink: 0;
  border-radius: 6px 0 0 6px;
}
.vps-tile-grip {
  display: flex;
  align-items: center;
  padding: 0 6px 0 4px;
  color: var(--text-muted);
  font-size: 13px;
  letter-spacing: -2px;
  cursor: grab;
  user-select: none;
  touch-action: none;
  opacity: 0.5;
  transition: opacity 0.15s;
  flex-shrink: 0;
}
.vps-tile:hover .vps-tile-grip { opacity: 1; }
.vps-tile-grip:active { cursor: grabbing; }
.vps-tile-content {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.vps-tile-controls {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 6px;
  flex-shrink: 0;
}
.vps-tile-ctrl-btn {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  width: 24px;
  height: 24px;
  border-radius: 3px;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.vps-tile-ctrl-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text);
  border-color: var(--border);
}
.vps-tile-statblock {
  margin-top: 2px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.vps-tile-stat-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  font-family: 'SF Mono', 'Cascadia Code', monospace;
  white-space: nowrap;
}
.vps-tile-stat-label {
  width: 28px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.vps-tile-stat-bar {
  flex: 1;
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
  min-width: 40px;
}
.vps-tile-stat-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.25s ease;
}
.vps-tile-stat-value {
  color: var(--text);
  font-size: 10.5px;
  flex-shrink: 0;
}
.vps-tile-stat-placeholder {
  color: var(--text-muted);
  font-size: 11px;
  font-style: italic;
  padding: 4px 0;
}
.vps-tile-stat-error {
  color: var(--danger);
  font-style: normal;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vps-tile-stat-ts {
  color: var(--text-muted);
  font-size: 10px;
  margin-top: 2px;
  text-align: right;
}
.vps-tile-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.vps-tile-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vps-tile-status {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--border);
  transition: background 0.3s;
}
.vps-tile-status.online {
  background: var(--success);
  box-shadow: 0 0 4px var(--success);
}
.vps-tile-status.error {
  background: var(--danger);
  box-shadow: 0 0 4px var(--danger);
}
.vps-tile-host {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'SF Mono', 'Cascadia Code', monospace;
  letter-spacing: -0.3px;
}

/* Mini stats on tile */
.vps-tile-mini-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 10px;
  flex-shrink: 0;
}
.vps-mini-stat {
  font-size: 11px;
  font-family: 'SF Mono', 'Cascadia Code', monospace;
  white-space: nowrap;
}
.vps-mini-label {
  color: var(--text-muted);
  font-size: 10px;
  margin-right: 2px;
}

/* Detail Panel */
.vps-detail-panel {
  margin-top: 8px;
  padding: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  animation: vps-fade-in 0.25s ease;
}
.vps-detail-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 13px;
  padding: 20px 0;
  justify-content: center;
}
.vps-detail-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px;
  text-align: center;
}
.vps-detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

/* Context Menu */
.vps-ctx-menu {
  position: fixed;
  z-index: 10000;
  min-width: 160px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  animation: vps-ctx-in 0.1s ease;
}
@keyframes vps-ctx-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
.vps-ctx-item {
  padding: 7px 14px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  transition: background 0.1s;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.vps-ctx-item:hover {
  background: var(--accent);
  color: #fff;
}
.vps-ctx-danger {
  color: var(--danger);
}
.vps-ctx-danger:hover {
  background: var(--danger);
  color: #fff;
}
.vps-ctx-sep {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
.vps-ctx-arrow {
  font-size: 9px;
  margin-left: 8px;
  color: var(--text-muted);
}
.vps-ctx-item:hover .vps-ctx-arrow {
  color: #fff;
}

/* Nested submenu */
.vps-ctx-has-sub {
  position: relative;
}
.vps-ctx-sub {
  display: none;
  position: absolute;
  left: 100%;
  top: -4px;
  min-width: 140px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.vps-ctx-has-sub:hover > .vps-ctx-sub {
  display: block;
}

/* Spinner */
.vps-spinner {
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255,255,255,0.08);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: vps-spin 0.7s linear infinite;
}
@keyframes vps-spin {
  to { transform: rotate(360deg); }
}

/* Error state */
.vps-error-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--danger);
}
.vps-error-msg {
  font-size: 12px;
  color: var(--text-muted);
  max-width: 500px;
  word-break: break-word;
}
.vps-retry-btn {
  margin-top: 8px;
  padding: 6px 20px;
  font-size: 13px;
}

/* Info line */
.vps-info-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
  animation: vps-fade-in 0.3s ease;
}
.vps-info-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg-primary);
  border: 1px solid var(--border);
  font-family: 'SF Mono', 'Cascadia Code', monospace;
  letter-spacing: -0.2px;
}
.vps-info-label {
  font-weight: 600;
  color: var(--text-muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Stats cards */
.vps-cards-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  animation: vps-fade-in 0.3s ease 0.05s both;
}
@media (max-width: 600px) {
  .vps-cards-row {
    grid-template-columns: 1fr;
  }
}

.vps-stat-card {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  overflow: hidden;
  transition: border-color 0.2s;
}
.vps-stat-card:hover {
  border-color: var(--text-muted);
}
.vps-stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 8px 8px 0 0;
  opacity: 0.6;
  background: var(--card-accent, var(--accent));
}
.vps-stat-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.vps-stat-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}
.vps-stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.5px;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
}
.vps-stat-sub {
  font-size: 11px;
  color: var(--text-muted);
}

/* Progress bar */
.vps-bar-bg {
  width: 100%;
  height: 6px;
  background: rgba(255,255,255,0.04);
  border-radius: 3px;
  overflow: hidden;
}
.vps-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s;
}

/* Action buttons */
.vps-action-btn {
  padding: 5px 14px;
  font-size: 12px;
}

/* Placeholder */
.vps-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-muted);
  font-size: 13px;
  opacity: 0.6;
}

/* Fade-in */
@keyframes vps-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Modal */
.vps-modal {
  width: 460px;
  max-width: 95vw;
}
.vps-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.vps-modal-header h3 {
  margin: 0;
  font-size: 15px;
}
.vps-modal-close {
  padding: 4px 8px;
  font-size: 14px;
}
.vps-modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vps-form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vps-form-row-split {
  gap: 12px;
}
.vps-form-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.vps-form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  min-width: 70px;
  flex-shrink: 0;
}
.vps-form-input {
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text);
  flex: 1;
}
.vps-form-input:focus {
  border-color: var(--accent);
  outline: none;
}
.vps-form-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: 4px;
}
.vps-color-input {
  width: 40px;
  height: 30px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-primary);
  cursor: pointer;
}
.vps-checkbox-label {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.vps-modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
}
.vps-test-result {
  font-size: 12px;
  color: var(--text-muted);
}
.vps-test-ok {
  color: var(--success);
}
.vps-test-fail {
  color: var(--danger);
}
.vps-delete-btn {
  color: var(--danger) !important;
  border-color: var(--danger) !important;
}
.vps-delete-btn:hover {
  background: var(--danger) !important;
  color: #fff !important;
}
`;
}
