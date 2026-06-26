# Finance Facts error handling and date filters

## Goal

Improve the new Finance Facts import workflow after release `v1.22.0`.

## Requirements

- Error notifications must not disappear before the user can read them.
- Project-level `showToast(..., "error")` should open the standard large error
  dialog with `OK` and `Copy error`.
- Finance CSV import failures must include the failed stage, full error text,
  and, when the parser knows it, the source CSV row that caused the error.
- Empty T-Bank `Дата платежа` should not fail the import. Use the date portion
  of `Дата операции` as fallback.
- Invalid non-empty CSV fields should report the row number, column name, value,
  and full raw CSV row.
- Finance Facts mode should not show the finance-list sidebar. Replace it with
  a minimal facts filter sidebar.
- The initial filter set is date-focused: all facts, date range, month, and
  year.

## UI Direction

Facts is a global ledger view. The left pane is a compact filter rail for the
ledger, while plan lists remain available only in Lists mode and as mapping
targets inside rule/assignment dialogs.
