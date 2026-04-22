import { call } from '../tauri-api.js';
import { showToast } from '../components/toast.js';
import { doSync } from '../components/status-bar.js';
import { qrcode } from '../lib/qrcode.js';

let root = null;
let activeSubTab = 'general';

const SUB_TABS = [
  { id: 'general',    label: 'General' },
  { id: 'shortcuts',  label: 'Shortcuts' },
  { id: 'analyzer',   label: 'SQL Analyzer' },
  { id: 'commits',    label: 'Commits' },
  { id: 'formatter',  label: 'SQL Formatter' },
  { id: 'sync',       label: 'Sync' },
  { id: 'updates',    label: 'Updates' },
];

// ── Public API ────────────────────────────────────────────────

export function openSettingsModal() {
  // Prevent duplicate modals
  if (document.querySelector('.settings-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay settings-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal settings-modal';

  // Header
  const header = el('div', { class: 'settings-header' });
  header.appendChild(el('h3', { text: 'Settings' }));
  const closeBtn = el('button', { text: '\u2715', class: 'btn-secondary settings-close-btn' });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Tab strip
  const tabStrip = el('div', { class: 'settings-tab-strip' });
  for (const tab of SUB_TABS) {
    const btn = el('button', {
      text: tab.label,
      class: 'settings-tab-btn' + (tab.id === activeSubTab ? ' active' : ''),
    });
    btn.dataset.tabId = tab.id;
    btn.addEventListener('click', () => {
      activeSubTab = tab.id;
      tabStrip.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderSubTab(body);
    });
    tabStrip.appendChild(btn);
  }
  modal.appendChild(tabStrip);

  // Body
  const body = el('div', { class: 'settings-body' });
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Add scoped styles
  injectStyles();

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Close on Escape (capture so it fires before the global handler)
  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    }
  }
  document.addEventListener('keydown', onKey, true);

  renderSubTab(body);
}

// ── Sub-tab rendering ─────────────────────────────────────────

async function renderSubTab(container) {
  container.innerHTML = '<div class="loading">Loading...</div>';
  try {
    switch (activeSubTab) {
      case 'general':   await renderGeneral(container);   break;
      case 'shortcuts': await renderShortcuts(container);  break;
      case 'analyzer':  await renderAnalyzer(container);   break;
      case 'commits':   await renderCommits(container);    break;
      case 'formatter': await renderFormatter(container);  break;
      case 'sync':      await renderSync(container);       break;
      case 'updates':   await renderUpdates(container);    break;
    }
  } catch (err) {
    container.innerHTML = '';
    container.appendChild(el('p', { text: 'Error loading settings: ' + err }));
  }
}

// ── General ───────────────────────────────────────────────────

