# Snippets Markdown and Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the Snippets module with compact sticky content tabs, better Markdown code handling, focused new-snippet editing, and link actions without embedded Web iframes.

**Architecture:** Keep the change frontend-only. `shortcuts.js` owns snippet detail/editor behavior, `md-toolbar.js` owns Markdown insertion semantics, `styles.css` owns shared Markdown code-block copy styles, and `dev-test.py` verifies the flows through the browser mock.

**Tech Stack:** Vanilla JavaScript modules, `marked`, Tauri invoke wrapper via `call()`, browser mock in `dev-mock.js`, CDP smoke tests in `dev-test.py`.

---

## File Structure

- Modify `desktop-rust/src/dev-mock.js`
  - Add richer snippet fixtures for tabs and Markdown code-block copy tests.
  - Keep existing command handlers unchanged unless a fixture exposes a missing behavior.
- Modify `desktop-rust/src/dev-test.py`
  - Add smoke coverage for snippet tabs, hidden empty tabs, link actions, editor focus, collapsed description, toolbar code insertion, and Markdown code-block copy.
- Modify `desktop-rust/src/components/md-toolbar.js`
  - Replace current `</>` code-button behavior with explicit no-selection, inline-selection, and block-selection behavior.
- Modify `desktop-rust/src/tabs/shortcuts.js`
  - Replace `viewMode = main/web/note` with `detailTab = code/description/links/note`.
  - Render full-width sticky tabs under the snippet header.
  - Render one active content pane at a time.
  - Remove embedded Web iframe view from the right panel.
  - Render links as compact rows with browser/app-window actions.
  - Add Markdown code-block copy buttons after rendering snippet Markdown.
  - Collapse editor description by default and focus new-snippet name input.
  - Keep Obsidian note create/link actions available from the edit modal when
    Obsidian is configured and the snippet has no linked note.
- Modify `desktop-rust/src/styles.css`
  - Add reusable Markdown code-block copy styling.
  - Add any stable snippet tab/link classes if inline styles become too brittle.
- Modify `desktop-rust/src/tabs/help.js`
  - Update English and Russian Snippets help text.
- Modify `desktop-rust/CHANGELOG.md`
  - Add top entry for the user-facing Snippets changes.

---

### Task 1: Add Snippets Fixtures for Browser Tests

**Files:**
- Modify: `desktop-rust/src/dev-mock.js`

- [ ] **Step 1: Add richer snippets to `ensureFixtures()`**

Replace the current `storeSet('shortcuts', [...])` block with:

```js
storeSet('shortcuts', [
  {
    id: 1,
    uuid: uuid(),
    name: 'SELECT all',
    value: 'SELECT * FROM {{table}};',
    description: 'SQL sample',
    links: [{ id: 1, title: 'PostgreSQL docs', url: 'https://postgresql.org' }],
    obsidian_note: null,
    created_at: now(),
    updated_at: now(),
  },
  {
    id: 2,
    uuid: uuid(),
    name: 'Python markdown block',
    value: 'Run this:\\n\\n```python\\nprint("hello")\\nprint("world")\\n```',
    description: '## Usage\\n\\nOpen the Links tab for docs.',
    links: [
      { id: 1, title: 'Python docs', url: 'https://docs.python.org/3/' },
      { id: 2, title: 'Runbook', url: 'https://wiki.local/runbooks/python' },
    ],
    obsidian_note: 'MockVault/Snippets/python.md',
    created_at: now(),
    updated_at: now(),
  },
  {
    id: 3,
    uuid: uuid(),
    name: 'Minimal plain snippet',
    value: 'plain text only',
    description: '',
    links: [],
    obsidian_note: null,
    created_at: now(),
    updated_at: now(),
  },
]);
storeSet('__seq.shortcuts', 3);
```

- [ ] **Step 2: Keep `read_obsidian_note()` useful for Note tab tests**

