# Changelog

## 1.2.8 OTA patches

- **f-20260423-18** — Shortcuts: Copy strips Markdown code fences
  (triple-backtick blocks and single-line backtick-wraps) before writing
  to the clipboard, so pasted code doesn't carry stray `\`\`\`` markers.
- **f-20260423-18** — Markdown editor: Link button (🔗) auto-fills the
  URL from the clipboard if it looks like one (http/https/ftp/mailto/www).
  If the clipboard isn't a URL, the caret lands inside the empty `()` so
  you can type immediately — no more modal prompt.
- **f-20260423-19** — Markdown editor: paste-over-selection now creates a
  Markdown link. Select text, press Ctrl+V with a URL in the clipboard →
  get `[selected](url)`. Non-URL clipboard or empty selection paste
  behaves normally.
- **f-20260423-20** — Notes preview: numbered lists (`1. …`) now render as
  decimal `1. 2. 3.` instead of bullet circles. Removed a stray
  `.note-preview li { list-style: disc }` override that beat the
  `.markdown-body ol { list-style-type: decimal }` parent rule.
- **f-20260423-21** — Notes: non-empty notes open in Markdown preview by
  default; double-click the preview to switch to Edit. Empty/new notes
  still open in Edit mode.
- **f-20260423-21** — Notes: pinned chip strip above folders/notes panel
  (same visual style as Repo Search chips). Each chip is a pinned note
  — click to open it directly in the right panel, auto-switching folder
  if needed. Updates on save/delete.

## v1.2.8 (2026-04-23)

- Hotkey: bring main window to front on a single press when it's visible
  but behind another app. Previously the first press hid it (because it
  was still "visible") and you needed a second press to bring it back.
  Now the window is only hidden when it's visible, focused and not
  minimized — otherwise it's unminimized + shown + focused.
- SQL help modals: Ctrl + mouse wheel zooms the text; size persists in
  localStorage across sessions.

## v1.2.2 (2026-04-22)

- Manage tab: per-row **Reset** button on dirty repos — runs
  `git reset --hard HEAD` to discard uncommitted changes, with
  confirmation. Untracked files are preserved.

## v1.2.1 (2026-04-22)

- Fix "Open in editor" on Windows/macOS: spawn the editor command
  through the user's shell so PATHEXT (`code.cmd` / `code.bat`) and
  login-shell PATH are honoured. Previously direct `spawn("code")`
  failed with "program not found" even if `code` worked in a terminal.

## v1.2.0 (2026-04-22)

**Repo Search — editor integration, full-file preview, Manage tab.**

- **Open in editor** — new button on every result card opens the file
  at the match line. Configurable editor command template in
  Settings → General (`code {path}:{line}` by default; supports
  `cursor`, `subl`, `pycharm`, etc.)
- **Full-file preview** — `Expand ▸` button on result cards opens a
  fullscreen view of the file with syntax highlighting (highlight.js
  bundled, ~190 languages). 2 MB cap; ESC or `Collapse ◂` closes.
- **Manage tab** — new inner tab under the group-tab strip showing a
  per-repo git status table (branch, last commit + date, dirty flag).
  Bulk **Pull all to main** action: skips dirty repos (highlighted in
  red), falls back `main → master → origin/HEAD`. **Dry-run** checkbox
  previews the exact `git` commands before executing.
- Search input + type selector + gear now live on the Search inner
  tab; chip strip (with select-all/none) remains shared across both
  inner tabs as the scope selector.

## v1.1.0 (2026-04-21)

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

## v1.0.0 (2026-04-20)

**First stable release with frontend-over-the-air (OTA) updates.**

### Highlights
- **Frontend OTA:** small UI/JS/CSS changes now install in ~2 seconds without a
  full reinstall. Click the sync indicator in the status bar → "Apply" → the
  WebView reloads with the new bundle. The installer stays untouched.
