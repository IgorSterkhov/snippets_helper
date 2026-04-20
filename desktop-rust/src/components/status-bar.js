import { call } from '../tauri-api.js';
import { showToast } from './toast.js';

let barEl = null;
let syncTextEl = null;
let syncDotEl = null;
let updateTextEl = null;
let updateDotEl = null;
let syncPopupEl = null;
let updateInfo = null;
let frontendVersion = null;
let frontendUpdateInfo = null;
const syncLog = [];

const FRONTEND_CHECK_INTERVAL_MS = 30 * 60 * 1000;

async function loadFrontendVersion() {
  try {
    const ver = await call('get_frontend_version');
    if (ver) { frontendVersion = ver; return ver; }
  } catch { /* backend missing */ }
  if (frontendVersion !== null) return frontendVersion;
  try {
    const res = await fetch('frontend-version.json');
    if (!res.ok) throw new Error('no file');
    const data = await res.json();
    frontendVersion = (data && data.version) || '';
  } catch {
    frontendVersion = '';
  }
  return frontendVersion;
}

function formatVersion(nativeVersion) {
  if (frontendVersion) return `v${frontendVersion}`;
  return `v${nativeVersion}`;
}

// ── Public API ────────────────────────────────────────────

export function createStatusBar() {
  barEl = document.createElement('div');
  barEl.id = 'status-bar';

  // Left: sync
  const syncSection = document.createElement('div');
  syncSection.className = 'sb-section sb-sync';
  syncSection.addEventListener('click', toggleSyncPopup);

  syncDotEl = document.createElement('span');
  syncDotEl.className = 'sb-dot sb-dot-idle';
  syncSection.appendChild(syncDotEl);

  syncTextEl = document.createElement('span');
  syncTextEl.className = 'sb-label';
  syncTextEl.textContent = 'Sync idle';
  syncSection.appendChild(syncTextEl);

  barEl.appendChild(syncSection);

  // Right: update
  const updateSection = document.createElement('div');
  updateSection.className = 'sb-section sb-update';
  updateSection.addEventListener('click', onUpdateClick);

  updateDotEl = document.createElement('span');
  updateDotEl.className = 'sb-dot sb-dot-idle';
  updateSection.appendChild(updateDotEl);

  updateTextEl = document.createElement('span');
  updateTextEl.className = 'sb-label';
  updateTextEl.textContent = 'Checking...';
  updateSection.appendChild(updateTextEl);

  barEl.appendChild(updateSection);

  document.body.appendChild(barEl);
  injectStyles();

  // Close popup on outside click
  document.addEventListener('click', (e) => {
    if (syncPopupEl && !syncPopupEl.contains(e.target) && !barEl.contains(e.target)) {
      closeSyncPopup();
    }
  });
}

// ── Sync ──────────────────────────────────────────────────

export function setSyncStatus(status, detail = '') {
  if (!syncDotEl || !syncTextEl) return;
  syncDotEl.className = 'sb-dot';
  switch (status) {
    case 'syncing':
      syncDotEl.classList.add('sb-dot-syncing');
      syncTextEl.textContent = 'Syncing...';
      break;
    case 'ok':
      syncDotEl.classList.add('sb-dot-ok');
      syncTextEl.textContent = detail || ('Synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      break;
    case 'error':
      syncDotEl.classList.add('sb-dot-error');
      syncTextEl.textContent = detail ? 'Sync: ' + detail.substring(0, 40) : 'Sync error';
      break;
    default:
      syncDotEl.classList.add('sb-dot-idle');
      syncTextEl.textContent = detail || 'Sync idle';
      break;
  }
}

export function addSyncLogEntry(entry) {
  syncLog.unshift(entry);
  if (syncLog.length > 20) syncLog.pop();
  if (syncPopupEl) renderSyncPopup();
}

export async function doSync() {
  setSyncStatus('syncing');
  try {
    const result = await call('trigger_sync');
    const pushTotal = result.push?.total || 0;
    const pullTotal = result.pull?.total || 0;
    let detail = '';
    if (pushTotal > 0 || pullTotal > 0) {
      const parts = [];
      if (pushTotal > 0) parts.push('↑' + pushTotal);
      if (pullTotal > 0) parts.push('↓' + pullTotal);
      detail = parts.join(' ') + ' · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    addSyncLogEntry({
      timestamp: result.timestamp || new Date().toLocaleTimeString(),
      type: 'success',
      push: result.push,
      pull: result.pull,
    });
    setSyncStatus('ok', detail);
    return result;
  } catch (err) {
    const msg = String(err);
    if (msg.includes('not configured')) {
      setSyncStatus('idle', 'Sync not configured');
    } else {
      addSyncLogEntry({ timestamp: new Date().toLocaleTimeString(), type: 'error', message: msg });
      setSyncStatus('error', msg.substring(0, 50));
    }
    throw err;
  }
}

// ── Sync popup ────────────────────────────────────────────

