# Tasks Sync + Mobile Tasks — Requirement Spec

## Status

Approved by user on 2026-05-23.

## Goal

Add cross-device synchronization for the desktop Tasks module and add a full
Tasks tab to the Android mobile app.

The feature must cover:

- server API support for all Tasks tables;
- desktop sync of existing Tasks data;
- mobile local storage, UI, and sync for Tasks;
- reliable relationship mapping between devices.

## Scope

### In scope

- API models and migration for:
  - `task_categories`
  - `task_statuses`
  - `tasks`
  - `task_checkboxes`
  - `task_links`
- Desktop sync support for those tables.
- Mobile SQLite tables for Tasks.
- Mobile Tasks tab with full CRUD:
  - categories
  - statuses
  - tasks
  - checkboxes
  - links
  - task notes
  - pinning
  - filters
  - create, edit, delete
- Mobile sync integration with the existing `/v1/sync/push` and
  `/v1/sync/pull` flow.
- Last-write-wins conflict behavior, matching current sync.

### Out of scope for first implementation

- Mobile drag-and-drop ordering UI.
- Background push notifications for task changes.
- Real-time sync or websocket transport.
- Changing the existing desktop Tasks UI unless needed for sync correctness.

## Key Decision: UUID Relationships

Desktop Tasks currently use local integer IDs for relationships:

- `tasks.category_id`
- `tasks.status_id`
- `task_checkboxes.task_id`
- `task_checkboxes.parent_id`
- `task_links.task_id`

Those IDs are local to one SQLite database and are not safe as cross-device
relationship identifiers.

The sync/API contract must use UUID relationships:

- `tasks.category_uuid`
- `tasks.status_uuid`
- `task_checkboxes.task_uuid`
- `task_checkboxes.parent_uuid`
- `task_links.task_uuid`

Desktop keeps its local integer IDs for UI and database queries. During sync,
desktop maps IDs to UUIDs on push and UUIDs back to local IDs on pull. This
matches the existing Notes pattern:

- desktop Notes UI uses `notes.folder_id`;
- server/mobile use `notes.folder_uuid`;
- desktop sync maps between them through `note_folders.id` and
  `note_folders.uuid`.

Mobile stores UUID relationships directly, like it already does for
`notes.folder_uuid`.

## API Data Model

Add SQLAlchemy models and Alembic migration for Tasks.

### `task_categories`

- `uuid` UUID primary key
- `user_id` UUID foreign key to `users.id`
- `id` integer nullable local desktop ID
- `name` string
- `color` string
- `sort_order` integer
- `created_at` datetime
- `updated_at` datetime
- `is_deleted` boolean

Index: `(user_id, updated_at)`.

### `task_statuses`

Same structure as `task_categories`.

### `tasks`

- `uuid` UUID primary key
- `user_id` UUID foreign key to `users.id`
- `id` integer nullable local desktop ID
- `title` string
- `category_id` integer nullable compatibility/local field
- `category_uuid` UUID nullable
- `status_id` integer nullable compatibility/local field
- `status_uuid` UUID nullable
- `is_pinned` integer or boolean-compatible integer
- `bg_color` string nullable
- `tracker_url` text nullable
- `notes_md` text
- `sort_order` integer
- `created_at` datetime
- `updated_at` datetime
- `is_deleted` boolean

Index: `(user_id, updated_at)`.

### `task_checkboxes`

- `uuid` UUID primary key
- `user_id` UUID foreign key to `users.id`
- `id` integer nullable local desktop ID
- `task_id` integer nullable compatibility/local field
- `task_uuid` UUID nullable
- `parent_id` integer nullable compatibility/local field
- `parent_uuid` UUID nullable
- `text` text
- `is_checked` integer or boolean-compatible integer
- `sort_order` integer
- `created_at` datetime
- `updated_at` datetime
- `is_deleted` boolean

Index: `(user_id, updated_at)`.

### `task_links`

- `uuid` UUID primary key
- `user_id` UUID foreign key to `users.id`
- `id` integer nullable local desktop ID
- `task_id` integer nullable compatibility/local field
- `task_uuid` UUID nullable
- `url` text
- `label` text nullable
- `sort_order` integer
- `created_at` datetime
- `updated_at` datetime
- `is_deleted` boolean

Index: `(user_id, updated_at)`.

## Sync Ordering

The sync table order must preserve parent-before-child dependencies:

1. `task_categories`
2. `task_statuses`
3. `tasks`
4. `task_checkboxes`
5. `task_links`

This order is required on pull so desktop can resolve UUID relationships into
local integer IDs before writing child rows.

