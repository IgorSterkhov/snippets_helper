# Mobile Finance Facts

## Goal

Add Finance Facts support to the React Native mobile app so bank facts imported
on desktop are visible on mobile, can be manually mapped to Finance list items,
and can be processed by mapping rules.

## Scope

- Add a `Lists / Facts` mode switch to the mobile Finance screen.
- Keep CSV import desktop-only. Mobile only consumes facts that arrive through
  sync.
- Sync these existing server/desktop tables to mobile:
  - `finance_transactions`
  - `finance_transaction_allocations`
  - `finance_mapping_rules`
- In `Facts` mode show all active imported facts globally, newest first.
- Show each fact's date, amount, description, bank category, MCC/card metadata,
  and current mapping status.
- Support filters in the first pass:
  - all facts
  - unmapped only
  - month picker/text value using `YYYY-MM`
- Support manual mapping:
  - choose target Finance list
  - choose only a terminal Finance item from that list
  - show planned totals next to list items
  - set/clear `rules_locked` for the fact so mapping rules cannot overwrite it
- Support mapping rules:
  - list existing rules
  - create a rule from a fact
  - conditions: bank category, description, MCC, direction, and amount ranges
  - target: Finance list + terminal item
  - option to apply the rule immediately to existing unmapped facts
  - applying a rule must skip `rules_locked` facts

## Data Model

Mobile stores the same sync columns as desktop/API. For portable relationships
mobile must store and push UUID relation columns; numeric `id` fields are kept
only as compatibility/cache values when pulled from the server.

Required mobile tables:

- `finance_transactions`: bank facts, keyed by `uuid`, including all bank CSV
  fields used by desktop and `rules_locked`.
- `finance_transaction_allocations`: one active mapping per fact, keyed by
  `uuid`, with both numeric ids and UUID relation fields where available.
- `finance_mapping_rules`: user rules, keyed by `uuid`, with rule conditions
  stored as JSON. Rows must include `target_plan_uuid`; `target_item_uuid` is
  optional but required when the rule targets an item.
- `finance_transaction_allocations`: rows must include `transaction_uuid` and
  `plan_uuid`; `item_uuid` and `rule_uuid` are optional.

Existing installs need a new Finance Facts backfill marker. If missing, mobile
must reset `last_sync_at` to `null` once so already-imported facts/rules are
pulled from the server.

## UX

The mobile Finance header keeps the existing compact financial style. Below the
header, add a segmented control:

- `Lists`: existing Finance list editor.
- `Facts`: global fact review queue.

Facts mode has compact cards optimized for reviewing on a phone. Tapping
`Map`/`Edit` opens a bottom sheet. The item selector uses the same hierarchy as
Finance rows and shows planned totals on the right.

`Rules` opens a bottom sheet with existing rules and a form for creating a new
rule. From a fact mapping sheet, `Create rule` opens the rule sheet prefilled
from that fact.

## Sync and Conflict Rules

- Pulled rows are upserted locally by UUID.
- Local manual mappings and local rules are pushed through the existing sync
  endpoint as the same table names desktop uses.
- Push changes in dependency order: `finance_transactions`,
  `finance_mapping_rules`, then `finance_transaction_allocations`, so a newly
  created allocation can reference a rule created in the same sync batch.
- When assigning a fact manually, mobile deactivates previous active local
  allocations for that fact, then creates a new active allocation with
  `assigned_by = 'manual'`.
- Applying a rule locally creates `assigned_by = 'rule'` allocations for
  matching unlocked facts. It does not remap already assigned facts in the
  first release unless the rule sheet explicitly requests remap.

## Out Of Scope

- CSV import on mobile.
- Editing/deleting existing rules beyond creating and applying them.
- Full desktop parity for all condition operators; first release uses the
  operators needed by current desktop-generated rules and the mobile create
  flow.
- APK/native changes. This should ship as mobile OTA if implementation remains
  JS-only.

## Tests

- DB schema creates the three Finance Facts tables.
- Finance repo builders upsert transactions, allocations, and mapping rules.
- Sync pull/push includes all three new tables.
- Mobile rule matching respects category/description/MCC/direction and skips
  locked facts.
- Finance screen renders Facts mode and opens a mapping flow.
