# Repo Search tools implementation plan (v1.2.0)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use `- [ ]` for tracking.

**Goal:** Ship 3 tools on the Repo Search module — open-in-editor,
full-file preview with syntax highlighting, and a Manage tab with
bulk `git pull to main`.

**Architecture:** All new backend work lives in
`desktop-rust/src-tauri/src/commands/repo_search.rs`, shelling out to
the `git` CLI (consistent with existing search backend). Frontend
adds an inner Search/Manage tab strip to
`desktop-rust/src/tabs/repo-search.js`, bundles highlight.js in
`desktop-rust/src/lib/highlight/`, and threads an `editor_command`
setting. Spec: `.workflow/specs/2026-04-22-repo-search-tools-design.md`.

**Tech Stack:** Rust + Tauri 2, `std::process::Command` for git/editor
spawn, `tokio::join_all` for parallel repo queries, plain JS + vanilla
highlight.js.

---

## Conventions

- Work from the worktree `/home/aster/dev/snippets_helper-feat-repo-tools/` (branch `feat/repo-tools`).
- After each Rust edit: `cd desktop-rust/src-tauri && cargo check`.
- After each JS edit: `cd desktop-rust/src && python3 dev-test.py` — 12/12 must stay green (+ new tests at the end).
- Short 1-line commit per task (CLAUDE.md #5).
- No new Rust deps.

---

## Chunk 1: Backend commands

All changes in `desktop-rust/src-tauri/src/commands/repo_search.rs` +
`lib.rs` registration.

### Task 1.1: `open_in_editor` command

**Files:** `desktop-rust/src-tauri/src/commands/repo_search.rs`

- [ ] **Step 1: Add command**

```rust
/// Spawn the user's editor with the given file. `editor_command` is a
/// user-supplied template with `{path}` and optional `{line}` placeholders.
/// Default: "code {path}:{line}".
#[tauri::command]
pub fn open_in_editor(
    state: State<DbState>,
    path: String,
    line: Option<u64>,
) -> Result<(), String> {
    let template = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let cid = get_computer_id();
        queries::get_setting(&conn, &cid, "editor_command")
            .ok()
            .flatten()
            .unwrap_or_else(|| "code {path}:{line}".to_string())
    };
    let line_str = line.map(|l| l.to_string()).unwrap_or_default();
    let rendered = template
        .replace("{path}", &path)
        .replace("{line}", &line_str);
    let parts: Vec<&str> = rendered.split_whitespace().collect();
    if parts.is_empty() {
        return Err("editor_command is empty".to_string());
    }
    std::process::Command::new(parts[0])
        .args(&parts[1..])
        .spawn()
        .map_err(|e| format!("spawn {}: {}", parts[0], e))?;
    Ok(())
}
```

- [ ] **Step 2:** `cd desktop-rust/src-tauri && cargo check` — clean.
- [ ] **Step 3:** commit `open_in_editor command`.

### Task 1.2: `read_full_file` command

**Files:** same.

- [ ] **Step 1: Add**

```rust
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
pub struct FullFileResult {
    pub content: String,
    pub truncated: bool,
    pub size: u64,
}

#[tauri::command]
pub fn read_full_file(path: String) -> Result<FullFileResult, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("metadata: {e}"))?;
    let size = meta.len();
    if size > MAX_FILE_BYTES {
        return Ok(FullFileResult {
            content: String::new(),
            truncated: true,
            size,
        });
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("read_to_string: {e}"))?;
    Ok(FullFileResult { content, truncated: false, size })
}
```

- [ ] **Step 2:** cargo check.
- [ ] **Step 3:** commit `read_full_file command (2MB cap)`.

### Task 1.3: `repo_search_status` command

**Files:** same.

Git helpers (add near top of file):

```rust
fn git_run(repo: &str, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .arg("-C").arg(repo)
        .args(args)
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn default_branch(repo: &str) -> Option<String> {
    for b in ["main", "master"] {
        if git_run(repo, &["show-ref", "--verify", "--quiet", &format!("refs/heads/{b}")]).is_ok() {
            return Some(b.to_string());
        }
    }
    // Fallback to origin/HEAD
    git_run(repo, &["rev-parse", "--abbrev-ref", "origin/HEAD"])
        .ok()
        .and_then(|s| s.strip_prefix("origin/").map(|s| s.to_string()))
}
```

Status command:

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct RepoStatus {
    pub name: String,
    pub branch: String,
    pub last_commit_subject: String,
    pub last_commit_iso: String,
    pub is_dirty: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn repo_search_status(
    state: State<DbState>,
) -> Result<Vec<RepoStatus>, String> {
    let repos = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let cid = get_computer_id();
        load_repos(&conn, &cid)
    };
    let handles = repos.into_iter().map(|repo| {
        tokio::task::spawn_blocking(move || status_one(&repo))
    });
    let mut out = Vec::new();
    for h in handles {
        out.push(h.await.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn status_one(repo: &RepoEntry) -> RepoStatus {
    let path = &repo.path;
    // Confirm it's a git repo
    if git_run(path, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return RepoStatus {
            name: repo.name.clone(),
            branch: String::new(),
            last_commit_subject: String::new(),
            last_commit_iso: String::new(),
            is_dirty: false,
            error: Some("not a git repository".to_string()),
        };
    }
    let branch = git_run(path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
    let last = git_run(path, &["log", "-1", "--format=%s|%cI"]).unwrap_or_default();
    let (subject, iso) = match last.split_once('|') {
        Some((s, d)) => (s.to_string(), d.to_string()),
        None => (String::new(), String::new()),
    };
    let dirty = git_run(path, &["status", "--porcelain"])
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    RepoStatus {
        name: repo.name.clone(),
        branch,
        last_commit_subject: subject,
        last_commit_iso: iso,
        is_dirty: dirty,
        error: None,
    }
}
```

- [ ] **Step 1:** paste helpers + status command.
- [ ] **Step 2:** cargo check.
- [ ] **Step 3:** commit `repo_search_status command + git helpers`.

### Task 1.4: `repo_search_pull_main` command

```rust
#[derive(Serialize)]
pub struct PullOutcome {
    pub name: String,
    pub skipped: bool,
    pub success: bool,
    pub message: String,
    pub commands_run: Vec<String>,
}

#[tauri::command]
pub async fn repo_search_pull_main(
    state: State<DbState>,
    paths: Vec<String>,
    dry_run: bool,
) -> Result<Vec<PullOutcome>, String> {
    let repos = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let cid = get_computer_id();
        let all = load_repos(&conn, &cid);
        let set: std::collections::HashSet<_> = paths.into_iter().collect();
        all.into_iter().filter(|r| set.contains(&r.path)).collect::<Vec<_>>()
    };
    let handles = repos.into_iter().map(|repo| {
        tokio::task::spawn_blocking(move || pull_one(&repo, dry_run))
    });
    let mut out = Vec::new();
    for h in handles {
        out.push(h.await.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn pull_one(repo: &RepoEntry, dry_run: bool) -> PullOutcome {
    let path = &repo.path;
    let name = repo.name.clone();
    let dirty = git_run(path, &["status", "--porcelain"])
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    if dirty {
        return PullOutcome {
            name,
            skipped: true,
            success: false,
            message: "uncommitted changes".to_string(),
            commands_run: vec![],
        };
    }
    let branch = match default_branch(path) {
        Some(b) => b,
        None => return PullOutcome {
            name,
            skipped: true,
            success: false,
            message: "no main/master/origin/HEAD".to_string(),
            commands_run: vec![],
        },
    };
    let planned = vec![
        format!("git checkout {branch}"),
        "git pull --ff-only".to_string(),
    ];
    if dry_run {
        return PullOutcome {
            name, skipped: false, success: true,
            message: "dry-run".to_string(),
            commands_run: planned,
        };
    }
    if let Err(e) = git_run(path, &["checkout", &branch]) {
        return PullOutcome { name, skipped: false, success: false, message: format!("checkout failed: {e}"), commands_run: planned };
    }
    match git_run(path, &["pull", "--ff-only"]) {
        Ok(out) => PullOutcome {
            name, skipped: false, success: true,
            message: out.lines().last().unwrap_or("ok").to_string(),
            commands_run: planned,
        },
        Err(e) => PullOutcome {
            name, skipped: false, success: false,
            message: format!("pull failed: {e}"),
            commands_run: planned,
        },
    }
}
```

- [ ] **Steps:** paste, cargo check, commit `repo_search_pull_main`.

### Task 1.5: register new commands in `lib.rs`

Under `// Repo Search`:

```rust
commands::repo_search::open_in_editor,
commands::repo_search::read_full_file,
commands::repo_search::repo_search_status,
commands::repo_search::repo_search_pull_main,
```

cargo check + commit `register v1.2.0 commands`.

---

## Chunk 2: Browser mock + CDP tests

**Files:** `desktop-rust/src/dev-mock.js`, `desktop-rust/src/dev-test.py`

### Task 2.1: mock 4 new commands

- `open_in_editor` — no-op, just log.
- `read_full_file` — returns a canned short string for known `.md/.txt/.js` extensions, `truncated: false, size: content.length`.
- `repo_search_status` — returns 3 fake rows matching the fixture repos, varying branches/dirty flags.
- `repo_search_pull_main` — returns per-path fake outcomes (skip if fixture is marked dirty).

Commit: `dev-mock: add v1.2.0 repo search commands`.

### Task 2.2: CDP T13/T14

- **T13** — switch to Repo Search tab, click `Manage` inner tab → assert table has N rows matching fixture.
- **T14** — click a file-card `Expand` button → assert `.rs-fullscreen` / `#rs-fullscreen-overlay` element is visible → click `Collapse` → assert gone.

Run `python3 dev-test.py` — 14/14. Commit: `dev-test: T13 Manage tab, T14 Expand/Collapse`.

---

## Chunk 3: Frontend — inner tabs (Search/Manage) + Manage table

**Files:** `desktop-rust/src/tabs/repo-search.js`

### Task 3.1: inner tab strip

Before `renderRepoChips` mount, insert:

```js
const innerTabs = el('div', { class: 'rs-inner-tabs' });
const searchInner = el('button', { text: 'Search', class: 'rs-inner-tab active' });
const manageInner = el('button', { text: 'Manage', class: 'rs-inner-tab' });
innerTabs.appendChild(searchInner);
innerTabs.appendChild(manageInner);
wrap.appendChild(innerTabs);

// Search panel — houses existing topbar + results
const searchPanel = el('div', { class: 'rs-inner-panel', id: 'rs-search-panel' });
// Manage panel — new
const managePanel = el('div', { class: 'rs-inner-panel', id: 'rs-manage-panel', style: 'display:none' });
wrap.appendChild(searchPanel);
wrap.appendChild(managePanel);
```

Move the existing topbar + results-area append into `searchPanel`.
Chip strip stays **outside** (above) so it's shared.

Wire the inner tab buttons to toggle `display`.

- Steps: edit, test (12/12 still), commit `repo-search: inner Search/Manage tab strip`.

### Task 3.2: Manage table

Inside `managePanel`:

```js
const toolbar = el('div', { class: 'rs-manage-toolbar' });
const refreshBtn = el('button', { text: 'Refresh', class: 'btn-secondary' });
const pullBtn   = el('button', { text: 'Pull all to main' });
const dryLabel  = document.createElement('label');
dryLabel.innerHTML = `<input type="checkbox" id="rs-dry"/> Dry-run`;
toolbar.appendChild(refreshBtn);
toolbar.appendChild(pullBtn);
toolbar.appendChild(dryLabel);
managePanel.appendChild(toolbar);

const tableWrap = el('div', { class: 'rs-manage-table-wrap', id: 'rs-manage-table' });
managePanel.appendChild(tableWrap);
```

State + rendering:

```js
let manageStatus = null;   // last RepoStatus[]
let manageOutcome = null;  // last PullOutcome[] (per-repo)

async function renderManage() {
  const scopeRepos = reposForActiveTab().filter(r => activeRepos.has(r.name));
  if (!scopeRepos.length) {
    tableWrap.innerHTML = '<p style="padding:12px;color:var(--text-muted)">No active repos in scope.</p>';
    return;
  }
  tableWrap.innerHTML = '<p style="padding:12px;color:var(--text-muted)">Loading…</p>';
  try {
    const all = await call('repo_search_status');
    const scopeSet = new Set(scopeRepos.map(r => r.name));
    manageStatus = all.filter(s => scopeSet.has(s.name));
  } catch (e) {
    tableWrap.innerHTML = `<p style="padding:12px;color:var(--danger)">${e}</p>`;
    return;
  }
  renderManageTable();
}

function renderManageTable() {
  // … build <table class="rs-manage"> …
  // columns: Name | Branch | Last commit | Date | Status
  // is_dirty → orange-ish row, error → red
  // if manageOutcome has an entry for row.name, show ✓/⚠/✗ + message in Status
}

refreshBtn.addEventListener('click', () => { manageOutcome = null; renderManage(); });
manageInner.addEventListener('click', () => { /* activate, call renderManage once */ });

pullBtn.addEventListener('click', async () => {
  if (!manageStatus) return;
  const dryRun = body.querySelector('#rs-dry').checked;
  const paths = manageStatus.map(s => allRepos.find(r => r.name === s.name)?.path).filter(Boolean);
  pullBtn.disabled = true;
  try {
    manageOutcome = await call('repo_search_pull_main', { paths, dryRun });
    if (dryRun) showDryRunPreview(manageOutcome);   // small modal listing planned commands
    renderManageTable();
  } catch (e) {
    showToast('Pull failed: ' + e, 'error');
  } finally {
    pullBtn.disabled = false;
  }
});
```

CSS: striped rows, red for dirty/error, green for OK.

Commit: `repo-search: Manage tab with status table + bulk pull`.

---

## Chunk 4: Frontend — Expand/Collapse + open-in-editor

**Files:** `desktop-rust/src/tabs/repo-search.js`, `desktop-rust/src/lib/highlight/*`

### Task 4.1: bundle highlight.js

Download from jsdelivr to `desktop-rust/src/lib/highlight/`:

```
highlight.min.js       (core)
github-dark.min.css    (theme matching app chrome)
```

Commit: `bundle highlight.js + github-dark theme`.

### Task 4.2: expand/collapse + buttons on file card

The card's footer currently has `Copy path`. Add `Open in editor` to
the left and `Expand ▸` to the right.

```js
// Open in editor
const openBtn = el('button', { text: 'Open in editor', class: 'rs-card-btn' });
openBtn.addEventListener('click', () => call('open_in_editor', { path: file.path, line: hit?.line ?? 1 }));

// Expand
const expandBtn = el('button', { text: 'Expand ▸', class: 'rs-card-btn' });
expandBtn.addEventListener('click', () => expandCard(file));
```

`expandCard(file)`:

1. Create an overlay covering the whole `#panel-repo-search` with the
   full file content + highlight.js.
2. `await call('read_full_file', { path: file.path })`. If `truncated`,
   show a friendly message + "Open in editor" button; skip rendering.
3. Detect language from extension, call `hljs.highlight(content, {language}).value`, render as `<pre><code class="hljs">…</code></pre>`.
4. Header with file name + `Collapse ◂` button + ESC keydown listener.

Commit: `repo-search: expand card to full-screen with highlight.js`.

### Task 4.3: editor command setting

**Files:** `desktop-rust/src/tabs/settings.js`

Add a "General" section input for `editor_command` with placeholder
`code {path}:{line}` and the help text from the spec. Wire via
existing `set_setting` / `get_setting`.

Commit: `settings: editor command template`.

---

## Chunk 5: CHANGELOG + release

### Task 5.1: CHANGELOG

Prepend `## v1.2.0 (2026-04-22)` with feature summary. Commit:
`CHANGELOG: v1.2.0 editor + full-file + Manage`.

### Task 5.2: version bump + release

- Bump `Cargo.toml` and `tauri.conf.json` to `1.2.0`.
- `cargo check && cargo test -p keyboard-helper` clean.
- `python3 dev-test.py` — 14/14.
- Merge `feat/repo-tools` → `main` ff.
- Commit version bump on main.
- Tag `v1.2.0`, push.
- Wait for CI; verify assets.
- Smoke test on device.

---

## Verification

- `cargo test -p keyboard-helper` green.
- `python3 dev-test.py` 14/14.
- Manual: add some repos in different groups, check Manage tab shows
  branch + dirty flag, `Pull all to main` works with dry-run.
- Manual: `Expand ▸` on a file card shows highlighted whole file; ESC
  collapses.
- Manual: set `editor_command` to `code {path}:{line}`, click
  `Open in editor` on a hit — VS Code opens at the line.
