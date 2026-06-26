# Finance Bank Facts Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a global Finance Facts ledger that imports T-Bank CSV exports, deduplicates rows, maps transactions to Finance lists/items by rules, syncs the data, and includes safe fact details in public Finance shares.

**Architecture:** Add first-class synced local/server tables for transactions, allocations, mapping rules, and import batches. Rust commands parse CSV and own local writes; frontend renders the approved Ledger-first Facts view and rule modal. Sync uses the existing UUID relation mapping pattern; public share loads only allocations for the shared plan and strips sensitive fields.

**Tech Stack:** Tauri Rust commands, rusqlite, SQLite/Postgres sync schema, FastAPI/SQLAlchemy, vanilla JS desktop UI, existing browser mock tests.

---

### Task 1: Local DB Models And Schema

**Files:**
- Modify: `desktop-rust/src-tauri/src/db/models.rs`
- Modify: `desktop-rust/src-tauri/src/db/mod.rs`
- Modify: `desktop-rust/src-tauri/src/db/queries.rs`

- [x] Add Rust structs: `FinanceTransaction`, `FinanceTransactionAllocation`, `FinanceMappingRule`, `FinanceImportBatch`.
- [x] Add SQLite tables with `uuid`, `updated_at`, `sync_status`, `user_id`.
- [x] Add indexes:
  - `idx_finance_transactions_source_fingerprint`
  - `idx_finance_transactions_payment_date`
  - `idx_finance_allocations_plan_item`
  - `idx_finance_mapping_rules_sort`
  - `idx_finance_import_batches_imported`
- [x] Add read helpers and CRUD/query helpers.
- [x] Add `rules_locked INTEGER NOT NULL DEFAULT 0 CHECK (rules_locked IN (0, 1))`
  to `finance_transactions`.
- [x] Add unit tests for:
  - duplicate fingerprint rejection/update;
  - allocation requires existing transaction and plan;
  - allocation item must belong to allocation plan;
  - soft-delete plan also soft-deletes related allocations, but not transaction facts.
  - locked transaction is preserved when rules are applied.

### Task 2: CSV Parser And Import Preview

**Files:**
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/src/commands/finance.rs`
- Modify: `desktop-rust/src-tauri/src/db/queries.rs`

- [x] Add a small CSV parsing path in Rust using the existing dependency set if possible; otherwise add `csv`.
- [x] Parse semicolon CSV with quoted Russian headers.
- [x] Parse dates:
  - `Дата операции` as `YYYY-MM-DD HH:MM:SS`;
  - `Дата платежа` as `YYYY-MM-DD`.
- [x] Parse decimal comma money to signed cents.
- [x] Use `Сумма платежа` as `amount_cents`.
- [x] Compute stable SHA-256 fingerprint from normalized raw fields.
- [x] Add Tauri command `preview_finance_bank_csv(path)`.
- [x] Return summary: total rows, new rows, duplicate rows, parse errors, date range, expense total, income total, currencies.
- [x] Add tests for the sample T-Bank rows, including positive refund and duplicate row.

### Task 3: Import Commit And Rule Application

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/finance.rs`
- Modify: `desktop-rust/src-tauri/src/db/queries.rs`

- [x] Add command `import_finance_bank_csv(path)`.
- [x] Create `finance_import_batches` row.
- [x] Insert only new transactions by fingerprint.
- [x] Apply enabled mapping rules in sort order.
- [x] For each matched transaction, create one active allocation to rule target plan/item.
- [x] Skip transactions where `rules_locked = 1`.
- [x] Leave unmatched facts without allocation and state `unmapped`.
- [x] Add commands:
  - `list_finance_transactions(filters)`
  - `list_finance_mapping_rules`
  - `create_finance_mapping_rule`
  - `update_finance_mapping_rule`
  - `delete_finance_mapping_rule`
  - `apply_finance_mapping_rule(rule_id, remap_assigned)`
  - `set_finance_transaction_rules_locked(transaction_id, rules_locked)`
  - `assign_finance_transaction(transaction_id, plan_id, item_id, save_rule_hint)`
- [x] Manual assignment may set `rules_locked = true`.
- [x] Add query tests for rule priority, `remap_assigned = false`, and locked
  facts being skipped even when `remap_assigned = true`.

