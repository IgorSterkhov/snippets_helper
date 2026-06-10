# Finance Lists: Types And Row Dates

## Goal

Expand the desktop Finance module from monthly-only planning to reusable
finance lists. A list may represent recurring monthly payments, a project
budget, a one-time estimate, or a general planning list.

The UI must stop implying that every list is monthly, and each finance row
must be able to carry a date value appropriate for the selected list type.

## Product Decisions

- Each finance list has a user-visible type:
  - `monthly` — recurring monthly payments;
  - `project` — project-specific expenses;
  - `one_time` — one-time list or estimate;
  - `general` — neutral/default list type.
- Existing finance plans migrate to `monthly`, because the first released
  version described all finance plans as monthly.
- New default list name changes from `Regular monthly` to `Regular payments`.
- Summary labels use neutral wording. `Monthly total` becomes `Total`.
- Row date formatting depends on list type:
  - `monthly`: store and edit day-of-month only (`due_day`, 1..31), render as
    `21-е`, `3-е`, etc.;
  - other types: store and edit a full ISO date (`due_date`, `YYYY-MM-DD`),
    render as localized full date in the table.
- Date is optional for every row, including groups.

## Data Model

Add nullable/compatible fields:

`finance_plans`:

- `kind TEXT NOT NULL DEFAULT 'monthly'`

Allowed values are `monthly`, `project`, `one_time`, and `general`.

`finance_items`:

- `due_day INTEGER NULL`
- `due_date TEXT NULL`

Validation:

- `due_day` must be empty or between 1 and 31.
- `due_date` must be empty or parse as a real calendar date through
  `chrono::NaiveDate::parse_from_str("%Y-%m-%d")`; invalid values such as
  `2026-99-99` are rejected.
- `monthly` list UI edits and displays `due_day`.
- non-monthly list UI edits and displays `due_date`.
- Switching a list between types does not bulk-clear row dates. The inactive
  date field is hidden but preserved, so changing a list type and changing it
  back does not silently destroy dates.

## UX

- Sidebar keeps showing list cards; list cards may show a compact kind badge.
- Main header contains editable list name, currency, and type.
- Tree table gains a `Date` column between `Amount` and `Total`.
- Monthly rows use a compact numeric day input.
- Project/one-time/general rows use a date input.
- Empty states and help copy use `list` rather than `monthly plan`.

## Compatibility

- Existing data remains readable after migration.
- Existing old rows have empty date fields.
- Tauri commands should accept new fields as optional arguments and default
  missing `kind` to `monthly`, so stale mock/test callers fail less abruptly
  during development.
- Existing frontend tests and dev mock must be updated to include list kind and
  row date fields.
- This changes the native database model and Tauri command signatures, so it
  must ship as a full `v*` desktop release, not frontend-only OTA.

## Out Of Scope

- API/mobile sync for finance data.
- Paid/fact tracking and recurring schedule generation.
- Sorting rows by due date.
- Automatic validation of month length for February/30-day months.
