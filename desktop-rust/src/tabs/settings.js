import { call } from '../tauri-api.js';
import { showToast } from '../components/toast.js';
import { doSync } from '../components/status-bar.js';
import { qrcode } from '../lib/qrcode.js';

let root = null;
let activeSubTab = 'general';
let adminTabVisible = false;

const BASE_SUB_TABS = [
  { id: 'general',    label: 'General' },
  { id: 'shortcuts',  label: 'Shortcuts' },
  { id: 'tasks',      label: 'Tasks' },
  { id: 'analyzer',   label: 'SQL Analyzer' },
  { id: 'commits',    label: 'Commits' },
  { id: 'formatter',  label: 'SQL Formatter' },
  { id: 'ai',         label: 'AI' },
  { id: 'sync',       label: 'Sync' },
  { id: 'updates',    label: 'Updates' },
];

const ADMIN_TAB = { id: 'users', label: 'Users / Limits' };

// ── Public API ────────────────────────────────────────────────

export function openSettingsModal() {
  // Prevent duplicate modals
  if (document.querySelector('.settings-overlay')) return;
  if (activeSubTab === 'users' && !adminTabVisible) activeSubTab = 'general';

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
  modal.appendChild(tabStrip);

  // Body
  const body = el('div', { class: 'settings-body' });
  modal.appendChild(body);
  for (const tab of visibleSubTabs()) {
    tabStrip.appendChild(makeTabButton(tab, tabStrip, body));
  }

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
  refreshAdminTab(tabStrip, body);
}

// ── Sub-tab rendering ─────────────────────────────────────────

async function renderSubTab(container) {
  container.innerHTML = '<div class="loading">Loading...</div>';
  try {
    switch (activeSubTab) {
      case 'general':   await renderGeneral(container);   break;
      case 'shortcuts': await renderShortcuts(container);  break;
      case 'tasks':     await renderTasks(container);       break;
      case 'analyzer':  await renderAnalyzer(container);   break;
      case 'commits':   await renderCommits(container);    break;
      case 'formatter': await renderFormatter(container);  break;
      case 'ai':        await renderAi(container);         break;
      case 'sync':      await renderSync(container);       break;
      case 'updates':   await renderUpdates(container);    break;
      case 'users':     await renderUsers(container);      break;
    }
  } catch (err) {
    container.innerHTML = '';
    container.appendChild(el('p', { text: 'Error loading settings: ' + err }));
  }
}

function visibleSubTabs() {
  return adminTabVisible ? [...BASE_SUB_TABS, ADMIN_TAB] : BASE_SUB_TABS;
}

function makeTabButton(tab, tabStrip, body) {
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
  return btn;
}

