# Snippet Editor Drafts

## Goal

Protect Snippets editor content from accidental loss when a user presses Escape
or cancels a new/edit snippet modal with unsaved changes.

## Product Direction

Use option B: local draft autosave plus a discard confirmation.

## Requirements

- Autosave editor fields locally while the Snippets editor is open:
  - name;
  - value;
  - description;
  - links;
  - timestamp.
- For a new snippet, reopen the draft prompt the next time the user starts a new
  snippet if a local draft exists.
- For an existing snippet, keep a per-snippet draft and offer restore when the
  same snippet is edited again and the draft differs from saved content.
- On Escape or Cancel with unsaved changes, do not close immediately. Ask the
  user whether to keep editing or discard the unsaved changes.
- Clear the matching draft after a successful save or explicit discard.
- Keep the feature frontend-only: use browser local storage and existing modal
  infrastructure, with no new Tauri command or schema change.

## UX

- New snippet with draft:
  - show a compact restore dialog before opening the editor;
  - actions: Restore, Start empty, Discard draft.
- Editor cancel with changes:
  - show a confirmation dialog;
  - actions: Continue editing, Discard.

## Constraints

- Drafts are local to the desktop WebView/device and are not synced.
- Do not store more than the single new-snippet draft and one draft per edited
  snippet id.
- Successful Save remains the authoritative persistence path through the
  existing `create_shortcut` / `update_shortcut` commands.
