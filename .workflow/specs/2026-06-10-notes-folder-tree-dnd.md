# Notes Folder Tree DnD

## Goal

Improve the Notes module folder tree in the left panel:

- folder rows must not shift neighboring rows on hover;
- folders can be reordered with the mouse;
- folders can be nested by dropping one folder onto another folder;
- dropping between folders inserts the folder into that sibling slot;
- reusable implementation guidance for nested-tree drag and drop is saved for future work.

## UX Decisions

- Drag starts from a fixed grip handle on the left side of each folder row.
- Dropping onto a collapsed folder is allowed and automatically expands the target folder.
- Dropping after an expanded folder means after the whole visible branch, not before its first child.

## Visual Design

- Use a compact file-explorer tree row.
- Reserve fixed layout zones for grip, expand arrow, icon, title, badge, and actions.
- Folder actions fade in by opacity on hover/focus; they must not use `display: none` in a way that changes row layout.
- Use a line indicator for before/after drops.
- Use a row highlight for "make child" drops.
- Keep row height stable across default, hover, active, and drag states.

## Data Rules

- The persisted order is sibling-local through `sort_order`.
- A move updates `parent_id` and normalizes `sort_order` in the old and new sibling buckets.
- A folder cannot be moved into itself or into any descendant.
- Moving into another folder must mark the moved folder and affected sibling rows as pending sync.

## Release Impact

This adds a native Tauri command for folder movement, so it must ship as a full desktop `v*` patch release.
