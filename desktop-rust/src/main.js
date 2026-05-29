import { TabContainer } from './components/tab-container.js';
import { call } from './tauri-api.js';
import { openSettingsModal, checkFirstRun } from './tabs/settings.js';
import { createStatusBar, doSync, checkUpdateStatus, checkFrontendUpdateStatus, startFrontendUpdateWatcher } from './components/status-bar.js';
import { showToast } from './components/toast.js';

const TABS = [
  { id: 'shortcuts', label: 'Shortcuts', icon: '\u{1F3F7}\u{FE0F}', loader: (el) => import('./tabs/shortcuts.js').then(m => m.init(el)) },
  { id: 'notes',     label: 'Notes',     icon: '\u{1F5D2}\u{FE0F}', loader: (el) => import('./tabs/notes.js').then(m => m.init(el)) },
  { id: 'tasks',     label: 'Tasks',     icon: '✅',    loader: (el) => import('./tabs/tasks/index.js').then(m => m.init(el)) },
  { id: 'sql',       label: 'SQL',       icon: '\u{1F5C3}', loader: (el) => import('./tabs/sql/sql-main.js').then(m => m.init(el)) },
  { id: 'superset',  label: 'Superset',  icon: 'logo:apachesuperset', loader: (el) => import('./tabs/superset/superset-main.js').then(m => m.init(el)) },
  { id: 'commits',   label: 'Commits',   icon: '\u{1F500}', loader: (el) => import('./tabs/commits.js').then(m => m.init(el)) },
  { id: 'exec',      label: 'Exec',      icon: '\u26A1',    loader: (el) => import('./tabs/exec.js').then(m => m.init(el)) },
  { id: 'repo-search', label: 'Search', icon: '\uD83D\uDD0D', loader: (el) => import('./tabs/repo-search.js').then(m => m.init(el)) },
  { id: 'vps', label: 'VPS', icon: '\uD83D\uDDA5', loader: (el) => import('./tabs/vps.js').then(m => m.init(el)) },
  { id: 'whisper', label: 'Whisper', icon: '🎤', loader: (el) => import('./tabs/whisper/whisper-main.js').then(m => m.init(el)) },
];

function getStandaloneRequest() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('standalone') !== '1') {
    return { standalone: false, moduleId: '', tab: null };
  }
  const moduleId = params.get('module') || '';
  const tab = TABS.find(t => t.id === moduleId) || null;
  return { standalone: true, moduleId, tab };
}

function closeModuleContextMenu() {
  document.querySelector('.module-context-menu')?.remove();
}