function toggleSyncPopup() {
  if (syncPopupEl) {
    closeSyncPopup();
    return;
  }
  openSyncPopup();
  const isSyncing = syncDotEl?.classList.contains('sb-dot-syncing');
  if (!isSyncing) {
    showToast('Syncing...');
    doSync().catch(() => {});
  }
}

function openSyncPopup() {
  closeSyncPopup();
  const popup = document.createElement('div');
  popup.className = 'sb-popup';
  syncPopupEl = popup;
  renderSyncPopup();
  document.body.appendChild(popup);

  // Position above status bar, left-aligned
  const barRect = barEl.getBoundingClientRect();
  popup.style.left = barRect.left + 'px';
  popup.style.bottom = (window.innerHeight - barRect.top + 4) + 'px';
}

function closeSyncPopup() {
  if (syncPopupEl) { syncPopupEl.remove(); syncPopupEl = null; }
}

function renderSyncPopup() {
  if (!syncPopupEl) return;
  syncPopupEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'sb-popup-header';
  header.textContent = 'Sync Log';
  syncPopupEl.appendChild(header);

  if (syncLog.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sb-popup-empty';
    empty.textContent = 'No sync events yet';
    syncPopupEl.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'sb-popup-list';

  for (const entry of syncLog) {
    const item = document.createElement('div');
    item.className = 'sb-popup-item';

    const ts = document.createElement('span');
    ts.className = 'sb-popup-ts';
    ts.textContent = entry.timestamp;

    if (entry.type === 'error') {
      item.innerHTML = `<span class="sb-popup-ts">${entry.timestamp}</span> <span class="sb-dot-inline sb-dot-error"></span> ${entry.message || 'Error'}`;
    } else {
      const pushTotal = entry.push?.total || 0;
      const pullTotal = entry.pull?.total || 0;
      if (pushTotal === 0 && pullTotal === 0) {
        item.innerHTML = `<span class="sb-popup-ts">${entry.timestamp}</span> <span class="sb-dot-inline sb-dot-idle"></span> Nothing to sync`;
      } else {
        const parts = [];
        if (pushTotal > 0) parts.push('↑ ' + fmtMap(entry.push.pushed));
        if (pullTotal > 0) parts.push('↓ ' + fmtMap(entry.pull.pulled));
        item.innerHTML = `<span class="sb-popup-ts">${entry.timestamp}</span> <span class="sb-dot-inline sb-dot-ok"></span> ${parts.join(' · ')}`;

        // Expandable details
        const details = document.createElement('div');
        details.className = 'sb-popup-details';
        details.style.display = 'none';
        if (pushTotal > 0) details.appendChild(makeBlock('Pushed', entry.push.pushed));
        if (pullTotal > 0) details.appendChild(makeBlock('Pulled', entry.pull.pulled));
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
          details.style.display = details.style.display === 'none' ? 'block' : 'none';
        });
        item.appendChild(details);
      }
    }
    list.appendChild(item);
  }
  syncPopupEl.appendChild(list);
}

function fmtMap(m) {
  if (!m) return '';
  return Object.entries(m).map(([t, n]) => t + ' +' + n.length).join(', ');
}

function makeBlock(label, dataMap) {
  const block = document.createElement('div');
  block.className = 'sb-popup-detail';
  for (const [table, names] of Object.entries(dataMap)) {
    const shown = names.slice(0, 5).join(', ');
    const extra = names.length > 5 ? ` [+${names.length - 5}]` : '';
    const line = document.createElement('div');
    line.textContent = `└ ${table}: ${shown}${extra}`;
    line.className = 'sb-popup-detail-line';
    block.appendChild(line);
  }
  return block;
}

// ── Update status ─────────────────────────────────────────

export async function checkUpdateStatus() {
  if (!updateTextEl) return;
  await loadFrontendVersion();
  updateTextEl.textContent = 'Checking...';
  updateDotEl.className = 'sb-dot sb-dot-idle';
  try {
    const info = await call('check_for_update');
    updateInfo = info;
    // For native-update slots, use the native version directly so the label
    // can never look like a downgrade when the frontend has been OTA'd ahead.
    if (info.has_update) {
      updateTextEl.textContent = `v${info.current_version} → v${info.latest_version} available`;
      updateDotEl.className = 'sb-dot sb-dot-update';
      barEl.querySelector('.sb-update').title = `Click to download v${info.latest_version}` +
        (frontendVersion ? ` (frontend: ${frontendVersion})` : '');
    } else if (info.build_in_progress) {
      updateTextEl.textContent = `v${info.current_version} · v${info.latest_version} building...`;
      updateDotEl.className = 'sb-dot sb-dot-building';
      barEl.querySelector('.sb-update').title = 'Build in progress, try again later';
    } else {
      // No native update — show the combined label so users see their frontend version too.
      updateTextEl.textContent = `${formatVersion(info.current_version)} · up to date`;
      updateDotEl.className = 'sb-dot sb-dot-ok';
      barEl.querySelector('.sb-update').title = `Click to re-check` +
        (frontendVersion && frontendVersion !== info.current_version ? ` (native: v${info.current_version})` : '');
    }
  } catch (e) {
    updateTextEl.textContent = 'Update check failed';
    updateDotEl.className = 'sb-dot sb-dot-error';
  }
}

