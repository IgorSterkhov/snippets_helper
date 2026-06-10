# Implementation Plan: Notes Folder Pane Resize

## Steps

1. Inspect `desktop-rust/src/tabs/notes.js` folder tree layout and current
   folder row metadata/count rendering.
2. Add local UI constants and helpers for `notes.folder_tree_width`:
   - load setting during init/render;
   - apply width through a CSS custom property or inline style;
   - normalize persisted values by parsing integers, rejecting empty/NaN/
     non-finite values, clamping to 200..520px, and falling back to the current
     default 260px when needed.
3. Add divider DOM and pointer handlers:
   - pointerdown starts resize;
   - pointermove updates width live;
   - pointerup persists the clamped width with `set_setting`;
   - pointercancel and pointerup both remove document listeners, drag classes,
     cursor overrides, and selection locks;
   - double-click resets to 260px and persists it.
4. Remove nested folder count from folder row markup without changing the row
   height or drag target layout.
5. Update Help/release history/changelog for the Notes UI change.
6. Verify:
   - `node --check` on changed JS;
   - `python3 dev-test.py`, comparing against known unrelated failure baseline.
7. Commit and release as frontend-only `f-20260610-N`, monitor CI, and verify
   frontend manifest/assets.