Ensure the existing mock handler returns Markdown with a code block:

```js
async read_obsidian_note() {
  return '# Mock note\n\n```bash\necho note\n```';
},
```

- [ ] **Step 3: Syntax-check the mock**

Run:

```bash
node --check desktop-rust/src/dev-mock.js
```

Expected: no output and exit code `0`.

---

### Task 2: Add Failing CDP Smoke Tests for Snippets

**Files:**
- Modify: `desktop-rust/src/dev-test.py`

- [ ] **Step 1: Add clipboard permissions before tests run**

After `await cdp.send('Page.enable')`, add:

```python
await cdp.send('Browser.grantPermissions', permissions=['clipboardReadWrite'], origin=f'http://localhost:{HTTP_PORT}')
```

- [ ] **Step 2: Add a helper to open the Snippets tab**

Inside `run_tests()`, before the numbered scenarios that need it, add:

```python
async def open_shortcuts_tab():
    await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"shortcuts\"]').click()")
    await wait_until(cdp, "!!document.querySelector('#panel-shortcuts')", timeout=4)
    await wait_until(cdp, "document.body.innerText.includes('SELECT all')", timeout=5)
```

- [ ] **Step 3: Add a test for conditional full-width detail tabs**

Add this test near the other tab/module smoke tests:

```python
async def t_snippets_tabs_conditional():
    await open_shortcuts_tab()
    await cdp.eval(
        "[...document.querySelectorAll('#panel-shortcuts div')].find(x => x.textContent.trim() === 'Minimal plain snippet').click()"
    )
    await wait_until(cdp, "document.body.innerText.includes('plain text only')", timeout=3)
    tabs_min = await cdp.eval(
        "[...document.querySelectorAll('.snippet-detail-tab')].map(x => x.textContent.trim())"
    )
    assert tabs_min == ['Code'], f'minimal tabs: {tabs_min!r}'

    await cdp.eval(
        "[...document.querySelectorAll('#panel-shortcuts div')].find(x => x.textContent.trim() === 'Python markdown block').click()"
    )
    await wait_until(cdp, "document.body.innerText.includes('Python markdown block')", timeout=3)
    tabs_full = await cdp.eval(
        "[...document.querySelectorAll('.snippet-detail-tab')].map(x => x.textContent.trim())"
    )
    assert tabs_full == ['Code', 'Description', 'Links', 'Note'], f'full tabs: {tabs_full!r}'
    iframe_count = await cdp.eval("document.querySelectorAll('#panel-shortcuts iframe').length")
    assert iframe_count == 0, f'embedded iframe should not render, got {iframe_count}'
await check('T16 Snippets detail tabs are conditional', t_snippets_tabs_conditional)
```

- [ ] **Step 4: Add a test for Links actions**

Add:

```python
async def t_snippets_links_tab_actions():
    await open_shortcuts_tab()
    await cdp.eval(
        "[...document.querySelectorAll('#panel-shortcuts div')].find(x => x.textContent.trim() === 'Python markdown block').click()"
    )
    await cdp.eval(
        "[...document.querySelectorAll('.snippet-detail-tab')].find(x => x.textContent.trim() === 'Links').click()"
    )
    await wait_until(cdp, "document.body.innerText.includes('Python docs')", timeout=3)
    rows = await cdp.eval("document.querySelectorAll('.snippet-link-row').length")
    assert rows == 2, f'link rows: {rows}'
    actions = await cdp.eval(
        "[...document.querySelectorAll('.snippet-link-row:first-child button')].map(x => x.title)"
    )
    assert actions == ['Open in browser', 'Open in app window'], f'actions: {actions!r}'
await check('T17 Snippets Links tab exposes explicit actions', t_snippets_links_tab_actions)
```

- [ ] **Step 5: Add a test for Markdown code-block copy**

Add:

