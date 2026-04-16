import { call } from '../tauri-api.js';
import { showToast } from '../components/toast.js';

let root = null;
let environments = [];     // VpsEnvironment[]
let allServers = [];       // VpsServer[]
let expandedServer = null; // { envName, serverIndex, stats, loading, error }
let refreshTimers = {};    // envName -> { countdown, timer }
let tabVisible = true;
let contextMenu = null;    // current context menu element

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  loadData().then(() => {
    root.appendChild(buildLayout());
  });

  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('click', closeContextMenu);
  document.addEventListener('keydown', onGlobalKeydown);
}

export function destroy() {
  stopAllRefreshTimers();
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
  tile.style.animationDelay = `${animIdx * 40}ms`;

  // Color accent
  const accent = el('div', { class: 'vps-tile-accent' });
  accent.style.background = srv.color;
  tile.appendChild(accent);

  // Content
  const content = el('div', { class: 'vps-tile-content' });

  const nameRow = el('div', { class: 'vps-tile-name-row' });
  const name = el('span', { text: srv.name, class: 'vps-tile-name' });
  nameRow.appendChild(name);

  // Status indicator
  const statusDot = el('span', { class: 'vps-tile-status', id: `vps-status-${gIdx}` });
  nameRow.appendChild(statusDot);

  content.appendChild(nameRow);

  const hostLine = el('div', {
    text: `${srv.user}@${srv.host}:${srv.port}`,
    class: 'vps-tile-host',
  });
  content.appendChild(hostLine);

  tile.appendChild(content);

  // Mini stats (if we have cached stats)
  const miniStats = el('div', { class: 'vps-tile-mini-stats', id: `vps-mini-${gIdx}` });
  tile.appendChild(miniStats);

  // Click to expand
  tile.addEventListener('click', (e) => {
    if (e.target.closest('.vps-tile-ctx-btn')) return;
    toggleExpand(gIdx, envName);
  });

  // Context menu trigger
  tile.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showTileContextMenu(e, srv, gIdx, envName);
  });

  return tile;
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
    // Collapse
    expandedServer = null;
    renderEnvironments();
    return;
  }

  expandedServer = { envName, serverIndex: gIdx, stats: null, loading: true, error: null };
  renderEnvironments();
  fetchStatsForExpanded();
}

async function fetchStatsForExpanded() {
  if (!expandedServer) return;
  const gIdx = expandedServer.serverIndex;
  const srv = allServers[gIdx];
  if (!srv) return;

  expandedServer.loading = true;
  expandedServer.error = null;
  renderEnvironments();

  try {
    const stats = await call('vps_get_stats', {
      host: srv.host,
      user: srv.user,
      port: srv.port,
      keyFile: srv.key_file,
    });
    if (!expandedServer || expandedServer.serverIndex !== gIdx) return;
    expandedServer.stats = stats;
    expandedServer.loading = false;
    expandedServer.error = null;
    renderEnvironments();

    // Update the mini stats dot to green
    updateStatusDot(gIdx, 'online');
  } catch (e) {
    if (!expandedServer || expandedServer.serverIndex !== gIdx) return;
    expandedServer.loading = false;
    expandedServer.error = String(e);
    expandedServer.stats = null;
    renderEnvironments();
    updateStatusDot(gIdx, 'error');
  }
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

  // Fetch all servers in parallel
  const promises = envServers.map(async (srv, localIdx) => {
    const gIdx = globalIndex(envName, localIdx);
    try {
      const stats = await call('vps_get_stats', {
        host: srv.host,
        user: srv.user,
        port: srv.port,
        keyFile: srv.key_file,
      });
      updateStatusDot(gIdx, 'online');
      updateMiniStats(gIdx, stats);
      // If this server is expanded, update its stats too
      if (expandedServer && expandedServer.serverIndex === gIdx) {
        expandedServer.stats = stats;
        expandedServer.loading = false;
        expandedServer.error = null;
      }
      return { gIdx, stats, ok: true };
    } catch (e) {
      updateStatusDot(gIdx, 'error');
      if (expandedServer && expandedServer.serverIndex === gIdx) {
        expandedServer.loading = false;
        expandedServer.error = String(e);
      }
      return { gIdx, error: e, ok: false };
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
  align-items: center;
  gap: 0;
  height: 48px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
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
@keyframes vps-tile-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.vps-tile-accent {
  width: 4px;
  height: 100%;
  flex-shrink: 0;
  border-radius: 6px 0 0 6px;
}
.vps-tile-content {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
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
