# Desktop Module Detached Windows Spec

## Requirement

Add a way to open any main left-sidebar module in a separate desktop window.
The separate window must show only that module and must not include the main
left sidebar, so the user cannot switch from Snippets to Notes, Tasks, Exec, or
other main modules inside that window.

## UX

- Add a right-click context menu to main sidebar module buttons.
- The menu contains one action: `Open in separate window`.
- The action applies to real main modules such as Snippets/Shortcuts, Notes,
  Tasks, SQL, Superset, Commits, Exec, Search, VPS, and Whisper.
- Settings and Help are not treated as detachable modules in this task.
- Left-click behavior stays unchanged and still switches the active module in
  the main window.
- In a detached module window, the module occupies the full window content
  area. The main sidebar is not rendered.
- Module-owned navigation remains available. For example, SQL and Superset can
  still show their own internal tabs because those do not switch to unrelated
  main modules.

## Window Behavior

- Use one detached window per module.
- If a detached window for the requested module already exists, focus it
  instead of opening a duplicate.
- Window labels should be stable and derived from the module id, for example
  `module_shortcuts` or `module_tasks`.
- The window title should include the module label, for example
  `Snippets - Keyboard Helper`.
- Closing a detached window only closes that window. It must not hide or close
  the main app window.

## Architecture

- Add a native Tauri command such as `open_module_window(module_id)`.
- Validate `module_id` against an allowlist before creating or focusing a
  window.
- Open the internal app URL with standalone query parameters, for example
  `khapp://localhost/index.html?standalone=1&module=tasks`.
- Update the frontend boot path so `main.js` can detect standalone mode:
  - normal mode builds the existing `TabContainer`, sidebar buttons, Settings,
    Help, status bar, remembered `last_active_tab`, and global startup behavior;
  - standalone mode resolves the requested module from the same module
    registry, creates only that module panel, and loads it directly.
- Standalone windows must not write `last_active_tab`, because they are not
  changing the active module in the main window.

## Release Scope

This adds a new Tauri command and creates app windows from native code, so the
desktop change must be released as a full `v*` release, not a frontend-only
OTA.

Because this is user-facing desktop behavior, the release must update:

- `desktop-rust/src/tabs/help.js`
- `desktop-rust/src/release-history.md`
- `desktop-rust/CHANGELOG.md`

## Testing

- Add or update browser mock coverage for the right-click menu and standalone
  frontend boot path.
- Add a Rust test for module id validation if the validation is factored into a
  testable helper.
- Run `node --check` for changed JavaScript files.
- Run `python3 dev-test.py` from `desktop-rust/src`.
- Run `cargo check` from `desktop-rust/src-tauri` because the native command
  surface changes.

## Acceptance Criteria

- Right-clicking a main sidebar module button shows `Open in separate window`.
- Selecting the action opens that module in a separate window.
- The detached window has no main left sidebar and no Settings/Help sidebar
  buttons.
- The detached window cannot switch to unrelated main modules.
- Opening the same module again focuses the existing detached window.
- The main window keeps its current tab and remembered `last_active_tab`
  behavior.
- Existing module functionality still works in both the main window and the
  detached window.