async function renderGeneral(container) {
  container.innerHTML = '';

  const hotkeyMode = await getSetting('hotkey_mode') || 'alt_space';
  const fontSize = await getSetting('font_size') || '14';
  let autostartEnabled = false;
  try { autostartEnabled = await call('get_autostart'); } catch {}

  // Hotkey mode
  const hotkeyRow = makeFormRow('Hotkey mode:');
  const hotkeySelect = document.createElement('select');
  hotkeySelect.className = 'settings-input';
  for (const opt of ['alt_space', 'ctrl_space', 'ctrl_shift_space', 'ctrl_backtick']) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt.replace(/_/g, ' + ');
    if (opt === hotkeyMode) o.selected = true;
    hotkeySelect.appendChild(o);
  }
  hotkeySelect.addEventListener('change', () => saveSetting('hotkey_mode', hotkeySelect.value));
  hotkeyRow.appendChild(hotkeySelect);
  container.appendChild(hotkeyRow);

  // Font size
  const fontRow = makeFormRow('Font size:');
  const fontInput = document.createElement('input');
  fontInput.type = 'number';
  fontInput.className = 'settings-input';
  fontInput.min = '10';
  fontInput.max = '24';
  fontInput.value = fontSize;
  fontInput.style.width = '80px';
  fontInput.addEventListener('change', () => saveSetting('font_size', fontInput.value));
  fontRow.appendChild(fontInput);
  container.appendChild(fontRow);

  // Language
  const langRow = makeFormRow('Language:');
  const langSelect = document.createElement('select');
  langSelect.className = 'settings-input';
  langSelect.innerHTML = '<option value="en">English</option><option value="ru">Русский</option>';
  langSelect.value = await getSetting('ui_language') || 'en';
  langSelect.addEventListener('change', () => saveSetting('ui_language', langSelect.value));
  langRow.appendChild(langSelect);
  container.appendChild(langRow);

  // Obsidian vaults path
  const obsRow = makeFormRow('Obsidian vaults:');
  const obsInput = document.createElement('input');
  obsInput.className = 'settings-input';
  obsInput.placeholder = '/path/to/obsidian/vaults';
  obsInput.style.flex = '1';
  obsInput.value = await getSetting('obsidian_vaults_path') || '';
  obsInput.addEventListener('change', () => saveSetting('obsidian_vaults_path', obsInput.value));
  obsRow.appendChild(obsInput);
  container.appendChild(obsRow);

  // Autostart
  const autoRow = makeFormRow('Autostart:');
  const autoCb = document.createElement('input');
  autoCb.type = 'checkbox';
  autoCb.checked = autostartEnabled;
  autoCb.addEventListener('change', async () => {
    try {
      await call('set_autostart', { enabled: autoCb.checked });
      showToast('Autostart ' + (autoCb.checked ? 'enabled' : 'disabled'), 'success');
    } catch (err) {
      showToast('Failed to set autostart: ' + err, 'error');
      autoCb.checked = !autoCb.checked;
    }
  });
  autoRow.appendChild(autoCb);
  container.appendChild(autoRow);

  // Search tab unload timeout
  const unloadRow = makeFormRow('Search tab unload (min):');
  const unloadInput = document.createElement('input');
  unloadInput.type = 'number';
  unloadInput.className = 'settings-input';
  unloadInput.min = '1';
  unloadInput.max = '60';
  unloadInput.value = await getSetting('repo_search_unload_minutes') || '10';
  unloadInput.style.width = '80px';
  unloadInput.addEventListener('change', () => saveSetting('repo_search_unload_minutes', unloadInput.value));
  unloadRow.appendChild(unloadInput);
  container.appendChild(unloadRow);

  // Search context lines
  const ctxRow = makeFormRow('Search context lines:');
  const ctxInput = document.createElement('input');
  ctxInput.type = 'number';
  ctxInput.className = 'settings-input';
  ctxInput.min = '0';
  ctxInput.max = '10';
  ctxInput.value = await getSetting('search_context_lines') || '3';
  ctxInput.style.width = '80px';
  ctxInput.addEventListener('change', () => saveSetting('search_context_lines', ctxInput.value));
  ctxRow.appendChild(ctxInput);
  container.appendChild(ctxRow);

  // Always on top
  const aotRow = makeFormRow('Always on top:');
  const aotCb = document.createElement('input');
  aotCb.type = 'checkbox';
  const aotVal = await getSetting('always_on_top');
  aotCb.checked = aotVal !== '0'; // default true
  aotCb.addEventListener('change', async () => {
    await saveSetting('always_on_top', aotCb.checked ? '1' : '0');
    try {
      await call('set_always_on_top', { enabled: aotCb.checked });
    } catch (err) {
      showToast('Failed to set always on top: ' + err, 'error');
    }
  });
  aotRow.appendChild(aotCb);
  container.appendChild(aotRow);

  // Editor command template
  const editorRow = makeFormRow('Editor command template:');
  const editorInput = document.createElement('input');
  editorInput.type = 'text';
  editorInput.className = 'settings-input';
  editorInput.placeholder = 'code {path}:{line}';
  editorInput.style.flex = '1';
  editorInput.value = (await getSetting('editor_command')) || '';
  editorInput.addEventListener('change', () => saveSetting('editor_command', editorInput.value));
  editorRow.appendChild(editorInput);
  container.appendChild(editorRow);

  const editorHelp = document.createElement('p');
  editorHelp.className = 'settings-help';
  editorHelp.style.cssText = 'font-size:11px;color:var(--text-muted);margin:4px 0 12px';
  editorHelp.innerHTML = 'Examples: <code>code {path}:{line}</code>, <code>cursor {path}</code>, <code>subl {path}:{line}</code>, <code>pycharm {path}</code>. The <code>{path}</code> and <code>{line}</code> placeholders are substituted when opening a file.';
  container.appendChild(editorHelp);
}

