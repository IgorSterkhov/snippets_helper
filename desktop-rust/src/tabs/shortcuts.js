import { call } from '../tauri-api.js';
import { createSearchBar } from '../components/search-bar.js';
import { showModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { marked } from '../lib/marked.min.js';
import { attachToolbar } from '../components/md-toolbar.js';

let shortcuts = [];
let selectedIndex = -1;
let listEl = null;
let detailEl = null;
let currentQuery = '';
let fontSize = 14;
let listWidth = 260;
let descOpen = false;
let viewMode = 'main'; // 'main' | 'web' | 'note'
let activeWebLink = null; // index of active link in web view
let expandedCard = null; // index of expanded card in list
let expandHeight = 4; // multiplier for expanded height
let obsidianConfigured = false;
let tags = [];
let selectedTagId = null;
let tagPanelEl = null;

export async function init(container) {
  container.innerHTML = '';
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;height:100%;overflow:hidden;padding:0';

  // Load font size settings (snippets-specific overrides global)
  try {
    const globalFs = await call('get_setting', { key: 'font_size' });
    const snippetsFs = await call('get_setting', { key: 'snippets_font_size' });
    fontSize = parseInt(snippetsFs || globalFs) || 14;
    const lw = await call('get_setting', { key: 'snippets_left_width' });
    if (lw) listWidth = parseInt(lw) || 260;
    const eh = await call('get_setting', { key: 'snippet_expand_multiplier' });
    if (eh) expandHeight = parseInt(eh) || 4;
  } catch {}

  // Header row: search + add button (fixed)
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--bg-secondary);flex-shrink:0';

  const searchBar = createSearchBar(onSearch);
  searchBar.style.flex = '1';
  searchBar.style.marginBottom = '0';
  header.appendChild(searchBar);

  const addBtn = document.createElement('button');
  addBtn.textContent = '+';
  addBtn.title = 'Add shortcut';
  addBtn.style.cssText = 'min-width:32px;height:32px;padding:0;font-size:18px';
  addBtn.addEventListener('click', () => openEditor(null));
  header.appendChild(addBtn);

  container.appendChild(header);

  // Tag panel
  tagPanelEl = document.createElement('div');
  tagPanelEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:6px 12px;border-bottom:1px solid var(--border);flex-shrink:0;align-items:center';
  container.appendChild(tagPanelEl);

  // Two-panel layout (fills remaining space)
  const panels = document.createElement('div');
  panels.style.cssText = 'display:flex;flex:1;overflow:hidden';

  // Left panel: name list (independent scroll)
  listEl = document.createElement('div');
  listEl.style.cssText = `width:${listWidth}px;min-width:180px;overflow-y:auto;border-right:1px solid var(--border);flex-shrink:0`;

  // Right panel: detail view (fixed layout, internal scrolls)
  detailEl = document.createElement('div');
  detailEl.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';

  panels.appendChild(listEl);
  panels.appendChild(detailEl);
  container.appendChild(panels);

  // Keyboard navigation
  document.addEventListener('keydown', onKeydown);

  loadShortcuts();
}

async function onSearch(query) {
  currentQuery = query;
  selectedIndex = -1;
  await loadShortcuts();
}

async function loadShortcuts() {
  try {
    // Check obsidian configuration
    try {
      const obsPath = await call('get_setting', { key: 'obsidian_vaults_path' });
      obsidianConfigured = !!(obsPath && obsPath.trim());
    } catch { obsidianConfigured = false; }

    // Load tags
    try {
      tags = await call('list_snippet_tags');
    } catch { tags = []; }
    renderTagPanel();

    // Load shortcuts based on tag + search
    if (selectedTagId !== null) {
      const tag = tags.find(t => t.id === selectedTagId);
      if (tag) {
        const patterns = JSON.parse(tag.patterns || '[]');
        shortcuts = await call('filter_shortcuts', { patterns, query: currentQuery });
      } else {
        selectedTagId = null;
        shortcuts = currentQuery.trim()
          ? await call('search_shortcuts', { query: currentQuery })
          : await call('list_shortcuts');
      }
    } else if (currentQuery.trim()) {
      shortcuts = await call('search_shortcuts', { query: currentQuery });
    } else {
      shortcuts = await call('list_shortcuts');
    }
    if (selectedIndex < 0 && shortcuts.length > 0) selectedIndex = 0;
    if (selectedIndex >= shortcuts.length) selectedIndex = shortcuts.length - 1;
    renderList();
    renderDetail();
  } catch (err) {
    showToast('Failed to load shortcuts: ' + err, 'error');
  }
}

function renderList() {
  listEl.innerHTML = '';

  if (shortcuts.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = currentQuery ? 'No matches' : 'No shortcuts yet';
    empty.style.cssText = 'text-align:center;margin-top:32px;color:var(--text-muted);font-size:13px';
    listEl.appendChild(empty);
    return;
  }

  shortcuts.forEach((shortcut, index) => {
    const isSelected = index === selectedIndex;

    const item = document.createElement('div');
    item.style.cssText = `
      padding:8px 12px;
      cursor:pointer;
      border-bottom:1px solid var(--border);
      font-size:${fontSize}px;
      transition:background 0.1s;
      border-left:3px solid ${isSelected ? 'var(--accent)' : 'transparent'};
      background:${isSelected ? 'var(--bg-tertiary)' : 'transparent'};
    `;

    if (!isSelected) {
      item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg-secondary)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
    }

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    nameEl.textContent = shortcut.name;
    item.appendChild(nameEl);

    item.addEventListener('click', () => {
      selectedIndex = index;
      viewMode = 'main';
      descOpen = false;
      activeWebLink = null;
      renderList();
      renderDetail();
    });

    listEl.appendChild(item);
  });
}

