# Checkpoint: Tasks Sync + Mobile Tasks

Date: 2026-05-23
Branch/worktree: current folder, `main`
Commit status: not committed

## Current Goal

Implemented cross-device Tasks sync support across API, desktop sync, and
mobile. Release has not been started.

## Approved Spec and Plan

- Spec: `.workflow/specs/2026-05-23-tasks-sync-mobile-api.md`
- Plan: `.workflow/plans/2026-05-23-tasks-sync-mobile-api.md`

Both are new uncommitted files. Spec status is approved.

## Current Git State

Modified:

- `api/models.py`
- `desktop-rust/src-tauri/src/db/queries.rs`
- `desktop-rust/src-tauri/src/sync/client.rs`
- `mobile/__tests__/db/database.test.js`
- `mobile/__tests__/sync/syncService.test.js`
- `mobile/package-lock.json`
- `mobile/src/db/database.js`
- `mobile/src/navigation/AppNavigator.js`
- `mobile/src/sync/syncService.js`

Untracked:

- `.workflow/checkpoints/2026-05-23-tasks-sync-checkpoint.md`
- `.workflow/plans/2026-05-23-tasks-sync-mobile-api.md`
- `.workflow/specs/2026-05-23-tasks-sync-mobile-api.md`
- `api/alembic/versions/006_add_tasks_sync_tables.py`
- `mobile/__tests__/db/taskRepo.test.js`
- `mobile/src/db/taskRepo.js`
- `mobile/src/screens/Tasks/`

Note: `mobile/package-lock.json` changed because `npm install` was run to
install mobile test dependencies. The visible diff only updates lockfile root
version from `1.0.0` to `1.0.5`, matching `mobile/package.json`.

## Implemented

API:

- Added ORM models for:
  - `task_categories`
  - `task_statuses`
  - `tasks`
  - `task_checkboxes`
  - `task_links`
- Registered all five tables in `TABLE_MODELS`.
- Added Alembic migration `006_add_tasks_sync_tables.py`.
- Migration includes UUID relationship fields:
  - `tasks.category_uuid`
  - `tasks.status_uuid`
  - `task_checkboxes.task_uuid`
  - `task_checkboxes.parent_uuid`
  - `task_links.task_uuid`

Desktop Rust sync:

- Kept desktop sync schema local-ID based; did not add UUID relationship fields
  as SQLite columns.
- Added lookup helpers in `db/queries.rs` for task category/status/task/checkbox
  `id <-> uuid`.
- Added push mapping in `sync/client.rs`:
  - `category_id -> category_uuid`
  - `status_id -> status_uuid`
  - `task_id -> task_uuid`
  - `parent_id -> parent_uuid`
- Added pull mapping in `sync/client.rs`:
  - `category_uuid -> category_id`
  - `status_uuid -> status_id`
  - `task_uuid -> task_id`
  - `parent_uuid -> parent_id`
- Missing required task parent rows for checkboxes/links are skipped instead of
  panicking; skipped counts are returned in sync result JSON.
- Task/category/status/checkbox/link display names are handled in sync logs with
  char-safe UTF-8 truncation.

Mobile:

- Added Tasks SQLite tables in `mobile/src/db/database.js`.
- Added `mobile/src/db/taskRepo.js` with builders, CRUD helpers, soft delete,
  modified-row queries, and sort-order helper.
- Added Jest coverage for task builders.
- Extended `syncService` pull/push/pending-count integration for all task tables.
- Added mobile Tasks UI:
  - `TaskListScreen`
  - `TaskEditorScreen`
  - `TaskManageScreen`
- Added bottom tab `Tasks` in `AppNavigator`.
- Mobile DnD was intentionally not implemented.

## Verification Already Run

Passed:

```bash
python3 -m py_compile api/models.py api/alembic/versions/006_add_tasks_sync_tables.py
```

```bash
cd desktop-rust/src-tauri && cargo test db::queries::tests::test_task_uuid_lookup_helpers
```

```bash
cd desktop-rust/src-tauri && cargo test sync::client::tests::extract_display_name_handles_task_tables_with_utf8
```

```bash
cd desktop-rust/src-tauri && cargo check
```

```bash
node --check mobile/src/db/taskRepo.js
node --check mobile/src/sync/syncService.js
```

```bash
node - <<'NODE'
const fs = require('fs');
const parser = require('@babel/parser');
for (const file of [
  'mobile/src/screens/Tasks/TaskListScreen.js',
  'mobile/src/screens/Tasks/TaskEditorScreen.js',
  'mobile/src/screens/Tasks/TaskManageScreen.js',
  'mobile/src/navigation/AppNavigator.js',
]) {
  parser.parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
  console.log('parsed', file);
}
NODE
```

```bash
cd mobile && npm test -- __tests__/db/database.test.js __tests__/db/taskRepo.test.js __tests__/sync/syncService.test.js
```

