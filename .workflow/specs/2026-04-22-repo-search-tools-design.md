# Repo Search — editor integration, full-file view, Manage tab

Design spec for v1.2.0. Three additions to the Repo Search module agreed
on 2026-04-22.

## Context

Current Repo Search shows hit cards (file / content / git) and lets the
user toggle repos on/off via chips. Reading file context beyond the
match requires re-running a search or leaving the app. There's no
built-in view of repo state (branch, dirtiness, last commit).

v1.2.0 adds:
1. **Open in editor** — one-click to open a hit file at the match line.
2. **Full-file preview** — expand a card to fill the search area with
   the whole file, syntax-highlighted.
3. **Manage tab** — a second inner tab showing per-repo git status for
   the current scope (active group tab) with a bulk "Pull to main".

## Goals

- Keep all three features behind a single `v1.2.0` native release.
- No new Rust crate deps; git operations shell out to the `git` CLI.
- Respect the existing scope model: operations run against the chip-row
  selection of the active group tab.

## Non-goals

- Writing / committing from the app (read-only git operations only).
- Remote push, merging, branch creation.
- Detecting editor path automatically — user configures the command.
- Streaming / paginated file previews (2 MB cap, message for larger
  files).

---

## Feature 1 — Open in editor

### Backend
New Tauri command:
```rust
pub fn open_in_editor(path: String, line: Option<u64>) -> Result<(), String>
```
Reads a user setting `editor_command` (default `code {path}:{line}`),
substitutes `{path}` and `{line}` (empty if None), splits on spaces,
spawns the process (detached). Returns error if the binary isn't on
PATH.

### Setting
`editor_command` in Settings → General → "Editor command template".
Help text: examples `code {path}:{line}`, `cursor {path}`,
`subl {path}:{line}`, `pycharm {path}`.

### UI
Expanded file card gets a new button to the **left** of the existing
`Copy path`:
```
[ Open in editor ] [ Copy path ] [ Expand ▸ ]
```
Click → `invoke('open_in_editor', { path, line })` with the card's
match line (or 1 for filename-only hits).

---

## Feature 2 — Full-file preview

### Backend
New Tauri command:
```rust
pub fn read_full_file(path: String) -> Result<{ content: String, truncated: bool }, String>
```
Caps at 2 MB. Returns `truncated: true` with a friendly message if the
file is larger than the cap.

### UI
Expanded file card gets a new button to the **right** of `Copy path`.

- **Collapsed state (default):** card shows context lines as today, button label `Expand ▸`.
- **Expanded state:** the card's results-area replaces the whole tab panel content (including the chip-strip area), showing the whole file with syntax highlighting. Button label becomes `Collapse ◂`. Pressing ESC or clicking `Collapse` returns to normal.

### Syntax highlighting
Bundle `highlight.js` under `desktop-rust/src/lib/highlight/` (core +
~30 common languages: sql, py, js, ts, rs, go, java, cpp, shell, yaml,
json, xml, html, css, md, toml, dockerfile, nginx, bash, ini, diff).
Language auto-detected from the file extension; unknown extensions
fall back to plain text.

---

## Feature 3 — Manage tab

### Layout
Inside the Repo Search tab, below the group-tab strip and chip-strip,
add a **second tab strip** with two tabs: `Search | Manage`.

```
┌────────────────────────────────────────────────┐
│  [All | Databases | Airflow | Ungrouped | +]   │   ← group tabs
├────────────────────────────────────────────────┤
│  [✓] [⊘] | chip1 chip2 ... +                  │   ← sel controls + chips (shared)
├────────────────────────────────────────────────┤
│  [ Search ] [ Manage ]                         │   ← inner tabs
├────────────────────────────────────────────────┤
│  … tab content …                               │
└────────────────────────────────────────────────┘
```

- `Search` — hosts the existing search input, type selector (Files /
  Content / Git), sort toggle, gear, results area. Currently directly
  under the chip strip — moves here.
