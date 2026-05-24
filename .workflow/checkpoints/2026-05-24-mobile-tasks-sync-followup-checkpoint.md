# Checkpoint: Mobile Tasks Sync Follow-up

Date: 2026-05-24
Branch/worktree: current folder, `main`
Current git state before this checkpoint: clean, `main...origin/main`

## User-Verified Status

The user confirmed that mobile synchronization has now completed successfully
after the latest fixes. Desktop Debug Sync full pull showed server-side task
data for the same API key:

- `task_categories`: 3
- `task_statuses`: 5
- `tasks`: 8
- `task_checkboxes`: 95
- `task_links`: 1

After mobile OTA `1.0.11`, the mobile app was able to sync this data.

## Released Versions Involved

Desktop:

- `v1.3.28`: initial Tasks sync + mobile Tasks release.
- `v1.3.29`: desktop one-time Tasks sync backfill, commit
  `0be564d backfill desktop tasks sync (v1.3.29)`.

Mobile OTA:

- `1.0.6`: initial mobile Tasks tab/data/sync.
- `1.0.7`: first attempt at mobile initial Tasks sync.
- `1.0.8`: mobile full-pull marker `tasks_initial_sync_backfill_v1`.
- `1.0.9`: skip invalid task child sync rows.
- `1.0.10`: refresh mobile Tasks list after sync completes, marker
  `tasks_initial_sync_backfill_v2`.
- `1.0.11`: force another full Tasks pull after desktop backfill, marker
  `tasks_initial_sync_backfill_v3`, commit
  `25ee2c0 force mobile tasks resync (OTA 1.0.11)`.

Production mobile update manifest at checkpoint time:

```json
{"version":"1.0.11","bundle_url":"https://ister-app.ru/snippets-updates/bundle-1.0.11.zip","release_notes":"Force one full task sync after desktop backfill."}
```

## Problems Solved In This Debugging Pass

1. Mobile showed Tasks tab but no task data.

Root cause: server initially had old synced tables for the user's API key, but
no `task_categories`, `task_statuses`, or `tasks`. Only orphan
`task_checkboxes` existed. Mobile could not pull rows that were not on the
server.

Fix: desktop release `v1.3.29` requeued existing local desktop task rows once
for upload.

2. Mobile sync hit `NOT NULL constraint failed: task_checkboxes.task_uuid`.

Root cause: server had invalid task child rows without `task_uuid`. Mobile
SQLite requires `task_uuid TEXT NOT NULL`.

Fix: API pull/push and mobile pull skip invalid `task_checkboxes`/`task_links`
rows without `task_uuid`. Covered by regression tests and post-release smoke.

3. Server had tasks after desktop backfill, but mobile still showed no tasks.

Root cause: mobile `1.0.10` had already saved a new `last_sync_at` after an
earlier empty/full pull. Desktop backfill uploaded existing task rows with their
original older `updated_at` values, so mobile incremental pull no longer saw
them.

Fix: mobile OTA `1.0.11` changes the full-pull marker to
`tasks_initial_sync_backfill_v3`, forcing one more `last_sync_at = null` pull on
upgraded devices.

## Verification Already Run

Mobile tests after OTA `1.0.11`:

```bash
cd mobile && npm test -- --runInBand
```

Result: 7 test suites passed, 27 tests passed.

Production post-release smoke after OTA `1.0.11`:

```bash
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api \
POST_RELEASE_REGISTER_USER=1 \
POST_RELEASE_DESKTOP_TAG=v1.3.29 \
POST_RELEASE_MOBILE_VERSION=1.0.11 \
bash tests/post_release/run.sh -q
```

Result: 6 passed.

## Current Open Mobile Tasks Issue

User's first follow-up remark:

> Checkboxes do not support nesting on mobile. In a task they appear on one
> hierarchy level and got mixed.

Current evidence from code:

- Mobile SQLite has `task_checkboxes.parent_uuid`.
- Mobile sync includes `parent_uuid` and `task_uuid`.
- Desktop sync maps `parent_id <-> parent_uuid`.
- Desktop task code supports nested checkboxes and reorder with parent IDs.
- Mobile `TaskEditorScreen` renders `visibleCheckboxes.map(...)` as a flat list.
- Mobile `addCheckbox()` always creates a root checkbox with `parent_uuid: null`.
- Mobile `getTaskCheckboxes()` orders by `parent_uuid, sort_order`, which groups
  siblings by parent UUID but does not produce a stable depth-first tree order.

Interpretation: this is likely a mobile UI/editing limitation, not a server sync
schema problem. The hierarchy data is present in the model, but mobile does not
build/render a checkbox tree and does not provide controls to create/move nested
items.

## Suggested Next Scope

Create a small mobile Tasks follow-up spec before implementation. Candidate
requirement:

- Render task checkboxes as a hierarchy on mobile using `parent_uuid`.
- Preserve desktop ordering semantics: root items ordered by `sort_order`, then
  each item's children ordered by `sort_order`.
- Prevent mixed flat display when nested rows are pulled from desktop.
- Decide whether mobile should only display existing nesting or also allow
  editing nesting.

Potential implementation surfaces:

- `mobile/src/db/taskRepo.js`
- `mobile/src/screens/Tasks/TaskEditorScreen.js`
- `mobile/__tests__/db/taskRepo.test.js`
- possibly `mobile/__tests__/sync/syncService.test.js` if ordering/tree helpers
  are placed outside the screen.

