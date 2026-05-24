# Desktop Pinned Task Chip Drag-Reorder — Requirement Spec

## Status

Approved by user on 2026-05-24. Selected approach: extend the existing Tasks
DnD layer.

## Goal

Let users reorder pinned task chips in the desktop Tasks tab by dragging a chip
within the wrapped chip strip.

## Scope

Ship as a desktop frontend-only OTA if only `desktop-rust/src/**` files change.

In scope:

- Drag pinned chips inside `#tasks-pinned`.
- Preserve normal click behavior: click opens the task; drag only starts after
  a small pointer movement threshold.
- Show a floating ghost while dragging.
- Replace the source slot with a placeholder of the same size.
- Move the placeholder through wrapped flex rows so chips visibly make room.
- Use FLIP animation when the placeholder moves.
- Persist the final pinned order using existing `reorder_tasks`.
- Reload tasks/pinned chips after commit.

Out of scope:

- New Tauri commands.
- Native/Rust changes.
- Dragging pinned chips to category/status dropdowns.
- Reordering unpinned tasks from the chip strip.

## Interaction Requirements

- The chip strip remains `flex-wrap`.
- The placeholder must work across line wraps, not only in one horizontal row.
- Position calculation uses both row and horizontal location:
  - group chip rects into visual rows by `top`;
  - within the target row, compare cursor `x` with chip midpoints;
  - if the cursor is below the last row, place the placeholder at the end.
- Dropping outside the chip strip cancels the reorder.
- Reorder calls `reorder_tasks` with all task ids ordered as:
  - pinned ids in the new chip-strip order first;
  - existing unpinned visible ids after them, preserving their current order.

## Testing

Add a desktop browser mock smoke test:

- open the Tasks tab;
- wait for pinned chips;
- drag the last pinned chip before the first pinned chip using pointer events;
- verify the DOM chip order changes after reload;
- verify regular click behavior is not broken by opening a chip after the drag.

Run before release:

```bash
node --check desktop-rust/src/tabs/tasks/dropdown.js
node --check desktop-rust/src/tabs/tasks/dnd.js
node --check desktop-rust/src/tabs/tasks/index.js
cd desktop-rust/src && python3 dev-test.py
```