- `Manage` — hosts the new repo-status table.

Chip strip stays visible on both inner tabs — it's the shared scope
selector.

### Table in Manage
Columns:
| Name | Branch | Last commit | Date | Status |
|------|--------|-------------|------|--------|
| pg-analytics | main    | fix: null-safe column lookup | 2d ago | ✓ clean |
| ch-metrics   | feature | add metric for … | 3h ago | ⚠ dirty (3 modified) |
| dags-core    | main    | (no commits)      |  —     | ✓ clean |

Rows visible = chip-row selection of current scope (respects active
repos on the chip strip — dim chips are excluded). This matches the
user's "явно видно список" — dim chips aren't in the table.

### Actions
- **Refresh** (button): re-fetch status of all rows. Also runs
  automatically on Manage-tab activate.
- **Pull all to main** (button): for each row
  - if `dirty` → skip, flash the row red, tooltip "uncommitted changes",
  - else run `git checkout main && git pull --ff-only` (if no `main`,
    fall back to `master`, then to `origin/HEAD`).
  - Result per row: ✓ / ⚠ skipped / ✗ failed. Remains visible until next
    Refresh / user dismisses.
- **Dry-run checkbox** next to "Pull all to main": when ticked, clicking
  the button shows (in a small modal) the exact `git` commands that
  *would* run per repo, no execution. User confirmation not required in
  dry-run mode.

### Backend

```rust
pub struct RepoStatus {
    pub name: String,
    pub branch: String,               // current branch, empty if detached
    pub last_commit_subject: String,  // "" if repo has zero commits
    pub last_commit_iso: String,      // "" if none
    pub is_dirty: bool,
    pub error: Option<String>,        // e.g. "not a git repo", "git not found"
}

#[tauri::command]
pub async fn repo_search_status(paths: Vec<String>) -> Vec<RepoStatus>;

pub struct PullOutcome {
    pub name: String,
    pub skipped: bool,
    pub success: bool,
    pub message: String,     // user-readable summary
    pub commands_run: Vec<String>,
}

#[tauri::command]
pub async fn repo_search_pull_main(paths: Vec<String>, dry_run: bool) -> Vec<PullOutcome>;
```

Both commands shell out to `git` (same binary the existing git-history
search relies on). Concurrent per-repo execution via `tokio::join_all`
so a slow remote doesn't block the others. Timeout per repo: 30s.

`git` dirtiness check: `git status --porcelain` — non-empty output =
dirty.

Default branch fallback order:
1. `main` — `git show-ref --verify --quiet refs/heads/main`
2. `master` — same check
3. `origin/HEAD` — `git rev-parse --abbrev-ref origin/HEAD`
4. Otherwise error "no default branch"

---

## Files touched

- `desktop-rust/src-tauri/src/commands/repo_search.rs` — new status +
  pull commands, `read_full_file`, `open_in_editor`. Add tests for the
  default-branch fallback and dirty detection helpers.
- `desktop-rust/src-tauri/src/lib.rs` — register 4 new commands.
- `desktop-rust/src/tabs/repo-search.js` — inner tab strip,
  Search/Manage split, Manage table, expand/collapse card, open-in-editor
  button.
- `desktop-rust/src/lib/highlight/` — highlight.js bundle (core + langs).
- `desktop-rust/src/dev-mock.js` — mirror the 4 new commands.
- `desktop-rust/src/dev-test.py` — smoke tests T13 (Search/Manage tabs
  exist), T14 (expand/collapse toggles the full-screen state).
- `desktop-rust/src/tabs/settings.js` — editor command template setting.
- `desktop-rust/CHANGELOG.md` — v1.2.0 entry.

## Release

`v1.2.0`, full release (native + frontend). Bump
`desktop-rust/src-tauri/Cargo.toml` and `desktop-rust/src-tauri/tauri.conf.json`.
