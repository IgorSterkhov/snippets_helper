# Mobile Finance Module Implementation Plan

## 1. Storage

- Add `finance_plans` and `finance_items` to `mobile/src/db/database.js`.
- Add a Finance sync-enabled backfill marker
  `finance_sync_enabled_backfill_v2`. If missing, reset `last_sync_at` and
  store the marker so existing users receive a full Finance pull.
- Do not reuse a marker that could have been written before Finance sync was
  completely wired.
- Create `mobile/src/db/financeRepo.js` with:
  - builders for pulled rows;
  - list/get/create/update/delete helpers for plans;
  - list/get/create/update/delete helpers for items;
  - tree flattening and total calculation helpers;
  - reorder helpers for up/down/indent/outdent;
  - `getModifiedFinancePlansSince`;
  - `getModifiedFinanceItemsSince`.

## 2. Sync

- Import Finance builders/getModified helpers in `mobile/src/sync/syncService.js`.
- Add `finance_plans` and `finance_items` to `BUILDERS` and `TABLE_ORDER`.
- Add pull validation that rejects active `finance_items` without `plan_uuid`.
- Include Finance rows in pending-count and push payload.

## 3. Navigation

- Add a Finance stack to `mobile/src/navigation/AppNavigator.js`.
- Add the `Finance` bottom tab between `Tasks` and `AI`.

## 4. UI

- Add `mobile/src/screens/Finance/FinanceScreen.js`.
- Use the existing theme and sync status patterns.
- Screen state:
  - plans;
  - active plan UUID;
  - items;
  - collapsed row IDs;
  - reorder selected row UUID;
  - share sheet visibility.
- Header:
  - title;
  - total;
  - share action;
  - add-list action.
- List selector:
  - horizontal chips/cards;
  - active list is visually obvious.
- Plan editor:
  - name;
  - currency;
  - type buttons.
- Row editor:
  - name input;
  - amount input in major currency units;
  - date/day input depending on plan kind;
  - note input;
  - aggregate total;
  - child/sibling/delete controls.
- Reorder mode:
  - selecting a row exposes up/down/left/right actions;
  - invalid moves are disabled.
- Share:
  - call sync and wait for the active sync operation before opening
    `ShareLinkSheet`;
  - pass `itemType="finance_plan"`.

## 5. Tests

- Add `mobile/__tests__/db/financeRepo.test.js` for:
  - builders write UUID relationships;
  - tree flattening and totals;
  - sibling move;
  - indent/outdent;
  - soft delete descendants.
- Explicitly cover plan deletion marking all local items with the same
  `plan_uuid` as deleted, because the server does not cascade soft deletes for
  synced Finance rows.
- Update `mobile/__tests__/db/database.test.js` for new tables and backfill.
- Update `mobile/__tests__/sync/syncService.test.js` for Finance pull/push.
- Add a lightweight screen test if the existing React Native test setup can
  render the Finance screen without native navigation friction.

## 6. Verification

- Run targeted Jest tests:
  - database;
  - financeRepo;
  - syncService.
- Run `npm test -- --runInBand` if practical.
- If all mobile changes remain JS-only, bump `mobile/package.json` to the next
  patch OTA version and cut a mobile OTA release following `mobile/RELEASES.md`.

## 7. Risks

- Existing mobile sync is last-sync-cursor based; a missing Finance backfill
  marker would make old Finance server rows invisible on already-synced
  devices. The backfill marker is mandatory.
- Finance item hierarchy must use UUIDs locally to avoid desktop/mobile local
  integer id mismatch.
- Share links are live server views; mobile must sync before creating/opening
  a Finance share link.