```python
async def t_snippets_markdown_code_copy():
    await open_shortcuts_tab()
    await cdp.eval(
        "[...document.querySelectorAll('#panel-shortcuts div')].find(x => x.textContent.trim() === 'Python markdown block').click()"
    )
    await wait_until(cdp, "!!document.querySelector('.markdown-code-copy')", timeout=3)
    await cdp.eval("document.querySelector('.markdown-code-copy').click()")
    copied = await wait_until(cdp, "navigator.clipboard.readText().then(t => t.includes('print(\"hello\")') && t)", timeout=3)
    assert copied == 'print(\"hello\")\\nprint(\"world\")', f'copied: {copied!r}'
await check('T18 Snippets Markdown code block copy', t_snippets_markdown_code_copy)
```

- [ ] **Step 6: Add a test for editor focus and collapsed description**

Add:

```python
async def t_snippets_new_editor_focus_and_description_collapse():
    await open_shortcuts_tab()
    await cdp.eval("document.querySelector('#panel-shortcuts button[title=\"Add shortcut\"]').click()")
    await wait_until(cdp, "!!document.querySelector('.modal-overlay input[placeholder=\"Name\"]')", timeout=3)
    active = await cdp.eval("document.activeElement === document.querySelector('.modal-overlay input[placeholder=\"Name\"]')")
    assert active, 'name input should be focused'
    desc_visible = await cdp.eval(
        "!![...document.querySelectorAll('.modal-overlay textarea')].find(x => x.placeholder.startsWith('Description') && x.offsetParent !== null)"
    )
    assert not desc_visible, 'description textarea should be collapsed by default'
    badge = await cdp.eval("document.querySelector('.snippet-editor-desc-toggle .snippet-editor-desc-badge')?.textContent")
    assert badge == 'empty', f'description badge: {badge!r}'
await check('T19 Snippets new editor focuses name and collapses description', t_snippets_new_editor_focus_and_description_collapse)
```

- [ ] **Step 7: Add a test for toolbar code button no-selection behavior**

Add:

```python
async def t_snippets_toolbar_code_block_insert():
    await open_shortcuts_tab()
    if await cdp.eval("!!document.querySelector('.modal-overlay')"):
        await cdp.eval("document.querySelector('.modal-overlay .btn-secondary').click()")
    await cdp.eval("document.querySelector('#panel-shortcuts button[title=\"Add shortcut\"]').click()")
    await wait_until(cdp, "!!document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')", timeout=3)
    await cdp.eval(
        "const ta=document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]');"
        "ta.focus(); ta.setSelectionRange(0,0);"
        "[...document.querySelectorAll('.modal-overlay .md-toolbar button')].find(b => b.title === 'Code block').click();"
    )
    value = await cdp.eval("document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]').value")
    caret = await cdp.eval("document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]').selectionStart")
    assert value == '```\\n\\n```', f'value: {value!r}'
    assert caret == 4, f'caret: {caret}'
await check('T20 Snippets toolbar inserts fenced code block', t_snippets_toolbar_code_block_insert)
```

- [ ] **Step 8: Run smoke tests to verify they fail**

Run:

```bash
cd desktop-rust/src && python3 dev-test.py
```

Expected before implementation: existing tests pass, new Snippets tests fail because `.snippet-detail-tab`, `.markdown-code-copy`, and collapsed editor description do not exist yet.

---

### Task 3: Implement Markdown Toolbar Code Semantics

**Files:**
- Modify: `desktop-rust/src/components/md-toolbar.js`

- [ ] **Step 1: Add helper functions above `getButtons()`**

Add:

```js
function getLineBounds(textarea, start, end) {
  const value = textarea.value;
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextNewline = value.indexOf('\n', end);
  const lineEnd = nextNewline === -1 ? value.length : nextNewline;
  return { lineStart, lineEnd };
}

function selectionCoversWholeLines(textarea, start, end) {
  if (start === end) return false;
  const value = textarea.value;
  const selected = value.substring(start, end);
  if (selected.includes('\n')) return true;
  const { lineStart, lineEnd } = getLineBounds(textarea, start, end);
  return start === lineStart && end === lineEnd;
}

function insertCodeBlock(textarea) {
  const start = textarea.selectionStart;
  const text = '```\n\n```';
  textarea.setRangeText(text, start, start, 'end');
  textarea.setSelectionRange(start + 4, start + 4);
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function toggleCodeFormatting(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  if (start === end) {
    insertCodeBlock(textarea);
    return;
  }

  const selected = textarea.value.substring(start, end);
  if (selectionCoversWholeLines(textarea, start, end)) {
    const { lineStart, lineEnd } = getLineBounds(textarea, start, end);
    const block = textarea.value.substring(lineStart, lineEnd);
    textarea.setRangeText('```\n' + block + '\n```', lineStart, lineEnd, 'select');
  } else if (selected.includes('\n')) {
    textarea.setRangeText('```\n' + selected + '\n```', start, end, 'select');
  } else {
    textarea.setRangeText('`' + selected + '`', start, end, 'select');
  }

  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}
```

- [ ] **Step 2: Replace the existing `</>` button action**

Change the code button definition to:

```js
{
  label: '</>', title: 'Code block',
  action: () => toggleCodeFormatting(textarea),
},
```

- [ ] **Step 3: Syntax-check the toolbar**

Run:

```bash
node --check desktop-rust/src/components/md-toolbar.js
```

Expected: no output and exit code `0`.

---

### Task 4: Implement Snippet Detail Tabs and Link Rows

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`
- Modify: `desktop-rust/src/styles.css`

- [ ] **Step 1: Replace old detail state variables**

At the top of `shortcuts.js`, replace:

```js
let descOpen = false;
let viewMode = 'main'; // 'main' | 'web' | 'note'
let activeWebLink = null; // index of active link in web view
```

with:

```js
let detailTab = 'code'; // 'code' | 'description' | 'links' | 'note'
```

- [ ] **Step 2: Update list selection resets**

Where list clicks and keyboard navigation currently set `viewMode`, `descOpen`,
and `activeWebLink`, replace those assignments with:

```js
detailTab = 'code';
```

- [ ] **Step 3: Add tab helper functions after `parseLinks()`**

Add:

```js
function hasText(value) {
  return !!(value && String(value).trim());
}

function getDetailTabs(shortcut, links) {
  const tabs = [{ id: 'code', label: 'Code' }];
  if (hasText(shortcut.description)) tabs.push({ id: 'description', label: 'Description' });
  if (links.length > 0) tabs.push({ id: 'links', label: 'Links' });
  if (hasText(shortcut.obsidian_note)) tabs.push({ id: 'note', label: 'Note' });
  return tabs;
}

function ensureValidDetailTab(tabs) {
  if (!tabs.some(tab => tab.id === detailTab)) detailTab = 'code';
}

function isMarkdownLike(text) {
  return /(?:^#{1,6}\s|\*\*|__|\[.+\]\(.+\)|```|^\s*[-*]\s|\|.+\|)/m.test(text || '');
}
```

- [ ] **Step 4: Replace `renderDetail()` routing**

Inside `renderDetail()`, after `links` and `hasLinks`, compute:

```js
const hasNote = shortcut.obsidian_note && shortcut.obsidian_note.trim();
const tabs = getDetailTabs(shortcut, links);
ensureValidDetailTab(tabs);
```

Remove the old `Main/Web/Note` toggle creation and the old accent gradient line.
After appending the header, append:

```js
const tabBar = document.createElement('div');
tabBar.className = 'snippet-detail-tabs';
tabs.forEach(tab => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'snippet-detail-tab' + (detailTab === tab.id ? ' active' : '');
  btn.textContent = tab.label;
  btn.addEventListener('click', () => {
    detailTab = tab.id;
    renderDetail();
  });
  tabBar.appendChild(btn);
});
detailEl.appendChild(tabBar);

