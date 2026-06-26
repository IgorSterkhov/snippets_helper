# Finance Bank Facts Import

## Goal

Add global Finance facts so bank CSV exports can be imported once, deduplicated,
mapped to Finance lists/items by rules, synced across devices, and included in
public Finance shares without exposing sensitive raw bank fields.

## Approved UX Direction

- Add a top-level Finance mode named `Facts`.
- Keep the existing list-specific views (`Structure`, `Calendar`) under the
  current Finance list workflow.
- Use the approved dark `Ledger first` layout:
  `Date | Description | Bank | Amount | Finance target | State`.
- Provide a `Mapping rule` modal for creating/editing rules.
- A rule can be saved for future imports and can also be applied to existing
  facts.
- Applying to existing facts defaults to updating only currently unmapped facts.
  Remapping already assigned facts requires an explicit separate option.
- Each fact has a separate rule-lock property. Locked facts are not changed by
  rule application, even when bulk remap of already assigned facts is enabled.

## CSV Import Scope

First import format is the T-Bank style semicolon CSV with Russian headers:

- `Дата операции`
- `Дата платежа`
- `Номер карты`
- `Статус`
- `Сумма операции`
- `Валюта операции`
- `Сумма платежа`
- `Валюта платежа`
- `Кэшбэк`
- `Категория`
- `MCC`
- `Описание`
- `Бонусы (включая кэшбэк)`
- `Округление на инвесткопилку`
- `Сумма операции с округлением`

Actual transaction amount is `Сумма платежа`.
`Сумма операции`, cashback, bonuses, rounding, and rounded amount are stored as
metadata for later analysis.

## Data Model

Facts are global to the Finance module, not owned by a specific Finance list.

New synced tables:

- `finance_transactions`: one imported bank operation.
- `finance_transaction_allocations`: the current single active assignment from a
  transaction to a Finance list and optionally a Finance item.
- `finance_mapping_rules`: ordered deterministic mapping rules.
- `finance_import_batches`: import history and summary.

First UI version supports one active allocation per transaction. The allocation
table is still used so future split allocations do not require redesigning the
storage model.

`finance_transactions` includes `rules_locked` (`false` by default). When it is
`true`, automatic rule application skips the fact. Manual assignment UI exposes
this as a per-fact checkbox/lock action.

## Deduplication

Each imported row gets a stable source fingerprint from normalized raw bank row
fields:

`source + operation_at + payment_date + card + status + operation_amount + operation_currency + payment_amount + payment_currency + category + mcc + description + cashback + bonuses + invest_rounding + rounded_amount`

The uniqueness boundary is per user and source/fingerprint, not per Finance
list. Reimporting overlapping CSV files must not create duplicate facts.

## Mapping Rules

A mapping rule has:

- priority/sort order;
- enabled flag;
- name;
- match mode: all/any;
- conditions over bank fields:
  - category exact/contains;
  - MCC exact;
  - description contains/starts/exact;
  - direction: expense/income/refund/any;
  - amount exact/range;
  - card mask;
- target Finance list;
- target Finance item;
- apply behavior.

Rules map:

`bank condition -> finance plan -> finance item`.

Unmatched facts import as `Unmapped`. They appear in `Facts`, do not affect
plan/fact totals, and are not included in public share until assigned.

Rule application never modifies facts whose `rules_locked` flag is enabled.
The bulk option to remap already assigned facts only applies to unlocked facts.

## Sync And Share

Facts, allocations, rules, and import batches sync through the existing sync
pipeline.

Public Finance share includes only facts whose allocation points to the shared
Finance plan.

Public share shows:

- date;
- description;
- bank category;
- MCC;
- amount;
- assigned Finance item.

Public share does not show:

- card number/mask;
- raw CSV row;
- cashback/bonuses/rounding;
- import batch/file metadata.

## Errors

Import errors must be visible and actionable:

- missing required headers;
- invalid date;
- invalid money value;
- unsupported currency values;
- duplicate count;
- rows skipped due to parse errors.

Use the existing modal error pattern with copyable detail where practical.

## Release Scope

This adds local DB tables, Tauri commands, sync schema/API models, and public
share payload changes. It requires a full desktop `v*` release, not a
frontend-only `f-*` release.
