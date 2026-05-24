# Snippets Left Panel Sort Spec

## Requirement

Add a sorting control to the Snippets left panel.

## Approved UI

Use option A from the visual companion: a compact sort button in the header
next to search, showing the active mode and opening a two-item menu.

## Behavior

- Default mode remains alphabetical by snippet name.
- Alternative mode sorts by `updated_at`, newest first.
- The chosen mode is saved locally and survives frontend reloads/restarts.
- Sorting applies after the current tag/search filtering.
- Switching sort mode keeps the currently selected snippet selected when it is
  still present in the filtered list.
- No new native/Tauri command is added.

## Release Notes

Because this is user-facing desktop UI behavior, the release must update Help,
`desktop-rust/src/release-history.md`, and `desktop-rust/CHANGELOG.md` before
tagging.