if (detailTab === 'code') {
  renderCodeTab(shortcut, links, hasLinks);
} else if (detailTab === 'description') {
  renderDescriptionTab(shortcut);
} else if (detailTab === 'links') {
  renderLinksTab(links);
} else if (detailTab === 'note' && hasNote) {
  renderNoteView(shortcut);
} else {
  detailTab = 'code';
  renderCodeTab(shortcut, links, hasLinks);
}
```

- [ ] **Step 5: Rename and simplify `renderMainView()`**

Rename `renderMainView(shortcut, hasDesc, links, hasLinks)` to `renderCodeTab(shortcut, links, hasLinks)`.

Inside it:

- Remove all Description-section rendering.
- Keep the snippet value rendering.
- Remove inline link chips from the code tab.
- After `marked(shortcut.value)`, call `enhanceMarkdownCodeBlocks(valueEl)`.

The Markdown branch should be:

```js
if (hasMarkdown) {
  valueEl = document.createElement('div');
  valueEl.className = 'markdown-body snippet-tab-content';
  valueEl.style.cssText = `font-size:${fontSize}px;padding:16px 18px;line-height:1.6`;
  valueEl.innerHTML = marked(shortcut.value);
  enhanceMarkdownCodeBlocks(valueEl);
} else {
  valueEl = document.createElement('pre');
  valueEl.className = 'snippet-tab-content';
  valueEl.style.cssText = `font-family:'SF Mono','Cascadia Code','Fira Code',monospace;font-size:${fontSize - 1}px;line-height:1.65;color:var(--text);padding:16px 18px;white-space:pre-wrap;word-break:break-word;margin:0`;
  valueEl.textContent = shortcut.value;
}
```

- [ ] **Step 6: Add `renderDescriptionTab()`**

Add after `renderCodeTab()`:

```js
function renderDescriptionTab(shortcut) {
  const view = document.createElement('div');
  view.className = 'snippet-tab-pane snippet-tab-content';
  view.style.cssText = `flex:1;overflow-y:auto;padding:16px 18px;font-size:${fontSize - 1}px;color:var(--text);line-height:1.5`;

  if (isMarkdownLike(shortcut.description)) {
    view.classList.add('markdown-body');
    view.innerHTML = marked(shortcut.description);
    enhanceMarkdownCodeBlocks(view);
  } else {
    view.style.whiteSpace = 'pre-wrap';
    view.style.wordBreak = 'break-word';
    view.textContent = shortcut.description;
  }

  detailEl.appendChild(view);
}
```

- [ ] **Step 7: Add `renderLinksTab()`**

Add:

```js
function renderLinksTab(links) {
  const view = document.createElement('div');
  view.className = 'snippet-tab-pane snippet-links-tab';
  view.style.cssText = 'flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:8px';

  links.forEach(link => {
    const row = document.createElement('div');
    row.className = 'snippet-link-row';

    const meta = document.createElement('div');
    meta.className = 'snippet-link-meta';

    const title = document.createElement('div');
    title.className = 'snippet-link-title';
    title.textContent = link.title || link.url;
    meta.appendChild(title);

    const url = document.createElement('div');
    url.className = 'snippet-link-url';
    url.textContent = link.url;
    meta.appendChild(url);
    row.appendChild(meta);

    const browserBtn = document.createElement('button');
    browserBtn.type = 'button';
    browserBtn.className = 'snippet-link-action';
    browserBtn.textContent = '↗';
    browserBtn.title = 'Open in browser';
    browserBtn.addEventListener('click', async () => {
      try { await call('open_url', { url: link.url }); } catch (err) { showToast('Error: ' + err, 'error'); }
    });
    row.appendChild(browserBtn);

    const windowBtn = document.createElement('button');
    windowBtn.type = 'button';
    windowBtn.className = 'snippet-link-action';
    windowBtn.textContent = '▣';
    windowBtn.title = 'Open in app window';
    windowBtn.addEventListener('click', async () => {
      try { await call('open_link_window', { url: link.url, title: link.title || link.url }); } catch (err) { showToast('Error: ' + err, 'error'); }
    });
    row.appendChild(windowBtn);

    view.appendChild(row);
  });

  detailEl.appendChild(view);
}
```

- [ ] **Step 8: Remove old `renderWebView()`**

Delete `renderWebView(links)` and any calls to it.

- [ ] **Step 9: Add CSS for tabs and link rows**

Append near the Markdown section or utility section in `styles.css`:

```css
.snippet-detail-tabs {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  height: 30px;
  flex-shrink: 0;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border);
}

