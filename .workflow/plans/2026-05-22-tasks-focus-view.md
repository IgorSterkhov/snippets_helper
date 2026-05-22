# Tasks Focus View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a third Tasks layout mode, `Focus view`, with a searchable left task index and selected-task editor on the right.

**Architecture:** Keep the change frontend-only. Extend the existing `tasks_layout_mode` setting with `focus`, reuse the current top filters/pinned chips, and reuse `renderCard(..., { expanded: true })` for the selected task detail pane. Store the selected task id and a selected-task snapshot separately from `state.tasks` so pinned tasks outside current filters can remain open on the right.

**Tech Stack:** Vanilla JavaScript modules in `desktop-rust/src/tabs/tasks/`, scoped CSS returned from `desktop-rust/src/tabs/tasks/tasks-css.js`, browser mock fixtures in `desktop-rust/src/dev-mock.js`, CDP smoke tests in `desktop-rust/src/dev-test.py`.

---

## File Map

- `desktop-rust/src/tabs/tasks/index.js`
  - Add `focus` layout mode.
  - Replace the single 1/2 toggle button with a three-segment icon control.
  - Render the Focus view left index, local search, right detail pane, outside-filter banner, and `Show in list`.
  - Keep pinned chip behavior compatible with both card modes and Focus view.
- `desktop-rust/src/tabs/tasks/tasks-css.js`
  - Add segmented layout switch styles.
  - Add Focus view split-pane styles, compact task rows, local search, right-pane empty states, and outside-filter banner.
- `desktop-rust/src/dev-mock.js`
  - Add a pinned Personal task fixture so outside-filter behavior can be tested without depending on previous tests.
- `desktop-rust/src/dev-test.py`
  - Add smoke coverage for mode switching, local search, outside-filter pinned opening, and `Show in list`.
- `desktop-rust/src/tabs/help.js`
  - Update Tasks feature text in EN/RU.
- `desktop-rust/CHANGELOG.md`
  - Add an Unreleased Tasks entry.
- `FRONTEND_PATTERNS.md`
  - Document the Focus view split-pane pattern as a reusable UI convention.

---

## Task 1: Add Red Smoke Tests

**Files:**
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [x] **Step 1: Add a pinned outside-filter fixture**

In `desktop-rust/src/dev-mock.js`, add a third task to `storeSet('tasks', [...])`:

```js
{
  id: 3, uuid: uuid(), title: 'Pinned personal task', category_id: 2, status_id: 1,
  is_pinned: true, bg_color: null, tracker_url: null, notes_md: 'Outside Work filter',
  sort_order: 2, created_at: now(), updated_at: now(), sync_status: 'synced', user_id: 'mock-user',
},
```

Update:

```js
storeSet('__seq.tasks', 3);
```

- [x] **Step 2: Add a Focus view smoke test**

In `desktop-rust/src/dev-test.py`, after the existing Tasks test and before Snippets tests, add:

```python
# ── T16: Tasks Focus view layout/search/outside pinned ─────
async def t16_tasks_focus_view_layout_search_and_outside_pin():
    await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"tasks\"]').click()")
    await wait_until(cdp, "!!document.querySelector('#tasks-layout-focus')", timeout=5)

    await cdp.eval("document.querySelector('#tasks-layout-focus').click()")
    await wait_until(cdp, "document.querySelector('#tasks-cards-scroll.focus')", timeout=3)

    modes = await cdp.eval(
        "[...document.querySelectorAll('.tasks-layout-mode')].map(x => x.title)"
    )
    assert modes == ['One column', 'Two columns', 'Focus view'], f'modes: {modes!r}'

    await wait_until(cdp, "!!document.querySelector('.tasks-focus-search')", timeout=3)
    row_titles = await cdp.eval(
        "[...document.querySelectorAll('.tasks-focus-row-title')].map(x => x.textContent.trim())"
    )
    assert 'Pinned mock task' in row_titles, row_titles
    assert 'Regular mock task' in row_titles, row_titles

    await cdp.eval(
        "const input=document.querySelector('.tasks-focus-search');"
        "input.value='regular';"
        "input.dispatchEvent(new Event('input', { bubbles: true }));"
    )
    searched = await cdp.eval(
        "[...document.querySelectorAll('.tasks-focus-row-title')].map(x => x.textContent.trim())"
    )
    assert searched == ['Regular mock task'], f'searched: {searched!r}'

    await cdp.eval(
        "[...document.querySelectorAll('.tasks-filter-group:first-child .tasks-dropdown')][0].click()"
    )
    await wait_until(cdp, "!!document.querySelector('.tasks-dropdown-menu')", timeout=3)
    await cdp.eval(
        "[...document.querySelectorAll('.tasks-dropdown-item')]"
        ".find(x => x.textContent.includes('Work')).click()"
    )
    await wait_until(
        cdp,
        "[...document.querySelectorAll('.tasks-focus-row-title')]"
        ".every(x => !x.textContent.includes('Pinned personal task'))",
        timeout=3,
    )

    await cdp.eval(
        "[...document.querySelectorAll('#tasks-pinned .tasks-pinned-chip-label')]"
        ".find(x => x.textContent.includes('Pinned personal task')).click()"
    )
    await wait_until(
        cdp,
        "document.querySelector('.tasks-focus-outside-banner')?.textContent.includes('outside current filters')",
        timeout=3,
    )
    selected_title = await cdp.eval("document.querySelector('.tasks-focus-detail .task-editor-title')?.value")
    assert selected_title == 'Pinned personal task', f'selected title: {selected_title!r}'

    await cdp.eval("document.querySelector('.tasks-focus-show-in-list').click()")
    await wait_until(
        cdp,
        "[...document.querySelectorAll('.tasks-focus-row-title')]"
        ".some(x => x.textContent.includes('Pinned personal task'))",
        timeout=3,
    )
    category_label = await cdp.eval(
        "document.querySelector('#tasks-cat-dropdown')?.textContent"
    )
    assert 'Personal' in category_label, f'category label: {category_label!r}'
await check('T16 Tasks Focus view layout/search/outside pinned', t16_tasks_focus_view_layout_search_and_outside_pin)
```

Renumber the later Snippets test comments and check labels from `T16...T22` to `T17...T23`.

- [x] **Step 3: Verify RED**

Run:

```bash
cd desktop-rust/src && python3 dev-test.py
```

Expected:

```text
FAIL  T16 Tasks Focus view layout/search/outside pinned: ...
```

The failure should be caused by missing `#tasks-layout-focus` or missing `.tasks-focus-*` elements.

---

## Task 2: Add Focus View State And Mode Switch

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/index.js`
- Modify: `desktop-rust/src/tabs/tasks/tasks-css.js`

- [x] **Step 1: Extend state**

In `desktop-rust/src/tabs/tasks/index.js`, change:

```js
layoutMode: 'one-col', // 'one-col' | 'two-col'
expandedTaskId: null,  // id of currently expanded card (at most one)
```

to:

```js
layoutMode: 'one-col', // 'one-col' | 'two-col' | 'focus'
expandedTaskId: null,  // selected/expanded task id
selectedTask: null,    // task snapshot for Focus view, including outside-filter tasks
focusSearch: '',
```

- [x] **Step 2: Restore `focus` from settings**

In `init`, change:

```js
if (saved === 'two-col' || saved === 'one-col') {
  state.layoutMode = saved;
}
```

to:

```js
if (saved === 'two-col' || saved === 'one-col' || saved === 'focus') {
  state.layoutMode = saved;
}
```

- [x] **Step 3: Replace the old toggle button with a segmented control**

Replace the old `toggleBtn` creation in `buildLayout()` with:

```js
const modes = el('div', { id: 'tasks-layout-toggle', class: 'tasks-layout-switch' });
[
  { id: 'one-col', title: 'One column', icon: oneColumnIcon() },
  { id: 'two-col', title: 'Two columns', icon: twoColumnIcon() },
  { id: 'focus', title: 'Focus view', icon: focusViewIcon() },
].forEach(mode => {
  const btn = document.createElement('button');
  btn.id = `tasks-layout-${mode.id === 'one-col' ? 'one' : mode.id === 'two-col' ? 'two' : 'focus'}`;
  btn.className = 'tasks-layout-mode';
  btn.type = 'button';
  btn.title = mode.title;
  btn.innerHTML = mode.icon;
  btn.addEventListener('click', () => onSetLayoutMode(mode.id));
  modes.appendChild(btn);
});
filterRow.appendChild(modes);
```

Add icon helpers below `renderDropdowns()`:

```js
function oneColumnIcon() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
    <rect x="2" y="2" width="12" height="12" rx="1.5"/>
  </svg>`;
}

function twoColumnIcon() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
    <rect x="2" y="2" width="12" height="12" rx="1.5"/>
    <line x1="8" y1="2" x2="8" y2="14"/>
  </svg>`;
}