function parseLinks(shortcut) {
  try {
    const parsed = JSON.parse(shortcut.links || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function renderDetail() {
  detailEl.innerHTML = '';

  if (selectedIndex < 0 || selectedIndex >= shortcuts.length) {
    const hint = document.createElement('p');
    hint.textContent = 'Select a snippet from the list';
    hint.style.cssText = 'color:var(--text-muted);text-align:center;margin-top:32px';
    detailEl.appendChild(hint);
    return;
  }

  const shortcut = shortcuts[selectedIndex];
  const hasDesc = shortcut.description && shortcut.description.trim();
  const links = parseLinks(shortcut);
  const hasLinks = links.length > 0;

  // Auto-open description if filled
  if (hasDesc && !descOpen) descOpen = true;

  // Header: name + [Main|Web] + actions — dark bg zone
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;padding:10px 18px;border-bottom:1px solid var(--border);flex-shrink:0;gap:10px;background:var(--bg-secondary)';

  const nameEl = document.createElement('h3');
  nameEl.style.cssText = `margin:0;font-size:${fontSize + 1}px;font-weight:700;color:#f0f6fc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;font-family:'SF Mono','Cascadia Code','Fira Code',monospace;letter-spacing:-0.3px`;
  nameEl.textContent = shortcut.name;
  header.appendChild(nameEl);

  // Main/Web/Note toggle
  const hasNote = shortcut.obsidian_note && shortcut.obsidian_note.trim();
  const showToggle = hasLinks || hasNote || obsidianConfigured;
  if (showToggle) {
    const toggle = document.createElement('div');
    toggle.style.cssText = 'display:flex;gap:0;flex-shrink:0';

    const tabs = [{ id: 'main', label: 'Main', show: true }];
    if (hasLinks) tabs.push({ id: 'web', label: 'Web', show: true });
    if (hasNote || obsidianConfigured) tabs.push({ id: 'note', label: 'Note', show: true });

    tabs.forEach((tab, i) => {
      if (!tab.show) return;
      const btn = document.createElement('button');
      btn.textContent = tab.label;
      const isActive = viewMode === tab.id;
      const isFirst = i === 0;
      const isLast = i === tabs.length - 1;
      const radius = isFirst ? '6px 0 0 6px' : isLast ? '0 6px 6px 0' : '0';
      btn.style.cssText = `padding:3px 12px;font-size:11px;font-weight:500;border:1px solid var(--border);${!isFirst ? 'border-left:none;' : ''}cursor:pointer;border-radius:${radius};transition:all 0.12s;background:${isActive ? 'var(--bg-tertiary)' : 'transparent'};color:${isActive ? 'var(--text)' : 'var(--text-muted)'};border-color:${isActive ? '#30363d' : 'var(--border)'}`;
      btn.addEventListener('click', () => {
        viewMode = tab.id;
        if (tab.id === 'web' && activeWebLink === null && links.length > 0) activeWebLink = 0;
        renderDetail();
      });
      toggle.appendChild(btn);
    });

    header.appendChild(toggle);
  }

  // Action buttons
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:6px;flex-shrink:0;margin-left:auto';

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:500;background:var(--accent);color:white;border:none;border-radius:4px;cursor:pointer';
  copyBtn.addEventListener('click', () => copyToClipboard(shortcut.value));

  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit';
  editBtn.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:500;background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:4px;cursor:pointer';
  editBtn.addEventListener('click', () => openEditor(shortcut));

  const delBtn = document.createElement('button');
  delBtn.textContent = 'Del';
  delBtn.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:500;background:transparent;color:var(--danger);border:1px solid var(--border);border-radius:4px;cursor:pointer';
  delBtn.addEventListener('click', () => confirmDelete(shortcut));

  actions.appendChild(copyBtn);
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  header.appendChild(actions);
  detailEl.appendChild(header);

  // Accent gradient line
  const accentLine = document.createElement('div');
  accentLine.style.cssText = 'height:2px;flex-shrink:0;background:linear-gradient(90deg,var(--accent),transparent 70%);opacity:0.4';
  detailEl.appendChild(accentLine);

  if (viewMode === 'main') {
    renderMainView(shortcut, hasDesc, links, hasLinks);
  } else if (viewMode === 'note') {
    renderNoteView(shortcut);
  } else {
    renderWebView(links);
  }
}

function renderMainView(shortcut, hasDesc, links, hasLinks) {
  const mainView = document.createElement('div');
  mainView.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow-y:auto';

  // Snippet value — render as markdown if content has markdown markers, otherwise raw
  const hasMarkdown = /(?:^#{1,6}\s|\*\*|__|\[.+\]\(.+\)|```|^\s*[-*]\s|\|.+\|)/m.test(shortcut.value);

  let valueEl;
  if (hasMarkdown) {
    valueEl = document.createElement('div');
    valueEl.className = 'markdown-body';
    valueEl.style.cssText = `font-size:${fontSize}px;padding:16px 18px;line-height:1.6`;
    valueEl.innerHTML = marked(shortcut.value);
  } else {
    valueEl = document.createElement('pre');
    valueEl.style.cssText = `font-family:'SF Mono','Cascadia Code','Fira Code',monospace;font-size:${fontSize - 1}px;line-height:1.65;color:var(--text);padding:16px 18px;white-space:pre-wrap;word-break:break-word;margin:0`;
    valueEl.textContent = shortcut.value;
  }
  mainView.appendChild(valueEl);

  // Link chips (inline, below snippet text)
  if (hasLinks) {
    const linksInline = document.createElement('div');
    linksInline.style.cssText = 'padding:8px 18px;display:flex;flex-wrap:wrap;gap:5px;align-items:center;border-top:1px solid rgba(255,255,255,0.04)';

    links.forEach((link, i) => {
      const chip = document.createElement('div');
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;transition:border-color 0.15s';
      chip.addEventListener('mouseenter', () => { chip.style.borderColor = 'var(--accent)'; });
      chip.addEventListener('mouseleave', () => { chip.style.borderColor = 'var(--border)'; });

      const icon = document.createElement('span');
      icon.textContent = '🔗';
      icon.style.cssText = 'font-size:11px';
      chip.appendChild(icon);

      const title = document.createElement('span');
      title.textContent = link.title || link.url;
      title.style.cssText = 'color:var(--text)';
      chip.appendChild(title);

      // Click chip → switch to Web view on this link
      chip.addEventListener('click', (e) => {
        if (e.target.classList.contains('link-ext')) return;
        viewMode = 'web';
        activeWebLink = i;
        renderDetail();
      });

      // ↗ open in browser
      const ext = document.createElement('span');
      ext.textContent = '↗';
      ext.className = 'link-ext';
      ext.title = 'Open in browser';
      ext.style.cssText = 'color:var(--text-muted);font-size:11px;cursor:pointer;padding:2px;border-radius:3px;margin-left:2px';
      ext.addEventListener('mouseenter', () => { ext.style.color = 'var(--text)'; ext.style.background = 'var(--bg-tertiary)'; });
      ext.addEventListener('mouseleave', () => { ext.style.color = 'var(--text-muted)'; ext.style.background = ''; });
      ext.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await call('open_url', { url: link.url }); } catch (err) { showToast('Error: ' + err, 'error'); }
      });
      chip.appendChild(ext);

      linksInline.appendChild(chip);
    });

    mainView.appendChild(linksInline);
  }

  // Description (collapsible)
  const descSection = document.createElement('div');
  descSection.style.cssText = 'border-top:1px solid var(--border);flex-shrink:0';

  const toggle = document.createElement('div');
  toggle.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 18px;cursor:pointer;font-size:11px;color:var(--text-muted);user-select:none';
  toggle.addEventListener('mouseenter', () => { toggle.style.background = 'var(--bg-secondary)'; });
  toggle.addEventListener('mouseleave', () => { toggle.style.background = ''; });

  const arrow = document.createElement('span');
  arrow.textContent = '\u25B6';
  arrow.style.cssText = `font-size:10px;display:inline-block;transition:transform 0.2s;${descOpen ? 'transform:rotate(90deg)' : ''}`;
  toggle.appendChild(arrow);

  const label = document.createElement('span');
  label.textContent = 'Description';
  toggle.appendChild(label);

  const badge = document.createElement('span');
  badge.style.cssText = 'background:var(--bg-tertiary);padding:1px 5px;border-radius:6px;font-size:9px;color:var(--text-muted)';
  badge.textContent = hasDesc ? 'filled' : 'empty';
  if (!hasDesc) badge.style.opacity = '0.5';
  toggle.appendChild(badge);

  const descContent = document.createElement('div');
  descContent.style.cssText = `max-height:300px;overflow-y:auto;padding:4px 18px 10px 18px;font-size:${fontSize - 1}px;color:var(--text);line-height:1.5;display:${descOpen ? 'block' : 'none'}`;
  if (hasDesc) {
    const hasMarkdownInDesc = /(?:^#{1,6}\s|\*\*|__|\[.+\]\(.+\)|```|^\s*[-*]\s|\|.+\|)/m.test(shortcut.description);
    if (hasMarkdownInDesc) {
      descContent.className = 'markdown-body';
      descContent.innerHTML = marked(shortcut.description);
    } else {
      descContent.style.whiteSpace = 'pre-wrap';
      descContent.style.wordBreak = 'break-word';
      descContent.textContent = shortcut.description;
    }
  } else {
    descContent.innerHTML = '<span style="color:var(--text-muted);font-style:italic">No description. Click Edit to add one.</span>';
  }

  toggle.addEventListener('click', () => {
    descOpen = !descOpen;
    arrow.style.transform = descOpen ? 'rotate(90deg)' : '';
    descContent.style.display = descOpen ? 'block' : 'none';
  });

  descSection.appendChild(toggle);
  descSection.appendChild(descContent);
  mainView.appendChild(descSection);

  detailEl.appendChild(mainView);
}

function renderWebView(links) {
  const webView = document.createElement('div');
  webView.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';

  // Compact link tabs + ↗ browser buttons
  const tabBar = document.createElement('div');
  tabBar.style.cssText = 'display:flex;padding:8px 16px;flex-shrink:0;border-bottom:1px solid var(--border);gap:4px;flex-wrap:wrap;align-items:center';

  links.forEach((link, i) => {
    const tabWrapper = document.createElement('div');
    tabWrapper.style.cssText = 'display:inline-flex;align-items:center;gap:2px';

    const tab = document.createElement('button');
    const isActive = activeWebLink === i;
    tab.textContent = link.title || link.url;
    tab.style.cssText = `padding:4px 10px;font-size:12px;border:1px solid var(--border);border-radius:4px 0 0 4px;cursor:pointer;transition:all 0.15s;background:${isActive ? 'var(--bg-tertiary)' : 'transparent'};color:${isActive ? 'var(--text)' : 'var(--text-muted)'};border-color:${isActive ? '#30363d' : 'var(--border)'}`;
    tab.addEventListener('click', () => { activeWebLink = i; renderDetail(); });
    tabWrapper.appendChild(tab);

    const extBtn = document.createElement('button');
    extBtn.textContent = '↗';
    extBtn.title = 'Open in browser';
    extBtn.style.cssText = `padding:4px 6px;font-size:11px;border:1px solid var(--border);border-left:none;border-radius:0 4px 4px 0;cursor:pointer;background:transparent;color:var(--text-muted);transition:all 0.15s`;
    extBtn.addEventListener('mouseenter', () => { extBtn.style.color = 'var(--text)'; extBtn.style.background = 'var(--bg-tertiary)'; });
    extBtn.addEventListener('mouseleave', () => { extBtn.style.color = 'var(--text-muted)'; extBtn.style.background = ''; });
    extBtn.addEventListener('click', async () => {
      try { await call('open_url', { url: link.url }); } catch (err) { showToast('Error: ' + err, 'error'); }
    });
    tabWrapper.appendChild(extBtn);

    tabBar.appendChild(tabWrapper);
  });

  webView.appendChild(tabBar);

  // iframe area
  const frameArea = document.createElement('div');
  frameArea.style.cssText = 'flex:1;background:var(--bg-secondary);display:flex;flex-direction:column;overflow:hidden';

  if (activeWebLink !== null && activeWebLink < links.length) {
    const url = links[activeWebLink].url;
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'width:100%;flex:1;border:none;background:white';

    // Detect iframe load failure
    const fallback = document.createElement('div');
    fallback.style.cssText = 'display:none;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--text-muted)';
    fallback.innerHTML = `
      <div style="font-size:14px">This site blocked embedded viewing</div>
      <div style="display:flex;gap:8px">
        <button id="fb-app" style="padding:6px 16px;font-size:13px;background:var(--accent,#388bfd);color:white;border:none;border-radius:6px;cursor:pointer">Open in app window</button>
        <button id="fb-browser" class="btn-secondary" style="padding:6px 16px;font-size:13px;background:var(--bg-tertiary);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer">Open in browser</button>
      </div>
    `;

    // Try to detect blocked iframe (heuristic: if contentWindow is inaccessible after load)
    iframe.addEventListener('load', () => {
      try {
        // If we can access contentDocument, it loaded (or it's about:blank for blocked)
        const doc = iframe.contentDocument;
        if (!doc || !doc.body || doc.body.innerHTML === '') {
          iframe.style.display = 'none';
          fallback.style.display = 'flex';
        }
      } catch {
        // Cross-origin — iframe loaded but we can't access it (this is normal/OK)
      }
    });

    iframe.addEventListener('error', () => {
      iframe.style.display = 'none';
      fallback.style.display = 'flex';
    });

    // Timeout fallback — if iframe shows nothing after 5s
    setTimeout(() => {
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.body && doc.body.innerHTML === '') {
          iframe.style.display = 'none';
          fallback.style.display = 'flex';
        }
      } catch { /* cross-origin, iframe is working */ }
    }, 5000);

    frameArea.appendChild(iframe);
    frameArea.appendChild(fallback);

    // Wire fallback buttons after DOM insertion
    setTimeout(() => {
      const appBtn = fallback.querySelector('#fb-app');
      const browserBtn = fallback.querySelector('#fb-browser');
      if (appBtn) appBtn.addEventListener('click', async () => {
        try { await call('open_link_window', { url, title: links[activeWebLink].title || url }); } catch (err) { showToast('Error: ' + err, 'error'); }
      });
      if (browserBtn) browserBtn.addEventListener('click', async () => {
        try { await call('open_url', { url }); } catch (err) { showToast('Error: ' + err, 'error'); }
      });
    }, 0);
  } else {
    frameArea.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:14px">Select a link to view</div>';
  }

  webView.appendChild(frameArea);
  detailEl.appendChild(webView);
}

