# Repo Search Groups & Multi-Add Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named groups (with icon + color) to Repo Search, a tab strip
that filters chips + search scope per-group, inline per-tab
select-all/none controls, and multi-folder Add so a batch of repos lands
in one dialog.

**Architecture:** Matches the spec at `.workflow/specs/2026-04-21-repo-groups-design.md`.
Backend keeps the existing "JSON blob in `settings` table" pattern —
groups live under key `repo_search_groups`, each `RepoEntry` gains an
optional `group_id`. Frontend adds a tab strip above the current chip
row; everything else (search execution, chip rendering inside the active
tab) stays as today. Edit on a chip uses a net-new `update_repo` command;
delete-group cascades `group_id → None` on affected repos.

**Tech Stack:** Rust + Tauri 2 + rusqlite for backend; plain JS modules
for frontend; `tauri-plugin-dialog` for the folder picker; Python + CDP
for headless UI tests (via the browser mock).

---

## Conventions

- **Commit style:** short 1-line per CLAUDE.md #5. Commit after each task,
  not each step.
- **Cargo check:** run `cd desktop-rust/src-tauri && cargo check` after any
  Rust edit — the full build takes minutes, `cargo check` is seconds.
- **Browser mock tests:** `cd desktop-rust/src && python3 dev-test.py`
  — must be 7/7 (then 12/12 after new tests are added) for every commit.
- **No Docker rebuild needed** until the full end-to-end screenshot
  re-test at the end.
- **File paths in this plan are relative to repo root** unless prefixed
  with `/`.

---

## Chunk 1: Backend — groups storage & commands

All changes in `desktop-rust/src-tauri/src/commands/repo_search.rs` plus
one-line additions to `lib.rs`.

### Task 1.1: `RepoGroup` struct + `group_id` on `RepoEntry`

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/repo_search.rs`

**Why the test is first:** we need to confirm old `repo_search_repos`
blobs still deserialise after the schema change (backward compat).

- [ ] **Step 1: Write the failing test**

Append to the existing `#[cfg(test)]` block at the bottom of
`repo_search.rs` (create it if missing):

```rust
#[test]
fn legacy_repo_entry_deserialises_with_none_group() {
    let legacy = r#"[{"name":"r1","path":"/tmp/r1","color":"#3b82f6"}]"#;
    let parsed: Vec<RepoEntry> = serde_json::from_str(legacy).unwrap();
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].name, "r1");
    assert!(parsed[0].group_id.is_none());
}
```

- [ ] **Step 2: Run, confirm it fails**

```
cd desktop-rust/src-tauri && cargo test -p keyboard-helper legacy_repo_entry_deserialises_with_none_group
```

Expected: compile error (`RepoEntry` has no field `group_id`) or test
failure.

- [ ] **Step 3: Add the new field + new struct**

Edit `RepoEntry`:

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RepoEntry {
    pub name: String,
    pub path: String,
    pub color: String,
    #[serde(default)]
    pub group_id: Option<i64>,
}
```

Keep the full `Clone, Debug, Serialize, Deserialize` derive list — the existing `Debug` derive is not optional.

Add below `RepoEntry`:

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RepoGroup {
    pub id: i64,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub sort_order: i32,
}
```

- [ ] **Step 4: Run, confirm the legacy-compat test passes**

```
cd desktop-rust/src-tauri && cargo test -p keyboard-helper legacy_repo_entry_deserialises_with_none_group
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-rust/src-tauri/src/commands/repo_search.rs
git commit -m "add RepoGroup + group_id on RepoEntry (backward-compat)"
```

---

### Task 1.2: Group CRUD helpers + `list_repo_groups`

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/repo_search.rs`

- [ ] **Step 1: Write test**

```rust
#[test]
fn load_groups_empty_when_key_missing() {
    // We don't have a conn fixture; instead prove the fallback via the JSON parse.
    let parsed: Vec<RepoGroup> = serde_json::from_str("[]").unwrap();
    assert!(parsed.is_empty());
}
```

- [ ] **Step 2: Add `load_groups` / `save_groups` mirroring `load_repos` / `save_repos`**

Under the existing `save_repos` fn, add:

```rust
fn load_groups(conn: &rusqlite::Connection, computer_id: &str) -> Vec<RepoGroup> {
    let raw = queries::get_setting(conn, computer_id, "repo_search_groups")
        .ok().flatten().unwrap_or_else(|| "[]".to_string());
    serde_json::from_str::<Vec<RepoGroup>>(&raw).unwrap_or_default()
}

