# Launchpad Containers And Grid

## Goal

Turn Micro Launchpad from a flat tile strip into a compact configurable
dashboard that can group commands and object shortcuts without losing keyboard
speed.

## Requirements

- Launchpad closes after activating an item that opens a new window:
  module tiles and object tiles for tasks, notes, snippets, and finance lists.
- Launchpad stays open after running an Exec command and continues to show the
  command status/output.
- Remove the `Add` tile from the main grid.
- Add a compact `+` button in the top bar, next to Settings.
- The `+` menu offers:
  - Add item.
  - Add container.
  - Add separator.
- Add item keeps the existing module/object drill-down flow.
- Containers are not full-width by default. A container has explicit `w` and
  `h` spans in the Launchpad grid, for example `2x1`, `2x2`, or `3x2`.
- In Edit mode containers can be resized by dragging the lower-right resize
  handle and by editing explicit `W` / `H` numeric fields.
- Containers can hold item tiles, especially commands. Items can be moved into
  containers, out of containers, and between containers.
- Deleting a container must not delete its content. Its child items are
  unwrapped back into the top-level grid near the deleted container.
- Separators are top-level layout entries with configurable width. They can be
  reordered and deleted in Edit mode.
- Launchpad has configurable grid size, stored per machine:
  `launchpad.columns` and `launchpad.rows`, default `4x3`.
- Changing grid size updates the visible grid and resizes the frameless
  Launchpad window.
- Existing `launchpad.items` data remains compatible: old flat items load as
  top-level tile entries.

## Layout Rules

- Launchpad uses CSS Grid auto-placement, not persisted `x/y` coordinates.
- `w` / `h` are grid spans. Entries are rendered in persisted order and the
  browser places them in the first available cells.
- `w` is clamped to `1..columns`; `h` is clamped to `1..4`.
- Resize never pushes or deletes other entries. If a larger span no longer fits
  in the current row, CSS Grid naturally places the entry in a later slot.
- The Launchpad window size is fixed by `columns` and `rows`; extra content
  scrolls inside `.launchpad-body`.
- Search, Recent, keyboard selection, and activation use a flattened item list:
  top-level tiles plus container children in visual/persisted order.
- Separators are not selectable outside Edit mode.
- Containers are selectable only in Edit mode. In normal mode their child tiles
  are selectable and executable.
- Old flat `launchpad.items` entries without `layoutType` normalize to
  `{ layoutType: "tile", item: oldItem, w: 1, h: 1 }` when loaded. Persisting
  after any layout edit writes the new shape while preserving old tile actions.

## Visual Direction

Use a dark command-console look rather than a heavy card dashboard. Containers
should read as quiet trays: subtle frame, compact title, internal mini-grid.
The signature visual element is the resize corner and thin amber selection
frame in Edit mode, so layout editing is clear without making normal mode busy.

Palette:
- `#080d12` shell black.
- `#0f1720` tray surface.
- `#58b8ea` cyan focus.
- `#f4c85d` amber selection.
- `#7f929d` muted labels.
- `#edf4f7` primary text.

## Release

This requires a native minor release, `v1.21.0`, because Launchpad window
sizing adds native command surface and this is a new visible workflow.
