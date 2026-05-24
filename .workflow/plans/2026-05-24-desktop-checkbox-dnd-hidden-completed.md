# Plan: Desktop Tasks Checkbox DnD With Hidden Completed Items

## Goal

Make checkbox drag-and-drop commits match the visible placeholder when
completed checkboxes are hidden.

## Steps

- [x] Add a browser mock regression test for dragging around a hidden completed
      checkbox and verify it fails before the fix.
- [x] Add checkbox reorder/update mocks needed by the regression scenario.
- [x] Change checkbox DnD commit payload so it carries visible drop context
      instead of relying on an incomplete DOM-only `orderedIds` list.
- [x] Rebuild checkbox entries with visible placement semantics while preserving
      hidden completed rows.
- [x] Run `node --check` on changed JS files.
- [x] Run `cd desktop-rust/src && python3 dev-test.py`.
- [x] Run `cd desktop-rust/src-tauri && cargo check`.
- [x] Update release history/changelog if the user-facing fix is released.