- **Signed updates:** every OTA bundle is minisign-signed in CI and verified
  on the client before it touches disk (same key as the existing native
  updater).
- **Auto-rollback:** if an OTA bundle fails to boot within 30 seconds, the
  previous version is restored automatically. No way to brick the app with
  a bad frontend release.
- **Two release flows:**
  - `v*` tags — full release (native .dmg / .exe **and** frontend OTA).
  - `f-*` tags — frontend-only release (fast, skips the native build).
  - Either path is picked up by existing clients; native updater keeps
    working because we carry `latest.json` forward on frontend-only releases.
- **Script templates in Exec tab:** SCP / SSH / rsync forms with VPS
  integration, generate a command in one click.
- **Status bar:** combined `v{native}-f{sha}` label; clicking it now runs a
  sync and the update check.
- **Modal fix:** form modals keep themselves open on validation errors and
  show inline error text instead of silently dismissing.
- **Debug escape hatch:** `KH_FORCE_SHOW=1` forces the main window visible on
  startup — useful for headless testing or recovering if the global hotkey
  is unavailable.

### Infrastructure
- Dockerfile + `dev-docker.sh` for headless Linux builds.
- Browser mock (`dev.html` + `dev-mock.js`) for offline UI development,
  covering ~95 Tauri commands.
- CDP-based smoke tests (`dev-test.py`) — 7 automated checks across the
  Exec modal fix and SCP template flow.

## v0.9.0 (2026-04-15)
- New tab: VPS Management — monitor remote servers via SSH
- Dashboard: CPU, RAM, Disk usage with color-coded progress bars
- Named colored server chips with auto-refresh (configurable per server)
- SSH key file support, custom ports, connection testing

## v0.8.8 (2026-04-15)
- Fixed Commits: history dropdown preserves selection, tag creation works
- Reset button clears history selection

## v0.8.7 (2026-04-15)
- Rewritten Commits tab to match Python logic
- Commit types/categories match Python version
- Task ID auto-parsed from tracker URLs (tracker.wb.ru, etc.)
- Real-time commit and chat message previews
- Conditional fields: reports (test/prod/connect) for отчет, test dag for даг

## v0.8.6 (2026-04-10)
- Fixed sync: LWW (Last Write Wins) by updated_at — prevents pull from overwriting newer local changes
- Added tag clear button (×) to reset snippet tag filter
- Markdown rendering in Description section

## v0.8.5 (2026-04-10)
- Fixed Windows build: removed .cxx build artifacts with too-long paths

## v0.8.3 (2026-04-07)
- Nested folders in Notes: tree view with expand/collapse, sub-folder creation, arbitrary depth
- Expandable note cards: hover handle to preview content without opening editor
- Expandable snippet cards: same pattern in Shortcuts tab
- Redesigned Notes styling: refined tree connectors, pin dots, editor typography
- Auto markdown preview when opening notes with markdown content
- Fixed ordered list rendering in markdown (explicit list-style-type)
- Card expand height configurable in Settings → Shortcuts

## v0.8.0 (2026-04-07)
- Status bar at bottom of window: sync status (left) + update status (right)
- Sync: pulsing dot indicator, click for sync log popup
- Updates: shows current version, available update, click to download or re-check
- Replaced sidebar sync indicator and top update banner
- Smart markdown rendering in snippets (auto-detect markdown content)
- Modal no longer closes on overlay click (only Cancel/X/Escape)

## v0.7.5 (2026-04-07)
- Fixed repo search: sort now preserves card format (content/git cards no longer collapse to single lines)
- Added edit/add repos in settings panel (gear icon)
- Fixed repo chips bar not rendering on first load

## v0.7.3 (2026-04-06)
- Added markdown toolbar for content textareas (Bold, Italic, Code, Link, List, Table, etc.)
- Toolbar appears in Notes editor and Snippet edit modal