fn save_groups(conn: &rusqlite::Connection, computer_id: &str, groups: &[RepoGroup]) -> Result<(), String> {
    let json = serde_json::to_string(groups).map_err(|e| e.to_string())?;
    queries::set_setting(conn, computer_id, "repo_search_groups", &json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_repo_groups(state: State<DbState>) -> Result<Vec<RepoGroup>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    Ok(load_groups(&conn, &cid))
}
```

- [ ] **Step 3: Run `cargo check`**

Expected: compiles clean. If the `State<DbState>` / `queries::*` imports
aren't already present at the top of the file (they are — they're used
for repos), nothing else to add.

- [ ] **Step 4: Commit**

```bash
git commit -am "add list_repo_groups + load/save helpers"
```

---

### Task 1.3: `add_repo_group` with unique-name check

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/repo_search.rs`

- [ ] **Step 1: Add command**

```rust
#[tauri::command]
pub fn add_repo_group(
    state: State<DbState>,
    name: String,
    icon: String,
    color: String,
) -> Result<RepoGroup, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    let mut groups = load_groups(&conn, &cid);
    if name.trim().is_empty() {
        return Err("Name is required".to_string());
    }
    if groups.iter().any(|g| g.name == name) {
        return Err(format!("Group '{}' already exists", name));
    }
    let next_id = groups.iter().map(|g| g.id).max().unwrap_or(0) + 1;
    let group = RepoGroup {
        id: next_id,
        name,
        icon,
        color,
        sort_order: 0,
    };
    groups.push(group.clone());
    save_groups(&conn, &cid, &groups)?;
    Ok(group)
}
```

- [ ] **Step 2: Run `cargo check`** — expect clean.

- [ ] **Step 3: Commit**

```bash
git commit -am "add add_repo_group with unique-name check"
```

---

### Task 1.4: `update_repo_group`

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/repo_search.rs`

- [ ] **Step 1: Add command**

```rust
#[tauri::command]
pub fn update_repo_group(
    state: State<DbState>,
    id: i64,
    name: String,
    icon: String,
    color: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    let mut groups = load_groups(&conn, &cid);
    if name.trim().is_empty() {
        return Err("Name is required".to_string());
    }
    if groups.iter().any(|g| g.name == name && g.id != id) {
        return Err(format!("Group '{}' already exists", name));
    }
    let found = groups.iter_mut().find(|g| g.id == id);
    match found {
        Some(g) => { g.name = name; g.icon = icon; g.color = color; }
        None => return Err(format!("Group #{} not found", id)),
    }
    save_groups(&conn, &cid, &groups)
}
```

- [ ] **Step 2: `cargo check`** — clean.

- [ ] **Step 3: Commit**

```bash
git commit -am "add update_repo_group"
```

---

### Task 1.5: `remove_repo_group` with cascade

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/repo_search.rs`

This is the subtlest one — must clear `group_id` on every repo under the
same mutex lock. Extract the cascade into a pure fn so it's actually
testable without a DB connection.

- [ ] **Step 1: Add pure helper + real test**

Add above `remove_repo_group`:

```rust
fn clear_group_from_repos(repos: &mut [RepoEntry], gid: i64) -> bool {
    let mut changed = false;
    for r in repos.iter_mut() {
        if r.group_id == Some(gid) {
            r.group_id = None;
            changed = true;
        }
    }
    changed
}
```

Add in the test block:

```rust
#[test]
fn clear_group_from_repos_only_touches_matching_entries() {
    let mut repos = vec![
        RepoEntry { name: "a".into(), path: "/a".into(), color: "#fff".into(), group_id: Some(1) },
        RepoEntry { name: "b".into(), path: "/b".into(), color: "#fff".into(), group_id: Some(2) },
        RepoEntry { name: "c".into(), path: "/c".into(), color: "#fff".into(), group_id: None },
    ];
    assert!(clear_group_from_repos(&mut repos, 1));
    assert!(repos[0].group_id.is_none());
    assert_eq!(repos[1].group_id, Some(2));
    assert!(repos[2].group_id.is_none());
    // Second call on the same id — nothing changes.
    assert!(!clear_group_from_repos(&mut repos, 1));
}
```

This actually exercises the production code path, not a local copy.

- [ ] **Step 2: Add command using the helper**

```rust
#[tauri::command]
pub fn remove_repo_group(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();

    // 1. Cascade: clear group_id on every repo that pointed at this group.
    let mut repos = load_repos(&conn, &cid);
    if clear_group_from_repos(&mut repos, id) {
        save_repos(&conn, &cid, &repos)?;
    }

    // 2. Drop the group.
    let mut groups = load_groups(&conn, &cid);
    groups.retain(|g| g.id != id);
    save_groups(&conn, &cid, &groups)
}
```

- [ ] **Step 3: `cargo test -p keyboard-helper clear_group_from_repos_only_touches_matching_entries`** — passes.

- [ ] **Step 4: Commit**

```bash
git commit -am "add remove_repo_group with cascade to Ungrouped"
```

---

### Task 1.6: `update_repo` (net-new)

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/repo_search.rs`

The UI currently does remove+add to edit a chip. This command replaces
that with one atomic call, and is the only way to change `group_id` on
an existing repo.

- [ ] **Step 1: Add command**

```rust
#[tauri::command]
pub fn update_repo(
    state: State<DbState>,
    old_name: String,
    name: String,
    path: String,
    color: String,
    group_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    let mut repos = load_repos(&conn, &cid);

    if name.trim().is_empty() {
        return Err("Name is required".to_string());
    }
    // Uniqueness (excluding the record being edited)
    if repos.iter().any(|r| r.name == name && r.name != old_name) {
        return Err(format!("Repo '{}' already exists", name));
    }

    let found = repos.iter_mut().find(|r| r.name == old_name);
    match found {
        Some(r) => { r.name = name; r.path = path; r.color = color; r.group_id = group_id; }
        None => return Err(format!("Repo '{}' not found", old_name)),
    }
    save_repos(&conn, &cid, &repos)
}
```

- [ ] **Step 2: `cargo check`** — clean.

- [ ] **Step 3: Commit**

```bash
git commit -am "add update_repo command"
```

---

### Task 1.7: extend `add_repo` with `group_id`

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/repo_search.rs`

- [ ] **Step 1: Update signature + body**

Replace the existing `add_repo` with:

```rust
#[tauri::command]
pub fn add_repo(
    state: State<DbState>,
    name: String,
    path: String,
    color: String,
    group_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    let mut repos = load_repos(&conn, &cid);
    if repos.iter().any(|r| r.name == name) {
        return Err(format!("Repo with name '{}' already exists", name));
    }
    repos.push(RepoEntry { name, path, color, group_id });
    save_repos(&conn, &cid, &repos)
}
```

Tauri's parameter bridge treats `Option<i64>` as `null` when missing, so
existing callers that pass `{name, path, color}` without `group_id`
continue to work (they just get `None`).

- [ ] **Step 2: `cargo check`** — clean.

- [ ] **Step 3: Commit**

```bash
git commit -am "add_repo now accepts optional group_id"
```

---

### Task 1.8: register new commands in `lib.rs`

**Files:**
- Modify: `desktop-rust/src-tauri/src/lib.rs`

- [ ] **Step 1: Append to the `invoke_handler` macro**

Under the `// Repo Search` section, after the existing
`commands::repo_search::remove_repo`, add:

```rust
            commands::repo_search::update_repo,
            commands::repo_search::list_repo_groups,
            commands::repo_search::add_repo_group,
            commands::repo_search::update_repo_group,
            commands::repo_search::remove_repo_group,
```

- [ ] **Step 2: `cargo check`** — clean.

- [ ] **Step 3: Commit**

```bash
git commit -am "register repo-group + update_repo commands"
```

---

## Chunk 2: Browser mock — new commands

**Files:**
- Modify: `desktop-rust/src/dev-mock.js`

Patterns to mirror: the mock already has `list_repos` / `add_repo` /
`remove_repo`. Same `storeGet` / `storeSet` helpers work for groups.

### Task 2.1: mock group commands + extended repo commands

- [ ] **Step 1: Write new CDP test (failing)**

Add at the bottom of `dev-test.py` inside `run_tests`:

```python
async def t8_create_group():
    result = await cdp.eval("""(async () => {
      const g = await window.__TAURI__.core.invoke('add_repo_group', { name: 'Databases', icon: '🗄', color: '#3b82f6' });
      const list = await window.__TAURI__.core.invoke('list_repo_groups');
      return { created: g, count: list.length, name: list[0]?.name };
    })()""")
    assert result['count'] == 1 and result['name'] == 'Databases', result
await check('T8 create group via mock', t8_create_group)
```

- [ ] **Step 2: Run, expect fail**

```
cd desktop-rust/src && python3 dev-test.py
```

Expected: T8 fails because the mock has no `add_repo_group`.

- [ ] **Step 3: Add mocks**

In `dev-mock.js`, inside the `commands` object, add after the existing
repo commands:

```javascript
// Groups
async list_repo_groups() {
  return storeGet('repo_groups', []);
},
async add_repo_group({ name, icon, color }) {
  if (!name || !name.trim()) throw new Error('Name is required');
  const groups = storeGet('repo_groups', []);
  if (groups.some(g => g.name === name)) throw new Error(`Group '${name}' already exists`);
  const id = (groups.reduce((m, g) => Math.max(m, g.id), 0)) + 1;
  const group = { id, name, icon: icon || '', color: color || '#3b82f6', sort_order: 0 };
  groups.push(group);
  storeSet('repo_groups', groups);
  return group;
},
async update_repo_group({ id, name, icon, color }) {
  const groups = storeGet('repo_groups', []);
  if (groups.some(g => g.name === name && g.id !== id)) throw new Error(`Group '${name}' already exists`);
  const g = groups.find(g => g.id === id);
  if (!g) throw new Error(`Group #${id} not found`);
  g.name = name; g.icon = icon; g.color = color;
  storeSet('repo_groups', groups);
},
async remove_repo_group({ id }) {
  // Cascade
  const repos = storeGet('repos', []).map(r => r.group_id === id ? { ...r, group_id: null } : r);
  storeSet('repos', repos);
  const groups = storeGet('repo_groups', []).filter(g => g.id !== id);
  storeSet('repo_groups', groups);
},
async update_repo({ old_name, name, path, color, group_id }) {
  const repos = storeGet('repos', []);
  if (repos.some(r => r.name === name && r.name !== old_name)) throw new Error(`Repo '${name}' already exists`);
  const r = repos.find(x => x.name === old_name);
  if (!r) throw new Error(`Repo '${old_name}' not found`);
  r.name = name; r.path = path; r.color = color; r.group_id = group_id ?? null;
  storeSet('repos', repos);
},
```

Also extend the existing `add_repo` mock to accept `group_id`:

```javascript
async add_repo({ name, path, color, group_id }) {
  const repos = storeGet('repos', []);
  if (repos.some(r => r.name === name)) throw new Error(`Repo '${name}' already exists`);
  repos.push({ name, path, color, group_id: group_id ?? null });
  storeSet('repos', repos);
},
```

- [ ] **Step 4: Run tests, expect T8 passes**

```
cd desktop-rust/src && python3 dev-test.py
```

Expected: 8/8 pass.

- [ ] **Step 5: Commit**

```bash
git commit -am "dev-mock: add group commands + update_repo"
```

---

## Chunk 3: Frontend UI — tab strip + active-tab scope

All changes in `desktop-rust/src/tabs/repo-search.js`. This chunk touches
only the chip area, not the Add flow.

### Task 3.1: load groups + compute active tab

- [ ] **Step 1: Add state + loader**

At the top of the file (around the other `let` declarations):

```javascript
let allGroups = [];         // RepoGroup[]
let activeTabId = 'all';    // 'all' | group.id (number) | 'ungrouped'
```

Update `loadInitData` and `destroy`:

```javascript
async function loadInitData() {
  try {
    allRepos = await call('list_repos');
    allGroups = await call('list_repo_groups');
    activeRepos = new Set(allRepos.map(r => r.name));
    // Clamp activeTabId if it points at a now-deleted group.
    if (typeof activeTabId === 'number' && !allGroups.some(g => g.id === activeTabId)) {
      activeTabId = 'all';
    }
  } catch {
    allRepos = []; allGroups = []; activeRepos = new Set(); activeTabId = 'all';
  }
  try {
    const val = await call('get_setting', { key: 'search_context_lines' });
    contextLines = parseInt(val) || 3;
  } catch { contextLines = 3; }
}