function positionModuleContextMenu(menu, event) {
  const margin = 8;
  const rect = menu.getBoundingClientRect();
  const left = Math.min(
    Math.max(margin, event.clientX),
    Math.max(margin, window.innerWidth - rect.width - margin),
  );
  const top = Math.min(
    Math.max(margin, event.clientY),
    Math.max(margin, window.innerHeight - rect.height - margin),
  );
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function showModuleContextMenu(event, tab) {
  event.preventDefault();
  closeModuleContextMenu();

  const menu = document.createElement('div');
  menu.className = 'module-context-menu';
  menu.innerHTML = '<button type="button" data-action="open-module-window">Open in separate window</button>';
  menu.querySelector('[data-action="open-module-window"]').addEventListener('click', async () => {
    closeModuleContextMenu();
    try {
      await call('open_module_window', { moduleId: tab.id });
    } catch (err) {
      showToast(`Failed to open module window: ${err}`, 'error');
    }
  });
  document.body.appendChild(menu);
  positionModuleContextMenu(menu, event);
}

async function mountStandaloneModule(app, request) {
  document.body.classList.add('standalone-module-window');
  app.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'tab-panel standalone-module-panel';

  if (!request.tab) {
    panel.id = 'panel-standalone-error';
    panel.innerHTML = '<div class="loading">Unsupported module window</div>';
    app.appendChild(panel);
    setTimeout(() => call('confirm_frontend_boot').catch(() => {}), 5000);
    return;
  }

  panel.id = `panel-${request.moduleId}`;
  panel.innerHTML = '<div class="loading">Loading...</div>';
  app.appendChild(panel);

  try {
    await request.tab.loader(panel);
  } catch (err) {
    console.error(`Failed to load standalone module "${request.moduleId}":`, err);
    panel.innerHTML = '<div class="loading">Failed to load module</div>';
  }

  setTimeout(() => call('confirm_frontend_boot').catch(() => {}), 5000);
}

async function main() {
  const app = document.getElementById('app');
  const standaloneRequest = getStandaloneRequest();
  if (standaloneRequest.standalone) {
    await mountStandaloneModule(app, standaloneRequest);
    return;
  }

  // First-run check
  await checkFirstRun();

  app.innerHTML = '';
  const tabContainer = new TabContainer(app, TABS);
  for (const tab of TABS) {
    const btn = tabContainer.buttons[tab.id];
    if (btn) {
      btn.addEventListener('contextmenu', (event) => showModuleContextMenu(event, tab));
    }
  }
  document.addEventListener('click', closeModuleContextMenu);
  window.addEventListener('blur', closeModuleContextMenu);

  // Add settings button at the bottom of the sidebar
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  tabContainer.tabBar.appendChild(spacer);

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'tab-btn';
  settingsBtn.title = 'Settings';
  settingsBtn.innerHTML = '<span class="tab-icon">\u2699</span><span class="tab-label">Settings</span>';
  settingsBtn.addEventListener('click', () => openSettingsModal());
  tabContainer.tabBar.appendChild(settingsBtn);

  const helpBtn = document.createElement('button');
  helpBtn.className = 'tab-btn';
  helpBtn.title = 'Help';
  helpBtn.innerHTML = '<span class="tab-icon">?</span><span class="tab-label">Help</span>';
  helpBtn.addEventListener('click', async () => {
    const { openHelpModal } = await import('./tabs/help.js');
    openHelpModal();
  });
  tabContainer.tabBar.appendChild(helpBtn);

  // Status bar (bottom of window)
  createStatusBar();

  // Apply global font size
  try {
    const fs = await call('get_setting', { key: 'font_size' });
    if (fs) document.getElementById('app').style.fontSize = fs + 'px';
  } catch {}

  let lastTab = 'shortcuts';
  try {
    const saved = await call('get_setting', { key: 'last_active_tab' });
    if (saved) lastTab = saved;
  } catch {}

  await tabContainer.activate(lastTab);

  let repoSearchTimer = null;
  const origActivate = tabContainer.activate.bind(tabContainer);
  tabContainer.activate = async (tabId) => {
    // If switching away from repo-search, start unload timer
    if (tabContainer.activeTabId === 'repo-search' && tabId !== 'repo-search') {
      const timeout = parseInt(await call('get_setting', { key: 'repo_search_unload_minutes' }).catch(() => '10')) || 10;
      repoSearchTimer = setTimeout(async () => {
        try {
          const { destroy } = await import('./tabs/repo-search.js');
          destroy();
        } catch {}
        tabContainer.loadedTabs.delete('repo-search');
        const panel = tabContainer.panels['repo-search'];
        if (panel) panel.innerHTML = '<div class="loading">Loading...</div>';
      }, timeout * 60 * 1000);
    }
    // If switching to repo-search, cancel unload timer
    if (tabId === 'repo-search' && repoSearchTimer) {
      clearTimeout(repoSearchTimer);
      repoSearchTimer = null;
    }
    await origActivate(tabId);
    call('set_setting', { key: 'last_active_tab', value: tabId }).catch(() => {});
  };
}

document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    if (document.body.classList.contains('standalone-module-window')) return;
    // Don't hide if a modal is open -- modal handles its own Escape
    if (document.querySelector('.modal-overlay')) return;
    const { invoke } = window.__TAURI__.core;
    await invoke('hide_and_sync');
  }
});

// Sync when window becomes visible
document.addEventListener('visibilitychange', () => {
  if (getStandaloneRequest().standalone) return;
  if (document.visibilityState === 'visible') {
    doSync().catch(() => {});
  }
});

document.addEventListener('DOMContentLoaded', () => {
  console.log('[keyboard-helper] frontend loaded @', new Date().toISOString());
  const standalone = getStandaloneRequest().standalone;
  main();
  if (standalone) return;
  // Initial sync on launch
  setTimeout(() => doSync().catch(() => {}), 1000);
  // Confirm the frontend booted successfully so the Rust watchdog
  // doesn't auto-rollback a just-applied OTA update. 5s gives tabs
  // and invoke round-trips time to settle.
  setTimeout(() => call('confirm_frontend_boot').catch(() => {}), 5000);
  // Check for updates via status bar
  setTimeout(() => checkUpdateStatus().catch(() => {}), 3000);
  setTimeout(() => checkFrontendUpdateStatus().catch(() => {}), 4000);
  startFrontendUpdateWatcher();
});
