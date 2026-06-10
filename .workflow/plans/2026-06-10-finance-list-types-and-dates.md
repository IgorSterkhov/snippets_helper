# Implementation Plan: Finance Lists Types And Dates

## Steps

1. Update native data model and DB migration:
   - add `FinancePlan.kind`;
   - add `FinanceItem.due_day` and `FinanceItem.due_date`;
   - extend `ensure_schema` with compatible `ALTER TABLE` migration guards;
   - update default seed to create `Regular payments` as `monthly`.

2. Update finance queries and Tauri commands:
   - read/write new fields;
   - extend `create_finance_plan` and `update_finance_plan` with optional
     `kind`, defaulting to `monthly`;
   - extend `create_finance_item` and `update_finance_item` with optional date
     fields;
   - validate kind, day, and ISO date before writing, using
     `chrono::NaiveDate::parse_from_str("%Y-%m-%d")` for full dates.

3. Update desktop Finance frontend:
   - add list type selector in the header;
   - rename monthly-specific labels to neutral list wording;
   - add `Date` column;
   - render day input for `monthly`, date input for other kinds;
   - save the visible date field while preserving the hidden inactive date
     value when list type changes.

4. Update browser mock and help/release docs:
   - mock accepts both camelCase and snake_case date/kind args;
   - Help describes finance lists and date behavior;
   - changelog and in-app release history include the new `v*` tag.

5. Verify:
   - `node --check` on changed JS files;
   - `cargo test finance`;
   - `cargo check`;
   - `python3 dev-test.py`, comparing against the known unrelated failure
     baseline and calling out any difference explicitly.

6. Release:
   - bump desktop native version from `1.10.0` to `1.11.0`;
   - commit with a short one-line message;
   - tag and push `v1.11.0`;
   - monitor GitHub Actions and verify release assets/frontend manifest.

## Risk Notes

- Because Tauri command signatures change, this cannot be delivered as a
  frontend-only `f-*` update.
- Existing unrelated dirty files in `src-tauri` must not be staged unless they
  are part of the Finance change.
- Keep date values optional to avoid breaking existing finance rows.
