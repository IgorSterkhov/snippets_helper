import { call } from '../tauri-api.js';
import { showToast } from '../components/toast.js';

let root = null;
let allServers = [];       // VpsServer[]
let activeIndex = -1;      // index of selected server (-1 = none)
let currentStats = null;   // last fetched stats
let loading = false;
let errorMsg = '';
let refreshTimer = null;
let countdownTimer = null;
let countdownSec = 0;
let tabVisible = true;

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  loadServers().then(() => {
    root.appendChild(buildLayout());
    renderContent();
  });

  // Track visibility for auto-refresh
  document.addEventListener('visibilitychange', onVisibilityChange);
}

export function destroy() {
  stopAutoRefresh();
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (root) root.innerHTML = '';
  allServers = [];
  activeIndex = -1;
  currentStats = null;
}

function onVisibilityChange() {
  const wasVisible = tabVisible;
  tabVisible = document.visibilityState === 'visible';
  if (tabVisible && !wasVisible && activeIndex >= 0) {
    const srv = allServers[activeIndex];
    if (srv && srv.auto_refresh) {
      startAutoRefresh(srv);
    }
  } else if (!tabVisible) {
    stopAutoRefresh();
  }
}

async function loadServers() {
  try {
    allServers = await call('list_vps_servers');
  } catch {
    allServers = [];
  }
}

// ── Layout ─────────────────────────────────────────────────

function buildLayout() {
  const wrap = el('div', { class: 'vps-wrap' });

  // Server chips bar
  const chipBar = el('div', { class: 'vps-chip-bar', id: 'vps-chip-bar' });
  wrap.appendChild(chipBar);
  renderChips();

  // Main content area
  const content = el('div', { class: 'vps-content', id: 'vps-content' });
  wrap.appendChild(content);

  return wrap;
}

// ── Server Chips ─────────────────────────────────────────────

function renderChips() {
  const bar = root ? root.querySelector('#vps-chip-bar') : null;
  if (!bar) return;
  bar.innerHTML = '';

  for (let i = 0; i < allServers.length; i++) {
    const srv = allServers[i];
    const isActive = i === activeIndex;
    const chip = document.createElement('div');
    chip.className = 'vps-chip' + (isActive ? ' active' : '');
    if (!isActive) chip.style.opacity = '0.5';

    const colorBar = document.createElement('span');
    colorBar.className = 'vps-chip-bar';
    colorBar.style.background = srv.color;
    if (isActive) colorBar.style.boxShadow = `0 0 6px ${srv.color}`;
    chip.appendChild(colorBar);

    const label = document.createElement('span');
    label.className = 'vps-chip-label';
    label.textContent = srv.name;
    chip.appendChild(label);

    // Gear button
    const gear = document.createElement('span');
    gear.className = 'vps-chip-gear';
    gear.textContent = '\u2699';
    gear.title = 'Edit server';
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      showServerModal(i);
    });
    chip.appendChild(gear);

    chip.addEventListener('click', () => selectServer(i));

    // Right-click to remove
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm(`Remove server "${srv.name}"?`)) {
        removeServer(i);
      }
    });

    chip.title = `${srv.user}@${srv.host}:${srv.port}`;
    bar.appendChild(chip);
  }

  // "+" button
  const addBtn = document.createElement('div');
  addBtn.className = 'vps-chip vps-chip-add';
  addBtn.textContent = '+';
  addBtn.title = 'Add server';
  addBtn.addEventListener('click', () => showServerModal());
  bar.appendChild(addBtn);
}

function selectServer(index) {
  if (index === activeIndex) return;
  stopAutoRefresh();
  activeIndex = index;
  currentStats = null;
  errorMsg = '';
  renderChips();
  renderContent();
  if (index >= 0) fetchStats();
}

// ── Content Rendering ───────────────────────────────────────