// ── Shortcuts settings ────────────────────────────────────────

async function renderShortcuts(container) {
  container.innerHTML = '';

  const listFontSize = await getSetting('shortcuts_font_size') || '13';
  const leftPanelWidth = await getSetting('shortcuts_left_width') || '300';

  const fontRow = makeFormRow('List font size:');
  const fontInput = document.createElement('input');
  fontInput.type = 'number';
  fontInput.className = 'settings-input';
  fontInput.min = '10';
  fontInput.max = '24';
  fontInput.value = listFontSize;
  fontInput.style.width = '80px';
  fontInput.addEventListener('change', () => saveSetting('shortcuts_font_size', fontInput.value));
  fontRow.appendChild(fontInput);
  container.appendChild(fontRow);

  const widthRow = makeFormRow('Left panel width:');
  const widthInput = document.createElement('input');
  widthInput.type = 'number';
  widthInput.className = 'settings-input';
  widthInput.min = '150';
  widthInput.max = '800';
  widthInput.value = leftPanelWidth;
  widthInput.style.width = '100px';
  widthInput.addEventListener('change', () => saveSetting('shortcuts_left_width', widthInput.value));
  widthRow.appendChild(widthInput);
  container.appendChild(widthRow);

  // Expand preview multiplier
  const expandVal = await getSetting('snippet_expand_multiplier') || '4';
  const expandRow = makeFormRow('Card expand height (x):');
  const expandInput = document.createElement('input');
  expandInput.type = 'number';
  expandInput.className = 'settings-input';
  expandInput.min = '2';
  expandInput.max = '10';
  expandInput.value = expandVal;
  expandInput.style.width = '80px';
  expandInput.addEventListener('change', () => saveSetting('snippet_expand_multiplier', expandInput.value));
  expandRow.appendChild(expandInput);
  container.appendChild(expandRow);
}

// ── SQL Table Analyzer ────────────────────────────────────────

async function renderAnalyzer(container) {
  container.innerHTML = '';

  const fmtVertical = await getSetting('analyzer_format_vertical') || '0';

  const fmtRow = makeFormRow('Format vertical:');
  const fmtCb = document.createElement('input');
  fmtCb.type = 'checkbox';
  fmtCb.checked = fmtVertical === '1';
  fmtCb.addEventListener('change', () => saveSetting('analyzer_format_vertical', fmtCb.checked ? '1' : '0'));
  fmtRow.appendChild(fmtCb);
  container.appendChild(fmtRow);

  // Templates list (read-only display)
  container.appendChild(el('label', { text: 'Analyzer templates:', class: 'settings-label', style: 'margin-top:12px' }));
  try {
    const templates = await call('list_analyzer_templates');
    if (templates && templates.length) {
      const list = el('div', { class: 'settings-tag-list' });
      for (const t of templates) {
        const item = el('div', { class: 'settings-tag-item' });
        item.appendChild(el('span', { text: t.name || t.template_name || JSON.stringify(t) }));
        list.appendChild(item);
      }
      container.appendChild(list);
    } else {
      container.appendChild(el('p', { text: 'No templates configured.' }));
    }
  } catch {
    container.appendChild(el('p', { text: 'Could not load templates.' }));
  }
}

// ── Commits (tag management) ──────────────────────────────────