export function destroy() {
  if (root) root.innerHTML = '';
  results = [];
  activeTabId = 'all';   // reset so the next init starts clean
}
```

- [ ] **Step 2: Add helpers**

After `loadInitData`, add:

```javascript
function reposForActiveTab() {
  if (activeTabId === 'all') return allRepos;
  if (activeTabId === 'ungrouped') return allRepos.filter(r => !r.group_id);
  return allRepos.filter(r => r.group_id === activeTabId);
}

function hasUngroupedRepos() {
  return allRepos.some(r => !r.group_id);
}
```

- [ ] **Step 3: `dev-test.py` must still be 8/8**

- [ ] **Step 4: Commit**

```bash
git commit -am "repo-search: load groups + active tab state"
```

---

### Task 3.2: render tab strip

- [ ] **Step 1: Add `renderTabStrip`**

After `renderRepoChips`, add:

```javascript
function renderTabStrip(containerEl) {
  const bar = containerEl || root.querySelector('#rs-tab-strip');
  if (!bar) return;
  bar.innerHTML = '';

  const tabs = [{ id: 'all', name: 'All', icon: '', color: '' }];
  const sorted = [...allGroups].sort((a, b) => a.name.localeCompare(b.name));
  tabs.push(...sorted.map(g => ({ id: g.id, name: g.name, icon: g.icon || '', color: g.color || '' })));
  if (hasUngroupedRepos()) {
    tabs.push({ id: 'ungrouped', name: 'Ungrouped', icon: '◌', color: '' });
  }

  for (const t of tabs) {
    const btn = document.createElement('button');
    btn.className = 'rs-tab' + (t.id === activeTabId ? ' active' : '');
    btn.dataset.tabId = t.id;
    if (t.icon) {
      const ic = document.createElement('span');
      ic.className = 'rs-tab-icon';
      ic.textContent = t.icon;
      if (t.color) ic.style.color = t.color;
      btn.appendChild(ic);
    }
    btn.appendChild(document.createTextNode(t.name));
    btn.addEventListener('click', () => {
      activeTabId = t.id;
      renderTabStrip();
      renderRepoChips();
    });
    // Inline select controls on the active tab
    if (t.id === activeTabId) {
      const selAll = document.createElement('span');
      selAll.className = 'rs-tab-sel';
      selAll.textContent = '✓';
      selAll.title = 'Select all in tab';
      selAll.addEventListener('click', (e) => { e.stopPropagation(); scopeSelect(true); });
      btn.appendChild(selAll);
      const selNone = document.createElement('span');
      selNone.className = 'rs-tab-sel';
      selNone.textContent = '⊘';
      selNone.title = 'Deselect all in tab';
      selNone.addEventListener('click', (e) => { e.stopPropagation(); scopeSelect(false); });
      btn.appendChild(selNone);
    }
    bar.appendChild(btn);
  }

  // "+" at the end
  const addBtn = document.createElement('button');
  addBtn.className = 'rs-tab rs-tab-add';
  addBtn.textContent = '+';
  addBtn.title = 'New group';
  addBtn.addEventListener('click', showNewGroupModal);
  bar.appendChild(addBtn);
}