// ── Obsidian Note View ──────────────────────────────────────


async function renderNoteView(shortcut) {
  const noteView = document.createElement('div');
  noteView.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';

  const hasNote = shortcut.obsidian_note && shortcut.obsidian_note.trim();

  if (hasNote) {
    // Show note path
    const pathBar = document.createElement('div');
    pathBar.style.cssText = 'padding:8px 16px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:8px;flex-shrink:0';
    const pathLabel = document.createElement('span');
    pathLabel.textContent = shortcut.obsidian_note;
    pathLabel.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    pathBar.appendChild(pathLabel);

    const unlinkBtn = document.createElement('button');
    unlinkBtn.textContent = 'Unlink';
    unlinkBtn.className = 'btn-secondary';
    unlinkBtn.style.cssText = 'padding:2px 10px;font-size:11px;flex-shrink:0';
    unlinkBtn.addEventListener('click', async () => {
      try {
        await call('link_obsidian_note', { snippetId: shortcut.id, notePath: '' });
        showToast('Note unlinked', 'success');
        await loadShortcuts();
      } catch (err) { showToast('Error: ' + err, 'error'); }
    });
    pathBar.appendChild(unlinkBtn);
    noteView.appendChild(pathBar);

    // Read and render note content
    const contentArea = document.createElement('div');
    contentArea.style.cssText = 'flex:1;overflow-y:auto;padding:16px 20px;font-size:14px;color:var(--text);line-height:1.6';

    try {
      const md = await call('read_obsidian_note', { notePath: shortcut.obsidian_note });
      contentArea.classList.add('markdown-body');
      contentArea.innerHTML = marked(md);
    } catch (err) {
      contentArea.innerHTML = `<div style="color:var(--text-muted);text-align:center;margin-top:32px">
        <p>Cannot read note: ${err}</p>
        <p style="font-size:12px">The file may have been moved or deleted.</p>
      </div>`;
    }
    noteView.appendChild(contentArea);
  } else {
    // No linked note - show actions
    const emptyView = document.createElement('div');
    emptyView.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:var(--text-muted)';

    const msg = document.createElement('p');
    msg.textContent = 'No linked Obsidian note';
    msg.style.cssText = 'font-size:14px;margin:0';
    emptyView.appendChild(msg);

    if (obsidianConfigured) {
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:10px';

      const createBtn = document.createElement('button');
      createBtn.textContent = 'Create note';
      createBtn.style.cssText = 'padding:6px 16px;font-size:13px';
      createBtn.addEventListener('click', () => openCreateNoteModal(shortcut));
      actions.appendChild(createBtn);

      const linkBtn = document.createElement('button');
      linkBtn.textContent = 'Link existing note';
      linkBtn.className = 'btn-secondary';
      linkBtn.style.cssText = 'padding:6px 16px;font-size:13px';
      linkBtn.addEventListener('click', () => openLinkNoteModal(shortcut));
      actions.appendChild(linkBtn);

      emptyView.appendChild(actions);
    } else {
      const hint = document.createElement('p');
      hint.textContent = 'Configure Obsidian vaults path in Settings > General';
      hint.style.cssText = 'font-size:12px;margin:0';
      emptyView.appendChild(hint);
    }

    noteView.appendChild(emptyView);
  }

  detailEl.appendChild(noteView);
}

