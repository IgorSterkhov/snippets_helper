# Finance Module: Monthly Planning

## Goal

Add a dedicated desktop Finance module for planning recurring monthly expenses.

The first version focuses on one practical workflow:

- create and edit monthly plan cards;
- use a default `Regular monthly` card;
- maintain a nested expense tree inside a card;
- set amounts on leaf or group rows;
- automatically aggregate descendant amounts into parent totals;
- reorder and nest expense rows with mouse drag-and-drop.

## Product Decisions

- One currency per plan card.
- First version is monthly planning only, without payment fact/history.
- All rows inside `Regular monthly` are treated as recurring monthly costs.
- UI is a tree table with columns rather than free-form cards for every row.

## Data Model

`finance_plans`:

- `id`
- `name`
- `currency`
- `sort_order`
- `created_at`
- `updated_at`
- `uuid`
- `sync_status`
- `user_id`

`finance_items`:

- `id`
- `plan_id`
- `parent_id`
- `name`
- `amount_cents`
- `note`
- `sort_order`
- `created_at`
- `updated_at`
- `uuid`
- `sync_status`
- `user_id`

Amounts are stored as integer minor units (`amount_cents`) to avoid floating
point rounding errors.

Totals use one explicit formula for every row:

`row_total = row.amount_cents + sum(descendant.amount_cents)`.

This means a group row may have its own amount, but that amount is separate
from children and is added once. The UI must label the direct amount and the
aggregate total as different columns to avoid double-counting confusion.

The first version keeps these tables desktop-local. `uuid`, `sync_status`, and
`user_id` are present to leave a clean path for future sync, but `finance_*`
tables are not added to the sync registry or API contract in `v1.10.0`.

DB constraints:

- `uuid` is unique and non-null on both tables;
- `finance_items.plan_id` references `finance_plans(id)`;
- `finance_items.parent_id` references `finance_items(id)`;
- `amount_cents >= 0` in the first version;
- item move/create commands reject parents from another plan;
- `(plan_id, parent_id, sort_order)` is indexed for tree rendering.

Deletes are soft-deletes (`sync_status = 'deleted'`) for plans and items.
Deleting a plan soft-deletes all of its items. Deleting an item soft-deletes
the item and all descendants.

## UX

- Sidebar shows plan cards, starting with `Regular monthly`.
- Main area shows the selected plan:
  - summary strip with total monthly plan amount;
  - tree table with row grip, expand control, name, amount, aggregate total,
    note, and actions.
- Parent totals are computed in the frontend from visible/canonical item data.
- Rows can be moved through pointer-based DnD:
  - top/bottom row zones insert before/after;
  - middle row zone nests into the target;
  - dropping into a collapsed row expands it after commit.

## Out of Scope for First Version

- API/mobile sync for finance data.
- Actual paid/unpaid monthly facts.
- Multiple currencies inside one plan.
- Budgets, charts, imports, bank integrations.

## Release Impact

This adds new DB tables and new Tauri commands, so it must ship as a full
desktop minor release `v1.10.0`.