async function renderCommits(container) {
  container.innerHTML = '';

  container.appendChild(el('label', { text: 'Commit tags:', class: 'settings-label' }));

  let tags = [];
  try {
    const computerId = await getComputerId();
    tags = await call('list_commit_tags', { computerId });
  } catch {}

  const list = el('div', { class: 'settings-tag-list' });
  for (const t of tags) {
    const item = el('div', { class: 'settings-tag-item' });
    item.appendChild(el('span', { text: t.tag_name + (t.is_default ? ' (default)' : '') }));
    const delBtn = el('button', { text: '\u2715', class: 'btn-danger btn-small' });
    delBtn.addEventListener('click', async () => {
      try {
        await call('delete_commit_tag', { id: t.id });
        showToast('Tag deleted', 'success');
        renderCommits(container);
      } catch (err) {
        showToast('Error: ' + err, 'error');
      }
    });
    item.appendChild(delBtn);
    list.appendChild(item);
  }
  container.appendChild(list);

  // Add tag form
  const addRow = el('div', { class: 'settings-add-row' });
  const tagInput = document.createElement('input');
  tagInput.className = 'settings-input';
  tagInput.placeholder = 'New tag name';
  tagInput.style.flex = '1';
  addRow.appendChild(tagInput);

  const defaultCb = document.createElement('input');
  defaultCb.type = 'checkbox';
  defaultCb.title = 'Default';
  const defaultLabel = el('label', { text: ' Default', class: 'settings-inline-label' });
  defaultLabel.prepend(defaultCb);
  addRow.appendChild(defaultLabel);

  const addBtn = el('button', { text: 'Add' });
  addBtn.addEventListener('click', async () => {
    const name = tagInput.value.trim();
    if (!name) return;
    try {
      const computerId = await getComputerId();
      await call('create_commit_tag', { computerId, tagName: name, isDefault: defaultCb.checked });
      showToast('Tag created', 'success');
      renderCommits(container);
    } catch (err) {
      showToast('Error: ' + err, 'error');
    }
  });
  addRow.appendChild(addBtn);
  container.appendChild(addRow);
}

// ── SQL Formatter ─────────────────────────────────────────────

async function renderFormatter(container) {
  container.innerHTML = '';

  const customFns = await getSetting('ch_custom_functions') || '';

  container.appendChild(el('label', { text: 'ClickHouse custom functions (one per line):', class: 'settings-label' }));
  const ta = document.createElement('textarea');
  ta.className = 'settings-textarea';
  ta.rows = 10;
  ta.value = customFns;
  ta.placeholder = 'dictGet\narrayJoin\ntoStartOfMonth';
  ta.addEventListener('change', () => saveSetting('ch_custom_functions', ta.value));
  container.appendChild(ta);
}

// ── Sync ──────────────────────────────────────────────────────

async function renderSync(container) {
  container.innerHTML = '';

  const apiUrl = await getSetting('sync_api_url') || '';
  const apiKey = await getSetting('sync_api_key') || '';
  const caCert = await getSetting('sync_ca_cert') || '';
  const syncEnabled = await getSetting('sync_enabled') || '1';

  // Enable/disable
  const enableRow = makeFormRow('Sync enabled:');
  const enableCb = document.createElement('input');
  enableCb.type = 'checkbox';
  enableCb.checked = syncEnabled === '1';
  enableCb.addEventListener('change', () => saveSetting('sync_enabled', enableCb.checked ? '1' : '0'));
  enableRow.appendChild(enableCb);
  container.appendChild(enableRow);

  // API URL
  const urlRow = makeFormRow('API URL:');
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.className = 'settings-input';
  urlInput.value = apiUrl;
  urlInput.placeholder = 'https://sync.example.com/api';
  urlInput.style.flex = '1';
  urlInput.addEventListener('change', () => saveSetting('sync_api_url', urlInput.value));
  urlRow.appendChild(urlInput);
  container.appendChild(urlRow);

  // CA cert path
  const certRow = makeFormRow('CA cert path:');
  const certInput = document.createElement('input');
  certInput.type = 'text';
  certInput.className = 'settings-input';
  certInput.value = caCert;
  certInput.placeholder = '/path/to/ca.pem';
  certInput.style.flex = '1';
  certInput.addEventListener('change', () => saveSetting('sync_ca_cert', certInput.value));
  certRow.appendChild(certInput);
  container.appendChild(certRow);

  // API key
  const keyRow = makeFormRow('API key:');
  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.className = 'settings-input';
  keyInput.value = apiKey;
  keyInput.placeholder = 'your-api-key';
  keyInput.style.flex = '1';
  keyInput.addEventListener('change', () => saveSetting('sync_api_key', keyInput.value));
  keyRow.appendChild(keyInput);

  const qrBtn = el('button', { text: 'QR', class: 'btn-secondary', title: 'Show QR code for mobile app' });
  qrBtn.style.cssText = 'min-width:auto;padding:6px 12px;font-size:13px';
  qrBtn.addEventListener('click', () => {
    const key = keyInput.value.trim();
    if (!key) { showToast('API key is empty', 'error'); return; }
    showQRModal(key);
  });
  keyRow.appendChild(qrBtn);
  container.appendChild(keyRow);

  // Action buttons
  const actions = el('div', { class: 'settings-actions' });

  const testBtn = el('button', { text: 'Test Connection', class: 'btn-secondary' });
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    try {
      const result = await doSync();
      const pushN = result.push?.total || 0;
      const pullN = result.pull?.total || 0;
      showToast(`Connection OK. Pushed: ${pushN}, Pulled: ${pullN}`, 'success');
    } catch (err) {
      showToast('Connection failed: ' + err, 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
    }
  });
  actions.appendChild(testBtn);

  const registerBtn = el('button', { text: 'Register' });
  registerBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
      showToast('Set API URL first', 'error');
      return;
    }
    registerBtn.disabled = true;
    registerBtn.textContent = 'Registering...';
    try {
      const computerName = await call('get_setting', { key: 'computer_name' }) || 'unknown';
      const data = await call('register_sync', { apiUrl: url, name: computerName });
      if (data.api_key) {
        keyInput.value = data.api_key;
        await saveSetting('sync_api_key', data.api_key);
        showToast('Registered! API key saved.', 'success');
      } else {
        showToast('Registered, but no API key returned.', 'info');
      }
    } catch (err) {
      showToast('Register failed: ' + err, 'error');
    } finally {
      registerBtn.disabled = false;
      registerBtn.textContent = 'Register';
    }
  });
  actions.appendChild(registerBtn);

  container.appendChild(actions);
}