function renderContent() {
  const content = root ? root.querySelector('#vps-content') : null;
  if (!content) return;
  content.innerHTML = '';

  if (activeIndex < 0 || !allServers[activeIndex]) {
    content.innerHTML = '<div class="vps-placeholder">Select a server to view stats</div>';
    return;
  }

  if (loading) {
    content.innerHTML = '<div class="vps-placeholder"><span class="vps-spinner"></span> Connecting...</div>';
    return;
  }

  if (errorMsg) {
    const errWrap = el('div', { class: 'vps-error' });
    errWrap.appendChild(el('div', { text: 'Connection failed', class: 'vps-error-title' }));
    errWrap.appendChild(el('div', { text: errorMsg, class: 'vps-error-msg' }));
    const retryBtn = el('button', { text: 'Retry', class: 'vps-retry-btn' });
    retryBtn.addEventListener('click', () => fetchStats());
    errWrap.appendChild(retryBtn);
    content.appendChild(errWrap);
    return;
  }

  if (!currentStats) {
    content.innerHTML = '<div class="vps-placeholder">Select a server to view stats</div>';
    return;
  }

  const srv = allServers[activeIndex];

  // Info line
  const infoLine = el('div', { class: 'vps-info-line' });
  if (currentStats.hostname) {
    const hostBadge = el('span', { class: 'vps-info-badge' });
    hostBadge.innerHTML = '<span class="vps-info-label">Host</span> ' + escapeHtml(currentStats.hostname);
    infoLine.appendChild(hostBadge);
  }
  if (currentStats.uptime) {
    const uptimeBadge = el('span', { class: 'vps-info-badge' });
    uptimeBadge.innerHTML = '<span class="vps-info-label">Uptime</span> ' + escapeHtml(formatUptime(currentStats.uptime));
    infoLine.appendChild(uptimeBadge);
  }
  content.appendChild(infoLine);

  // Stats cards
  const cardsRow = el('div', { class: 'vps-cards-row' });

  cardsRow.appendChild(buildStatCard(
    'CPU',
    currentStats.cpu_usage_pct,
    `${currentStats.cpu_usage_pct.toFixed(1)}%`,
    null
  ));

  cardsRow.appendChild(buildStatCard(
    'RAM',
    currentStats.ram_pct,
    `${currentStats.ram_pct.toFixed(1)}%`,
    `${currentStats.ram_used} / ${currentStats.ram_total}`
  ));

  cardsRow.appendChild(buildStatCard(
    'Disk',
    currentStats.disk_pct,
    `${currentStats.disk_pct.toFixed(1)}%`,
    `${currentStats.disk_used} / ${currentStats.disk_total}`
  ));

  content.appendChild(cardsRow);

  // Actions bar
  const actionsBar = el('div', { class: 'vps-actions-bar' });

  const refreshBtn = el('button', { text: 'Refresh', class: 'vps-action-btn' });
  refreshBtn.addEventListener('click', () => fetchStats());
  actionsBar.appendChild(refreshBtn);

  if (srv.auto_refresh) {
    const countdown = el('span', { class: 'vps-countdown', id: 'vps-countdown' });
    countdown.textContent = countdownSec > 0 ? `Refreshing in ${countdownSec}s...` : '';
    actionsBar.appendChild(countdown);
  }

  content.appendChild(actionsBar);
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

  // Add colored top accent line
  card.style.setProperty('--card-accent', getBarColor(clampedPct));

  return card;
}

function getBarColor(pct) {
  if (pct > 80) return '#f85149';
  if (pct > 50) return '#f0883e';
  return '#3fb950';
}

// ── Data Fetching ───────────────────────────────────────────

async function fetchStats() {
  if (activeIndex < 0 || !allServers[activeIndex]) return;
  const srv = allServers[activeIndex];
  const fetchIndex = activeIndex;

  loading = true;
  errorMsg = '';
  renderContent();

  try {
    const stats = await call('vps_get_stats', {
      host: srv.host,
      user: srv.user,
      port: srv.port,
      keyFile: srv.key_file,
    });
    // Make sure user didn't switch servers while we were loading
    if (activeIndex !== fetchIndex) return;
    currentStats = stats;
    loading = false;
    errorMsg = '';
    renderContent();

    // Start auto-refresh if enabled
    if (srv.auto_refresh && tabVisible) {
      startAutoRefresh(srv);
    }
  } catch (e) {
    if (activeIndex !== fetchIndex) return;
    loading = false;
    errorMsg = String(e);
    currentStats = null;
    renderContent();
  }
}

function startAutoRefresh(srv) {
  stopAutoRefresh();
  if (!srv.auto_refresh || srv.refresh_interval < 5) return;

  countdownSec = srv.refresh_interval;
  updateCountdownDisplay();

  countdownTimer = setInterval(() => {
    countdownSec--;
    updateCountdownDisplay();
    if (countdownSec <= 0) {
      stopAutoRefresh();
      fetchStats();
    }
  }, 1000);
}

function stopAutoRefresh() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  countdownSec = 0;
}

function updateCountdownDisplay() {
  const el = root ? root.querySelector('#vps-countdown') : null;
  if (el) {
    el.textContent = countdownSec > 0 ? `Refreshing in ${countdownSec}s...` : '';
  }
}

// ── Server CRUD ─────────────────────────────────────────────