function scopeSelect(select) {
  const scope = reposForActiveTab();
  for (const r of scope) {
    if (select) activeRepos.add(r.name);
    else activeRepos.delete(r.name);
  }
  renderRepoChips();
}
```

- [ ] **Step 2: Mount the tab strip**

In `buildLayout`, after the existing topbar and before the chip bar,
insert:

```javascript
  const tabStrip = el('div', { class: 'rs-tab-strip', id: 'rs-tab-strip' });
  wrap.appendChild(tabStrip);
  renderTabStrip(tabStrip);
```

- [ ] **Step 3: Filter chips by active tab**

In `renderRepoChips`, **only the outer loop header** changes — the body
(chip creation, hooks, color bars) stays identical, and the `+` add
button at the end of the function stays outside the loop, untouched.

Replace just this line:

```javascript
  for (const repo of allRepos) {
```

with:

```javascript
  const scope = reposForActiveTab();
  for (const repo of scope) {
```

Everything else in that function is unchanged.

- [ ] **Step 4: Add CSS**

Append to the `css()` string return (near the top, before existing
`.rs-topbar` rules):

```css
.rs-tab-strip {
  display: flex;
  gap: 2px;
  padding: 6px 12px 0;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}
.rs-tab {
  padding: 5px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 5px 5px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.rs-tab.active {
  background: var(--bg-secondary);
  border-color: var(--border);
  color: var(--text);
}
.rs-tab-icon { display: inline-flex; font-size: 11px; }
.rs-tab-sel {
  padding: 0 4px;
  cursor: pointer;
  font-size: 11px;
  opacity: 0.7;
  margin-left: 3px;
  border-radius: 3px;
}
.rs-tab-sel:hover { opacity: 1; background: rgba(255,255,255,0.05); }
.rs-tab-add { color: var(--text-muted); font-weight: bold; padding: 5px 8px; }
.rs-tab-add:hover { color: var(--text); }
```

- [ ] **Step 5: `dev-test.py`** — 8/8 still pass (no new failures).

- [ ] **Step 6: Commit**

```bash
git commit -am "repo-search: tab strip with active-tab select controls"
```

---

## Chunk 4: Group CRUD UI

### Task 4.1: New Group mini-modal

**Files:**
- Modify: `desktop-rust/src/tabs/repo-search.js`

- [ ] **Step 1: Add the modal**

```javascript
const CURATED_ICONS = ['🗄','🔄','🌐','💻','📱','🔧','📄','⚡','🤖','📊','🔒','🧪','🚀','🎨','📁'];
const PALETTE_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#a855f7','#14b8a6','#f43f5e','#6366f1','#eab308','#8b949e'];
function randomPaletteColor() { return PALETTE_COLORS[Math.floor(Math.random() * PALETTE_COLORS.length)]; }

async function showNewGroupModal(existing) {
  const body = document.createElement('div');
  body.innerHTML = `
    <label style="display:block;margin-bottom:4px">Name</label>
    <input id="g-name" style="width:100%" placeholder="e.g. Databases" />
    <label style="display:block;margin-top:10px;margin-bottom:4px">Icon</label>
    <div id="g-icon-grid" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px"></div>
    <input id="g-icon" style="width:100%" maxlength="2" placeholder="or type 1-2 chars / emoji" />
    <label style="display:block;margin-top:10px;margin-bottom:4px">Color</label>
    <div id="g-color-grid" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px"></div>
    <input id="g-color" type="color" style="width:100%;height:30px" />
  `;
  body.querySelector('#g-name').value = existing?.name || '';
  body.querySelector('#g-icon').value = existing?.icon || '';
  body.querySelector('#g-color').value = existing?.color || randomPaletteColor();

  const iconGrid = body.querySelector('#g-icon-grid');
  for (const ic of CURATED_ICONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = ic;
    btn.style.cssText = 'font-size:16px;padding:4px 8px;background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer';
    btn.addEventListener('click', () => { body.querySelector('#g-icon').value = ic; });
    iconGrid.appendChild(btn);
  }
  const colorGrid = body.querySelector('#g-color-grid');
  for (const c of PALETTE_COLORS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = `width:20px;height:20px;background:${c};border:1px solid var(--border);border-radius:3px;cursor:pointer;padding:0`;
    btn.addEventListener('click', () => { body.querySelector('#g-color').value = c; });
    colorGrid.appendChild(btn);
  }

  try {
    await showModal({
      title: existing ? 'Edit Group' : 'New Group',
      body,
      // Refresh inside onConfirm so real errors don't get swallowed by the
      // outer try/catch that also catches the modal's 'cancelled' rejection.
      onConfirm: async () => {
        const name = body.querySelector('#g-name').value.trim();
        const icon = body.querySelector('#g-icon').value.trim();
        const color = body.querySelector('#g-color').value;
        if (!name) throw new Error('Name is required');
        if (existing) {
          await call('update_repo_group', { id: existing.id, name, icon, color });
        } else {
          const g = await call('add_repo_group', { name, icon, color });
          activeTabId = g.id;
        }
        allGroups = await call('list_repo_groups');
        renderTabStrip();
        renderRepoChips();
      },
    });
  } catch { /* user cancelled */ }
}
```

**Note on color helpers:** the existing file has `randomColor()` at
line ~381 using a different 6-colour palette. This plan adds
`randomPaletteColor()` with the 15 PALETTE_COLORS specifically for the
group + multi-add flows. Do not remove or alter the existing
`randomColor` — its callers (settings-panel) are out of scope for this
plan.

- [ ] **Step 2: `showNewGroupModal` is already wired to `+` from Task 3.2.**

- [ ] **Step 3: `showModal` import**

Confirm the top of `repo-search.js` has `import { showModal } from '../components/modal.js';`
— if not, add it.

- [ ] **Step 4: CDP test for create via UI**

Add to `dev-test.py`:

```python
async def t9_create_group_via_ui():
    await cdp.eval("document.querySelector('.rs-tab-add').click()")
    await wait_until(cdp, "!!document.querySelector('#g-name')", timeout=3)
    await cdp.eval("document.querySelector('#g-name').value='Airflow'; document.querySelector('#g-name').dispatchEvent(new Event('input'))")
    await cdp.eval("[...document.querySelectorAll('.modal-overlay')].pop().querySelector('.modal-actions button:last-child').click()")
    await wait_until(cdp, "[...document.querySelectorAll('.rs-tab')].some(b => b.textContent.includes('Airflow'))", timeout=3)
await check('T9 create group via UI', t9_create_group_via_ui)
```

- [ ] **Step 5: Run tests** — 9/9 pass.

- [ ] **Step 6: Commit**

```bash
git commit -am "repo-search: new / edit group mini-modal"
```

---

### Task 4.2: right-click context menu on group tabs

**Files:**
- Modify: `desktop-rust/src/tabs/repo-search.js`

- [ ] **Step 1: Attach contextmenu handler in `renderTabStrip`**

Inside the loop, **after** `btn.addEventListener('click', ...)`, when
`t.id` is a number (i.e. a real group tab), add:

```javascript
    if (typeof t.id === 'number') {
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showGroupContextMenu(e.clientX, e.clientY, allGroups.find(g => g.id === t.id));
      });
    }
```

- [ ] **Step 2: Add `showGroupContextMenu`**

```javascript
function showGroupContextMenu(x, y, group) {
  if (!group) return;
  const menu = document.createElement('div');
  menu.className = 'rs-ctx-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:4px 0;z-index:9999;min-width:140px`;
  const make = (text, handler) => {
    const item = document.createElement('div');
    item.textContent = text;
    item.style.cssText = 'padding:6px 14px;cursor:pointer;font-size:12px';
    item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.05)');
    item.addEventListener('mouseleave', () => item.style.background = 'transparent');
    item.addEventListener('click', () => { menu.remove(); handler(); });
    return item;
  };
  menu.appendChild(make('Edit group', () => showNewGroupModal(group)));
  menu.appendChild(make('Delete group', async () => {
    try {
      await showModal({
        title: 'Delete Group',
        body: `Delete group "${group.name}"? Repos will move to Ungrouped.`,
        onConfirm: async () => { await call('remove_repo_group', { id: group.id }); },
      });
      if (activeTabId === group.id) activeTabId = 'all';
      allGroups = await call('list_repo_groups');
      allRepos = await call('list_repos');
      renderTabStrip();
      renderRepoChips();
    } catch { /* cancelled */ }
  }));
  document.body.appendChild(menu);
  const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}
