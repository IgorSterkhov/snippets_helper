# Prompt: Nested Tree Drag-and-Drop Algorithm

Use this prompt when implementing mouse drag-and-drop for a nested, reorderable tree.

Build a pointer-events based drag-and-drop system. Do not use HTML5 Drag and Drop,
because embedded webviews often handle it inconsistently.

Requirements:

1. Data model:
   - Each row has `id`, `parent_id`, `sort_order`, and optional `children`.
   - Persist order per sibling bucket, not globally.
   - Reject invalid moves where the dragged node becomes a child of itself or one
     of its descendants.
   - Commit moves atomically in the backend: update `parent_id`, normalize
     `sort_order` for affected old and new sibling buckets, and mark changed rows
     dirty for sync.

2. Rendering:
   - Render a flat list of visible rows from the tree, preserving depth metadata.
   - Keep row height stable. Reserve fixed zones for grip, disclosure arrow,
     icon, label, metadata, and actions.
   - Show actions with opacity/visibility, not layout-changing `display: none`.
   - Use `data-id`, `data-parent-id`, and `data-depth` on each visible row.

3. Drag start:
   - Start only from a grip handle.
   - Require a small movement threshold before starting the drag.
   - Create a fixed-position ghost clone that follows the pointer.
   - Mark the source row as dragging and suppress its click after the drop.

4. Drop target calculation:
   - For each pointer move, inspect the visible row under the cursor.
   - Split each row vertically into three zones:
     - top third: drop `before` this row;
     - middle third: drop `inside` this row;
     - bottom third: drop `after` this row's visible branch.
   - If the row is expanded and the operation is `after`, insert after the last
     visible descendant of that row.
   - If the target row is collapsed and operation is `inside`, allow the drop and
     expand the target after the commit.

5. Visual feedback:
   - For `before` / `after`, show a full-width insertion line at the computed slot.
   - For `inside`, highlight the target row as the new parent.
   - Animate moved visible rows with FLIP:
     - capture old bounding rects;
     - move indicator or placeholder;
     - apply inverse transform;
     - play a short transform transition.

6. Commit:
   - Convert the visual drop operation into backend arguments:
     - `inside target`: `parent_id = target.id`, `before_id = null`;
     - `before target`: `parent_id = target.parent_id`, `before_id = target.id`;
     - `after branch`: `parent_id = branchRoot.parent_id`, `before_id = nextVisibleSiblingAfterBranch || null`.
   - Reload canonical data from the backend after a successful commit.
   - On failure, cleanup visuals and show a persistent diagnostic error if the app
     has one; otherwise show a clear toast.

7. Edge cases:
   - No-op drops should not call the backend.
   - Dropping outside the tree cancels.
   - Hidden/collapsed descendants must remain in storage and must not be inferred
     as drop targets unless the operation explicitly drops into their visible parent.
   - Preserve selection and expansion state where possible.
