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

  const helpBtn = document.createElement('button');
  helpBtn.className = 'tab-btn';
  helpBtn.title = 'Help';
  helpBtn.innerHTML = '<span class="tab-icon">?</span><span class="tab-label">Help</span>';
  helpBtn.addEventListener('click', async () => {
    const { openHelpModal } = await import('./tabs/help.js');
    openHelpModal();
  });
  tabContainer.tabBar.appendChild(helpBtn);

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

async function showUpdateBanner() {
  try {
    const autoUpdate = await call('get_setting', { key: 'auto_update_enabled' });
    if (autoUpdate !== '1') return;
    const info = await call('check_for_update');
    if (info.has_update) {
      // Insert banner before #app, not inside it
      const banner = document.createElement('div');
      banner.className = 'update-banner';
      const text = document.createTextNode(`New version ${info.latest_version} available! `);
      const link = document.createElement('a');
      link.textContent = 'Download';
      link.href = '#';
      link.style.cssText = 'color:white;text-decoration:underline;cursor:pointer';
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        try { await call('open_url', { url: info.download_url }); } catch {}
      });
      const closeBtn = document.createElement('span');
      closeBtn.textContent = ' ✕';
      closeBtn.style.cssText = 'cursor:pointer;margin-left:12px;opacity:0.7';
      closeBtn.addEventListener('click', () => banner.remove());
      banner.appendChild(text);
      banner.appendChild(link);
      banner.appendChild(closeBtn);
      document.body.insertBefore(banner, document.body.firstChild);
    }
  } catch (e) {
    console.log('Update check:', e);
  }
}

// Sync when window becomes visible (focus)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    call('trigger_sync').catch(() => {});
  }
});

document.addEventListener('DOMContentLoaded', () => {
  main();
  // Initial sync on launch
  setTimeout(() => call('trigger_sync').catch(() => {}), 1000);
  // Check for updates 3 seconds after launch
  setTimeout(showUpdateBanner, 3000);
});