// ── Updates ──────────────────────────────────────────────────

async function renderUpdates(container) {
  container.innerHTML = '';

  const autoUpdateEnabled = await getSetting('auto_update_enabled') || '0';

  // Current version
  const curRow = makeFormRow('Current version:');
  const curLabel = el('span', { text: 'loading...' });
  curRow.appendChild(curLabel);
  container.appendChild(curRow);

  // Latest version
  const latestRow = makeFormRow('Latest version:');
  const latestLabel = el('span', { text: '-' });
  latestRow.appendChild(latestLabel);
  container.appendChild(latestRow);

  // Status text
  const statusRow = el('div', { style: 'margin-bottom:12px;font-size:13px;color:var(--text-muted)' });
  statusRow.textContent = '';
  container.appendChild(statusRow);

  // Auto-update checkbox
  const autoRow = makeFormRow('Auto-update:');
  const autoCb = document.createElement('input');
  autoCb.type = 'checkbox';
  autoCb.checked = autoUpdateEnabled === '1';
  autoCb.addEventListener('change', () => saveSetting('auto_update_enabled', autoCb.checked ? '1' : '0'));
  autoRow.appendChild(autoCb);
  container.appendChild(autoRow);

  // Action buttons
  const actions = el('div', { class: 'settings-actions' });

  const checkBtn = el('button', { text: 'Check for updates', class: 'btn-secondary' });
  const downloadBtn = el('button', { text: 'Download & Install' });
  downloadBtn.style.display = 'none';
  let updateInfo = null;

  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    checkBtn.textContent = 'Checking...';
    statusRow.textContent = '';
    try {
      const info = await call('check_for_update');
      updateInfo = info;
      curLabel.textContent = info.current_version;
      latestLabel.textContent = info.latest_version || '-';
      if (info.has_update) {
        statusRow.textContent = 'A new version is available!';
        downloadBtn.style.display = '';
      } else if (info.build_in_progress) {
        statusRow.textContent = `Version ${info.latest_version} is building... Windows installer not ready yet. Try again in a few minutes.`;
        downloadBtn.style.display = 'none';
      } else {
        statusRow.textContent = 'You are up to date.';
        downloadBtn.style.display = 'none';
      }
    } catch (err) {
      statusRow.textContent = 'Check failed: ' + err;
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check for updates';
    }
  });

  downloadBtn.addEventListener('click', async () => {
    if (updateInfo && updateInfo.download_url) {
      try {
        const { invoke } = window.__TAURI__.core;
        await invoke('open_url', { url: updateInfo.download_url });
      } catch {
        // Fallback: copy URL to clipboard
        await navigator.clipboard.writeText(updateInfo.download_url);
        showToast('URL copied to clipboard. Open in browser.', 'info');
      }
    }
  });

  actions.appendChild(checkBtn);
  actions.appendChild(downloadBtn);
  container.appendChild(actions);

  // Frontend OTA controls
  const feSection = el('div', { style: 'margin-top:16px;padding-top:12px;border-top:1px solid var(--border)' });
  feSection.appendChild(el('label', { text: 'Frontend (hot update)', class: 'settings-label', style: 'display:block;margin-bottom:6px' }));
  const feStatus = el('div', { text: 'Current: -', style: 'font-size:12px;color:var(--text-muted);margin-bottom:8px' });
  feSection.appendChild(feStatus);
  const feRow = el('div', { class: 'settings-row' });
  const feCheckBtn = el('button', { text: 'Check frontend update', class: 'btn-secondary' });
  const feApplyBtn = el('button', { text: 'Apply' });
  feApplyBtn.style.display = 'none';
  const feRevertBtn = el('button', { text: 'Revert to previous', class: 'btn-secondary' });
  feRow.appendChild(feCheckBtn);
  feRow.appendChild(feApplyBtn);
  feRow.appendChild(feRevertBtn);
  feSection.appendChild(feRow);
  container.appendChild(feSection);

  let feInfo = null;

  (async () => {
    try { const v = await call('get_frontend_version'); feStatus.textContent = 'Current: ' + (v || '-'); } catch {}
  })();

  feCheckBtn.addEventListener('click', async () => {
    feCheckBtn.disabled = true;
    feCheckBtn.textContent = 'Checking...';
    try {
      feInfo = await call('check_frontend_update');
      feStatus.textContent = `Current: ${feInfo.current_version} · Latest: ${feInfo.latest_version}`;
      feApplyBtn.style.display = feInfo.has_update ? '' : 'none';
    } catch (e) {
      showToast('Frontend check failed: ' + e, 'error');
    } finally {
      feCheckBtn.disabled = false;
      feCheckBtn.textContent = 'Check frontend update';
    }
  });

  feApplyBtn.addEventListener('click', async () => {
    if (!feInfo || !feInfo.has_update) return;
    feApplyBtn.disabled = true;
    feApplyBtn.textContent = 'Downloading...';
    try {
      await call('download_frontend_update', {
        url: feInfo.url, version: feInfo.latest_version,
        signature: feInfo.signature || '', sha256: feInfo.sha256 || null,
      });
      feApplyBtn.textContent = 'Applying...';
      await call('apply_frontend_update', { version: feInfo.latest_version });
    } catch (e) {
      showToast('Apply failed: ' + e, 'error');
      feApplyBtn.disabled = false;
      feApplyBtn.textContent = 'Apply';
    }
  });

  feRevertBtn.addEventListener('click', async () => {
    feRevertBtn.disabled = true;
    try {
      const prev = await call('revert_frontend');
      showToast('Reverted to ' + prev, 'success');
    } catch (e) {
      showToast(String(e), 'error');
    } finally {
      feRevertBtn.disabled = false;
    }
  });

  // GitHub Token for private repo
  container.appendChild(el('label', { text: 'GitHub Token (for private repos):', class: 'settings-label', style: 'margin-top:16px' }));
  const tokenRow = el('div', { class: 'settings-row' });
  const tokenInput = document.createElement('input');
  tokenInput.className = 'settings-input';
  tokenInput.type = 'password';
  tokenInput.placeholder = 'ghp_... or github_pat_...';
  tokenInput.style.flex = '1';
  const savedToken = await getSetting('github_token') || '';
  tokenInput.value = savedToken;
  tokenInput.addEventListener('change', () => saveSetting('github_token', tokenInput.value));
  tokenRow.appendChild(tokenInput);
  container.appendChild(tokenRow);

  // --- Sync actions section ---
  const syncSection = el('div', { style: 'margin-top:20px;padding-top:16px;border-top:1px solid var(--border)' });
  syncSection.appendChild(el('label', { text: 'Sync actions', class: 'settings-label', style: 'display:block;margin-bottom:8px' }));

  const forceBtn = el('button', { text: 'Force Full Sync (reset & re-download all data)' });
  forceBtn.style.cssText = 'display:block;margin-bottom:16px';
  forceBtn.addEventListener('click', async () => {
    forceBtn.disabled = true;
    forceBtn.textContent = 'Syncing...';
    try {
      const result = await call('force_full_sync');
      const pushN = result.push?.total || 0;
      const pullN = result.pull?.total || 0;
      showToast(`Full sync complete! Pushed: ${pushN}, Pulled: ${pullN}. Restart app to see data.`, 'success');
    } catch (err) {
      showToast('Sync error: ' + err, 'error');
    } finally {
      forceBtn.disabled = false;
      forceBtn.textContent = 'Force Full Sync (reset & re-download all data)';
    }
  });
  syncSection.appendChild(forceBtn);
  container.appendChild(syncSection);

  // --- Diagnostics section ---
  const diagSection = el('div', { style: 'margin-top:8px;padding-top:16px;border-top:1px solid var(--border)' });
  diagSection.appendChild(el('label', { text: 'Diagnostics', class: 'settings-label', style: 'display:block;margin-bottom:8px' }));

  const debugBtn = el('button', { text: 'Debug Sync', class: 'btn-secondary' });
  debugBtn.style.cssText = 'display:block;margin-bottom:8px';
  const debugOutput = el('pre', { style: 'font-size:11px;color:var(--text-muted);background:var(--bg-secondary);padding:10px;border-radius:6px;overflow:auto;max-height:200px;white-space:pre-wrap' });
  debugBtn.addEventListener('click', async () => {
    debugBtn.disabled = true;
    debugBtn.textContent = 'Running...';
    try {
      const result = await call('debug_sync');
      debugOutput.textContent = JSON.stringify(result, null, 2);
    } catch (err) {
      debugOutput.textContent = 'Error: ' + err;
    } finally {
      debugBtn.disabled = false;
      debugBtn.textContent = 'Debug Sync';
    }
  });
  diagSection.appendChild(debugBtn);
  diagSection.appendChild(debugOutput);
  container.appendChild(diagSection);

  // Auto-check on tab open
  checkBtn.click();
}

