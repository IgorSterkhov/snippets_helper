# Finance Module Monthly Plans Implementation Plan

1. Add native DB model and migrations:
   - `FinancePlan`;
   - `FinanceItem`;
   - `finance_plans`;
   - `finance_items`;
   - seed default `Regular monthly` plan;
   - add FK, uuid uniqueness, non-negative amount checks, and tree indexes.
2. Add native commands:
   - list/create/update/delete plans;
   - list/create/update/delete items;
   - reorder plans;
   - move item with atomic sibling reordering, same-plan validation, and cycle
     protection.
3. Register the commands and add browser mock support.
4. Add `desktop-rust/src/tabs/finance.js`:
   - compact operational UI;
   - plan sidebar;
   - selected plan summary;
   - editable nested tree table;
   - pointer-based row DnD.
5. Add the tab to `main.js` and Help.
6. Update `FRONTEND_PATTERNS.md` only if the Finance DnD pattern differs from
   the nested tree DnD already documented for Notes.
7. Bump desktop version to `1.10.0`, update release history and changelog.
8. Verify:
   - targeted Rust finance tests;
   - `cargo check`;
   - `node --check` for changed JS;
   - `python3 dev-test.py`; any existing unrelated failures must be called out
     explicitly before release instead of treated as a green gate.
9. Commit and release `v1.10.0`.