```

- [ ] **Step 3: CDP test — cascade on `remove_repo_group`**

Self-contained (creates its own group + repo so it survives test
reordering). Tests the *backend cascade*, not the right-click menu
(CDP `contextmenu` synthesis is too flaky to rely on). UI-level delete
is covered manually.

```python
async def t10_remove_repo_group_cascade():
    setup = await cdp.eval("""(async () => {
      const g = await window.__TAURI__.core.invoke('add_repo_group', { name: 'CascadeGrp', icon: '', color: '#10b981' });
      await window.__TAURI__.core.invoke('add_repo', { name: 'cascade-repo', path: '/tmp/cascade-repo', color: '#fff', group_id: g.id });
      return g.id;
    })()""")
    await cdp.eval(f"window.__TAURI__.core.invoke('remove_repo_group', {{ id: {setup} }})")
    result = await cdp.eval("""(async () => {
      const repos = await window.__TAURI__.core.invoke('list_repos');
      const r = repos.find(x => x.name === 'cascade-repo');
      return { still_present: !!r, group_id: r?.group_id };
    })()""")
    assert result['still_present'] and result['group_id'] is None, result
await check('T10 remove_repo_group cascades repos to Ungrouped', t10_remove_repo_group_cascade)
```

- [ ] **Step 4: Run tests** — 10/10 pass.

- [ ] **Step 5: Commit**

```bash
git commit -am "repo-search: context menu edit/delete on group tabs"
```

---

## Chunk 5: Multi-add + chip edit

### Task 5.1: multi-select folder dialog replaces single-add

**Files:**
- Modify: `desktop-rust/src/tabs/repo-search.js`

- [ ] **Step 1: Replace `showAddRepoModal` behaviour**

Find the `addBtn` in `renderRepoChips` (the `+` at the end of the chip
row). Replace its click handler with:

```javascript
  addBtn.addEventListener('click', async () => {
    try {
      const { open } = window.__TAURI__.dialog;
      const picked = await open({ multiple: true, directory: true });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      const existingNames = new Set(allRepos.map(r => r.name));
      const groupId = (typeof activeTabId === 'number') ? activeTabId : null;
      const addedNames = [];
      for (const p of paths) {
        let base = p.split(/[\\/]/).filter(Boolean).pop() || 'repo';
        let name = base;
        let n = 2;
        while (existingNames.has(name)) name = `${base} (${n++})`;
        existingNames.add(name);
        try {
          await call('add_repo', { name, path: p, color: randomPaletteColor(), group_id: groupId });
          addedNames.push(name);
        } catch (e) {
          showToast(`Skipped ${base}: ${e}`, 'error');
        }
      }
      allRepos = await call('list_repos');
      // Activate only what we just added (matching by the literal name we chose,
      // not fuzzy path-suffix matching — that's broken for auto-deduped names).
      for (const n of addedNames) activeRepos.add(n);
      renderTabStrip();
      renderRepoChips();
    } catch (e) {
      showToast('Error: ' + e, 'error');
    }
  });