async function openCreateNoteModal(shortcut) {
  const form = document.createElement('div');
  form.style.cssText = 'display:flex;flex-direction:column;gap:12px;min-width:350px';

  // Vault selector
  const vaultLabel = document.createElement('label');
  vaultLabel.textContent = 'Vault:';
  vaultLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--text)';
  form.appendChild(vaultLabel);

  const vaultSelect = document.createElement('select');
  vaultSelect.style.cssText = 'padding:6px 10px;font-size:13px';
  form.appendChild(vaultSelect);

  // Folder selector
  const folderLabel = document.createElement('label');
  folderLabel.textContent = 'Folder:';
  folderLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--text)';
  form.appendChild(folderLabel);

  const folderSelect = document.createElement('select');
  folderSelect.style.cssText = 'padding:6px 10px;font-size:13px';
  form.appendChild(folderSelect);

  // Filename
  const fnLabel = document.createElement('label');
  fnLabel.textContent = 'Filename:';
  fnLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--text)';
  form.appendChild(fnLabel);

  const fnInput = document.createElement('input');
  fnInput.type = 'text';
  fnInput.value = shortcut.name;
  fnInput.placeholder = 'Note filename (without .md)';
  form.appendChild(fnInput);

  // Load vaults
  try {
    const vaults = await call('list_obsidian_vaults');
    if (vaults.length === 0) {
      showToast('No Obsidian vaults found at the configured path', 'error');
      return;
    }
    for (const v of vaults) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      vaultSelect.appendChild(opt);
    }
    // Load folders for first vault
    await loadFolders(vaultSelect.value);
  } catch (err) {
    showToast('Error loading vaults: ' + err, 'error');
    return;
  }

  vaultSelect.addEventListener('change', () => loadFolders(vaultSelect.value));

  async function loadFolders(vault) {
    folderSelect.innerHTML = '';
    try {
      const folders = await call('list_obsidian_folders', { vault });
      for (const f of folders) {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        folderSelect.appendChild(opt);
      }
    } catch (err) { showToast('Error loading folders: ' + err, 'error'); }
  }

  showModal({
    title: 'Create Obsidian Note',
    body: form,
    onConfirm: async () => {
      const vault = vaultSelect.value;
      const folder = folderSelect.value;
      const filename = fnInput.value.trim();
      if (!filename) { showToast('Filename is required', 'error'); return; }
      try {
        await call('create_obsidian_note', { snippetId: shortcut.id, vault, folder, filename });
        showToast('Note created', 'success');
        viewMode = 'note';
        await loadShortcuts();
      } catch (err) { showToast('Error: ' + err, 'error'); }
    },
  }).catch(() => {});
}

