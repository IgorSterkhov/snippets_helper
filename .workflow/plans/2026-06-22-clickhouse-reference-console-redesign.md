# ClickHouse Reference Console Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the desktop ClickHouse module as the approved Reference Console UI while preserving lazy local documentation behavior.

**Architecture:** Keep all data flow and Tauri command calls unchanged. Refactor only the DOM shape and CSS inside `desktop-rust/src/tabs/clickhouse-docs.js`, then update browser smoke expectations and release notes.

**Tech Stack:** Vanilla JS, injected CSS, existing Tauri `call(...)`, `marked`, browser mock CDP smoke tests.

---

### Task 1: Add Smoke Expectations

**Files:**
- Modify: `desktop-rust/src/dev-test.py`

- [ ] **Step 1: Extend `T27 ClickHouse docs module`**

Add assertions after the existing title check:

```python
console_frame = await cdp.eval("""(() => {
  const panel = document.querySelector('#panel-clickhouse-docs');
  return {
    hasShell: !!panel?.querySelector('.ch-reference-console'),
    hasLogo: !!panel?.querySelector('.ch-logo-mark'),
    hasStatusRail: !!panel?.querySelector('.ch-inspector-rail'),
    statusText: panel?.querySelector('.ch-inspector-rail')?.innerText || '',
  };
})()""")
assert console_frame['hasShell'] is True, console_frame
assert console_frame['hasLogo'] is True, console_frame
assert console_frame['hasStatusRail'] is True, console_frame
assert '4' in console_frame['statusText'] and 'sections' in console_frame['statusText'], console_frame
assert '2' in console_frame['statusText'] and 'pages' in console_frame['statusText'], console_frame
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd desktop-rust/src && python3 dev-test.py
```

Expected: `T27 ClickHouse docs module` fails because `.ch-reference-console`,
`.ch-logo-mark`, and `.ch-inspector-rail` do not exist yet, and therefore the
mock `2 pages` / `4 sections` values are not rendered.

### Task 2: Implement Reference Console Shell

**Files:**
- Modify: `desktop-rust/src/tabs/clickhouse-docs.js`

- [ ] **Step 1: Update shell classes**

Change the root shell class from `ch-docs-shell` to
`ch-docs-shell ch-reference-console`, add a header logo element with class
`ch-logo-mark`, and add a right rail element with class `ch-inspector-rail`
inside the body.

- [ ] **Step 2: Populate the right rail**

Add a `renderInspectorRail()` function that writes local index facts from
`tree` and `updateProgress`:

```js
function renderInspectorRail() {
  const rail = root?.querySelector('.ch-inspector-rail');
  if (!rail) return;
  const last = tree.last_update_at ? formatDate(tree.last_update_at) : 'Never';
  const summary = updateProgress?.summary || 'Local cache ready';
  rail.innerHTML = `
    <div class="ch-inspector-title">Local index</div>
    <div class="ch-inspector-card"><b>${tree.section_count || 0}</b><span>sections</span></div>
    <div class="ch-inspector-card"><b>${tree.page_count || 0}</b><span>pages</span></div>
    <div class="ch-inspector-card"><b>${escapeHtml(last)}</b><span>last update</span></div>
    <div class="ch-inspector-note">${escapeHtml(summary)}</div>
  `;
}
```

Call it from `renderStatus()`, `renderUpdateProgress()`, and after tree load.

- [ ] **Step 3: Replace CSS with the Reference Console styling**

Keep selectors local to `.ch-docs-shell`/`.ch-*`. Use the approved dark palette,
ClickHouse yellow active states, compact button/input sizing, a three-column
desktop body, and a responsive single-column fallback below 900px.

### Task 3: Preserve Existing Behavior

**Files:**
- Modify: `desktop-rust/src/tabs/clickhouse-docs.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] **Step 1: Run syntax checks**

Run:

```bash
node --check desktop-rust/src/tabs/clickhouse-docs.js
node --check desktop-rust/src/tabs/help.js
python3 -m py_compile desktop-rust/src/dev-test.py
```

Expected: all commands exit `0`.

- [ ] **Step 2: Run full smoke tests**

Run:

```bash
cd desktop-rust/src && python3 dev-test.py
```

Expected: `=== 79/79 passed ===` or the current full test count with every test passing.

### Task 4: Release Notes and OTA

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`

- [ ] **Step 1: Update Help text**

Mention that the ClickHouse module now uses a Reference Console layout with a
local index rail and section-first reading.

- [ ] **Step 2: Add release history entry**

Add `f-20260622-N` to `desktop-rust/src/release-history.md` and
`desktop-rust/CHANGELOG.md` before tagging.

- [ ] **Step 3: Verify release history gate**

Run:

```bash
grep -F "f-20260622-N" desktop-rust/src/release-history.md
```

Expected: the tag line is present in `desktop-rust/src/release-history.md`.

- [ ] **Step 4: Commit and release**

Run verification commands, commit with a one-line message, create an `f-*` tag,
push, monitor GitHub Actions, and verify three frontend release assets plus
`frontend-version.json`.
