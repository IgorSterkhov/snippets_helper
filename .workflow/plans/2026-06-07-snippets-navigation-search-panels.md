# Snippets Navigation, Search, and Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add branch history navigation, explicit search scope, tokenized literal search, independent tag/pinned panels, and tag chip reordering to the desktop Snippets tab.

**Architecture:** Keep the change frontend-first inside `desktop-rust/src/tabs/shortcuts.js`, using existing `list_shortcuts`, `update_snippet_tag`, and `set_setting` commands. Search filtering becomes deterministic frontend filtering over `allShortcuts`, so no Tauri IPC signature changes are needed and existing native/mock `search_shortcuts` commands stay untouched.

**Tech Stack:** Vanilla JavaScript desktop frontend, existing CSS in `desktop-rust/src/styles.css`, existing browser mock in `desktop-rust/src/dev-mock.js`, and CDP smoke tests in `desktop-rust/src/dev-test.py`.

---

### Task 1: Add Smoke Coverage First

**Files:**
- Modify: `desktop-rust/src/dev-test.py`

- [ ] **Step 1: Add snippets navigation/search/panel smoke tests**

Add tests after the existing Snippets tests:

```python
async def t26b_snippets_related_history_navigation():
    await open_shortcuts_tab()
    await cdp.eval("""
      [...document.querySelectorAll('#panel-shortcuts div')]
        .find(x => x.textContent.trim() === 'bash_obsidian_setup')?.click()
    """)
    await wait_until(cdp, "!![...document.querySelectorAll('.snippet-detail-tab')].find(x => x.textContent.trim() === 'Related')", timeout=3)
    await cdp.eval("[...document.querySelectorAll('.snippet-detail-tab')].find(x => x.textContent.trim() === 'Related').click()")
    await wait_until(cdp, "document.querySelectorAll('.snippet-related-row').length > 0", timeout=3)
    first_related = await cdp.eval("document.querySelector('.snippet-related-row .snippet-related-name')?.textContent.trim()")
    await cdp.eval("document.querySelector('.snippet-related-row').click()")
    await wait_until(cdp, f"document.querySelector('#panel-shortcuts h3')?.textContent.trim() === {json.dumps(first_related)}", timeout=3)
    await cdp.eval("document.querySelector('#panel-shortcuts .snippet-history-back').click()")
    await wait_until(cdp, "document.querySelector('#panel-shortcuts h3')?.textContent.trim() === 'bash_obsidian_setup'", timeout=3)
    assert await cdp.eval("document.querySelector('#panel-shortcuts .snippet-history-button')?.textContent.includes('◷')"), 'missing history button'
```

```python
async def t26c_snippets_search_scope_and_tokens():
    await open_shortcuts_tab()
    await cdp.eval("""
      window.__TAURI__.core.invoke('create_shortcut', {
        name: 'route_plain_name',
        value: 'plain value',
        description: '',
        links: '[]',
        obsidian_note: ''
      })
    """)
    await cdp.eval("""
      window.__TAURI__.core.invoke('create_shortcut', {
        name: 'routes without underscore',
        value: 'value mentions route_ literal',
        description: '',
        links: '[]',
        obsidian_note: ''
      })
    """)
    await open_shortcuts_tab()
    await cdp.eval("document.querySelector('#panel-shortcuts .search-bar input').value = 'route_'; document.querySelector('#panel-shortcuts .search-bar input').dispatchEvent(new Event('input', { bubbles: true }))")
    await wait_until(cdp, "document.querySelector('#panel-shortcuts .shortcut-list-name')?.textContent.includes('route_plain_name')", timeout=3)
    names = await cdp.eval("[...document.querySelectorAll('#panel-shortcuts .shortcut-list-name')].map(x => x.textContent.trim())")
    assert 'route_plain_name' in names, names
    assert 'routes without underscore' not in names, names
    await cdp.eval("document.querySelector('#panel-shortcuts .snippet-search-scope-button').click()")
    await wait_until(cdp, "document.querySelector('#panel-shortcuts .snippet-search-scope-button')?.dataset.searchScope === 'full'", timeout=3)
    await cdp.eval("document.querySelector('#panel-shortcuts .search-bar input').value = 'bash setup'; document.querySelector('#panel-shortcuts .search-bar input').dispatchEvent(new Event('input', { bubbles: true }))")
    await wait_until(cdp, "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-name')].some(x => x.textContent.trim() === 'bash_obsidian_setup')", timeout=3)
```

