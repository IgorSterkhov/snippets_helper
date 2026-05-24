# Mobile Task Checkbox Reorder Mode — Requirement Spec

## Status

Continuation approved by user on 2026-05-24 after the dot-controls OTA.

## Goal

Add a mobile checkbox reorder mode for task checklists without drag-and-drop.
The mode should let the user change checkbox order and nesting from the
existing dot handle.

## Scope

Ship as a mobile OTA if only JavaScript/mobile files change.

In scope:

- Add `Переместить` to the long-press menu on a checkbox dot.
- Enter a reorder mode with one selected checkbox row.
- Show floating controls with `up`, `down`, `left`, `right`, and `OK`.
- Persist changed `parent_uuid` and `sort_order` for existing tasks
  immediately, so sync can pick up the changes.
- Preserve the selected checkbox subtree when moving a parent row.
- Keep the phase 1 dot handle, collapse/expand, hide completed, wrap text,
  and trash icon behavior.

Out of scope:

- Drag-and-drop.
- Multi-select moves.
- Creating a child checkbox from the action menu.
- Desktop UI changes.
- Server/API changes.

## Interaction Requirements

### Entry

Long-pressing the left dot opens the existing action menu. The menu adds a
`Переместить` action. Selecting it highlights that checkbox row and opens the
floating reorder controls.

### Controls

The selected row is moved as a subtree: descendants stay attached to it.

- `up`: move the selected row before the previous sibling in the same parent.
- `down`: move the selected row after the next sibling in the same parent.
- `right`: make the selected row the last child of the previous sibling.
- `left`: move the selected row one level up, immediately after its current
  parent.
- `OK`: exit reorder mode.

If an action is not possible, its button is disabled.

When `right` moves a row under a collapsed previous sibling, that new parent
is expanded so the moved row does not disappear immediately.

### Filtering and Collapse

Reorder mode should show completed checkboxes even if the "hide completed"
preference is enabled. This avoids moving a row relative to hidden siblings.

Existing collapse state is preserved. The user can still collapse/expand rows
through the dot. Reorder actions operate on the full sibling group in storage
order.

## Data Requirements

The stored hierarchy remains the existing `task_checkboxes` model:

- `parent_uuid` defines nesting;
- `sort_order` defines order inside a sibling group.

Every successful move normalizes `sort_order` to `0..n` inside each affected
sibling group. Rows whose `parent_uuid` or `sort_order` changed receive a fresh
`updated_at`.

For existing tasks, changed rows are written to SQLite immediately and
`notifyLocalChange()` is called. For a new unsaved task, changes stay in React
state until the task is saved.

## Testing

Add unit coverage for the pure tree-move helper:

- moving up/down among siblings;
- indenting right under the previous sibling;
- outdenting left after the current parent;
- disabled/no-op boundary moves.

Run before OTA:

```bash
cd mobile && npm test -- --runTestsByPath __tests__/db/taskRepo.test.js
```

```bash
cd mobile && npm test -- --runInBand
```

Post-release smoke after OTA:

```bash
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api \
POST_RELEASE_REGISTER_USER=1 \
POST_RELEASE_DESKTOP_TAG=f-20260524-1 \
POST_RELEASE_MOBILE_VERSION=1.0.15 \
bash tests/post_release/run.sh -q
```