### Task 4: Sync Schema And Client Relation Mapping

**Files:**
- Modify: `desktop-rust/src-tauri/src/sync/schema.rs`
- Modify: `desktop-rust/src-tauri/src/sync/client.rs`
- Modify: `desktop-rust/src-tauri/src/db/queries.rs`

- [x] Add new Finance fact tables to `SYNCED_TABLES`.
- [x] Add data columns for each new table.
- [x] Map local relation IDs to UUIDs on push:
  - allocation `transaction_id`, `plan_id`, `item_id`;
  - mapping rule `target_plan_id`, `target_item_id`;
  - import batch has no local relation except user-owned rows.
- [x] Map UUIDs back to local IDs on pull.
- [x] Preserve missing relation behavior: reject or defer rows whose required related UUIDs are absent.
- [x] Add sync tests for round-tripping allocation and rule relations.

### Task 5: API Models, Migration, And Sync Validation

**Files:**
- Create: `api/alembic/versions/018_add_finance_facts.py`
- Modify: `api/models.py`
- Modify: `api/routes/sync.py`

- [x] Add SQLAlchemy models matching local tables.
- [x] Add Alembic migration.
- [x] Add new tables to `api.models.TABLE_MODELS`; API sync columns are derived
  from SQLAlchemy columns by `api/routes/sync.py`.
- [x] Validate finance transaction amount/date/fingerprint/`rules_locked` fields.
- [x] Validate allocation `transaction_uuid`, `plan_uuid`, and optional `item_uuid` ownership and plan consistency.
- [x] Validate mapping rule target plan/item ownership and plan consistency.
- [x] Add natural uniqueness protection for user/source/fingerprint.
- [x] Add API tests or existing sync smoke coverage for new tables if the project already has API tests available.

### Task 6: Public Finance Share Facts

**Files:**
- Modify: `api/routes/share_links.py`
- Modify: `api/share_utils.py`

- [x] When loading a public `finance_plan`, fetch allocations where `plan_uuid` equals the shared plan UUID.
- [x] Join safe transaction fields.
- [x] Add facts payload to `public_finance_plan_payload`.
- [x] Render a compact fact section in public HTML:
  - aggregate by item/month;
  - expandable operation rows with date, description, category, MCC, amount.
- [x] Do not include card mask, raw row, cashback, bonuses, rounding, import batch, or rule metadata.

### Task 7: Desktop Facts UI And Rule Modal

**Files:**
- Modify: `desktop-rust/src/tabs/finance.js`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [x] Add top-level `Facts` mode to Finance.
- [x] Render approved Ledger-first view with filters, summary, import button, rules button, and dense facts table.
- [x] Add import flow:
  - file picker;
  - preview summary;
  - confirm import;
  - refresh facts.
- [x] Add mapping rule modal matching visual companion:
  - rule name;
  - enabled/priority;
  - conditions;
  - target Finance list;
  - target Finance item;
  - live preview count;
  - `Apply to existing facts`;
  - explicit `Also remap assigned facts`.
- [x] Add manual assignment from a transaction row.
- [x] Add per-fact lock control:
  - lock icon/checkbox in row details or assignment modal;
  - locked facts show a small lock marker in the `State` column;
  - bulk rule application never changes locked facts.
- [x] Update dev mock commands and smoke tests for:
  - Facts tab renders;
  - rule modal renders;
  - import preview summary shape.

### Task 8: Help, Release History, And Verification

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `FRONTEND_PATTERNS.md` if a reusable finance ledger/rule-modal pattern is introduced.

- [x] Document Finance Facts import, mapping rules, deduplication, sync/share behavior.
- [x] Choose a minor semver bump because this adds DB tables, sync/API surface, Tauri commands, and a new workflow.
- [x] Run `cargo test` or focused Rust tests for finance parsing/queries.
- [x] Run `cd desktop-rust/src-tauri && cargo check`.
- [x] Run `node --check desktop-rust/src/tabs/finance.js desktop-rust/src/dev-mock.js`.
- [x] Run `cd desktop-rust/src && python3 dev-test.py`.
- [x] Commit with a one-line message.
- [x] Tag and verify the full `v*` release according to `desktop-rust/RELEASES.md`.