## Desktop Sync Requirements

### Push mapping

Before pushing Tasks data:

- `tasks.category_id` -> `category_uuid`
- `tasks.status_id` -> `status_uuid`
- `task_checkboxes.task_id` -> `task_uuid`
- `task_checkboxes.parent_id` -> `parent_uuid`
- `task_links.task_id` -> `task_uuid`

The local integer fields remain in the payload only as compatibility/debug
fields. UUID fields are the canonical cross-device relationship fields and must
be used by clients to attach related Tasks records.

### Pull mapping

Before writing pulled rows into desktop SQLite:

- `category_uuid` -> `tasks.category_id`
- `status_uuid` -> `tasks.status_id`
- `task_uuid` -> `task_checkboxes.task_id`
- `parent_uuid` -> `task_checkboxes.parent_id`
- `task_uuid` -> `task_links.task_id`

If a related UUID is missing locally, desktop must avoid creating broken foreign
key relationships:

- keep nullable optional relationships as `NULL`;
- skip required child rows when their parent task cannot be resolved;
- include skipped-row counts in sync result details.

### Display names

Sync logs should show readable names for Tasks:

- categories/statuses: `name`
- tasks: `title`
- checkboxes: `text`
- links: `label`, then `url`

Any truncation of user content in Rust must use char-based truncation, not byte
slicing.

## Mobile Requirements

### Navigation

Add a bottom tab:

- `Snippets`
- `Notes`
- `Tasks`
- `Settings`

The Tasks tab should follow the existing compact mobile style and theme system.

### Local SQLite

Add mobile tables:

- `task_categories`
- `task_statuses`
- `tasks`
- `task_checkboxes`
- `task_links`

Mobile should use UUID relationships directly:

- `tasks.category_uuid`
- `tasks.status_uuid`
- `task_checkboxes.task_uuid`
- `task_checkboxes.parent_uuid`
- `task_links.task_uuid`

Each table includes:

- `uuid`
- `updated_at`
- `is_deleted`

### Mobile UI

The first mobile implementation should support full CRUD:

- list tasks;
- filter by category and status;
- create and edit tasks;
- delete tasks with soft-delete;
- pin/unpin tasks;
- edit task title, category, status, background color, tracker URL, and notes;
- add/edit/delete checkboxes;
- toggle checkbox completion;
- add/edit/delete links;
- manage categories and statuses.

Mobile drag-and-drop is omitted in the first implementation. New mobile records
are appended at the end of their current list by assigning `max(sort_order) + 1`.

### Mobile sync

Extend `mobile/src/sync/syncService.js` to include all Tasks tables in:

- pull apply builders;
- local modified-row collection;
- pending change count.

Pull-to-refresh and existing app/network sync triggers should include Tasks.

## Release Requirements

Desktop sync changes touch native Rust code and database/sync behavior, so the
desktop release must be a full `v*` release, not a frontend-only `f-*` OTA.

Mobile changes under `mobile/src/` are OTA-eligible if no native dependency or
Android config changes are needed. If implementation requires new native
dependencies or Android config changes, mobile requires an APK release.

## Testing Requirements

### API

- Migration creates all Tasks tables and indexes.
- `/v1/sync/push` accepts Tasks changes.
- `/v1/sync/pull` returns Tasks changes.
- LWW conflict handling matches existing sync behavior.

### Desktop Rust

- Unit tests for UUID mapping helpers:
  - category/status ID <-> UUID;
  - task ID <-> UUID;
  - checkbox parent ID <-> UUID.
- Push payload contains UUID relationship fields.
- Pull writes local integer relationships correctly.
- Missing parent UUID handling does not panic.
- UTF-8 truncation tests for task/checkbox/link display names.

### Mobile

- SQLite migrations initialize Tasks tables.
- Repo functions create, update, soft-delete, and list Tasks rows.
- Sync service includes Tasks in push, pull, and pending counts.
- Basic screen tests or manual smoke checklist for:
  - tab opens;
  - create/edit/delete task;
  - manage categories/statuses;
  - checkbox toggle;
  - pull-to-refresh sync.

## Acceptance Criteria

- A task created on desktop appears on mobile after sync.
- A task created on mobile appears on desktop after sync.
- Category and status assignments survive cross-device sync.
- Checkboxes and links remain attached to the correct task across devices.
- Nested checkbox parent relationships survive sync.
- Deletes are synchronized and hidden on all devices.
- Existing Snippets and Notes sync behavior is not regressed.
- Mobile Tasks tab is usable offline and syncs once connectivity/API access is
  available.