## v0.7.2 (2026-04-06)
- Upgraded markdown preview: full parser with tables, code blocks, GFM, task lists
- Custom marked.js bundled locally (headers, bold, italic, strikethrough, nested lists, blockquotes, images)
- Added .markdown-body CSS styles for dark theme

## v0.7.0 (2026-04-06)
- New tab: Repo Search — search across local git repositories
- Search by filename (glob), file content (ripgrep/grep/Rust fallback), git history
- Named colored repos with toggle chips (Design B: bold + color bar)
- Results grouped by file with context on click
- Tab auto-unloads after configurable timeout (default 10 min)

## v0.6.3 (2026-04-05)
- Added sync status indicator in sidebar (syncing/ok/error)
- Sync log popup with detailed push/pull results (click indicator to view)
- Each sync shows what was pushed/pulled with record names

## v0.6.1 (2026-04-05)
- Obsidian integration: create, link, and view notes from snippets
- Main/Web/Note toggle in snippet detail panel
- Markdown rendering for Obsidian notes
- Settings: Obsidian vaults path (per machine)

## v0.5.3 (2026-04-05)
- New app icon: H4 Cyan {K} on purple-blue gradient
- Fixed global font size setting
- Added Always on Top toggle in Settings → General
- Snippet tags sync via API (server migration applied)
- Language setting (English/Russian) for Help

## v0.5.1 (2026-04-05)
- Added Help modal (?) with Features, Hotkeys, and Changelog tabs
- Multi-language support (English/Russian)
- Changelog embedded from CHANGELOG.md at build time

## v0.5.0 (2026-04-03)
- Redesigned links: Main/Web toggle, inline link chips, embedded iframe viewer with fallback
- Links open in Web tab inside the app, with "Open in browser" option

## v0.4.3 (2026-04-03)
- Security cleanup: removed sensitive docs from repository

## v0.4.2 (2026-04-03)
- Fixed tag creation (camelCase parameter naming)

## v0.4.1 (2026-04-03)
- Added snippet links: attach URLs to snippets, view in WebView window
- Tabbed bottom section: Description | Links
- API migration for links field
- Synced links across devices

## v0.4.0 (2026-04-03)
- Added snippet tags: colored filter presets for shortcuts
- Glob pattern matching (e.g. `af_*`)
- Tag management modal with color picker
- Tags synced across devices

## v0.3.3 (2026-04-03)
- Fixed independent scrolling: left panel, value block, and description scroll separately

## v0.3.0 (2026-04-03)
- Redesigned Shortcuts tab: two-panel layout (name list + detail view)
- Collapsible description section with filled/empty badge
- Font size from settings

## v0.2.9 (2026-04-03)
- Fixed sync: proper null handling for last_sync_at
- Fixed user_id population from auth on pull

## v0.2.6 (2026-04-03)
- Added Updates tab in Settings: version check, GitHub token for private repos
- Debug Sync diagnostics
- Update notification banner

## v0.2.5 (2026-04-03)
- Fixed autostart on Windows (registry-based)
- Added update UI and notification banner

## v0.2.4 (2026-04-03)
- Fixed close to tray (X button hides instead of quitting)
- Tray icon click shows window
- Auto-sync on window show

## v0.2.2 (2026-04-02)
- Fixed register and health check via Rust IPC

## v0.2.0 (2026-04-02)
- Added auto-updater plugin
- Optimized CI: macOS ARM + Windows only, thin LTO
- Signing key for update artifacts

## v0.1.3 (2026-04-02)
- Fixed global-shortcut plugin config crash on Windows

## v0.1.0 (2026-04-02)
- Initial release
- 6 tabs: Shortcuts, Notes, SQL Tools (5 sub-tabs), Superset, Commits, Exec
- Global hotkey (Alt+Space native, Double Shift/Ctrl polling)
- System tray with hide/show
- SQLite database with sync to remote API
- Dark theme (GitHub Dark inspired)
- Lazy tab loading
- Settings with 6 sub-tabs
- Autostart support (Windows, macOS, Linux)
