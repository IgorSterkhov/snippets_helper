import { call } from './tauri-api.js';

// ── Sync Log ───────────────────────────────────────────────────

const syncLog = []; // max 20 entries
let syncIndicatorEl = null;
let syncPopupEl = null;

/**
 * Initialize the sync indicator in the sidebar.
 * Call after the Help button has been appended to tabBar.
 */
export function initSyncIndicator(tabBar) {
  const indicator = document.createElement('div');
  indicator.id = 'sync-indicator';
  indicator.title = 'Sync status';
  indicator.textContent = '\u23F8'; // paused
  indicator.addEventListener('click', toggleSyncPopup);
  tabBar.appendChild(indicator);
  syncIndicatorEl = indicator;

  // Close popup on outside click
  document.addEventListener('click', (e) => {
    if (syncPopupEl && !syncPopupEl.contains(e.target) && e.target !== syncIndicatorEl) {
      closeSyncPopup();
    }
  });

  injectSyncStyles();
}

// ── Status updates ─────────────────────────────────────────────

/** Update the indicator icon/color based on state */
export function updateSyncStatus(status) {
  if (!syncIndicatorEl) return;
  syncIndicatorEl.classList.remove('sync-ok', 'sync-error', 'sync-syncing', 'sync-paused');
  switch (status) {
    case 'syncing':
      syncIndicatorEl.textContent = '\uD83D\uDD04'; // 🔄
      syncIndicatorEl.classList.add('sync-syncing');
      syncIndicatorEl.title = 'Syncing...';
      break;
    case 'ok':
      syncIndicatorEl.textContent = '\u2705'; // ✅
      syncIndicatorEl.classList.add('sync-ok');
      syncIndicatorEl.title = 'Last sync successful';
      break;
    case 'error':
      syncIndicatorEl.textContent = '\u274C'; // ❌
      syncIndicatorEl.classList.add('sync-error');
      syncIndicatorEl.title = 'Sync error';
      break;
    default:
      syncIndicatorEl.textContent = '\u23F8'; // ⏸
      syncIndicatorEl.classList.add('sync-paused');
      syncIndicatorEl.title = 'Sync not configured';
      break;
  }
}

// ── Log entries ────────────────────────────────────────────────

export function addSyncLogEntry(entry) {
  syncLog.unshift(entry);
  if (syncLog.length > 20) syncLog.pop();
  // If popup is open, refresh it
  if (syncPopupEl) renderSyncPopup();
}

// ── doSync — central sync function ────────────────────────────

export async function doSync() {
  updateSyncStatus('syncing');
  try {
    const result = await call('trigger_sync');
    addSyncLogEntry({
      timestamp: result.timestamp || new Date().toLocaleTimeString(),
      type: 'success',
      push: result.push,
      pull: result.pull,
    });
    updateSyncStatus('ok');
    return result;
  } catch (err) {
    const errMsg = String(err);
    // "sync_api_url not configured" is not really an error — just means sync is off
    if (errMsg.includes('not configured')) {
      updateSyncStatus('paused');
    } else {
      addSyncLogEntry({
        timestamp: new Date().toLocaleTimeString(),
        type: 'error',
        message: errMsg,
      });
      updateSyncStatus('error');
    }
    throw err;
  }
}

// ── Popup ──────────────────────────────────────────────────────

function toggleSyncPopup() {
  if (syncPopupEl) {
    closeSyncPopup();
  } else {
    openSyncPopup();
  }
}

function openSyncPopup() {
  closeSyncPopup();
  const popup = document.createElement('div');
  popup.className = 'sync-popup';
  syncPopupEl = popup;
  renderSyncPopup();

  // Position near the indicator
  document.body.appendChild(popup);
  positionPopup();
}

function positionPopup() {
  if (!syncPopupEl || !syncIndicatorEl) return;
  const rect = syncIndicatorEl.getBoundingClientRect();
  syncPopupEl.style.left = (rect.right + 8) + 'px';
  syncPopupEl.style.bottom = (window.innerHeight - rect.bottom) + 'px';
}

function closeSyncPopup() {
  if (syncPopupEl) {
    syncPopupEl.remove();
    syncPopupEl = null;
  }
}