async function removeServer(index) {
  try {
    await call('remove_vps_server', { index });
    allServers.splice(index, 1);
    if (activeIndex === index) {
      activeIndex = -1;
      currentStats = null;
      stopAutoRefresh();
    } else if (activeIndex > index) {
      activeIndex--;
    }
    renderChips();
    renderContent();
    showToast('Server removed', 'success');
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
  const testResult = el('span', { class: 'vps-test-result', id: 'vps-test-result' });
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
    };

    if (!serverData.name || !serverData.host) {
      showToast('Name and host are required', 'error');
      return;
    }

    try {
      if (isEdit) {
        await call('update_vps_server', { index: editIndex, server: serverData });
        allServers[editIndex] = serverData;
        showToast('Server updated', 'success');
      } else {
        await call('add_vps_server', { server: serverData });
        allServers.push(serverData);
        showToast('Server added', 'success');
      }
      renderChips();
      if (activeIndex === editIndex) renderContent();
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

// ── Helpers ─────────────────────────────────────────────────

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
  // Extract the useful part: "up X days, H:MM" from full uptime string
  const match = raw.match(/up\s+(.+?)(?:,\s+\d+\s+user|$)/);
  return match ? match[1].trim().replace(/,\s*$/, '') : raw;
}

function randomColor() {
  const colors = ['#f0883e', '#3fb950', '#58a6ff', '#d2a8ff', '#f778ba', '#79c0ff', '#ffa657', '#7ee787'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ── Styles ──────────────────────────────────────────────────

function css() {
  return `
.vps-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Chip bar */
.vps-chip-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
  min-height: 40px;
}
.vps-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px 5px 8px;
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
.vps-chip:hover {
  border-color: var(--text-muted);
}
.vps-chip.active {
  background: var(--bg-secondary);
  opacity: 1 !important;
}
.vps-chip-bar .vps-chip-bar-el {
  /* color bar inside chip */
}
.vps-chip-bar > .vps-chip .vps-chip-bar {
  width: 3px;
  height: 16px;
  border-radius: 2px;
  flex-shrink: 0;
}
.vps-chip-label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vps-chip-gear {
  font-size: 13px;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
  margin-left: 2px;
}
.vps-chip:hover .vps-chip-gear {
  opacity: 1;
}
.vps-chip-gear:hover {
  color: var(--accent);
}
.vps-chip-add {
  font-size: 16px;
  font-weight: 400;
  padding: 4px 10px;
  color: var(--text-muted);
  opacity: 1 !important;
}
.vps-chip-add:hover {
  color: var(--accent);
  border-color: var(--accent);
}

/* Content */
.vps-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.vps-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 300px;
  color: var(--text-muted);
  font-size: 14px;
  opacity: 0.7;
}

/* Spinner */
.vps-spinner {
  display: inline-block;
  width: 22px;
  height: 22px;
  border: 2px solid rgba(255,255,255,0.08);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: vps-spin 0.7s linear infinite;
}
@keyframes vps-spin {
  to { transform: rotate(360deg); }
}

/* Error state */
.vps-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
  text-align: center;
}
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
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.vps-info-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  font-family: 'SF Mono', 'Cascadia Code', monospace;
  letter-spacing: -0.2px;
}
.vps-info-label {
  font-weight: 600;
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Stats cards row */
.vps-cards-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 20px;
}
@media (max-width: 600px) {
  .vps-cards-row {
    grid-template-columns: 1fr;
  }
}

.vps-stat-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
  overflow: hidden;
  transition: border-color 0.2s;
}
.vps-stat-card:hover {
  border-color: var(--text-muted);
}
/* Subtle gradient overlay for depth */
.vps-stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 10px 10px 0 0;
  opacity: 0.6;
  background: var(--card-accent, var(--accent));
}
.vps-stat-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.vps-stat-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}
.vps-stat-value {
  font-size: 26px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.5px;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
}
.vps-stat-sub {
  font-size: 12px;
  color: var(--text-muted);
}

/* Progress bar */
.vps-bar-bg {
  width: 100%;
  height: 8px;
  background: rgba(255,255,255,0.04);
  border-radius: 4px;
  overflow: hidden;
}
.vps-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s;
}

/* Actions bar */
.vps-actions-bar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.vps-action-btn {
  padding: 6px 16px;
  font-size: 12px;
}
.vps-countdown {
  font-size: 11px;
  color: var(--text-muted);
  font-family: 'SF Mono', 'Cascadia Code', monospace;
  letter-spacing: -0.3px;
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

/* Fade-in animations */
@keyframes vps-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.vps-info-line { animation: vps-fade-in 0.3s ease; }
.vps-cards-row { animation: vps-fade-in 0.3s ease 0.05s both; }
.vps-actions-bar { animation: vps-fade-in 0.3s ease 0.1s both; }
`;
}
