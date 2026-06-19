# Snippet Editor Drafts Implementation Plan

## Files

- `desktop-rust/src/tabs/shortcuts.js`
- `desktop-rust/src/components/modal.js`
- `desktop-rust/src/tabs/help.js`
- `desktop-rust/src/release-history.md`
- `desktop-rust/CHANGELOG.md`
- `desktop-rust/src/dev-test.py`

## Steps

1. Add small localStorage helpers in `shortcuts.js` for draft keys, JSON
   parsing, snapshot comparison, and draft timestamps.
2. Convert the Snippets Add button to open a draft choice dialog when a new
   snippet draft exists.
3. Extend `showModal` minimally so cancel can be guarded before the overlay is
   removed, button labels can be customized, and one extra footer action can be
   added for the draft restore dialog.
4. Update `openEditor` so it can receive an initial draft snapshot and stores
   snapshots on input/link changes.
5. Add cancel protection by passing `onCancel` to `showModal`; if the snapshot
   differs from the initial saved state, show a confirmation dialog and return
   `false` unless the user explicitly discards.
6. Make editor validation/API errors throw from `onConfirm` so the editor stays
   open and the draft is not cleared when save fails.
7. Clear the draft after successful create/update and after explicit discard.
8. Extend smoke tests to cover:
   - Escape with unsaved new snippet keeps the editor open unless discarded;
   - a new snippet draft can be restored after cancel/reopen.
9. Update Help and release history for the user-facing behavior.

## Validation

- `node --check desktop-rust/src/tabs/shortcuts.js`
- `node --check desktop-rust/src/components/modal.js`
- `node --check desktop-rust/src/tabs/help.js`
- `python3 -m py_compile desktop-rust/src/dev-test.py`
- `cd desktop-rust/src && python3 dev-test.py`
- `cd desktop-rust/src-tauri && cargo check`
- `git diff --check`