.snippet-detail-tab {
  border: 0;
  border-left: 1px solid rgba(255,255,255,0.06);
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
  padding: 0 8px;
  cursor: pointer;
}

.snippet-detail-tab:first-child { border-left: 0; }

.snippet-detail-tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.snippet-link-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 8px 10px;
}

.snippet-link-meta {
  min-width: 0;
  flex: 1;
}

.snippet-link-title {
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.snippet-link-url {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.snippet-link-action {
  width: 28px;
  height: 26px;
  padding: 0;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] **Step 10: Syntax-check snippets**

Run:

```bash
node --check desktop-rust/src/tabs/shortcuts.js
```

Expected: no output and exit code `0`.

---

### Task 5: Add Markdown Code-Block Copy Buttons

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`
- Modify: `desktop-rust/src/styles.css`

- [ ] **Step 1: Add helper in `shortcuts.js` near copy helpers**

Add before `stripMarkdownFences()`:

```js
function enhanceMarkdownCodeBlocks(root) {
  root.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.markdown-code-copy')) return;
    const code = pre.querySelector('code');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'markdown-code-copy';
    btn.textContent = '⧉';
    btn.title = 'Copy code block';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = code ? code.textContent : pre.textContent;
      try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard', 'success');
      } catch (err) {
        showToast('Failed to copy: ' + err, 'error');
      }
    });
    pre.appendChild(btn);
  });
}
```

- [ ] **Step 2: Ensure every `marked()` path in snippets calls the helper**

Call `enhanceMarkdownCodeBlocks(...)` after:

```js
valueEl.innerHTML = marked(shortcut.value);
```

after:

```js
view.innerHTML = marked(shortcut.description);
```

and in `renderNoteView()` after:

```js
contentArea.innerHTML = marked(md);
```

- [ ] **Step 3: Add CSS for copy buttons**

Append to `styles.css` near `.markdown-body pre`:

```css
.markdown-body pre {
  position: relative;
}

.markdown-code-copy {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.12s ease, color 0.12s ease, background 0.12s ease;
}

.markdown-body pre:hover .markdown-code-copy,
.markdown-code-copy:focus {
  opacity: 1;
}

.markdown-code-copy:hover {
  color: var(--text);
  background: var(--bg-secondary);
}
```

- [ ] **Step 4: Syntax-check snippets**

Run:

```bash
node --check desktop-rust/src/tabs/shortcuts.js
```

Expected: no output and exit code `0`.

---

### Task 6: Collapse Description in the Editor and Focus New Name

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`

- [ ] **Step 1: Add a focused-modal helper near `openEditor()`**

Add:

```js
function focusWhenVisible(el) {
  setTimeout(() => {
    try {
      el.focus();
      if (typeof el.select === 'function') el.select();
    } catch {}
  }, 0);
}
```

- [ ] **Step 2: Replace direct description textarea insertion with a collapsed section**

In `openEditor()`, replace the direct `descInput` append/toolbar block with:

```js
let descExpanded = false;

const descSection = document.createElement('div');
descSection.className = 'snippet-editor-desc-section';
descSection.style.cssText = 'display:flex;flex-direction:column;gap:0';

const descToggle = document.createElement('button');
descToggle.type = 'button';
descToggle.className = 'snippet-editor-desc-toggle';
descToggle.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;color:var(--text-muted);cursor:pointer;text-align:left';

const descArrow = document.createElement('span');
descArrow.textContent = '▶';
descArrow.style.cssText = 'font-size:10px;transition:transform 0.15s';
descToggle.appendChild(descArrow);

const descLabel = document.createElement('span');
descLabel.textContent = 'Description';
descLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--text)';
descToggle.appendChild(descLabel);

const descBadge = document.createElement('span');
descBadge.className = 'snippet-editor-desc-badge';
descBadge.textContent = isEdit && hasText(shortcut.description) ? 'filled' : 'empty';
descBadge.style.cssText = 'margin-left:auto;background:var(--bg-tertiary);padding:1px 6px;border-radius:8px;font-size:10px;color:var(--text-muted)';
descToggle.appendChild(descBadge);

const descBody = document.createElement('div');
descBody.style.cssText = 'display:none;flex-direction:column';

const descInput = document.createElement('textarea');
descInput.placeholder = 'Description (optional — documentation, notes, context)';
descInput.rows = 3;
descInput.value = isEdit ? shortcut.description : '';
descBody.appendChild(descInput);
attachToolbar(descInput);

function renderDescCollapse() {
  descArrow.style.transform = descExpanded ? 'rotate(90deg)' : '';
  descBody.style.display = descExpanded ? 'flex' : 'none';
}

descToggle.addEventListener('click', () => {
  descExpanded = !descExpanded;
  renderDescCollapse();
  if (descExpanded) focusWhenVisible(descInput);
});

descInput.addEventListener('input', () => {
  descBadge.textContent = hasText(descInput.value) ? 'filled' : 'empty';
});

descSection.appendChild(descToggle);
descSection.appendChild(descBody);
form.appendChild(descSection);
renderDescCollapse();
```

- [ ] **Step 3: Focus new snippet name input after modal opens**

- [ ] **Step 3a: Preserve Obsidian note create/link in the edit modal**

After the existing edit-only `obsidian_note` display block, add an `else if`
branch for configured Obsidian without a linked note:

```js
} else if (isEdit && obsidianConfigured) {
  const noteLabel = document.createElement('div');
  noteLabel.textContent = 'Obsidian note:';
  noteLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--text);margin-top:4px';
  form.appendChild(noteLabel);

  const noteRow = document.createElement('div');
  noteRow.style.cssText = 'display:flex;align-items:center;gap:8px';

  const noteHint = document.createElement('span');
  noteHint.textContent = 'No linked note';
  noteHint.style.cssText = 'font-size:12px;color:var(--text-muted);flex:1';
  noteRow.appendChild(noteHint);

  const createNoteBtn = document.createElement('button');
  createNoteBtn.type = 'button';
  createNoteBtn.className = 'btn-secondary';
  createNoteBtn.textContent = 'Create note';
  createNoteBtn.style.cssText = 'padding:2px 10px;font-size:11px;flex-shrink:0';
  createNoteBtn.addEventListener('click', () => openCreateNoteModal(shortcut));
  noteRow.appendChild(createNoteBtn);

  const linkNoteBtn = document.createElement('button');
  linkNoteBtn.type = 'button';
  linkNoteBtn.className = 'btn-secondary';
  linkNoteBtn.textContent = 'Link existing';
  linkNoteBtn.style.cssText = 'padding:2px 10px;font-size:11px;flex-shrink:0';
  linkNoteBtn.addEventListener('click', () => openLinkNoteModal(shortcut));
  noteRow.appendChild(linkNoteBtn);

  form.appendChild(noteRow);
}
```

After the `showModal({...}).catch(() => {});` call, add:

```js
if (!isEdit) focusWhenVisible(nameInput);
```

- [ ] **Step 4: Verify `description` still saves**