function renderSyncPopup() {
  if (!syncPopupEl) return;
  syncPopupEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'sync-popup-header';
  header.textContent = 'Sync Log';
  syncPopupEl.appendChild(header);

  if (syncLog.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sync-popup-empty';
    empty.textContent = 'No sync events yet';
    syncPopupEl.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'sync-popup-list';

  for (const entry of syncLog) {
    const item = document.createElement('div');
    item.className = 'sync-popup-item';

    const line = document.createElement('div');
    line.className = 'sync-popup-line';

    const ts = document.createElement('span');
    ts.className = 'sync-popup-ts';
    ts.textContent = '[' + entry.timestamp + ']';
    line.appendChild(ts);

    if (entry.type === 'error') {
      const icon = document.createElement('span');
      icon.className = 'sync-popup-icon sync-popup-icon-error';
      icon.textContent = ' \u274C ';
      line.appendChild(icon);

      const msg = document.createElement('span');
      msg.textContent = 'Error: ' + (entry.message || 'unknown');
      line.appendChild(msg);
    } else {
      // success
      const pushTotal = entry.push?.total || 0;
      const pullTotal = entry.pull?.total || 0;

      if (pushTotal === 0 && pullTotal === 0) {
        const icon = document.createElement('span');
        icon.className = 'sync-popup-icon sync-popup-icon-info';
        icon.textContent = ' \u2139\uFE0F ';
        line.appendChild(icon);
        const msg = document.createElement('span');
        msg.textContent = 'Nothing to sync';
        line.appendChild(msg);
      } else {
        const icon = document.createElement('span');
        icon.className = 'sync-popup-icon sync-popup-icon-ok';
        icon.textContent = ' \u2705 ';
        line.appendChild(icon);

        const parts = [];
        if (pushTotal > 0) parts.push('Push: ' + formatSyncDetails(entry.push.pushed));
        if (pullTotal > 0) parts.push('Pull: ' + formatSyncDetails(entry.pull.pulled));
        const msg = document.createElement('span');
        msg.textContent = parts.join(' | ');
        line.appendChild(msg);
      }

      // Expandable details
      if (pushTotal > 0 || pullTotal > 0) {
        item.style.cursor = 'pointer';
        const details = document.createElement('div');
        details.className = 'sync-popup-details';
        details.style.display = 'none';

        if (pushTotal > 0) {
          details.appendChild(makeDetailsBlock('Pushed', entry.push.pushed));
        }
        if (pullTotal > 0) {
          details.appendChild(makeDetailsBlock('Pulled', entry.pull.pulled));
        }

        item.addEventListener('click', () => {
          details.style.display = details.style.display === 'none' ? 'block' : 'none';
        });

        item.appendChild(line);
        item.appendChild(details);
        list.appendChild(item);
        continue;
      }
    }

    item.appendChild(line);
    list.appendChild(item);
  }

  syncPopupEl.appendChild(list);
}

function formatSyncDetails(dataMap) {
  if (!dataMap) return '';
  const parts = [];
  for (const [table, names] of Object.entries(dataMap)) {
    parts.push(table + ' +' + names.length);
  }
  return parts.join(', ');
}

function makeDetailsBlock(label, dataMap) {
  const block = document.createElement('div');
  block.className = 'sync-popup-detail-block';
  for (const [table, names] of Object.entries(dataMap)) {
    const line = document.createElement('div');
    line.className = 'sync-popup-detail-line';
    const MAX_SHOW = 5;
    const shown = names.slice(0, MAX_SHOW).join(', ');
    const extra = names.length > MAX_SHOW ? ' [+' + (names.length - MAX_SHOW) + ' more]' : '';
    line.textContent = '\u2514 ' + table + ': ' + shown + extra;
    block.appendChild(line);
  }
  return block;
}

// ── Styles ─────────────────────────────────────────────────────

let syncStylesInjected = false;

function injectSyncStyles() {
  if (syncStylesInjected) return;
  syncStylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
#sync-indicator {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  cursor: pointer;
  border-radius: 6px;
  position: relative;
  transition: background 0.15s;
  user-select: none;
}
#sync-indicator:hover {
  background: var(--bg-secondary);
}
#sync-indicator.sync-paused {
  color: var(--text-muted);
}
#sync-indicator.sync-syncing {
  color: var(--accent);
  animation: sync-spin 1s linear infinite;
}
#sync-indicator.sync-ok {
  color: var(--success);
}
#sync-indicator.sync-error {
  color: var(--danger);
}
@keyframes sync-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.sync-popup {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 380px;
  max-height: 340px;
  display: flex;
  flex-direction: column;
  z-index: 1500;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  font-size: 12px;
}
.sync-popup-header {
  padding: 10px 14px 8px;
  font-weight: 600;
  font-size: 13px;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.sync-popup-empty {
  padding: 20px 14px;
  color: var(--text-muted);
  text-align: center;
}
.sync-popup-list {
  overflow-y: auto;
  flex: 1;
  padding: 6px 0;
}
.sync-popup-item {
  padding: 4px 14px;
  border-bottom: 1px solid var(--border);
}
.sync-popup-item:last-child {
  border-bottom: none;
}
.sync-popup-line {
  display: flex;
  align-items: center;
  gap: 4px;
  line-height: 1.5;
  color: var(--text);
}
.sync-popup-ts {
  color: var(--text-muted);
  font-family: 'Consolas', 'Monaco', monospace;
  flex-shrink: 0;
}
.sync-popup-icon {
  flex-shrink: 0;
}
.sync-popup-icon-ok { color: var(--success); }
.sync-popup-icon-error { color: var(--danger); }
.sync-popup-icon-info { color: var(--text-muted); }
.sync-popup-details {
  padding: 4px 0 2px 20px;
}
.sync-popup-detail-block {
  margin-bottom: 2px;
}
.sync-popup-detail-line {
  color: var(--text-muted);
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11px;
  line-height: 1.4;
}
`;
  document.head.appendChild(style);
}
