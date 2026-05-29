# Desktop Task Checkbox Enter Insert

## Requirement

When editing a task checkbox in the desktop Tasks module, pressing Enter should
create a new checkbox at the same hierarchy level directly after the checkbox
where Enter was pressed.

This must apply to every hierarchy level:

- root checkbox -> new root checkbox after the current root checkbox;
- child checkbox -> new child under the same parent after the current child;
- deeper checkbox -> new checkbox under the same parent after the current item.

## Current Problem

The frontend calls `create_task_checkbox` with only `taskId`, `parentId`, and
empty text. The backend assigns `sort_order = max(sort_order) + 1` inside that
parent bucket, so the new checkbox appears at the end of the sibling list.

## Expected Behavior

After Enter:

1. Persist any edited text in the current checkbox.
2. Create the new checkbox with the same `parent_id`.
3. Reorder the full sibling bucket so the new checkbox is immediately after the
   current checkbox.
4. Preserve the relative order of all other siblings.
5. Focus the new empty checkbox after the task card re-renders.

For a parent checkbox with visible descendants, the new item is a sibling of the
parent. It will render after the parent's subtree, which is the correct tree
semantics for "same hierarchy level".

## Scope

In scope:

- Desktop Tasks frontend behavior.
- Browser mock support for `create_task_checkbox`.
- Regression coverage in `desktop-rust/src/dev-test.py`.

Out of scope:

- Native command signature changes.
- Mobile behavior.
- Drag-and-drop behavior.
- Database schema changes.