async function openLinkNoteModal(shortcut) {
  const form = document.createElement('div');
  form.style.cssText = 'display:flex;flex-direction:column;gap:12px;min-width:350px';

  // Vault selector
  const vaultLabel = document.createElement('label');
  vaultLabel.textContent = 'Vault:';
  vaultLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--text)';
  form.appendChild(vaultLabel);

  const vaultSelect = document.createElement('select');
  vaultSelect.style.cssText = 'padding:6px 10px;font-size:13px';
  form.appendChild(vaultSelect);

  // File list
  const fileLabel = document.createElement('label');
  fileLabel.textContent = 'Note file:';
  fileLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--text)';
  form.appendChild(fileLabel);

  const fileSelect = document.createElement('select');
  fileSelect.style.cssText = 'padding:6px 10px;font-size:13px';
  fileSelect.size = 10;
  form.appendChild(fileSelect);

  // Load vaults
  try {
    const vaults = await call('list_obsidian_vaults');
    if (vaults.length === 0) {
      showToast('No Obsidian vaults found at the configured path', 'error');
      return;
    }
    for (const v of vaults) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      vaultSelect.appendChild(opt);
    }
    await loadFiles(vaultSelect.value);
  } catch (err) {
    showToast('Error loading vaults: ' + err, 'error');
    return;
  }

  vaultSelect.addEventListener('change', () => loadFiles(vaultSelect.value));

  async function loadFiles(vault) {
    fileSelect.innerHTML = '';
    try {
      const files = await call('list_obsidian_files', { vault });
      for (const f of files) {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        fileSelect.appendChild(opt);
      }
    } catch (err) { showToast('Error loading files: ' + err, 'error'); }
  }

  showModal({
    title: 'Link Existing Note',
    body: form,
    onConfirm: async () => {
      const vault = vaultSelect.value;
      const file = fileSelect.value;
      if (!file) { showToast('Select a note file', 'error'); return; }
      const notePath = vault + '/' + file;
      try {
        await call('link_obsidian_note', { snippetId: shortcut.id, notePath });
        showToast('Note linked', 'success');
        viewMode = 'note';
        await loadShortcuts();
      } catch (err) { showToast('Error: ' + err, 'error'); }
    },
  }).catch(() => {});
}