async function onUpdateClick() {
  if (frontendUpdateInfo && frontendUpdateInfo.has_update) {
    await applyFrontendUpdate();
    return;
  }
  if (updateInfo && updateInfo.has_update && updateInfo.download_url) {
    try {
      await call('open_url', { url: updateInfo.download_url });
      showToast('Opening download page...', 'info');
    } catch (e) {
      showToast('Error: ' + e, 'error');
    }
    return;
  }
  await checkUpdateStatus();
  await checkFrontendUpdateStatus();
}

export async function checkFrontendUpdateStatus() {
  try {
    const info = await call('check_frontend_update');
    frontendUpdateInfo = info;
    if (info.has_update) {
      updateDotEl.className = 'sb-dot sb-dot-update';
      updateTextEl.textContent = `${formatVersion('')} → ${info.latest_version} (click to apply)`;
      barEl.querySelector('.sb-update').title = 'Click to download & apply frontend update';
      showToast(`Frontend update: ${info.latest_version}`, 'info');
    }
    return info;
  } catch (e) {
    return null;
  }
}

async function applyFrontendUpdate() {
  if (!frontendUpdateInfo || !frontendUpdateInfo.has_update) return;
  const info = frontendUpdateInfo;
  try {
    updateTextEl.textContent = 'Downloading...';
    updateDotEl.className = 'sb-dot sb-dot-building';
    await call('download_frontend_update', {
      url: info.url,
      version: info.latest_version,
      signature: info.signature,
      sha256: info.sha256 || null,
    });
    updateTextEl.textContent = 'Applying...';
    await call('apply_frontend_update', { version: info.latest_version });
    showToast('Frontend updated, reloading...', 'success');
  } catch (e) {
    showToast('Update failed: ' + e, 'error');
    updateDotEl.className = 'sb-dot sb-dot-error';
    updateTextEl.textContent = 'Update failed';
  }
}

let frontendCheckTimer = null;
export function startFrontendUpdateWatcher() {
  if (frontendCheckTimer) return;
  frontendCheckTimer = setInterval(() => {
    checkFrontendUpdateStatus().catch(() => {});
  }, FRONTEND_CHECK_INTERVAL_MS);
}

// ── Styles ────────────────────────────────────────────────

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
#status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  background: var(--bg-tertiary);
  border-top: 1px solid var(--border);
  height: 26px;
  min-height: 26px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
  font-family: 'SF Mono', 'Consolas', 'Fira Code', monospace;
  letter-spacing: -0.2px;
  user-select: none;
}

.sb-section {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 3px;
  transition: background 0.15s;
}
.sb-section:hover {
  background: rgba(255,255,255,0.04);
}

.sb-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.3s, box-shadow 0.3s;
}
.sb-dot-idle { background: #484f58; }
.sb-dot-syncing {
  background: var(--accent);
  animation: sb-pulse 1s ease-in-out infinite;
}
.sb-dot-ok { background: #3fb950; box-shadow: 0 0 4px #3fb95066; }
.sb-dot-error { background: #f85149; box-shadow: 0 0 4px #f8514966; }
.sb-dot-update { background: var(--accent); box-shadow: 0 0 6px var(--accent); animation: sb-pulse 2s ease-in-out infinite; }
.sb-dot-building { background: #f0883e; animation: sb-pulse 1.5s ease-in-out infinite; }

.sb-dot-inline {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  vertical-align: middle;
  margin: 0 2px;
}

.sb-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
}

@keyframes sb-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* Popup */
.sb-popup {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 400px;
  max-height: 320px;
  display: flex;
  flex-direction: column;
  z-index: 2000;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  font-size: 12px;
  font-family: system-ui, sans-serif;
}
.sb-popup-header {
  padding: 10px 14px 8px;
  font-weight: 600;
  font-size: 13px;
  color: var(--text);
  border-bottom: 1px solid var(--border);
}
.sb-popup-empty {
  padding: 24px 14px;
  color: var(--text-muted);
  text-align: center;
}
.sb-popup-list {
  overflow-y: auto;
  flex: 1;
  padding: 4px 0;
}
.sb-popup-item {
  padding: 5px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.03);
  color: var(--text);
  line-height: 1.5;
}
.sb-popup-item:last-child { border-bottom: none; }
.sb-popup-ts {
  color: var(--text-muted);
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 10px;
  margin-right: 4px;
}
.sb-popup-details { padding: 3px 0 1px 14px; }
.sb-popup-detail-line {
  color: var(--text-muted);
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 10px;
  line-height: 1.5;
}
`;
  document.head.appendChild(style);
}
