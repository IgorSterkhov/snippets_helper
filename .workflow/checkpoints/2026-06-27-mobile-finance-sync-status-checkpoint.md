# Checkpoint: Mobile Finance Sync Status

Date: 2026-06-27
Branch: `main`
Latest commit: `a95685b Use sync status for mobile finance sync`
Latest mobile OTA: `1.0.34`

## Current Goal

Mobile Finance fact mappings must sync reliably between desktop, API, and
mobile. Mobile should use the same class of explicit sync-state tracking as
desktop instead of relying only on `updated_at > last_sync_at`.

The next design question is how Finance should behave when facts have already
been mapped to expense-list items, and the user later changes that item or its
hierarchy.

## What Was Resolved

- Added `sync_status` to mobile Finance sync tables:
  - `finance_plans`;
  - `finance_items`;
  - `finance_transactions`;
  - `finance_mapping_rules`;
  - `finance_transaction_allocations`.
- Mobile local Finance edits now become `pending`, local soft deletes become
  `deleted`, and accepted/pulled rows become `synced`.
- Kept `sync_dirty` for `finance_transaction_allocations` as a compatibility
  bridge, but `sync_status` is now the primary transport mechanism.
- Added guarded Finance pull upserts so pulled server rows do not overwrite
  local `pending` or `deleted` rows before push.
- Sync now clears accepted Finance rows for all Finance sync tables from API
  `accepted_uuids`, not only allocations.
- Added regression tests for pending-row selection, accepted-row cleanup, and
  guarded pull upsert behavior.
- Fixed a missing AsyncStorage Jest mock in the mobile Finance screen test.

## Release Status

- Commit pushed to GitHub main: `a95685b`.
- Mobile OTA bundle built: `/tmp/bundle-1.0.34.zip`.
- Bundle uploaded to `snippets-api`.
- Public manifest now reports:
  - version: `1.0.34`;
  - bundle URL: `https://ister-app.ru/snippets-updates/bundle-1.0.34.zip`;
  - APK metadata preserved for required APK `versionCode 7`.

## Verification Already Run

- `node --check`:
  - `mobile/src/db/database.js`;
  - `mobile/src/db/financeRepo.js`;
  - `mobile/src/sync/syncService.js`.
- Focused Jest:
  - `__tests__/db/database.test.js`;
  - `__tests__/db/financeRepo.test.js`;
  - `__tests__/sync/syncService.test.js`;
  - result: 38 tests passed.
- Full mobile Jest:
  - 22 suites passed;
  - 109 tests passed.
- Public manifest check:
  - `wget -qO- https://ister-app.ru/snippets-updates/latest.json`.
- Post-release manifest smoke:
  - 1 passed, 1 skipped.

## Current Working Tree Notes

At checkpoint creation, worktree was clean.

## Open Design Question: Finance Item Semantics

Facts are currently mapped to Finance items by `plan_uuid` + `item_uuid`.
Finance items do not have an explicit persisted type such as `group` or
`leaf`; whether an item is a group is inferred from whether it has children.

Current behavior to keep in mind:

- Moving an item in the hierarchy preserves its UUID, so existing fact mappings
  still point to the same item.
- Renaming an item also preserves fact mappings; displays resolve the current
  item name.
- A previously terminal item can become a group simply by adding children.
  Existing facts mapped to that item remain mapped to that now-group item.
- Desktop and mobile mapping selectors currently allow choosing terminal rows
  only, but existing mappings can become group-target mappings after hierarchy
  changes.
- Structure totals currently include an item's own `amount_cents` plus child
  totals, while the payment calendar aggregates group rows from terminal
  descendants.

## Next Step On Return

Discuss and choose the protection model for mapped Finance items before
implementation. The likely recommended direction is:

- treat fact mappings and payment calendar facts as terminal-only;
- warn or block when an item with mapped facts/payments is about to become a
  group;
- offer a guided move/remap action to move existing mappings to a child item;
- optionally add an explicit `item_kind` / `is_group` model later if inferred
  terminal/group behavior becomes too fragile.
