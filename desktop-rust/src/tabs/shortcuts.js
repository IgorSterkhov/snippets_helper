import { call } from '../tauri-api.js';
import { createSearchBar } from '../components/search-bar.js';
import { showModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

let shortcuts = [];
let selectedIndex = -1;
let listEl = null;
let detailEl = null;
let currentQuery = '';
let fontSize = 14;
let listWidth = 260;
let descOpen = false;
let viewMode = 'main'; // 'main' | 'web'
let activeWebLink = null; // index of active link in web view
let tags = [];
let selectedTagId = null;
let tagPanelEl = null;

export async function init(container) {
  container.innerHTML = '';
  container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden';

  // Load font size settings
  try {
    const fs = await call('get_setting', { key: 'snippets_font_size' });
    if (fs) fontSize = parseInt(fs) || 14;
    const lw = await call('get_setting', { key: 'snippets_left_width' });
    if (lw) listWidth = parseInt(lw) || 260;
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
    const item = document.createElement('div');
    item.style.cssText = `padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:${fontSize}px;transition:background 0.1s;border-left:3px solid transparent`;

    if (index === selectedIndex) {
      item.style.background = 'var(--bg-tertiary)';
      item.style.borderLeftColor = 'var(--accent)';
    } else {
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

  // Header: name + [Main|Web] + actions
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;gap:8px';

  const nameEl = document.createElement('h3');
  nameEl.style.cssText = `margin:0;font-size:${fontSize + 1}px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0`;
  nameEl.textContent = shortcut.name;
  header.appendChild(nameEl);

  // Main/Web toggle (only show if has links)
  if (hasLinks) {
    const toggle = document.createElement('div');
    toggle.style.cssText = 'display:flex;gap:0;flex-shrink:0';

    const mainBtn = document.createElement('button');
    mainBtn.textContent = 'Main';
    mainBtn.style.cssText = `padding:3px 14px;font-size:12px;border:1px solid var(--border);cursor:pointer;border-radius:6px 0 0 6px;transition:all 0.15s;background:${viewMode === 'main' ? 'var(--bg-tertiary)' : 'transparent'};color:${viewMode === 'main' ? 'var(--text)' : 'var(--text-muted)'};border-color:${viewMode === 'main' ? 'var(--border-hover,#30363d)' : 'var(--border)'}`;
    mainBtn.addEventListener('click', () => { viewMode = 'main'; renderDetail(); });

    const webBtn = document.createElement('button');
    webBtn.textContent = 'Web';
    webBtn.style.cssText = `padding:3px 14px;font-size:12px;border:1px solid var(--border);border-left:none;cursor:pointer;border-radius:0 6px 6px 0;transition:all 0.15s;background:${viewMode === 'web' ? 'var(--bg-tertiary)' : 'transparent'};color:${viewMode === 'web' ? 'var(--text)' : 'var(--text-muted)'};border-color:${viewMode === 'web' ? 'var(--border-hover,#30363d)' : 'var(--border)'}`;
    webBtn.addEventListener('click', () => { viewMode = 'web'; if (activeWebLink === null && links.length > 0) activeWebLink = 0; renderDetail(); });

    toggle.appendChild(mainBtn);
    toggle.appendChild(webBtn);
    header.appendChild(toggle);
  }

  // Action buttons
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:6px;flex-shrink:0;margin-left:auto';

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.style.cssText = 'padding:4px 12px;font-size:12px';
  copyBtn.addEventListener('click', () => copyToClipboard(shortcut.value));

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-secondary';
  editBtn.textContent = 'Edit';
  editBtn.style.cssText = 'padding:4px 12px;font-size:12px';
  editBtn.addEventListener('click', () => openEditor(shortcut));

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-danger';
  delBtn.textContent = 'Delete';
  delBtn.style.cssText = 'padding:4px 12px;font-size:12px';
  delBtn.addEventListener('click', () => confirmDelete(shortcut));

  actions.appendChild(copyBtn);
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  header.appendChild(actions);
  detailEl.appendChild(header);

  if (viewMode === 'main') {
    renderMainView(shortcut, hasDesc, links, hasLinks);
  } else {
    renderWebView(links);
  }
}

function renderMainView(shortcut, hasDesc, links, hasLinks) {
  const mainView = document.createElement('div');
  mainView.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow-y:auto';

  // Snippet value
  const valueEl = document.createElement('pre');
  valueEl.style.cssText = `font-family:'SF Mono','Fira Code','Cascadia Code',monospace;font-size:${fontSize}px;color:var(--text);padding:12px 16px;white-space:pre-wrap;word-break:break-word;margin:0`;
  valueEl.textContent = shortcut.value;
  mainView.appendChild(valueEl);

  // Link chips (inline, below snippet text)
  if (hasLinks) {
    const linksInline = document.createElement('div');
    linksInline.style.cssText = 'padding:8px 16px;display:flex;flex-wrap:wrap;gap:6px;align-items:center';

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
  toggle.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 16px;cursor:pointer;font-size:12px;color:var(--text-muted);user-select:none';
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
  badge.style.cssText = 'background:var(--bg-tertiary);padding:1px 6px;border-radius:8px;font-size:10px;color:var(--text-muted)';
  badge.textContent = hasDesc ? 'filled' : 'empty';
  if (!hasDesc) badge.style.opacity = '0.5';
  toggle.appendChild(badge);

  const descContent = document.createElement('div');
  descContent.style.cssText = `max-height:140px;overflow-y:auto;padding:0 16px 10px 16px;font-size:${fontSize - 1}px;color:var(--text);white-space:pre-wrap;word-break:break-word;display:${descOpen ? 'block' : 'none'}`;
  if (hasDesc) {
    descContent.textContent = shortcut.description;
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

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'success');
  } catch (err) {
    showToast('Failed to copy: ' + err, 'error');
  }
}

async function copyAndHide(text) {
  try {
    await navigator.clipboard.writeText(text);
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

  const descInput = document.createElement('textarea');
  descInput.placeholder = 'Description (optional — documentation, notes, context)';
  descInput.rows = 3;
  descInput.value = isEdit ? shortcut.description : '';
  form.appendChild(descInput);

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