function renderTagPanel() {
  if (!tagPanelEl) return;
  tagPanelEl.innerHTML = '';

  if (tags.length === 0 && selectedTagId === null) {
    // Show only the "+" button when no tags exist
  }

  tags.forEach(tag => {
    const btn = document.createElement('button');
    const isSelected = selectedTagId === tag.id;
    btn.textContent = tag.name;
    btn.style.cssText = `
      background: ${isSelected ? tag.color + '22' : 'transparent'};
      border: 1px solid ${tag.color};
      color: ${tag.color};
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 12px;
      cursor: pointer;
      font-weight: ${isSelected ? '600' : '400'};
      line-height: 1.4;
    `;
    btn.addEventListener('click', () => {
      selectedTagId = isSelected ? null : tag.id;
      selectedIndex = -1;
      loadShortcuts();
    });
    tagPanelEl.appendChild(btn);
  });

  // Clear selection button (only if a tag is selected)
  if (selectedTagId !== null) {
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '×';
    clearBtn.title = 'Clear tag filter';
    clearBtn.style.cssText = 'background:transparent;border:1px solid var(--text-muted);color:var(--text-muted);width:24px;height:24px;border-radius:12px;font-size:14px;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;line-height:1';
    clearBtn.addEventListener('click', () => {
      selectedTagId = null;
      selectedIndex = -1;
      loadShortcuts();
    });
    tagPanelEl.appendChild(clearBtn);
  }

  // "+" manage tags button
  const addBtn = document.createElement('button');
  addBtn.textContent = '+';
  addBtn.title = 'Manage tags';
  addBtn.style.cssText = 'background:transparent;border:1px solid var(--text-muted);color:var(--text-muted);width:24px;height:24px;border-radius:12px;font-size:14px;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;line-height:1';
  addBtn.addEventListener('click', openTagManager);
  tagPanelEl.appendChild(addBtn);
}