// ── First-Run Dialog ──────────────────────────────────────────

export async function checkFirstRun() {
  let setupDone = null;
  try {
    setupDone = await call('get_setting', { key: 'setup_complete' });
  } catch {}

  if (setupDone) return;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay settings-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '450px';

    modal.appendChild(el('h3', { text: 'Welcome to Keyboard Helper!' }));

    const body = el('div', { class: 'modal-body' });
    body.appendChild(el('p', { text: 'Configure sync to keep your data across devices, or skip for now.' }));

    const urlLabel = el('label', { text: 'Sync API URL:', class: 'settings-label' });
    body.appendChild(urlLabel);
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.style.width = '100%';
    urlInput.style.marginBottom = '12px';
    urlInput.placeholder = 'https://sync.example.com/api';
    body.appendChild(urlInput);

    const keyLabel = el('label', { text: 'API Key:', class: 'settings-label' });
    body.appendChild(keyLabel);
    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.style.width = '100%';
    keyInput.style.marginBottom = '12px';
    keyInput.placeholder = 'your-api-key';
    body.appendChild(keyInput);

    const registerHint = el('p', {
      text: 'No API key? You can register from Settings > Sync later.',
      style: 'font-size:12px;color:var(--text-muted)',
    });
    body.appendChild(registerHint);

    modal.appendChild(body);

    const actions = el('div', { class: 'modal-actions' });
    const skipBtn = el('button', { text: 'Skip', class: 'btn-secondary' });
    const saveBtn = el('button', { text: 'Save & Sync' });

    skipBtn.addEventListener('click', async () => {
      try { await call('set_setting', { key: 'setup_complete', value: '1' }); } catch {}
      overlay.remove();
      resolve();
    });

    saveBtn.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      const key = keyInput.value.trim();
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        if (url) await call('set_setting', { key: 'sync_api_url', value: url });
        if (key) await call('set_setting', { key: 'sync_api_key', value: key });
        await call('set_setting', { key: 'setup_complete', value: '1' });
        if (url && key) {
          try {
            await doSync();
            showToast('Sync completed', 'success');
          } catch (err) {
            showToast('Sync failed: ' + err, 'error');
          }
        }
        overlay.remove();
        resolve();
      } catch (err) {
        showToast('Error saving: ' + err, 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save & Sync';
      }
    });

    actions.appendChild(skipBtn);
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);

    injectStyles();
    document.body.appendChild(overlay);
  });
}