```python
async def t26d_snippets_panel_toggles_and_tag_reorder():
    await open_shortcuts_tab()
    await wait_until(cdp, "!!document.querySelector('#panel-shortcuts .snippet-tags-toggle')", timeout=3)
    assert await cdp.eval("!!document.querySelector('#panel-shortcuts .snippet-tags-panel')"), 'tags panel hidden by default'
    await cdp.eval("document.querySelector('#panel-shortcuts .snippet-pinned-toggle').click()")
    await wait_until(cdp, "!!document.querySelector('#panel-shortcuts .snippet-pinned-panel')", timeout=3)
    assert await cdp.eval("!!document.querySelector('#panel-shortcuts .snippet-tags-panel')"), 'tags should remain visible when pinned is shown'
    await cdp.eval("document.querySelector('#panel-shortcuts .snippet-tags-toggle').click()")
    await wait_until(cdp, "!document.querySelector('#panel-shortcuts .snippet-tags-panel') && !!document.querySelector('#panel-shortcuts .snippet-pinned-panel')", timeout=3)
    await cdp.eval("document.querySelector('#panel-shortcuts .snippet-tags-toggle').click()")
    await wait_until(cdp, "document.querySelectorAll('#panel-shortcuts .snippet-tag-chip').length >= 2", timeout=3)
    before = await cdp.eval("[...document.querySelectorAll('#panel-shortcuts .snippet-tag-chip')].map(x => x.dataset.tagId)")
    await cdp.eval("""
      const chips = [...document.querySelectorAll('#panel-shortcuts .snippet-tag-chip')];
      const first = chips[0];
      const last = chips[chips.length - 1];
      const a = first.getBoundingClientRect();
      const b = last.getBoundingClientRect();
      first.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: a.left + 5, clientY: a.top + 5, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: b.right + 18, clientY: b.top + 5, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: b.right + 18, clientY: b.top + 5, bubbles: true }));
    """)
    await wait_until(cdp, "JSON.parse(localStorage.getItem('mock.snippet_tags') || '[]').some(t => t.sort_order > 0)", timeout=3)
    after = await cdp.eval("[...document.querySelectorAll('#panel-shortcuts .snippet-tag-chip')].map(x => x.dataset.tagId)")
    assert before != after, (before, after)
```

- [ ] **Step 2: Keep new test data local to the tests**

Do not add extra `bash_*` snippets to the global mock seed because the existing Key Cloud smoke test expects `bash · 3 snippets`. Create token-search fixtures inside the new search smoke test after the Key Cloud test has already run.

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
cd desktop-rust/src && python3 dev-test.py
```

Expected: the new tests fail because the new controls and behavior do not exist yet.

### Task 2: Implement Deterministic Search

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`

- [ ] **Step 1: Add search scope state and settings**

Add constants:

```js
const SNIPPETS_SEARCH_SCOPE_SETTING_KEY = 'snippets_search_scope';
const SNIPPET_SEARCH_SCOPES = new Set(['name', 'full']);
let searchScope = 'name';
let searchScopeButtonEl = null;
```

Add normalizer:

```js
function normalizeSnippetSearchScope(scope) {
  return SNIPPET_SEARCH_SCOPES.has(scope) ? scope : 'name';
}
```

- [ ] **Step 2: Load and render search scope**

In `init`, load:

```js
searchScope = normalizeSnippetSearchScope(await call('get_setting', { key: SNIPPETS_SEARCH_SCOPE_SETTING_KEY }));
```

Create a square `snippet-search-scope-button` next to the search field. It toggles between `name` and `full`, updates `dataset.searchScope`, persists the setting, and calls `loadShortcuts()`.

- [ ] **Step 3: Replace backend search calls with frontend filtering**

Add helpers:

```js
function tokenizeSnippetQuery(query) {
  return String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function snippetSearchHaystack(shortcut, scope = searchScope) {
  const fields = scope === 'full'
    ? [shortcut.name, shortcut.value, shortcut.description]
    : [shortcut.name];
  return fields.map(value => String(value || '').toLowerCase()).join('\n');
}

function matchesSnippetSearch(shortcut, query, scope = searchScope) {
  const tokens = tokenizeSnippetQuery(query);
  if (tokens.length === 0) return true;
  const haystack = snippetSearchHaystack(shortcut, scope);
  return tokens.every(token => haystack.includes(token));
}
```

