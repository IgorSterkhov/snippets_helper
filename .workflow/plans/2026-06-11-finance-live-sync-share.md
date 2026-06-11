# Finance Live Sync And Share Plan

## 1. Server Data And Sync

- Add Alembic migration `016` with `finance_plans` and `finance_items`.
- Add SQLAlchemy models and register both tables in `TABLE_MODELS`.
- Add Finance fields to `shared/sync_schema.py`.
- Update sync validation so non-deleted `finance_items` require `plan_uuid`.
- Ensure server accepts and returns `plan_uuid`/`parent_uuid`.
- Extend push responses with `accepted_uuids` by table and make desktop Finance
  sync require explicit acceptance before rows are marked synced.
- Validate Finance push rows per row: plan exists or is in the same batch,
  parent belongs to the same plan, amount/day/date/kind are valid. Reject bad
  rows without rolling back the whole push.
- Add server-side tests or focused smoke checks for Finance push/pull.

## 2. Public Share

- Extend share-link constraints and validation to allow `finance_plan`.
- Load owned Finance plans and their active items in `api/routes/share_links.py`.
- Query public Finance items by `plan_uuid`, not local `plan_id`.
- Add `public_finance_plan_payload()` and Finance rendering in
  `api/share_utils.py`.
- Keep Telegra.ph limited to `note` and `shortcut`; Finance Share dialog should
  not offer Telegra.ph in this pass.

## 3. Desktop Sync

- Add `finance_plans` and `finance_items` to Rust sync schema.
- Add Finance UUID lookup helpers in local queries.
- During push, map `finance_items.plan_id -> plan_uuid` and
  `parent_id -> parent_uuid`.
- During pull, map `plan_uuid -> plan_id`; defer `parent_uuid -> parent_id`
  until after upsert.
- Add sync client tests for Finance plan/item hierarchy pull and display names.

## 4. Desktop Finance UI

- Import and use the existing Share dialog in `finance.js`.
- Add a share icon button for the active Finance list.
- Trigger sync before opening/creating the link where practical, matching Notes.
- Add task-like keyboard editing for Finance row names:
  Enter sibling insert, Tab indent, Shift+Tab outdent, ArrowUp/ArrowDown visible
  neighbor focus.
- Add helper functions for create-after, indent/outdent, and focus restore.

## 5. Dev Mock And Tests

- Update `desktop-rust/src/dev-mock.js` so Finance share links work in the
  browser mock.
- Add or extend `dev-test.py` coverage for:
  - Finance Share dialog opens with `finance_plan`;
  - Finance row keyboard insert after current row;
  - Finance row Tab/Shift+Tab calls move logic.

## 6. Docs And Release

- Update Help, release history, and changelog.
- Update `FRONTEND_PATTERNS.md` if Finance keyboard tree editing becomes a
  reusable pattern.
- Run:
  - Python/API syntax or tests available locally;
  - Rust focused tests for sync/db changes;
  - `cargo check`;
  - `node --check` for changed JS;
  - `python3 dev-test.py`.
- Because native/API/sync changed, bump semver and publish a `v*` release.