// ── QR Code Modal ────────────────────────────────────────────

async function showQRModal(apiKey) {
  const apiUrl = await getSetting('sync_api_url') || '';
  const payload = JSON.stringify({ url: apiUrl, key: apiKey });

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '10001';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = 'max-width:340px;padding:24px;text-align:center';

  modal.appendChild(el('h3', { text: 'QR-код для мобильного', style: 'margin:0 0 16px' }));

  // Generate QR
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.style.cssText = 'border-radius:8px;background:#fff;padding:12px';
  const ctx = canvas.getContext('2d');
  const moduleCount = qr.getModuleCount();
  const cellSize = size / moduleCount;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  }
  modal.appendChild(canvas);

  modal.appendChild(el('p', {
    text: 'Отсканируйте в мобильном приложении Snippets Helper',
    style: 'margin:16px 0 0;font-size:13px;color:var(--text-muted)',
  }));

  const closeBtn = el('button', { text: 'Закрыть', style: 'margin-top:16px' });
  closeBtn.addEventListener('click', () => overlay.remove());
  modal.appendChild(closeBtn);

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ── Helpers ───────────────────────────────────────────────────

async function getSetting(key) {
  try {
    return await call('get_setting', { key });
  } catch {
    return null;
  }
}

async function saveSetting(key, value) {
  try {
    await call('set_setting', { key, value });
  } catch (err) {
    showToast('Failed to save setting: ' + err, 'error');
  }
}

