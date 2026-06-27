# Mobile Finance Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mobile Finance Facts review, mapping, and mapping rules for bank transactions imported through desktop sync.

**Architecture:** Extend the existing mobile Finance repo with three synced fact tables and pure JS helpers for assigning and applying rules. Add a `Lists / Facts` segmented mode in `FinanceScreen.js`, reusing existing Finance tree helpers for item selection and totals. Keep CSV import desktop-only and ship as JS-only mobile OTA.

**Tech Stack:** React Native, SQLite via `react-native-sqlite-storage`, existing mobile sync endpoint, Jest / React Native Testing Library.

---

## File Map

- Modify `mobile/src/db/database.js`
  - Create local tables for `finance_transactions`, `finance_transaction_allocations`, and `finance_mapping_rules`.
  - Add `finance_facts_sync_backfill_v1` marker that resets `last_sync_at` once.
- Modify `mobile/src/db/financeRepo.js`
  - Add upsert builders, query helpers, manual assignment, rule creation, and rule application helpers.
- Modify `mobile/src/sync/syncService.js`
  - Include the three new Finance Facts tables in pull, push, pending count, and row validation.
- Modify `mobile/src/screens/Finance/FinanceScreen.js`
  - Add `Lists / Facts` mode, Facts cards, map bottom sheet, and rules bottom sheet.
- Modify tests:
  - `mobile/__tests__/db/database.test.js`
  - `mobile/__tests__/db/financeRepo.test.js`
  - `mobile/__tests__/sync/syncService.test.js`
  - `mobile/__tests__/tasks/TaskEditorScreen.test.js` is not touched.
  - Add or extend a Finance screen test if a current harness exists; otherwise use repo/helper tests for behavior and keep UI test narrow.
- Modify `mobile/package.json`
  - Bump OTA version from `1.0.28` to `1.0.29`.

## Task 1: DB Schema And Backfill

- [ ] Add failing database test asserting `initDB()` creates `finance_transactions`, `finance_transaction_allocations`, and `finance_mapping_rules`, and resets `last_sync_at` when `finance_facts_sync_backfill_v1` is missing.
- [ ] Implement the three `CREATE TABLE IF NOT EXISTS` statements in `mobile/src/db/database.js`.
- [ ] Add `FINANCE_FACTS_SYNC_BACKFILL_KEY = 'finance_facts_sync_backfill_v1'` and mirror the existing Finance backfill flow.
- [ ] Run `cd mobile && npm test -- --runTestsByPath __tests__/db/database.test.js`.

## Task 2: Finance Repo Facts Helpers

- [ ] Add failing repo tests for:
  - `buildUpsertFinanceTransaction`
  - `buildUpsertFinanceTransactionAllocation`
  - `buildUpsertFinanceMappingRule`
  - `createFinanceTransactionAllocation`
  - `createFinanceMappingRule`
  - `applyFinanceMappingRule`
- [ ] Implement normalization helpers for signed fact amounts and boolean flags.
- [ ] Implement query helpers:
  - `getFinanceTransactions({ unmappedOnly, month })`
  - `getFinanceTransactionAllocations()`
  - `getFinanceMappingRules()`
  - `getModifiedFinanceTransactionsSince(since)`
  - `getModifiedFinanceTransactionAllocationsSince(since)`
  - `getModifiedFinanceMappingRulesSince(since)`
- [ ] Implement mapping helpers:
  - `createFinanceTransactionAllocation({ transaction, plan, item, assignedBy, rule })`
  - `setFinanceTransactionRulesLocked(uuid, rulesLocked)`
  - `createFinanceMappingRule(input)`
  - `applyFinanceMappingRule(rule, { remapAssigned = false })`
- [ ] Run `cd mobile && npm test -- --runTestsByPath __tests__/db/financeRepo.test.js`.

## Task 3: Sync Integration

- [ ] Add failing sync test proving pull applies and push sends:
  - `finance_transactions`
  - `finance_transaction_allocations`
  - `finance_mapping_rules`
- [ ] Add a sync test where a newly created rule and an allocation referencing
  that rule are pushed in the same batch, with the rule present before the
  allocation in the payload.
- [ ] Add builders to `BUILDERS`, tables to `TABLE_ORDER`, and modified-row getters to pending/push logic.
- [ ] Add row validation:
  - `finance_transactions` requires `uuid`
  - `finance_transaction_allocations` requires `uuid`, `transaction_uuid`, and `plan_uuid`
  - `finance_mapping_rules` requires `uuid` and `target_plan_uuid`
- [ ] Push fact tables in dependency order after plans/items:
  `finance_transactions`, `finance_mapping_rules`,
  `finance_transaction_allocations`.
- [ ] Run `cd mobile && npm test -- --runTestsByPath __tests__/sync/syncService.test.js`.

## Task 4: Finance Screen Facts Mode

- [ ] Add local screen state:
  - `activeMode: 'lists' | 'facts'`
  - `transactions`, `allocations`, `mappingRules`
  - `factsFilter`, `factsMonth`
  - selected transaction for map sheet
  - rules sheet state
- [ ] Add `loadFactsData()` that loads transactions, allocations, rules, plans, and all finance items needed for mapping.
- [ ] Add segmented control below the header. `Lists` keeps existing UI; `Facts` renders the global queue.
- [ ] Render compact fact cards:
  - payment date
  - signed amount
  - bank category / MCC / card
  - description
  - mapped target chip or `Unmapped`
  - `Map`/`Edit` button
- [ ] Add `MapFinanceFactSheet`:
  - list picker
  - terminal-only item picker with planned totals
  - save rows with `transaction_uuid`, `plan_uuid`, and optional `item_uuid`
  - rules lock checkbox
  - `Create rule`
  - `Save mapping`
- [ ] Add `FinanceRulesSheet`:
  - existing rules list
  - prefilled rule form from fact
  - condition fields for category, description, MCC, direction
  - amount range conditions compatible with desktop-created rules
  - target list/item picker
  - save rules with `target_plan_uuid` and optional `target_item_uuid`
  - `Apply to currently unmapped facts`
  - `Create & apply`
- [ ] Keep controls compact; no CSV import button in mobile.

## Task 5: Verification And OTA

- [ ] Run targeted mobile tests:
  - `cd mobile && npm test -- --runTestsByPath __tests__/db/database.test.js __tests__/db/financeRepo.test.js __tests__/sync/syncService.test.js`
- [ ] Run broader mobile tests if time permits:
  - `cd mobile && npm test`
- [ ] Bump `mobile/package.json` to `1.0.29`.
- [ ] Build OTA bundle per `mobile/RELEASES.md`.
- [ ] Upload `bundle-1.0.29.zip` to `/opt/isterapp/releases/snippets-updates/`.
- [ ] Update server `latest.json` with release notes mentioning Finance Facts review and mapping.
- [ ] Verify `https://ister-app.ru/snippets-updates/latest.json` returns `1.0.29`.

## Review Checklist

- Sync table names exactly match desktop/API table names.
- Mobile does not call native APIs or require APK rebuild.
- Existing Finance `Lists` mode remains unchanged except for the new mode switch.
- Existing installed mobile apps get one full pull for facts via the new backfill key.
- Manual assignments push as sync rows and become visible on desktop after sync.