function focusViewIcon() {
  return `<svg viewBox="0 0 18 16" fill="none" stroke="currentColor" stroke-width="1.7">
    <rect x="1.8" y="2" width="14.4" height="12" rx="1.6"/>
    <line x1="7" y1="2" x2="7" y2="14"/>
    <line x1="3.5" y1="5" x2="5.4" y2="5"/>
    <line x1="3.5" y1="8" x2="5.4" y2="8"/>
    <line x1="3.5" y1="11" x2="5.4" y2="11"/>
    <line x1="9.2" y1="5.2" x2="14" y2="5.2"/>
    <line x1="9.2" y1="8" x2="14" y2="8"/>
    <line x1="9.2" y1="10.8" x2="12.4" y2="10.8"/>
  </svg>`;
}
```

- [x] **Step 4: Update render/apply mode helpers**

Replace `renderLayoutToggle()` with:

```js
function renderLayoutToggle() {
  for (const btn of state.root.querySelectorAll('.tasks-layout-mode')) {
    const mode = btn.id === 'tasks-layout-one'
      ? 'one-col'
      : btn.id === 'tasks-layout-two'
        ? 'two-col'
        : 'focus';
    btn.classList.toggle('active', state.layoutMode === mode);
  }
}
```

Replace `applyLayoutMode()` with:

```js
function applyLayoutMode() {
  const scroll = state.root.querySelector('#tasks-cards-scroll');
  if (!scroll) return;
  scroll.classList.remove('one-col', 'two-col', 'focus');
  scroll.classList.add(state.layoutMode);
}
```

Replace `onToggleLayout()` with:

```js
async function onSetLayoutMode(mode) {
  if (!['one-col', 'two-col', 'focus'].includes(mode)) return;
  state.layoutMode = mode;
  if (mode === 'focus') ensureFocusSelection();
  applyLayoutMode();
  renderLayoutToggle();
  await renderTaskList();
  try {
    await call('set_setting', { key: 'tasks_layout_mode', value: state.layoutMode });
  } catch { /* non-fatal */ }
}
```

- [x] **Step 5: Add CSS for segmented mode switch**

In `desktop-rust/src/tabs/tasks/tasks-css.js`, replace the `.tasks-layout-toggle` block with:

```css
.tasks-layout-switch {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-secondary);
  overflow: hidden;
}
.tasks-layout-mode {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-right: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
}
.tasks-layout-mode:last-child { border-right: none; }
.tasks-layout-mode:hover { color: var(--text); background: var(--bg-tertiary); }
.tasks-layout-mode.active {
  color: var(--accent);
  background: rgba(56, 139, 253, 0.12);
}
.tasks-layout-mode svg { width: 16px; height: 16px; display: block; }
#tasks-layout-focus svg { width: 18px; }
```

- [x] **Step 6: Verify Task 2**

Run:

```bash
node --check desktop-rust/src/tabs/tasks/index.js
cd desktop-rust/src && python3 dev-test.py
```

Expected:

- `node --check` passes.
- The new `T16` still fails because Focus view body is not implemented yet.

---

## Task 3: Render Focus View Left Index And Right Detail

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/index.js`
- Modify: `desktop-rust/src/tabs/tasks/tasks-css.js`

- [x] **Step 1: Route `renderTaskList()` to Focus view**

At the start of `renderTaskList()`, after empty `scroll.innerHTML = ''`, add:

```js
if (state.layoutMode === 'focus') {
  await renderFocusView(scroll);
  return;
}
```

- [x] **Step 2: Add Focus selection helpers**

Add below `renderTaskList()`:

```js
function findTaskById(id) {
  if (id == null) return null;
  return state.tasks.find(t => t.id === id)
    || state.pinned.find(t => t.id === id)
    || (state.selectedTask && state.selectedTask.id === id ? state.selectedTask : null);
}

function ensureFocusSelection() {
  const current = findTaskById(state.expandedTaskId);
  if (current) {
    state.selectedTask = current;
    return current;
  }
  const first = state.tasks[0] || null;
  state.expandedTaskId = first ? first.id : null;
  state.selectedTask = first;
  return first;
}

function isSelectedOutsideTopFilters() {
  return !!state.expandedTaskId && !state.tasks.some(t => t.id === state.expandedTaskId);
}

function getCategory(task) {
  return state.categories.find(c => c.id === task.category_id) || null;
}

function getStatus(task) {
  return state.statuses.find(s => s.id === task.status_id) || null;
}
```

- [x] **Step 3: Add Focus view renderer**

Add:

```js
async function renderFocusView(scroll) {
  ensureFocusSelection();

  const shell = el('div', { class: 'tasks-focus-shell' });
  const left = el('div', { class: 'tasks-focus-list' });
  const right = el('div', { class: 'tasks-focus-detail' });
  shell.appendChild(left);
  shell.appendChild(right);
  scroll.appendChild(shell);

  renderFocusLeftPane(left);
  await renderFocusRightPane(right);
}

function renderFocusLeftPane(left) {
  const tools = el('div', { class: 'tasks-focus-tools' });
  const input = document.createElement('input');
  input.className = 'tasks-focus-search';
  input.type = 'search';
  input.placeholder = 'Search visible tasks...';
  input.value = state.focusSearch;
  input.addEventListener('input', () => {
    state.focusSearch = input.value;
    renderTaskList();
  });
  tools.appendChild(input);
  tools.appendChild(el('span', { class: 'tasks-focus-count', text: String(getFocusVisibleTasks().length) }));
  left.appendChild(tools);

  const visible = getFocusVisibleTasks();
  if (!state.tasks.length) {
    left.appendChild(el('div', { class: 'tasks-focus-empty', text: 'No tasks match the current filters.' }));
    return;
  }
  if (!visible.length) {
    left.appendChild(el('div', { class: 'tasks-focus-empty', text: 'No visible tasks match search.' }));
    return;
  }

  for (const task of visible) {
    left.appendChild(renderFocusRow(task));
  }
}

function getFocusVisibleTasks() {
  const q = state.focusSearch.trim().toLowerCase();
  if (!q) return state.tasks;
  return state.tasks.filter(t => String(t.title || '').toLowerCase().includes(q));
}

function renderFocusRow(task) {
  const row = el('button', { class: 'tasks-focus-row' });
  row.type = 'button';
  row.dataset.taskId = String(task.id);
  const selectedInList = state.expandedTaskId === task.id;
  row.classList.toggle('active', selectedInList);

  const cat = getCategory(task);
  const st = getStatus(task);

  const bar = el('span', { class: 'tasks-focus-cat-bar' });
  if (cat) bar.style.background = cat.color;
  row.appendChild(bar);

  const dot = el('span', { class: 'tasks-focus-status-dot' });
  if (st) dot.style.background = st.color;
  row.appendChild(dot);

  row.appendChild(el('span', { class: 'tasks-focus-row-title', text: task.title || '(untitled)' }));
  if (task.is_pinned) row.appendChild(el('span', { class: 'tasks-focus-pin', text: '📌' }));

  row.addEventListener('click', async () => {
    state.expandedTaskId = task.id;
    state.selectedTask = task;
    await renderTaskList();
  });
  return row;
}
```

- [x] **Step 4: Add Focus right pane renderer**

Add:

```js
async function renderFocusRightPane(right) {
  const selected = findTaskById(state.expandedTaskId);
  if (!selected) {
    const text = state.tasks.length
      ? 'Select a task from the list.'
      : 'No tasks match the current filters.';
    right.appendChild(el('div', { class: 'tasks-focus-detail-empty', text }));
    return;
  }

  state.selectedTask = selected;

  if (isSelectedOutsideTopFilters()) {
    const banner = el('div', { class: 'tasks-focus-outside-banner' });
    banner.appendChild(el('span', { text: 'Opened from pinned chips. This task is outside current filters.' }));
    const showBtn = document.createElement('button');
    showBtn.className = 'task-editor-btn tasks-focus-show-in-list';
    showBtn.type = 'button';
    showBtn.textContent = 'Show in list';
    showBtn.addEventListener('click', async () => showSelectedTaskInList(selected));
    banner.appendChild(showBtn);
    right.appendChild(banner);
  }

  const card = renderCard(selected, {
    expanded: true,
    state,
    onExpandToggle: async () => {
      state.expandedTaskId = null;
      state.selectedTask = null;
      await renderTaskList();
    },
    onTaskReload: async () => reloadTasks(),
  });
  card.classList.add('tasks-focus-card');
  right.appendChild(card);
}
```