```

- [ ] **Step 2: Keep `showAddRepoModal` alive**

Do **not** delete `showAddRepoModal`. It's still called from the
settings-panel Add/Edit-repo path (around lines 411 and 429 in the
current file — search for `showAddRepoModal` to locate). Removing it
would break the Settings panel at runtime.

The chip-row `+` is the only call-site replaced by the multi-select
folder dialog above; the Settings-panel call-sites stay on the modal.

- [ ] **Step 3: Manual sanity** — the CDP tests don't cover the Tauri dialog since it's a native OS API; just confirm `cargo check` and `dev-test.py` stay green.

- [ ] **Step 4: Commit**

```bash
git commit -am "repo-search: multi-select folder dialog for bulk add"
```

---

### Task 5.2: chip right-click → Edit uses `update_repo`

**Files:**
- Modify: `desktop-rust/src/tabs/repo-search.js`

The chip already has a context menu for remove. Extend it with Edit.

- [ ] **Step 1: Replace the chip contextmenu handler**

Find `chip.addEventListener('contextmenu', ...)` inside `renderRepoChips`
and replace with:

```javascript
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showRepoContextMenu(e.clientX, e.clientY, repo);
    });
```

- [ ] **Step 2: Add `showRepoContextMenu`**

Add near `showGroupContextMenu`:

```javascript
function showRepoContextMenu(x, y, repo) {
  const menu = document.createElement('div');
  menu.className = 'rs-ctx-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:4px 0;z-index:9999;min-width:140px`;
  const make = (text, handler) => {
    const item = document.createElement('div');
    item.textContent = text;
    item.style.cssText = 'padding:6px 14px;cursor:pointer;font-size:12px';
    item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.05)');
    item.addEventListener('mouseleave', () => item.style.background = 'transparent');
    item.addEventListener('click', () => { menu.remove(); handler(); });
    return item;
  };
  menu.appendChild(make('Edit repo', () => showEditRepoModal(repo)));
  menu.appendChild(make('Remove repo', () => { if (confirm(`Remove "${repo.name}"?`)) removeRepo(repo.name); }));
  document.body.appendChild(menu);
  const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}

