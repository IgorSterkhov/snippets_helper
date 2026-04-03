# Changelog

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
