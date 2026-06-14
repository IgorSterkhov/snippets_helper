# Finance Row Editing Polish

## Goal

Fix two desktop Finance editing regressions:

- saving an amount in a long expense tree must not jump the row list back to
  the top;
- keyboard-created placeholder names such as `Untitled item` must be selected
  when focus returns to the row name, so typing replaces the placeholder.

## Scope

- Desktop frontend only.
- No new Tauri commands or API changes.
- Existing autosave and full reload behavior may stay, but the user viewport
  and active field should be restored after a save-triggered reload.

## Expected Behavior

- Pressing Enter or otherwise committing an amount near the bottom of a long
  Finance list preserves the scroll position and working row context.
- A row created by keyboard, then indented with Tab before a real name is typed,
  may be saved as `Untitled item`, but the focused name field selects that text.
  The next typed character replaces it.

## Verification

- Add browser mock coverage for long Finance list scroll preservation.
- Add browser mock coverage for placeholder selection after keyboard create and
  Tab indent.