async function showEditRepoModal(repo) {
  const body = document.createElement('div');
  body.innerHTML = `
    <label style="display:block;margin-bottom:4px">Name</label>
    <input id="r-name" style="width:100%" />
    <label style="display:block;margin-top:10px;margin-bottom:4px">Color</label>
    <input id="r-color" type="color" style="width:100%;height:30px" />
    <label style="display:block;margin-top:10px;margin-bottom:4px">Group</label>
    <select id="r-group" style="width:100%"></select>
  `;
  body.querySelector('#r-name').value = repo.name;
  body.querySelector('#r-color').value = repo.color;
  const sel = body.querySelector('#r-group');
  sel.innerHTML = '<option value="">Ungrouped</option>' +
    allGroups.map(g => `<option value="${g.id}" ${g.id === repo.group_id ? 'selected' : ''}>${g.icon ? g.icon + ' ' : ''}${g.name}</option>`).join('');

  try {
    await showModal({
      title: 'Edit Repo',
      body,
      onConfirm: async () => {
        const name = body.querySelector('#r-name').value.trim();
        const color = body.querySelector('#r-color').value;
        const group_id = body.querySelector('#r-group').value ? parseInt(body.querySelector('#r-group').value) : null;
        if (!name) throw new Error('Name is required');
        await call('update_repo', { old_name: repo.name, name, path: repo.path, color, group_id });
      },
    });
    allRepos = await call('list_repos');
    renderTabStrip();
    renderRepoChips();
  } catch { /* cancelled */ }
}
```

- [ ] **Step 3: CDP test for edit**

```python
async def t11_edit_repo_changes_group():
    await cdp.eval("""(async () => {
      await window.__TAURI__.core.invoke('add_repo', { name: 'test-repo', path: '/tmp/test-repo', color: '#fff', group_id: null });
      const g = await window.__TAURI__.core.invoke('add_repo_group', { name: 'TestGrp', icon: '', color: '#3b82f6' });
      await window.__TAURI__.core.invoke('update_repo', { old_name: 'test-repo', name: 'test-repo', path: '/tmp/test-repo', color: '#fff', group_id: g.id });
    })()""")
    result = await cdp.eval("""(async () => {
      const repos = await window.__TAURI__.core.invoke('list_repos');
      return repos.find(r => r.name === 'test-repo')?.group_id;
    })()""")
    assert isinstance(result, int), f'expected int, got {result!r}'
await check('T11 update_repo changes group_id', t11_edit_repo_changes_group)
```

- [ ] **Step 4: Run tests** — 11/11 pass.

- [ ] **Step 5: Commit**

```bash
git commit -am "repo-search: edit chip via right-click + update_repo"
```

---

## Chunk 6: Final integration

### Task 6.1: CDP test for "delete active tab → fallback to All"

**Files:**
- Modify: `desktop-rust/src/tabs/repo-search.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] **Step 1: Refactor `showGroupContextMenu` to use a single refresh function**

Since CDP `contextmenu` synthesis is flaky, the test needs to call
the *same* post-delete refresh the UI does, without synthesising a
right-click. To make that possible without double-rendering:

1. Replace the current inline refresh block inside
   `showGroupContextMenu`'s Delete handler
   (`allGroups = await call('list_repo_groups');`,
   `allRepos = await call('list_repos');`,
   `renderTabStrip();`, `renderRepoChips();`)
   with a single call to a new module-level function:

   ```javascript
   async function reloadAndRerender() {
     allGroups = await call('list_repo_groups');
     allRepos = await call('list_repos');
     renderTabStrip();
     renderRepoChips();
   }
   ```

2. At the very bottom of the module's `init(container)` — after
   `loadInitData().then(...)` resolves (you can put it inside the
   `.then` block) — expose:

   ```javascript
   window.__rsRefreshAfterGroupDelete = reloadAndRerender;
   ```

