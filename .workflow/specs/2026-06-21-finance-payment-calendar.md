# Finance Payment Calendar Spec

## Goal

Add a payment calendar view to desktop Finance monthly lists. The existing
Structure view remains the editable plan tree; the new Calendar view tracks
actual monthly payments against terminal expense rows.

## Existing Fixes

- Long-list amount save already preserves scroll/focus through
  `captureFinanceViewport()` and `restoreFinanceViewport()`.
- New empty rows that become `Untitled item` after Tab indentation already
  select the placeholder text so typing replaces it.
- Existing smoke test: `T26h Finance row editing preserves scroll and
  placeholder selection`.

## Scope

- Desktop Finance only for this pass.
- Calendar tab appears only when the active finance list kind is `monthly`.
- Calendar uses the same row hierarchy, collapse state, and level band styling
  as Structure.
- Calendar does not allow adding, deleting, renaming, reordering, indenting, or
  outdenting rows.
- Terminal rows show editable monthly fact cells.
- Group rows show monthly totals from paid terminal descendants.

## Data Model

Add synced table `finance_payments`:

- `id`
- `plan_id`
- `item_id`
- `month_key` in `YYYY-MM`
- `is_paid`
- `paid_amount_cents`
- `note`
- `created_at`
- `updated_at`
- `uuid`: deterministic UUID derived from `item_uuid + month_key`
- `sync_status`
- `user_id`

Sync payload uses `plan_uuid` and `item_uuid`, matching existing Finance UUID
relationship mapping. `finance_payments` is synced after `finance_plans` and
`finance_items`, because pull needs both local ids resolved first.

The server and desktop validation must enforce:

- `plan_uuid` exists.
- `item_uuid` exists.
- the item belongs to that plan.
- the plan kind is `monthly`.

This avoids duplicate/off-plan payment facts and keeps the calendar scoped to
monthly lists.

Default display amount for a terminal cell is the row's current planned
`amount_cents` when no payment row exists. Editing amount or toggling paid
creates/updates the payment row for that item/month.

## UI

- Add an internal segmented switch in the selected Finance list: `Structure` /
  `Calendar`.
- Hide `Calendar` for non-monthly list kinds.
- Calendar header shows visible month columns and controls:
  - `+` appends the next month after the latest known/visible month.
  - A compact old-month visibility toggle hides/shows older months.
- Month labels use localized Russian month names, e.g. `Июнь 2026`.
- Terminal cell layout: checkbox plus compact money input.
- Group cell layout: read-only aggregated paid total.

## Release Notes

This is a native DB/sync/Tauri command change. Release as a new `v*` desktop
version and update Help, release history, and changelog.
