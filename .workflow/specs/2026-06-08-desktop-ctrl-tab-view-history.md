# Desktop Ctrl+Tab View History

## Goal

Add a global desktop shortcut for switching between recently opened views, so `Ctrl+Tab` can return from a task back to the exact snippet, note, or module view the user was working in.

## UX Direction

Implement option A first and then extend it to option C in the same feature:

1. First `Ctrl+Tab` immediately switches to the previous recent view.
2. Repeated `Ctrl+Tab` presses in the same held-control sequence show a compact switcher overlay and cycle through the same frozen recent-view snapshot.
3. `Shift+Ctrl+Tab` cycles backward inside that snapshot.
4. Releasing `Ctrl`, pressing `Escape`, or switching to the selected view closes the overlay.

## Requirements

1. Track recently opened views across loaded desktop modules.
2. Minimum tracked object views:
   - Snippets: selected snippet, including the active detail tab.
   - Tasks: selected/expanded task.
   - Notes: opened note editor/preview.
3. For other modules, track module-level activation so the history still behaves sensibly.
4. Keep most-recent ordering with dedupe by view key and a bounded list.
5. Restoring a view must activate the module first and then ask that module to open the stored object.
6. The switcher overlay must be dark-theme, compact, keyboard-only friendly, and must not appear over active modal dialogs.
7. No new Tauri/native commands.

## Non-Goals

- No persisted cross-restart history in this pass.
- No mouse interaction requirement for the switcher overlay.
- No mobile changes.
- No changes to snippet-local Related history.
- No backend/database changes.

## Verification

- Add browser mock smoke coverage for:
  - snippet -> task -> `Ctrl+Tab` returns to the exact snippet;
  - repeated `Ctrl+Tab` shows the switcher overlay;
  - the overlay contains recent task and snippet entries.
- Run `node --check` on changed JavaScript.
- Run `python3 dev-test.py` from `desktop-rust/src`.
