# Mobile Finance Sync Status

## Goal

Make mobile Finance synchronization follow the desktop pattern for local
changes: local Finance edits must be tracked with an explicit sync status and
must not depend only on `updated_at > last_sync_at`.

## Requirements

- Add a `sync_status` column to mobile Finance sync tables:
  `finance_plans`, `finance_items`, `finance_transactions`,
  `finance_mapping_rules`, and `finance_transaction_allocations`.
- Use desktop-like states:
  - `pending` for local rows waiting to be pushed;
  - `synced` for rows accepted by the server or received from pull;
  - `deleted` for locally soft-deleted rows waiting to be pushed.
- Keep existing `sync_dirty` on `finance_transaction_allocations` as a
  compatibility bridge, but make `sync_status` the primary mechanism.
- Push Finance rows when they are `pending` or `deleted`, even if their
  `updated_at` is older than the mobile sync cursor.
- After server `accepted_uuids`, mark accepted Finance rows as `synced`.
- Preserve forced full pull safety: it must still refuse to run while local
  Finance rows are pending.
- Pull must not overwrite local Finance rows with `sync_status IN
  ('pending', 'deleted')` before those rows are pushed. Server conflict
  handling should happen through the normal push/accepted/conflict path.

## Non-Goals

- Do not add mobile support for `finance_payments` in this task.
- Do not change API table contracts; `sync_status` remains a local client
  transport field.
