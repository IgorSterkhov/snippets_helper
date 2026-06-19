# Repo Search Module Header Implementation Plan

## Files

- `desktop-rust/src/tabs/repo-search.js`
- `desktop-rust/src/tabs/repo-search/help-content.js`
- `desktop-rust/src/tabs/help.js`
- `desktop-rust/src/release-history.md`
- `desktop-rust/CHANGELOG.md`
- `desktop-rust/src/dev-test.py`
- `FRONTEND_PATTERNS.md`

## Steps

1. Add a Repo Search help content module and import the shared `helpButton`.
2. Add a module header to `repo-search.js` before group tabs:
   - title;
   - Help button;
   - Settings gear button.
3. Remove the Search-toolbar settings gear and the inline `#rs-settings-panel`.
   Remove the old `settingsOpen` toggle state entirely.
4. Rework `loadSettingsPanel` into reusable content rendering for a settings
   modal body. It must refresh the currently open settings-modal body rather
   than querying the removed inline panel.
5. Add `openRepoSearchSettings()`:
   - creates modal manually or with `showModal`;
   - bounded height;
   - scrollable body;
   - close action.
6. Ensure repository add/edit/remove refreshes both:
   - the settings modal body when it is open;
   - main group tabs/chips/scope badge.
7. Update CSS for:
   - module header;
   - icon buttons;
   - scrollable settings modal;
   - retained repository settings rows.
8. Extend smoke tests to verify:
   - module header has Help and Settings buttons;
   - no Settings button remains in the Search toolbar;
   - Settings modal opens from header and has scrollable body;
   - Help modal opens from header.
9. Update global Help, release history, changelog, and frontend patterns.

## Validation

- `node --check desktop-rust/src/tabs/repo-search.js`
- `node --check desktop-rust/src/tabs/repo-search/help-content.js`
- `node --check desktop-rust/src/tabs/help.js`
- `python3 -m py_compile desktop-rust/src/dev-test.py`
- `cd desktop-rust/src && python3 dev-test.py`
- `cd desktop-rust/src-tauri && cargo check`
- `git diff --check`
