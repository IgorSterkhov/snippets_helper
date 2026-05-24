# Desktop Tasks Checkbox DnD With Hidden Completed Items

**Date:** 2026-05-24
**Status:** approved
**Scope:** `desktop-rust/src/tabs/tasks/`

## Problem

When completed checkboxes are hidden, the checkbox drag placeholder is computed
from visible rows only, but the commit code rebuilds the final checkbox state
from the full checkbox list. Hidden completed rows can keep stale `parent_id`
or `sort_order` values that make the dropped checkbox land somewhere different
from the placeholder, including under a hidden completed checkbox.

## Requirement

- Keep completed checkboxes hidden while dragging.
- The dropped checkbox must appear at the visible placeholder position after
  reload.
- Hidden completed checkboxes must not become an implicit drop target or parent.
- Hidden completed checkboxes should keep their own hierarchy and relative
  order unless the dragged visible item intentionally moves across them.
- Preserve existing nesting behavior:
  - horizontal drag nests under the visible row above;
  - no nesting into collapsed parents;
  - max depth remains enforced.

## Acceptance Test

Browser mock regression:

1. Seed a task with a hidden completed checkbox in the full checklist.
2. Enable the default hidden-completed view.
3. Drag a visible checkbox to the placeholder position below another visible
   checkbox without horizontal nesting.
4. Verify the persisted dragged checkbox parent is the visible sibling context,
   not the hidden completed checkbox.
5. Verify the visible order after reload matches the placeholder position.