In `loadShortcuts`, build `shortcuts` from `allShortcuts`:

```js
shortcuts = allShortcuts
  .filter(shortcut => matchesSelectedSnippetTag(shortcut))
  .filter(shortcut => matchesSnippetSearch(shortcut, currentQuery, searchScope));
```

- [ ] **Step 4: Add tag pattern matching helpers**

Implement `matchesSelectedSnippetTag(shortcut)` with helpers that support both real synced JSON arrays and legacy mock strings:

```js
function parseSnippetTagPatterns(tag) {
  const raw = String(tag?.patterns || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).map(s => s.trim()).filter(Boolean);
  } catch {}
  return raw.split(/[|,]/).map(s => s.trim()).filter(Boolean);
}

function globMatchesName(pattern, name) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(String(name || ''));
}

function matchesSelectedSnippetTag(shortcut) {
  if (selectedTagId === null) return true;
  const tag = tags.find(item => item.id === selectedTagId);
  if (!tag) return true;
  const patterns = parseSnippetTagPatterns(tag);
  if (patterns.length === 0) return true;
  return patterns.some(pattern => globMatchesName(pattern, shortcut.name));
}
```

Do not change `search_shortcuts` or `filter_shortcuts` in `desktop-rust/src/dev-mock.js` on this pass. UI tests should exercise the Snippets tab filtering, not diverging command stubs.

### Task 3: Implement Independent Panels and Tag Reorder

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`
- Modify: `desktop-rust/src/styles.css`

- [ ] **Step 1: Replace single panel mode with booleans**

Add:

```js
const SNIPPETS_SHOW_TAGS_SETTING_KEY = 'snippets_show_tags_panel';
const SNIPPETS_SHOW_PINNED_SETTING_KEY = 'snippets_show_pinned_panel';
let showTagsPanel = true;
let showPinnedPanel = false;
let topPanelsEl = null;
let tagsPanelEl = null;
let pinnedPanelEl = null;
let tagsToggleButtonEl = null;
let pinnedToggleButtonEl = null;
```

Read old `snippets_panel_mode` once as compatibility fallback:

```js
const legacyPanelMode = normalizeSnippetPanelMode(await call('get_setting', { key: SNIPPETS_PANEL_SETTING_KEY }));
const showTagsSetting = await call('get_setting', { key: SNIPPETS_SHOW_TAGS_SETTING_KEY });
const showPinnedSetting = await call('get_setting', { key: SNIPPETS_SHOW_PINNED_SETTING_KEY });
showTagsPanel = showTagsSetting == null ? legacyPanelMode !== 'pinned' : showTagsSetting !== '0';
showPinnedPanel = showPinnedSetting == null ? legacyPanelMode === 'pinned' : showPinnedSetting === '1';
if (!showTagsPanel && !showPinnedPanel) showTagsPanel = true;
```

- [ ] **Step 2: Replace dropdown with two icon buttons**

Remove panel menu functions. Add `.snippet-panel-toggle` buttons:

```js
tagsToggleButtonEl = createSnippetPanelToggle('tags', '⌗', 'Show tags panel', () => setSnippetPanelVisibility('tags', !showTagsPanel));
pinnedToggleButtonEl = createSnippetPanelToggle('pinned', '📌', 'Show pinned snippets panel', () => setSnippetPanelVisibility('pinned', !showPinnedPanel));
```

- [ ] **Step 3: Render separate top panels**

Replace `tagPanelEl` with `topPanelsEl`; `renderSnippetTopPanel()` should empty it and append `tagsPanelEl` then `pinnedPanelEl` when enabled.

- [ ] **Step 4: Render tags as classed chips**

Replace inline tag button styles with `.snippet-tag-chip`. Selected tag has `.active`, a visible color dot, stronger border/background, and a clear filter chip.

- [ ] **Step 5: Install wrapped DnD for tags**

After rendering tag chips:

```js
installWrappedChipDnd(tagsPanelEl, {
  chipSelector: '.snippet-tag-chip',
  datasetKey: 'tagId',
  placeholderClass: 'snippet-chip-dnd-placeholder',
  sourceClass: 'snippet-chip-dnd-source',
  onReorder: async (ids) => {
    await persistSnippetTagOrder(ids);
    await loadShortcuts();
  },
});
```

Implement `persistSnippetTagOrder(ids)` by calling `update_snippet_tag` for each tag with its existing `name`, `patterns`, `color`, and new `sortOrder`.

- [ ] **Step 6: Preserve tag order on tag edits**

When editing a tag in `openTagManager`, send the tag's existing `sort_order` instead of `0`. When creating a tag, use `max(existing sort_order) + 1` instead of `tags.length`.

### Task 4: Implement Related Branch History

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`
- Modify: `desktop-rust/src/styles.css`

