# Notes Folder Pane Resize

## Goal

Improve the Notes left folder tree by allowing the user to resize the folder
pane with the mouse and by removing the nested folder count from folder rows.

## Product Decisions

- Add a narrow draggable divider between the folder tree and notes/content area.
- Persist the width per desktop installation through existing settings:
  `notes.folder_tree_width`.
- Use a practical width range so the folder tree cannot collapse or dominate
  the workspace:
  - minimum: 200px;
  - maximum: 520px;
  - default: current visual width, 260px.
- Double-clicking the divider resets the width to the default.
- Remove the nested folder counter from folder rows entirely.
- Preserve current Notes folder drag-and-drop behavior and hover stability.

## UX

- Divider has `col-resize` cursor and a subtle hover/drag accent.
- During drag, text selection is disabled and the pane width updates live.
- Width is saved on drag end, not on every pointer move.
- Invalid persisted widths are ignored or clamped to the supported range.
- If saving fails, the UI keeps the new width for the current session and shows
  an error toast.

## Release Impact

This is a frontend-only Notes UI change using existing settings commands. It
should ship as an `f-*` desktop OTA release after Help/release history updates.