async function getComputerId() {
  const saved = await call('get_setting', { key: 'computer_id' });
  return saved || 'default';
}

function makeFormRow(labelText) {
  const row = el('div', { class: 'settings-form-row' });
  row.appendChild(el('label', { text: labelText, class: 'settings-label' }));
  return row;
}

function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.class) e.className = opts.class;
  if (opts.text) e.textContent = opts.text;
  if (opts.id) e.id = opts.id;
  if (opts.style) e.setAttribute('style', opts.style);
  if (opts.title) e.title = opts.title;
  return e;
}

// ── Styles ────────────────────────────────────────────────────

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
.settings-modal {
  max-width: 650px;
  width: 95%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  padding: 0;
}
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
}
.settings-header h3 { margin: 0; }
.settings-close-btn {
  padding: 4px 10px;
  min-width: auto;
  font-size: 14px;
}
.settings-tab-strip {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  padding: 0 12px;
  overflow-x: auto;
}
.settings-tab-btn {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  padding: 10px 14px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  border-radius: 0;
  transition: color 0.15s, border-color 0.15s;
}
.settings-tab-btn:hover {
  color: var(--text);
  background: transparent;
}
.settings-tab-btn.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  background: transparent;
}
.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.settings-form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.settings-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-muted);
  min-width: 120px;
  flex-shrink: 0;
}
.settings-input {
  padding: 6px 10px;
  font-size: 13px;
}
.settings-textarea {
  width: 100%;
  min-height: 120px;
  padding: 10px;
  font-size: 13px;
  font-family: 'Consolas', 'Monaco', monospace;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  resize: vertical;
}
.settings-textarea:focus {
  border-color: var(--accent);
  outline: none;
}
.settings-tag-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.settings-tag-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
}
.settings-tag-item .btn-small {
  padding: 2px 8px;
  font-size: 12px;
  min-width: auto;
}
.settings-add-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.settings-inline-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
  cursor: pointer;
}
.settings-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
`;
  document.head.appendChild(style);
}