- [x] **Step 5: Add `Show in list`**

Add:

```js
async function showSelectedTaskInList(task) {
  state.filter.category = task.category_id == null ? 'none' : String(task.category_id);
  state.filter.status = task.status_id == null ? 'none' : String(task.status_id);
  state.expandedTaskId = task.id;
  state.selectedTask = task;
  state.focusSearch = '';
  await reloadTasks();
}
```

- [x] **Step 6: Update `openExpanded` for pinned outside filters**

Change `openExpanded(id)` to accept an optional snapshot:

```js
export async function openExpanded(id, taskSnapshot = null) {
  state.expandedTaskId = id;
  if (taskSnapshot) state.selectedTask = taskSnapshot;
  await renderTaskList();
  setTimeout(() => {
    const card = state.root.querySelector(`[data-task-id="${id}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 50);
}
```

Change pinned chip rendering to pass the task snapshot:

```js
renderPinnedChips(el, state.pinned, state.categories, (task) => openExpanded(task.id, task));
```

- [x] **Step 7: Add Focus view CSS**

Append to `desktop-rust/src/tabs/tasks/tasks-css.js`:

```css
.tasks-cards-scroll.focus {
  padding: 0;
  display: flex;
  overflow: hidden;
}
.tasks-focus-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.tasks-focus-list {
  width: 34%;
  min-width: 260px;
  max-width: 390px;
  border-right: 1px solid var(--border);
  background: var(--bg-primary);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}
.tasks-focus-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.tasks-focus-search {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text);
  padding: 6px 8px;
  font-size: 12px;
}
.tasks-focus-count {
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
}
.tasks-focus-row {
  width: 100%;
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.tasks-focus-row:hover { background: var(--bg-secondary); }
.tasks-focus-row.active {
  border-color: var(--accent);
  background: rgba(56, 139, 253, 0.14);
}
.tasks-focus-cat-bar {
  width: 3px;
  height: 15px;
  border-radius: 2px;
  background: var(--text-muted);
  flex-shrink: 0;
}
.tasks-focus-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}
.tasks-focus-row-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.tasks-focus-pin {
  flex-shrink: 0;
  font-size: 11px;
}
.tasks-focus-detail {
  flex: 1;
  min-width: 0;
  padding: 12px;
  overflow-y: auto;
}
.tasks-focus-card {
  margin-bottom: 0;
}
.tasks-focus-empty,
.tasks-focus-detail-empty {
  padding: 24px;
  color: var(--text-muted);
  font-style: italic;
  text-align: center;
}
.tasks-focus-outside-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  margin-bottom: 10px;
  border: 1px solid rgba(245, 158, 11, 0.45);
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.10);
  color: #fbbf24;
  font-size: 12px;
}
.tasks-focus-show-in-list {
  flex-shrink: 0;
}
```

- [x] **Step 8: Verify Task 3**

Run:

```bash
node --check desktop-rust/src/tabs/tasks/index.js
cd desktop-rust/src && python3 dev-test.py
```

Expected:

```text
PASS  T16 Tasks Focus view layout/search/outside pinned
```

If the test still fails on filter picking, inspect the exact dropdown text from the failure and adjust the smoke selector, not production behavior.

---

## Task 4: Polish Reload Behavior And Docs

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/index.js`
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `FRONTEND_PATTERNS.md`

- [x] **Step 1: Keep selected task snapshot after reloads**

In `reloadTasks()`, after `await loadPinned();`, add:

```js
if (state.expandedTaskId != null) {
  state.selectedTask = findTaskById(state.expandedTaskId);
}
```

If `findTaskById(...)` returns null but `state.selectedTask` has the same id, keep `state.selectedTask` unchanged.

Use:

```js
if (state.expandedTaskId != null) {
  state.selectedTask = findTaskById(state.expandedTaskId)
    || (state.selectedTask && state.selectedTask.id === state.expandedTaskId ? state.selectedTask : null);
}
```

- [x] **Step 2: Update Help text**

In `desktop-rust/src/tabs/help.js`, update `tasks_desc` in both `en` and `ru` to mention:

```text
Focus view with a searchable left task index and selected task editor on the right.
```

and in RU:

```text
Focus view: слева поиск и компактный список задач, справа редактор выбранной задачи.
```

- [x] **Step 3: Update Changelog**

Add to top of `desktop-rust/CHANGELOG.md` under `## Unreleased`:

```markdown
- **Tasks:** added `Focus view`, a third layout mode with a searchable compact
  task index on the left and the selected task editor on the right. Pinned
  tasks outside current filters open in the detail pane without changing
  filters, with a `Show in list` action.
```

- [x] **Step 4: Update frontend pattern docs**

Add a `Focus split view` section to `FRONTEND_PATTERNS.md`:

```markdown
## §6 Focus split view

**Used in:** Tasks tab Focus view

Use this pattern when an existing card/list module needs a focused
single-item editor without removing global filters.

- Keep global filters and pinned/shortcut chips above the split.
- Left pane is a compact index of the currently filtered items.
- Local search filters only the left pane's already-visible items.
- Right pane can render an item outside current filters when opened from a
  global chip; show a banner and an explicit action to adjust filters.
- Do not mix compact-index rows with card drag-and-drop unless a separate
  reorder design is approved.
```

- [x] **Step 5: Verify Task 4**

Run:

```bash
node --check desktop-rust/src/tabs/tasks/index.js
node --check desktop-rust/src/tabs/help.js
python3 -m py_compile desktop-rust/src/dev-test.py
git diff --check
cd desktop-rust/src && python3 dev-test.py
```

Expected:

```text
=== 23/23 passed ===
```

The exact total may be higher if other tests were added after this plan; all tests must pass.

---

## Task 5: Release Checkpoint

**Files:**
- Commit all modified files from Tasks Focus view.

- [x] **Step 1: Run Rust sanity check**

Run:

```bash
cd desktop-rust/src-tauri && /home/aster/.cargo/bin/cargo check
```

Expected: command exits `0`; existing warnings are acceptable if unchanged.

- [x] **Step 2: Commit**

Run:

```bash
git add .workflow/specs/2026-05-22-tasks-focus-view.md \
        .workflow/plans/2026-05-22-tasks-focus-view.md \
        FRONTEND_PATTERNS.md \
        desktop-rust/CHANGELOG.md \
        desktop-rust/src/dev-mock.js \
        desktop-rust/src/dev-test.py \
        desktop-rust/src/tabs/help.js \
        desktop-rust/src/tabs/tasks/index.js \
        desktop-rust/src/tabs/tasks/tasks-css.js
git commit -m "feat: add tasks focus view"
```

- [x] **Step 3: Cut frontend-only OTA release**

Because this is frontend-only and does not add/modify Tauri IPC commands, use an `f-*` tag:

```bash
git tag f-20260522-2
git push origin main
git push origin f-20260522-2
```

If `f-20260522-2` already exists, increment the suffix.

- [x] **Step 4: Verify release assets**

Run:

```bash
wget -qO- https://api.github.com/repos/IgorSterkhov/snippets_helper/actions/runs?branch=f-20260522-2\&per_page=5
wget -qO- https://api.github.com/repos/IgorSterkhov/snippets_helper/releases/tags/f-20260522-2
wget -qO- https://github.com/IgorSterkhov/snippets_helper/releases/download/f-20260522-2/frontend-version.json
```

Expected:

- `release-frontend` job succeeds;
- native `release` job is skipped;
- release has exactly 3 assets: frontend zip, `frontend-version.json`, `latest.json`;
- `frontend-version.json.version` ends with the new commit SHA.

---

## Self-Review

- Spec coverage: covered mode naming/icon, B+search layout, top filters/chips, pinned outside filters, `Show in list`, persistence, no DnD in compact index, empty states, and smoke tests.
- Placeholder scan: no unfinished placeholders or undefined task steps remain.
- Type consistency: mode values are consistently `one-col`, `two-col`, and `focus`; DOM ids/classes match the test plan.