- [ ] **Step 1: Add history state**

```js
const SNIPPET_HISTORY_BRANCH_LIMIT = 10;
let snippetHistoryBack = [];
let snippetHistoryForward = [];
let historyPopoverDocClick = null;
```

History entries are:

```js
{ id: shortcut.id, name: shortcut.name, tab: detailTab }
```

Capture the entry before mutating `detailTab`, so Back from a Related click can restore the previous snippet's Related tab.

- [ ] **Step 2: Centralize snippet opening**

Update `openShortcutById(shortcutId, options)` so it supports:

```js
{ pushHistory = true, clearForward = true, tab = 'code' }
```

Before switching, push the current shortcut entry to `snippetHistoryBack` unless opening the same snippet.

- [ ] **Step 3: Add Back / History / Forward controls**

Render the controls before the snippet title:

```js
<button class="snippet-history-back">‹</button>
<button class="snippet-history-button">◷</button>
<button class="snippet-history-forward">›</button>
```

Disable Back/Forward when their stacks are empty. The History button opens a popover with up to 10 entries from `back + current + forward`, current highlighted. The visible branch is the last Back entries, current, and first Forward entries, trimmed to 10 total.

- [ ] **Step 4: Implement jump semantics**

Add helpers:

```js
function captureCurrentHistoryEntry() { ... }
function navigateSnippetHistoryBack() { ... }
function navigateSnippetHistoryForward() { ... }
function jumpToSnippetHistoryEntry(branchIndex) { ... }
```

For Back/Forward/jump, call `openShortcutById(id, { pushHistory: false, tab: entry.tab })`. If the target snippet was deleted, remove that entry from the relevant stack and show a toast.

- [ ] **Step 5: Wire Related and pinned/list opens through central opening**

Related row click calls `openShortcutById(item.shortcut.id, { tab: 'code' })`. Pinned chips also use the same function. Direct left-list selection updates current selection normally and records history only when it changes the selected snippet.

### Task 5: CSS Polish

**Files:**
- Modify: `desktop-rust/src/styles.css`

- [ ] **Step 1: Add compact button styles**

Add styles for `.snippet-search-scope-button`, `.snippet-panel-toggle`, and `.snippet-history-*` matching the existing dark utilitarian UI.

- [ ] **Step 2: Add panel and chip styles**

Add `.snippet-top-panels`, `.snippet-tags-panel`, `.snippet-panel-row-header`, `.snippet-tag-chip`, `.snippet-tag-chip.active`, `.snippet-panel-empty`, and reuse `.snippet-chip-dnd-placeholder`.

- [ ] **Step 3: Add history popover styles**

Add `.snippet-history-popover`, `.snippet-history-popover-item`, `.snippet-history-popover-item.current`, and truncation rules for long names.

### Task 6: Docs, Verification, Release

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`

- [ ] **Step 1: Update user-facing help/history**

Document Snippets history navigation, search scope button, panel toggles, and tag reorder in Help and release history.

- [ ] **Step 2: Run syntax checks**

Run:

```bash
node --check desktop-rust/src/tabs/shortcuts.js
node --check desktop-rust/src/dev-mock.js
```

Expected: both commands exit 0.

- [ ] **Step 3: Run smoke tests**

Run:

```bash
cd desktop-rust/src && python3 dev-test.py
```

Expected: all tests pass.

- [ ] **Step 4: Commit and release**

Because this is frontend-only and does not change native IPC, use an `f-20260607-N` release tag unless later edits touch `desktop-rust/src-tauri/`.