async function refreshAdminTab(tabStrip, body) {
  let me = null;
  try {
    me = await call('get_admin_me');
  } catch {
    me = null;
  }
  const shouldShow = !!me?.is_admin;
  if (shouldShow === adminTabVisible) return;
  adminTabVisible = shouldShow;
  const existing = tabStrip.querySelector('[data-tab-id="users"]');
  if (adminTabVisible && !existing) {
    tabStrip.appendChild(makeTabButton(ADMIN_TAB, tabStrip, body));
    return;
  }
  if (!adminTabVisible && existing) {
    existing.remove();
    if (activeSubTab === 'users') {
      activeSubTab = 'general';
      const generalBtn = tabStrip.querySelector('[data-tab-id="general"]');
      generalBtn?.classList.add('active');
      await renderSubTab(body);
    }
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

// ── Tasks ─────────────────────────────────────────────────────

async function renderTasks(container) {
  container.innerHTML = '';

  // Checkbox font size — applied via tasks-css.js var(--task-cb-font-size).
  const cbFont = await getSetting('tasks_checkbox_font_size') || '13';
  const maxItems = await getSetting('tasks_card_max_checkboxes') || '10';
  const layoutMode = await getSetting('tasks_layout_mode') || 'one-col';

  const fontRow = makeFormRow('Checkbox font size:');
  const fontInput = document.createElement('input');
  fontInput.type = 'number';
  fontInput.className = 'settings-input';
  fontInput.min = '10';
  fontInput.max = '20';
  fontInput.value = cbFont;
  fontInput.style.width = '80px';
  fontInput.addEventListener('change', () => {
    saveSetting('tasks_checkbox_font_size', fontInput.value);
    // Apply immediately to any currently rendered Tasks tab without a
    // refresh: set a CSS variable on the document root that the scoped
    // tasks CSS consumes.
    document.documentElement.style.setProperty('--task-cb-font-size', fontInput.value + 'px');
  });
  fontRow.appendChild(fontInput);
  container.appendChild(fontRow);

  const maxRow = makeFormRow('Max visible checkboxes per card:');
  const maxInput = document.createElement('input');
  maxInput.type = 'number';
  maxInput.className = 'settings-input';
  maxInput.min = '3';
  maxInput.max = '30';
  maxInput.value = maxItems;
  maxInput.style.width = '80px';
  maxInput.addEventListener('change', () => saveSetting('tasks_card_max_checkboxes', maxInput.value));
  maxRow.appendChild(maxInput);
  container.appendChild(maxRow);

  const layoutRow = makeFormRow('Layout:');
  const layoutSel = document.createElement('select');
  layoutSel.className = 'settings-input';
  for (const [val, label] of [['one-col', '1 column'], ['two-col', '2 columns (zigzag)']]) {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    if (layoutMode === val) opt.selected = true;
    layoutSel.appendChild(opt);
  }
  layoutSel.addEventListener('change', () => saveSetting('tasks_layout_mode', layoutSel.value));
  layoutRow.appendChild(layoutSel);
  container.appendChild(layoutRow);
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

// ── AI ───────────────────────────────────────────────────────

async function renderAi(container) {
  container.innerHTML = '';

  const title = el('div', { class: 'settings-section-title' });
  title.appendChild(el('h4', { text: 'AI provider' }));
  title.appendChild(el('p', {
    text: 'DeepSeek key is stored on the sync server for the current API account. The saved key is never shown again.',
    class: 'settings-help',
  }));
  container.appendChild(title);

  const statusBox = el('div', { class: 'ai-provider-box' });
  const status = el('div', { class: 'ai-provider-status', text: 'Loading...' });
  const meta = el('div', { class: 'ai-provider-meta', text: '' });
  statusBox.appendChild(status);
  statusBox.appendChild(meta);
  container.appendChild(statusBox);

  const keyRow = makeFormRow('DeepSeek key:');
  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.className = 'settings-input ai-provider-key-input';
  keyInput.placeholder = 'sk-...';
  keyInput.autocomplete = 'off';
  keyInput.style.flex = '1';
  keyRow.appendChild(keyInput);
  container.appendChild(keyRow);

  const actions = el('div', { class: 'settings-actions' });
  const saveBtn = el('button', { text: 'Save', class: 'ai-provider-save-btn' });
  const clearBtn = el('button', { text: 'Clear', class: 'btn-secondary ai-provider-clear-btn' });
  const refreshBtn = el('button', { text: 'Refresh', class: 'btn-secondary ai-provider-refresh-btn' });
  actions.appendChild(saveBtn);
  actions.appendChild(clearBtn);
  actions.appendChild(refreshBtn);
  container.appendChild(actions);

  async function refreshStatus(data = null) {
    status.classList.remove('configured', 'missing', 'error');
    meta.textContent = '';
    try {
      const info = data || await call('get_ai_provider_settings');
      if (info.deepseek_configured) {
        status.textContent = 'Configured';
        status.classList.add('configured');
        meta.textContent = info.deepseek_updated_at ? `Last updated: ${formatDate(info.deepseek_updated_at)}` : '';
        clearBtn.disabled = false;
      } else {
        status.textContent = 'Not configured';
        status.classList.add('missing');
        meta.textContent = 'AI chat and Telegram AI will ask you to save a DeepSeek key first.';
        clearBtn.disabled = true;
      }
    } catch (err) {
      status.textContent = 'Unavailable';
      status.classList.add('error');
      meta.textContent = String(err);
      clearBtn.disabled = true;
    }
  }

  saveBtn.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) {
      showToast('DeepSeek API key is empty', 'error');
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      const info = await call('save_ai_provider_settings', { deepseekApiKey: key });
      keyInput.value = '';
      await refreshStatus(info);
      showToast('DeepSeek key saved', 'success');
    } catch (err) {
      showToast('Failed to save DeepSeek key: ' + err, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  clearBtn.addEventListener('click', async () => {
    clearBtn.disabled = true;
    clearBtn.textContent = 'Clearing...';
    try {
      const info = await call('clear_ai_provider_settings');
      keyInput.value = '';
      await refreshStatus(info);
      showToast('DeepSeek key cleared', 'success');
    } catch (err) {
      showToast('Failed to clear DeepSeek key: ' + err, 'error');
      clearBtn.disabled = false;
    } finally {
      clearBtn.textContent = 'Clear';
    }
  });

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing...';
    await refreshStatus();
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh';
  });

  await refreshStatus();
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

// ── Admin Users / Limits ─────────────────────────────────────

async function renderUsers(container) {
  container.innerHTML = '';

  let me;
  try {
    me = await call('get_admin_me');
  } catch (err) {
    container.appendChild(el('p', { text: 'Admin status is unavailable: ' + err, class: 'settings-help' }));
    return;
  }

  if (!me?.is_admin) {
    container.appendChild(el('p', { text: 'Users / Limits is available only for server-appointed admins.', class: 'settings-help' }));
    return;
  }

  const header = el('div', { class: 'admin-users-header' });
  const title = el('div');
  title.appendChild(el('h4', { text: 'Users / Limits' }));
  title.appendChild(el('p', {
    text: 'Admin assignment is managed only on the server. This panel edits media storage limits.',
    class: 'settings-help',
  }));
  header.appendChild(title);
  header.appendChild(el('div', {
    text: `Your usage: ${formatBytes(me.media_used_bytes)} / ${formatBytes(me.media_quota_bytes)}`,
    class: 'admin-current-usage',
  }));
  container.appendChild(header);

  let users;
  try {
    users = await call('list_admin_users');
  } catch (err) {
    container.appendChild(el('p', { text: 'Failed to load users: ' + err, class: 'settings-help' }));
    return;
  }

  const list = el('div', { class: 'admin-users-list' });
  for (const user of users) {
    list.appendChild(renderAdminUserRow(user));
  }
  container.appendChild(list);
}

function renderAdminUserRow(user) {
  const row = el('div', { class: 'admin-user-row' });
  row.dataset.userId = user.user_id;

  const identity = el('div', { class: 'admin-user-identity' });
  const nameLine = el('div', { class: 'admin-user-name' });
  nameLine.appendChild(el('span', { text: user.name || 'Unnamed user' }));
  if (user.is_admin) {
    nameLine.appendChild(el('span', { text: 'Admin', class: 'admin-badge' }));
  }
  identity.appendChild(nameLine);
  identity.appendChild(el('div', {
    text: `ID ${shortId(user.user_id)} - created ${formatDate(user.created_at)} - last seen ${formatDate(user.last_seen_at)}`,
    class: 'admin-user-meta',
  }));
  row.appendChild(identity);

  const usage = el('div', { class: 'admin-usage-block' });
  usage.appendChild(el('div', {
    text: `${formatBytes(user.media_used_bytes)} / ${formatBytes(user.media_quota_bytes)}`,
    class: 'admin-usage-label',
  }));
  const bar = el('div', { class: 'admin-usage-bar' });
  const fill = el('div', { class: 'admin-usage-fill' });
  const pct = user.media_quota_bytes > 0
    ? Math.min(100, Math.round((user.media_used_bytes / user.media_quota_bytes) * 100))
    : 0;
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  usage.appendChild(bar);
  row.appendChild(usage);

  const controls = el('div', { class: 'admin-limit-controls' });
  const quotaInput = limitInput(bytesToMb(user.media_quota_bytes));
  const maxInput = limitInput(bytesToMb(user.media_max_upload_bytes));
  controls.appendChild(limitField('Quota MB', quotaInput));
  controls.appendChild(limitField('Max upload MB', maxInput));

  const saveBtn = el('button', { text: 'Save', class: 'btn-secondary admin-save-btn' });
  saveBtn.addEventListener('click', async () => {
    const quotaBytes = mbToBytes(quotaInput.value);
    const maxBytes = mbToBytes(maxInput.value);
    if (quotaBytes <= 0 || maxBytes <= 0) {
      showToast('Limits must be positive', 'error');
      return;
    }
    if (maxBytes > quotaBytes) {
      showToast('Max upload cannot exceed quota', 'error');
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      const updated = await call('update_admin_user_limits', {
        userId: user.user_id,
        mediaQuotaBytes: quotaBytes,
        mediaMaxUploadBytes: maxBytes,
      });
      row.replaceWith(renderAdminUserRow(updated));
      showToast('Limits updated', 'success');
    } catch (err) {
      showToast('Failed to update limits: ' + err, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });
  controls.appendChild(saveBtn);
  row.appendChild(controls);

  return row;
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

function shortId(value) {
  return String(value || '').slice(0, 8) || '-';
}

function formatDate(value) {
  if (!value) return 'never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function bytesToMb(bytes) {
  return Math.max(1, Math.round((Number(bytes) || 0) / (1024 * 1024)));
}

function mbToBytes(value) {
  const mb = Number(value);
  if (!Number.isFinite(mb)) return 0;
  return Math.round(mb * 1024 * 1024);
}

function limitInput(value) {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'settings-input admin-limit-input';
  input.min = '1';
  input.step = '1';
  input.value = String(value);
  return input;
}

function limitField(label, input) {
  const wrap = el('label', { class: 'admin-limit-field' });
  wrap.appendChild(el('span', { text: label }));
  wrap.appendChild(input);
  return wrap;
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
.settings-section-title h4 {
  margin: 0 0 4px;
  font-size: 15px;
}
.settings-help {
  margin: 0 0 12px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.4;
}
.ai-provider-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  margin: 4px 0 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
}
.ai-provider-status {
  flex-shrink: 0;
  font-weight: 700;
  font-size: 13px;
}
.ai-provider-status.configured { color: #3fb950; }
.ai-provider-status.missing { color: #f0b429; }
.ai-provider-status.error { color: #f85149; }
.ai-provider-meta {
  color: var(--text-muted);
  font-size: 12px;
  min-width: 0;
}
.admin-users-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 14px;
}
.admin-users-header h4 {
  margin: 0 0 4px;
  font-size: 15px;
}
.admin-current-usage {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
}
.admin-users-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.admin-user-row {
  display: grid;
  grid-template-columns: minmax(180px, 1.2fr) minmax(130px, 0.8fr) minmax(230px, 1fr);
  gap: 12px;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  background: var(--bg-secondary);
}
.admin-user-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
}
.admin-user-meta,
.admin-usage-label,
.admin-limit-field span {
  color: var(--text-muted);
  font-size: 11px;
}
.admin-badge {
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
}
.admin-usage-block {
  min-width: 0;
}
.admin-usage-bar {
  height: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  overflow: hidden;
  margin-top: 6px;
}
.admin-usage-fill {
  height: 100%;
  background: var(--accent);
}
.admin-limit-controls {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  justify-content: flex-end;
}
.admin-limit-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.admin-limit-input {
  width: 86px;
}
.admin-save-btn {
  height: 31px;
  min-width: 64px;
}
`;
  document.head.appendChild(style);
}
