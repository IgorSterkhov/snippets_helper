# Mobile Task Checkbox Tree — Requirement Spec

## Status

Draft. User selected approach A on 2026-05-24:

- first fix mobile display of existing nested checkboxes;
- later handle mobile editing of nesting as a separate approach B.

## Goal

Fix mobile Tasks so checkbox hierarchy synced from desktop is displayed as a
tree instead of a flat mixed list.

The first pass must preserve existing data and avoid changing the sync/API
contract. It is a mobile UI/data-ordering fix only.

## Current Problem

Desktop supports nested task checkboxes through local `parent_id`.
Sync maps that relationship to `parent_uuid`, and mobile SQLite stores
`task_checkboxes.parent_uuid`.

Mobile currently loses the visual hierarchy because:

- `TaskEditorScreen` renders `visibleCheckboxes.map(...)` as one flat list;
- `getTaskCheckboxes()` orders by `parent_uuid, sort_order`, which groups rows
  by parent UUID but does not produce depth-first tree order;
- `addCheckbox()` always creates root-level items with `parent_uuid: null`;
- mobile has no controls to create or move nested items.

Result: checkboxes that are nested on desktop appear on the same level on
mobile and may look mixed after sync.

## In Scope For This Pass

- Build a deterministic checkbox tree from `parent_uuid`.
- Render visible checkboxes in depth-first order.
- Show nesting visually with indentation on mobile.
- Keep existing checkbox actions working:
  - toggle checked state;
  - edit text;
  - delete an item and its subtree;
  - save changes;
  - sync changes.
- Keep new mobile checkboxes root-level for now.
- Add tests for tree ordering/hierarchy helpers.
- Ship as mobile OTA if only `mobile/src/**`, `mobile/__tests__/**`, and mobile
  version files change.

## Out Of Scope For This Pass

- Creating child checkboxes on mobile.
- Moving checkboxes between parents on mobile.
- Drag-and-drop ordering on mobile.
- Desktop UI changes.
- API/schema changes.
- Server migration changes.

These belong to a later approach B pass.

## Functional Requirements

### Tree Construction

Mobile must treat `uuid` and `parent_uuid` as canonical hierarchy fields.

For a task's checkbox list:

1. Ignore rows with `is_deleted`.
2. Root items are rows where `parent_uuid` is empty/null or points to a missing
   checkbox.
3. Siblings are ordered by `sort_order`, then by `text`, then by `uuid` as a
   stable fallback.
4. Render order is depth-first:
   - root item;
   - its children in sibling order;
   - each child's descendants recursively.
5. Cycles must not cause infinite recursion. If a cycle is detected, remaining
   affected rows should still appear once at root level.

### Display

Each checkbox row should show its depth with left indentation. The indentation
must be compact enough for phone screens and must not push text/actions out of
the row.

Recommended first-pass behavior:

- depth `0`: no extra indent;
- depth `1+`: fixed step indent, capped at a reasonable maximum;
- existing check/toggle, text input, and delete controls remain visible.

### Editing

Editing in this pass does not change hierarchy.

- Toggling a child checkbox keeps its `parent_uuid`.
- Editing child text keeps its `parent_uuid`.
- Deleting a parent marks the parent and all descendants deleted, using the
  existing subtree deletion behavior.
- Adding a new checkbox creates a root item with `parent_uuid: null`, matching
  current behavior.

## Implementation Notes

Prefer a pure helper for tree flattening so it can be unit-tested without
rendering React Native UI.

Candidate helper:

```text
flattenCheckboxTree(items) -> [{ item, depth }]
```

The helper can live in `mobile/src/db/taskRepo.js` or a small task utility file.
Keeping it near `taskRepo` is acceptable because it operates on task checkbox
records and avoids making `TaskEditorScreen` responsible for tree algorithms.

`TaskEditorScreen` should render the flattened tree instead of
`visibleCheckboxes.map(...)`.

## Verification

Required checks before release:

```bash
cd mobile && npm test -- --runTestsByPath __tests__/db/taskRepo.test.js
```

```bash
cd mobile && npm test -- --runInBand
```

If released as OTA:

```bash
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api \
POST_RELEASE_REGISTER_USER=1 \
POST_RELEASE_DESKTOP_TAG=v1.3.29 \
POST_RELEASE_MOBILE_VERSION=1.0.12 \
bash tests/post_release/run.sh -q
```

Manual acceptance on device:

- open a task that has nested desktop checkboxes;
- verify children are indented under the correct parents;
- verify checkbox order matches desktop hierarchy;
- toggle/edit a nested item, save, sync, and confirm hierarchy remains intact.
