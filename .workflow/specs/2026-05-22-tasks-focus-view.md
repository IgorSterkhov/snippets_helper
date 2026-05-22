# Tasks Focus View Spec

## Goal

Add a third Tasks layout mode, `Focus view`, alongside the existing one-column
and two-column card views.

`Focus view` is for working with one selected task at a time while keeping the
existing top-level task filters and pinned chips available.

## Selected UX

- Mode name in code and tooltip: `Focus view`.
- Mode button: SVG-only `list + detail` icon, no text label.
- Layout: B + search from the visual review.
- Pinned outside filters behavior: keep current filters unchanged, open the
  pinned task in the right pane, show a banner, and provide `Show in list`.

## Layout

The top Tasks area stays as it is today:

- header with `Tasks`, help, and settings;
- pinned task chips;
- Category and Status filters;
- `+ New task`;
- layout mode switch.

The layout mode switch becomes a compact three-segment icon control:

- one-column icon, existing behavior;
- two-column icon, existing behavior;
- `Focus view` icon (`list + detail`), new behavior.

In `Focus view`, the content area below filters is split into two panes:

- left pane: narrow task index;
- right pane: selected task detail/editor.

## Left Pane

The left pane shows the currently filtered task list.

Each row is one line:

- category color bar;
- status dot;
- task title with ellipsis;
- pin marker when pinned.

Above the rows, show a local search input:

- placeholder: `Search visible tasks...`;
- searches only tasks already visible after Category and Status filters;
- does not change backend filters or saved settings;
- if the selected task is filtered out by local search, keep it open on the
  right but remove the active row highlight.

## Right Pane

The right pane shows the selected task using the existing expanded task editor
surface:

- title;
- category/status;
- pin;
- tracker;
- links;
- color;
- checkboxes;
- notes;
- actions.

This should reuse existing task card/editor behavior as much as practical.

## Selection Rules

- Switching to `Focus view` selects:
  - current `expandedTaskId` if it exists;
  - otherwise the first task in the current filtered list;
  - otherwise an empty state.
- Clicking a row in the left pane opens that task in the right pane.
- Creating a new task in `Focus view` opens the new task in the right pane.
- Editing task metadata can make the task disappear from the filtered left
  list; in that case keep it open on the right and show the outside-filter
  banner.

## Pinned Chips Outside Filters

Pinned chips keep their current top-row location and remain clickable.

When a pinned chip points to a task that is not in the current Category/Status
filtered list:

- do not change the filters;
- open the task in the right pane;
- do not highlight any row in the left pane;
- show a banner above the detail editor:
  - text: `Opened from pinned chips. This task is outside current filters.`
  - action: `Show in list`.

`Show in list` changes filters so the task appears in the left list:

- set Category to the task category, or `None` when it has no category;
- set Status to the task status, or `None` when it has no status;
- keep the task selected.

## Persistence

Use the existing `tasks_layout_mode` setting with a third value:

- `one-col`;
- `two-col`;
- `focus`.

Unknown or missing values fall back to `one-col`.

The local search text is session-local and not persisted.

## Drag And Drop

Do not add task card drag-and-drop inside `Focus view` in this iteration.

Reason: the left pane is a compact index, not a card list. Existing drag-and-drop
behavior stays available in one-column and two-column modes.

Checkbox drag-and-drop inside the selected task remains available through the
existing editor.

## Empty States

- No tasks after Category/Status filters: show an empty left pane and a right
  empty state: `No tasks match the current filters.`
- Local search has no matches: show `No visible tasks match search.` in the
  left pane; keep the current right-pane selection if any.
- No selected task: show `Select a task from the list.`

## Out Of Scope

- Backend changes.
- New Tauri commands.
- Full-text backend search.
- Syntax or Markdown changes.
- Reordering tasks from the compact left pane.

## Verification

Add browser smoke coverage for:

- layout switch includes three modes and persists `focus`;
- `Focus view` renders top filters and pinned chips;
- left pane rows are one-line task titles with category/status/pin markers;
- local search filters only the left visible list;
- clicking a left row opens the task on the right;
- clicking a pinned chip outside current filters opens the task on the right,
  keeps filters unchanged, shows the outside-filter banner, and exposes
  `Show in list`;
- `Show in list` changes filters so the task appears in the left list.
