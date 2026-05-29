# Desktop Task Checkbox Enter Insert Plan

## Approach

Keep this as a frontend-only behavioral fix.

The backend already supports creating a checkbox and reordering checkbox rows.
Changing the native command signature is unnecessary for this behavior and would
force a full native release. The frontend should compose the existing commands:
create first, then reorder the affected sibling bucket.

## Steps

1. Add a regression smoke test in `desktop-rust/src/dev-test.py`:
   - seed a task with root siblings and child siblings;
   - press Enter in a middle root checkbox;
   - assert the created root checkbox sorts immediately after that root;
   - press Enter in a child checkbox;
   - assert the created child checkbox has the same parent and sorts immediately
     after that child.
   - include a hidden completed sibling in the same root bucket and assert it
     remains stored, keeps relative order, and does not become the insertion
     target;
   - include a grandchild bucket and assert Enter on a deeper checkbox creates a
     sibling with the same `parent_id` immediately after the current row.
2. Update `desktop-rust/src/dev-mock.js` with a realistic
   `create_task_checkbox` handler because the new test needs the browser mock to
   create rows like the native backend.
3. Update `desktop-rust/src/tabs/tasks/card.js`:
   - replace the Enter handler's create-only path with a helper that creates the
     sibling and then calls `reorder_task_checkboxes`;
   - after `create_task_checkbox`, force-load the full checkbox list or merge the
     returned row, sort the same-parent sibling bucket by `sort_order` plus stable
     `id`, remove the created row, splice it after the current row, then send
     reorder entries for the whole sibling bucket;
   - include non-visible siblings in the reordered bucket so hidden completed
     rows keep their relative order and do not get dropped;
   - keep the existing focus-after-reload behavior.
4. Run checks:
   - `node --check desktop-rust/src/tabs/tasks/card.js`;
   - `node --check desktop-rust/src/dev-mock.js`;
   - targeted `python3 dev-test.py`;
   - full `python3 dev-test.py` when practical.
5. If only `desktop-rust/src/` and workflow docs changed, publish a frontend-only
   OTA tag after updating `desktop-rust/src/tabs/help.js`,
   `desktop-rust/src/release-history.md`, and `desktop-rust/CHANGELOG.md` as
   required by the release gate.

## Reviewer Focus

- The new row must not be appended to the end after Enter.
- The fix must work for child sibling buckets, not only root rows.
- Hidden completed checkbox rows must preserve ordering and must not be lost.
- No native command/API signature changes should be introduced.
