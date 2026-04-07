# Changelog

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
