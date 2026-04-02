import { TabContainer } from './components/tab-container.js';
import { call } from './tauri-api.js';
import { openSettingsModal, checkFirstRun } from './tabs/settings.js';

const TABS = [
  { id: 'shortcuts', label: 'Shortcuts', icon: '\u{1F4CB}', loader: (el) => import('./tabs/shortcuts.js').then(m => m.init(el)) },
  { id: 'notes',     label: 'Notes',     icon: '\u{1F4DD}', loader: (el) => import('./tabs/notes.js').then(m => m.init(el)) },
  { id: 'sql',       label: 'SQL',       icon: '\u{1F5C3}', loader: (el) => import('./tabs/sql/sql-main.js').then(m => m.init(el)) },
  { id: 'superset',  label: 'Superset',  icon: '\u{1F4CA}', loader: (el) => import('./tabs/superset/superset-main.js').then(m => m.init(el)) },
  { id: 'commits',   label: 'Commits',   icon: '\u{1F4BE}', loader: (el) => import('./tabs/commits.js').then(m => m.init(el)) },
  { id: 'exec',      label: 'Exec',      icon: '\u26A1',    loader: (el) => import('./tabs/exec.js').then(m => m.init(el)) },
];

async function main() {
  // First-run check
  await checkFirstRun();

  const app = document.getElementById('app');
  app.innerHTML = '';
  const tabContainer = new TabContainer(app, TABS);

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

  let lastTab = 'shortcuts';
  try {
    const saved = await call('get_setting', { key: 'last_active_tab' });
    if (saved) lastTab = saved;
  } catch {}

  await tabContainer.activate(lastTab);

  const origActivate = tabContainer.activate.bind(tabContainer);
  tabContainer.activate = async (tabId) => {
    await origActivate(tabId);
    call('set_setting', { key: 'last_active_tab', value: tabId }).catch(() => {});
  };
}

document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    // Don't hide if a modal is open -- modal handles its own Escape
    if (document.querySelector('.modal-overlay')) return;
    const { invoke } = window.__TAURI__.core;
    await invoke('hide_and_sync');
  }
});

async function checkForUpdates() {
  try {
    const { check } = window.__TAURI__.updater;
    const update = await check();
    if (update) {
      const { showToast } = await import('./components/toast.js');
      showToast(`Update ${update.version} available. Installing...`, 'info');
      await update.downloadAndInstall();
      const { relaunch } = window.__TAURI__.process;
      await relaunch();
    }
  } catch (e) {
    console.log('Update check:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  main();
  // Check for updates 5 seconds after launch
  setTimeout(checkForUpdates, 5000);
});