The existing `onConfirm` line should continue to work:

```js
const description = descInput.value.trim();
```

- [ ] **Step 5: Syntax-check snippets**

Run:

```bash
node --check desktop-rust/src/tabs/shortcuts.js
```

Expected: no output and exit code `0`.

---

### Task 7: Update Help and Changelog

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/CHANGELOG.md`

- [ ] **Step 1: Update English snippets help**

In `help.js`, update `shortcuts_desc` in the English dictionary to mention:

```text
Tabbed detail view for Code, Description, Links, and Note. Rendered Markdown code blocks have copy buttons. Links open explicitly in the browser or a separate app window.
```

- [ ] **Step 2: Update Russian snippets help**

Update the Russian `shortcuts_desc` with the same meaning:

```text
Детальный просмотр разбит на вкладки Code, Description, Links и Note. В Markdown-блоках кода есть кнопка копирования. Ссылки открываются явно: в браузере или в отдельном окне приложения.
```

- [ ] **Step 3: Add changelog entry**

At the top of `desktop-rust/CHANGELOG.md`, add:

```markdown
## Unreleased

- Snippets: replaced `Main / Web / Note` with compact content tabs, added copy buttons to rendered Markdown code blocks, improved code-block insertion in the Markdown toolbar, and moved links to explicit browser/app-window actions.
```

- [ ] **Step 4: Syntax-check help**

Run:

```bash
node --check desktop-rust/src/tabs/help.js
```

Expected: no output and exit code `0`.

---

### Task 8: Run Tests, Fix Regressions, and Commit

**Files:**
- Test changed files and commit the finished feature.

- [ ] **Step 1: Run JS syntax checks**

Run:

```bash
node --check desktop-rust/src/dev-mock.js
node --check desktop-rust/src/components/md-toolbar.js
node --check desktop-rust/src/tabs/shortcuts.js
node --check desktop-rust/src/tabs/help.js
```

Expected: all commands exit `0`.

- [ ] **Step 2: Run CDP smoke tests**

Run:

```bash
cd desktop-rust/src && python3 dev-test.py
```

Expected: all tests pass, including the new Snippets tests.

- [ ] **Step 3: Inspect the diff**

Run:

```bash
git diff -- desktop-rust/src/dev-mock.js desktop-rust/src/dev-test.py desktop-rust/src/components/md-toolbar.js desktop-rust/src/tabs/shortcuts.js desktop-rust/src/styles.css desktop-rust/src/tabs/help.js desktop-rust/CHANGELOG.md .workflow/specs/2026-05-18-snippets-markdown-tabs.md .workflow/plans/2026-05-18-snippets-markdown-tabs.md
```

Expected: only the planned files changed.

- [ ] **Step 4: Commit**

Run:

```bash
git add .workflow/specs/2026-05-18-snippets-markdown-tabs.md .workflow/plans/2026-05-18-snippets-markdown-tabs.md desktop-rust/src/dev-mock.js desktop-rust/src/dev-test.py desktop-rust/src/components/md-toolbar.js desktop-rust/src/tabs/shortcuts.js desktop-rust/src/styles.css desktop-rust/src/tabs/help.js desktop-rust/CHANGELOG.md
git commit -m "feat: improve snippets markdown tabs"
```

Expected: one frontend feature commit.

---

## Self-Review

- Spec coverage: detail tabs, conditional tab visibility, Links/Web merge, Note visibility, Markdown code-copy, toolbar code insertion, editor focus, collapsed description, tests, help, and changelog are each mapped to tasks.
- Placeholder scan: no `TBD`, `TODO`, "implement later", or unresolved task placeholders.
- Type consistency: plan uses `detailTab`, `.snippet-detail-tab`, `.snippet-link-row`, `.markdown-code-copy`, `enhanceMarkdownCodeBlocks()`, and `toggleCodeFormatting()` consistently across tests and implementation steps.