3. In the Delete handler, call `await reloadAndRerender();` instead of
   the four previous lines. No double rendering — the hook is the
   *same* function the production code runs.

Then the test below simulates the menu handler by running the same
two operations (backend delete + `reloadAndRerender`), without needing
a synthetic context-menu event.
Then the test:

```python
async def t12_delete_active_tab_falls_back_to_all():
    gid = await cdp.eval("""(async () => {
      const g = await window.__TAURI__.core.invoke('add_repo_group', { name: 'Trash', icon: '', color: '#ef4444' });
      return g.id;
    })()""")
    await wait_until(cdp, "[...document.querySelectorAll('.rs-tab')].some(b => b.textContent.includes('Trash'))", timeout=3)
    # Activate the 'Trash' tab via click so activeTabId == gid
    await cdp.eval("""[...document.querySelectorAll('.rs-tab')].find(b => b.textContent.includes('Trash')).click()""")
    await wait_until(cdp, "[...document.querySelectorAll('.rs-tab.active')].some(b => b.textContent.includes('Trash'))", timeout=2)
    # Simulate the context-menu delete path: backend delete + UI reset
    await cdp.eval(f"""(async () => {{
      await window.__TAURI__.core.invoke('remove_repo_group', {{ id: {gid} }});
      // These two lines mirror what showGroupContextMenu's Delete handler does:
      // (mockable via the exposed hook)
      window.__rsRefreshAfterGroupDelete && window.__rsRefreshAfterGroupDelete();
    }})()""")
    # Wait a tick, then assert UI has 'All' active and 'Trash' is gone.
    await wait_until(cdp,
      "![...document.querySelectorAll('.rs-tab')].some(b => b.textContent.includes('Trash'))",
      timeout=3)
    active_label = await cdp.eval("document.querySelector('.rs-tab.active')?.textContent || ''")
    assert 'All' in active_label, f'expected All active, got {active_label!r}'
await check('T12 delete active tab → fallback to All', t12_delete_active_tab_falls_back_to_all)
```

The `window.__rsRefreshAfterGroupDelete` hook points at the same
`reloadAndRerender` function the production menu handler uses — no
duplicate rendering, just a second entry point for the test.

- [ ] **Step 2: Run tests** — 12/12 pass.

- [ ] **Step 3: Commit**

```bash
git commit -am "dev-test: cover delete-active-tab flow"
```

---

### Task 6.2: CHANGELOG entry

**Files:**
- Modify: `desktop-rust/CHANGELOG.md`

- [ ] **Step 1: Prepend under the unreleased / next-version heading**

At the top of the file, add a new section following the existing
format:

```markdown
## vX.Y.Z (2026-04-21)

- Repo Search: groups — organise repos into named, colored, icon-tagged
  groups. Tab strip above the chip row filters both the visible chips
  and the search scope per-tab.
- Each active tab carries inline ✓ / ⊘ shortcuts for bulk
  select / deselect within its scope.
- Right-click on a group tab to rename, recolour, change icon, or delete
  (repos keep existing, move to Ungrouped).
- Add Repo → multi-folder select in one dialog; each folder becomes a
  new repo with auto-derived name / random color, in the currently
  active tab's group.
- Right-click on a repo chip → Edit (name / color / group) or Remove.
```

- [ ] **Step 2: Commit**

```bash
git commit -am "CHANGELOG: repo groups + multi-add"
```

---

### Task 6.3: Release

This is a `v*` release (backend changes), per `desktop-rust/RELEASES.md` §1.
**Target version: `v1.1.0`** — pinned here so there's no guessing.

- [ ] **Step 1: Ensure branch**

```bash
git rev-parse --abbrev-ref HEAD     # expect 'main'
```

If not on `main`, stop and surface to the user — release tags are
cut from `main` only.

- [ ] **Step 2: Bump version — same `1.1.0` in both files**

- `desktop-rust/src-tauri/Cargo.toml` — `version = "1.1.0"`
- `desktop-rust/src-tauri/tauri.conf.json` — `"version": "1.1.0"`

- [ ] **Step 3: Refresh `Cargo.lock` + final test sweep**

```bash
cd desktop-rust/src-tauri && cargo check && cargo test -p keyboard-helper
cd ../src && python3 dev-test.py       # expect 12/12
```

All three must pass before tagging.

- [ ] **Step 4: Commit + tag + push**

```bash
git add desktop-rust/src-tauri/Cargo.toml desktop-rust/src-tauri/tauri.conf.json desktop-rust/src-tauri/Cargo.lock desktop-rust/CHANGELOG.md
git commit -m "repo groups + multi-add (v1.1.0)"
git tag v1.1.0
git push origin main
git push origin v1.1.0
```

- [ ] **Step 5: Wait for CI green**

Verify `https://github.com/IgorSterkhov/snippets_helper/releases/tag/v1.1.0` has `.dmg`, `.exe`, frontend zip, manifest, and `latest.json`. See `desktop-rust/RELEASES.md` §2.4.

- [ ] **Step 6: On-device smoke test**

Install the new build, confirm:
- Existing repos appear under Ungrouped.
- "New group" via `+` works; tabs re-sort alphabetically.
- Multi-select from the Add dialog lands repos in the current tab.
- Right-click on a chip → Edit → change group; chip moves to the other
  tab.
- Right-click on a group tab → Delete → chips reappear under Ungrouped.