Result: 3 test suites passed, 9 tests passed.

Also passed:

```bash
git diff --check
```

Blocked/unusable:

```bash
cd mobile && npm run lint -- src/screens/Tasks src/navigation/AppNavigator.js
```

Reason: project has no ESLint config. The command runs ESLint 6.4.0 and exits
with "ESLint couldn't find a configuration file." This is a tooling gap, not a
specific Tasks code failure.

## Release State

Release was not started.

Reason:

- The feature is not committed yet.
- Desktop release is `v*` because `desktop-rust/src-tauri/` changed.
- Mobile release is OTA candidate because only JS/mobile source files changed.
- API deploy requires applying migration `006`.

Expected next release sequence:

1. Review/commit current feature.
2. Update desktop release files for next desktop version, likely `1.3.28`.
3. Update mobile OTA version, likely `1.0.6`.
4. Deploy API migration/service.
5. Push desktop `v1.3.28` tag and watch CI.
6. Build/upload mobile OTA `1.0.6`.
7. Run post-release smoke tests.

## Important Notes for Continuation

- Subagents hung twice. User explicitly approved fallback to inline,
  single-threaded work if subagents hang.
- No git commit has been made for this feature.
- `node_modules/` now exists under `mobile/` after `npm install`; it should be
  ignored by git.
- Local Node is `v20.19.2`; React Native packages warn they require
  `>=20.19.4`, but install and targeted Jest tests completed.

## Fork Prompt: Post-Release Smoke Automation

Use this prompt in the fork branch:

```text
You are working in /home/aster/Dev/snippets_helper on a fork branch. Follow repository instructions from AGENTS.md, CLAUDE.md, FRONTEND_PATTERNS.md, desktop-rust/RELEASES.md, and mobile/RELEASES.md before planning or editing.

Task: design and implement post-release smoke automation for the Tasks sync release. Do not implement UI E2E for mobile/desktop in this phase.

Context:
- A separate uncommitted feature branch/worktree has implemented Tasks sync across API, desktop Rust sync, and mobile React Native.
- The feature adds API task tables, desktop ID<->UUID sync mapping, mobile Tasks SQLite/repo/sync, and mobile Tasks tab.
- Desktop release will be a full v* release because Rust/native code changed.
- Mobile release will likely be JS-only OTA.
- API deploy includes Alembic migration 006 for task tables.

Goal:
Create automation that can be run after release/deploy to verify that API, desktop sync logic, mobile sync logic, and release manifests are healthy. This is not a GUI E2E task.

In scope:
1. API integration smoke:
   - verify API health endpoint;
   - verify task tables exist after migration;
   - create/register or use a test user/API key;
   - push task_categories, task_statuses, tasks, task_checkboxes, task_links;
   - pull them back and assert UUID relationships are preserved;
   - verify soft delete propagation for a task;
   - verify last-write-wins conflict behavior for a task row.

2. Cross-device sync smoke without real UI:
   - simulate desktop-style task data with local integer IDs and UUID relationships;
   - simulate mobile-style task data that stores UUID relationships directly;
   - exercise the same sync payload contract used by `/v1/sync/push` and `/v1/sync/pull`;
   - assert category/status/task/checkbox/link relationships survive desktop -> API -> mobile and mobile -> API -> desktop roundtrips.

3. Release manifest smoke:
   - desktop: verify GitHub release tag has expected frontend manifest URL and native assets for v* release;
   - mobile: verify `https://ister-app.ru/snippets-updates/latest.json` has expected OTA version and reachable bundle URL;
   - API: verify deployed API reports healthy after migration.

4. Local developer runner:
   - add a script or documented command that runs the smoke suite against configurable environment variables:
     - API base URL
     - API key or test user name
     - desktop release tag
     - mobile expected version
   - keep secrets out of git.

Out of scope:
- No Android emulator automation.
- No Maestro/Detox/Appium.
- No desktop GUI automation.
- No release tagging/deploying.
- No destructive cleanup of production data unless explicitly isolated under a test user.

Preferred implementation:
- Put requirement spec in `.workflow/specs`.
- Put implementation plan in `.workflow/plans`.
- After approval, implement tests/scripts.
- Prefer Python pytest for API/cross-device smoke if it fits existing API tooling.
- Use official/public HTTP calls for release manifest checks.
- Tests must be safe to run repeatedly; generated test rows should use unique prefixes such as `smoke_<timestamp>`.

Deliverables:
- A spec for post-release smoke automation.
- An implementation plan.
- Smoke test code/scripts.
- Clear command examples.
- Verification output from running the suite locally against either a local API or a configured deployed test environment.

Acceptance criteria:
- A single command can run non-UI post-release smoke checks.
- The command fails if task UUID relationships are broken.
- The command fails if mobile OTA manifest version/bundle URL is wrong.
- The command fails if desktop release manifest/assets are missing.
- The command does not require a mobile emulator or desktop GUI.
```