function openTagManager() {
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:12px;min-width:380px';

  // Existing tags list
  const listDiv = document.createElement('div');
  listDiv.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto';

  function renderTagList() {
    listDiv.innerHTML = '';
    tags.forEach(tag => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0';

      const dot = document.createElement('span');
      dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${tag.color};flex-shrink:0`;
      row.appendChild(dot);

      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      nameSpan.textContent = tag.name;
      row.appendChild(nameSpan);

      const patternsSpan = document.createElement('span');
      patternsSpan.style.cssText = 'font-size:11px;color:var(--text-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      try {
        patternsSpan.textContent = JSON.parse(tag.patterns).join(', ');
      } catch { patternsSpan.textContent = tag.patterns; }
      row.appendChild(patternsSpan);

      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.style.cssText = 'padding:2px 8px;font-size:11px';
      editBtn.className = 'btn-secondary';
      editBtn.addEventListener('click', () => fillForm(tag));
      row.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.textContent = 'Del';
      delBtn.style.cssText = 'padding:2px 8px;font-size:11px';
      delBtn.className = 'btn-danger';
      delBtn.addEventListener('click', async () => {
        try {
          await call('delete_snippet_tag', { id: tag.id });
          if (selectedTagId === tag.id) selectedTagId = null;
          tags = await call('list_snippet_tags');
          renderTagList();
          renderTagPanel();
          showToast('Tag deleted', 'success');
        } catch (err) { showToast('Error: ' + err, 'error'); }
      });
      row.appendChild(delBtn);

      listDiv.appendChild(row);
    });

    if (tags.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No tags yet';
      empty.style.cssText = 'text-align:center;color:var(--text-muted);font-size:12px;margin:8px 0';
      listDiv.appendChild(empty);
    }
  }

  body.appendChild(listDiv);

  // Separator
  const sep = document.createElement('div');
  sep.style.cssText = 'border-top:1px solid var(--border);margin:4px 0';
  body.appendChild(sep);

  // Add/edit form
  const formTitle = document.createElement('div');
  formTitle.textContent = 'Add tag';
  formTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--text)';
  body.appendChild(formTitle);

  const form = document.createElement('div');
  form.style.cssText = 'display:flex;flex-direction:column;gap:8px';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Tag name';
  form.appendChild(nameInput);

  const patternsInput = document.createElement('input');
  patternsInput.type = 'text';
  patternsInput.placeholder = 'Patterns (comma-separated, e.g. af_*, airflow_*)';
  form.appendChild(patternsInput);

  const colorRow = document.createElement('div');
  colorRow.style.cssText = 'display:flex;align-items:center;gap:8px';
  const colorLabel = document.createElement('span');
  colorLabel.textContent = 'Color:';
  colorLabel.style.cssText = 'font-size:12px;color:var(--text-muted)';
  colorRow.appendChild(colorLabel);
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = '#388bfd';
  colorInput.style.cssText = 'width:40px;height:28px;padding:0;border:none;cursor:pointer';
  colorRow.appendChild(colorInput);
  form.appendChild(colorRow);

  let editingId = null;

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save tag';
  saveBtn.style.cssText = 'padding:4px 16px;font-size:12px;align-self:flex-start';
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const rawPatterns = patternsInput.value.trim();
    const color = colorInput.value;

    if (!name) { showToast('Name is required', 'error'); return; }
    if (!rawPatterns) { showToast('At least one pattern is required', 'error'); return; }

    const patternsArr = rawPatterns.split(',').map(p => p.trim()).filter(Boolean);
    const patterns = JSON.stringify(patternsArr);

    try {
      if (editingId !== null) {
        await call('update_snippet_tag', { id: editingId, name, patterns, color, sortOrder: 0 });
        showToast('Tag updated', 'success');
      } else {
        await call('create_snippet_tag', { name, patterns, color, sortOrder: tags.length });
        showToast('Tag created', 'success');
      }
      tags = await call('list_snippet_tags');
      renderTagList();
      renderTagPanel();
      clearForm();
    } catch (err) { showToast('Error: ' + err, 'error'); }
  });
  form.appendChild(saveBtn);
  body.appendChild(form);

  function fillForm(tag) {
    editingId = tag.id;
    nameInput.value = tag.name;
    try {
      patternsInput.value = JSON.parse(tag.patterns).join(', ');
    } catch { patternsInput.value = tag.patterns; }
    colorInput.value = tag.color;
    formTitle.textContent = 'Edit tag';
    saveBtn.textContent = 'Update tag';
  }

  function clearForm() {
    editingId = null;
    nameInput.value = '';
    patternsInput.value = '';
    colorInput.value = '#388bfd';
    formTitle.textContent = 'Add tag';
    saveBtn.textContent = 'Save tag';
  }

  renderTagList();

  showModal({
    title: 'Manage Snippet Tags',
    body,
    onConfirm: async () => {
      await loadShortcuts();
    },
  }).catch(() => {});
}

function onKeydown(e) {
  if (!listEl || !listEl.offsetParent) return;
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (document.querySelector('.modal-overlay')) return;
  if (activeTag === 'textarea') return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (shortcuts.length === 0) return;
    selectedIndex = Math.min(selectedIndex + 1, shortcuts.length - 1);
    viewMode = 'main'; descOpen = false; activeWebLink = null;
    renderList();
    renderDetail();
    scrollToSelected();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (shortcuts.length === 0) return;
    selectedIndex = Math.max(selectedIndex - 1, 0);
    viewMode = 'main'; descOpen = false; activeWebLink = null;
    renderList();
    renderDetail();
    scrollToSelected();
  } else if (e.key === 'Enter' && activeTag !== 'input') {
    e.preventDefault();
    if (selectedIndex >= 0 && selectedIndex < shortcuts.length) {
      copyAndHide(shortcuts[selectedIndex].value);
    }
  }
}

function scrollToSelected() {
  if (selectedIndex < 0 || !listEl) return;
  const items = listEl.children;
  if (items[selectedIndex]) {
    items[selectedIndex].scrollIntoView({ block: 'nearest' });
  }
}

// Strip Markdown code fences before copying. Removes:
//   - whole lines consisting of triple-backticks (with optional language
//     tag and leading indent) — both opening and closing fences;
//   - wrapping single backticks when the entire (trimmed) snippet is
//     a single inline `code` span.
// Inner content, surrounding prose and intentional blank lines are kept.
function stripMarkdownFences(text) {
  if (typeof text !== 'string' || !text) return text;
  let s = text.replace(/^[ \t]*```[^\n]*(\n|$)/gm, '');
  const trimmed = s.trim();
  if (
    trimmed.length >= 2 &&
    trimmed.startsWith('`') &&
    trimmed.endsWith('`') &&
    !trimmed.slice(1, -1).includes('`')
  ) {
    s = trimmed.slice(1, -1);
  }
  return s;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(stripMarkdownFences(text));
    showToast('Copied to clipboard', 'success');
  } catch (err) {
    showToast('Failed to copy: ' + err, 'error');
  }
}

async function copyAndHide(text) {
  try {
    await navigator.clipboard.writeText(stripMarkdownFences(text));
    await call('hide_and_sync');
  } catch (err) {
    showToast('Failed to copy: ' + err, 'error');
  }
}

function openEditor(shortcut) {
  const isEdit = shortcut !== null;

  const form = document.createElement('div');
  form.style.cssText = 'display:flex;flex-direction:column;gap:12px';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Name';
  nameInput.value = isEdit ? shortcut.name : '';
  form.appendChild(nameInput);

  const valueInput = document.createElement('textarea');
  valueInput.placeholder = 'Value (text to copy)';
  valueInput.rows = 6;
  valueInput.value = isEdit ? shortcut.value : '';
  form.appendChild(valueInput);
  attachToolbar(valueInput);

  const descInput = document.createElement('textarea');
  descInput.placeholder = 'Description (optional — documentation, notes, context)';
  descInput.rows = 3;
  descInput.value = isEdit ? shortcut.description : '';
  form.appendChild(descInput);
  attachToolbar(descInput);

  // Links section
  const linksLabel = document.createElement('div');
  linksLabel.textContent = 'Links:';
  linksLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--text);margin-top:4px';
  form.appendChild(linksLabel);

  const linksContainer = document.createElement('div');
  linksContainer.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  form.appendChild(linksContainer);

  let currentLinks = isEdit ? parseLinks(shortcut) : [];

  function renderLinkRows() {
    linksContainer.innerHTML = '';
    currentLinks.forEach((link, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center';

      const titleIn = document.createElement('input');
      titleIn.type = 'text';
      titleIn.placeholder = 'Title';
      titleIn.value = link.title || '';
      titleIn.style.cssText = 'flex:1;min-width:0';
      titleIn.addEventListener('input', () => { currentLinks[idx].title = titleIn.value; });
      row.appendChild(titleIn);

      const urlIn = document.createElement('input');
      urlIn.type = 'text';
      urlIn.placeholder = 'URL';
      urlIn.value = link.url || '';
      urlIn.style.cssText = 'flex:2;min-width:0';
      urlIn.addEventListener('input', () => { currentLinks[idx].url = urlIn.value; });
      row.appendChild(urlIn);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-danger';
      removeBtn.textContent = '\u2715';
      removeBtn.style.cssText = 'padding:4px 8px;font-size:12px;flex-shrink:0';
      removeBtn.addEventListener('click', () => {
        currentLinks.splice(idx, 1);
        renderLinkRows();
      });
      row.appendChild(removeBtn);

      linksContainer.appendChild(row);
    });
  }

  renderLinkRows();

  const addLinkBtn = document.createElement('button');
  addLinkBtn.className = 'btn-secondary';
  addLinkBtn.textContent = '+ Add link';
  addLinkBtn.style.cssText = 'padding:4px 12px;font-size:12px;align-self:flex-start';
  addLinkBtn.addEventListener('click', () => {
    currentLinks.push({ title: '', url: '' });
    renderLinkRows();
  });
  form.appendChild(addLinkBtn);

  // Obsidian note (read-only display)
  if (isEdit && shortcut.obsidian_note && shortcut.obsidian_note.trim()) {
    const noteLabel = document.createElement('div');
    noteLabel.textContent = 'Obsidian note:';
    noteLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--text);margin-top:4px';
    form.appendChild(noteLabel);

    const noteRow = document.createElement('div');
    noteRow.style.cssText = 'display:flex;align-items:center;gap:8px';

    const noteSpan = document.createElement('span');
    noteSpan.textContent = shortcut.obsidian_note;
    noteSpan.style.cssText = 'font-size:12px;color:var(--text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    noteRow.appendChild(noteSpan);

    const unlinkBtn = document.createElement('button');
    unlinkBtn.className = 'btn-danger';
    unlinkBtn.textContent = 'Unlink';
    unlinkBtn.style.cssText = 'padding:2px 10px;font-size:11px;flex-shrink:0';
    unlinkBtn.addEventListener('click', async () => {
      try {
        await call('link_obsidian_note', { snippetId: shortcut.id, notePath: '' });
        noteSpan.textContent = '(unlinked)';
        unlinkBtn.disabled = true;
        showToast('Note unlinked', 'success');
      } catch (err) { showToast('Error: ' + err, 'error'); }
    });
    noteRow.appendChild(unlinkBtn);

    form.appendChild(noteRow);
  }

  showModal({
    title: isEdit ? 'Edit Shortcut' : 'New Shortcut',
    body: form,
    onConfirm: async () => {
      const name = nameInput.value.trim();
      const value = valueInput.value;
      const description = descInput.value.trim();
      const validLinks = currentLinks.filter(l => l.url && l.url.trim());
      const links = JSON.stringify(validLinks);

      if (!name) { showToast('Name is required', 'error'); return; }
      if (!value) { showToast('Value is required', 'error'); return; }

      try {
        if (isEdit) {
          await call('update_shortcut', { id: shortcut.id, name, value, description, links });
          showToast('Shortcut updated', 'success');
        } else {
          await call('create_shortcut', { name, value, description, links });
          showToast('Shortcut created', 'success');
        }
        await loadShortcuts();
      } catch (err) {
        showToast('Error: ' + err, 'error');
      }
    },
  }).catch(() => {});
}

function confirmDelete(shortcut) {
  const msg = document.createElement('p');
  msg.textContent = `Delete "${shortcut.name}"?`;

  showModal({
    title: 'Confirm Delete',
    body: msg,
    onConfirm: async () => {
      try {
        await call('delete_shortcut', { id: shortcut.id });
        showToast('Shortcut deleted', 'success');
        selectedIndex = Math.min(selectedIndex, shortcuts.length - 2);
        await loadShortcuts();
      } catch (err) {
        showToast('Error: ' + err, 'error');
      }
    },
  }).catch(() => {});
}
