# Finance Payment Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synced monthly payment calendar tab to desktop Finance monthly lists.

**Architecture:** Add `finance_payments` as a first-class synced table in desktop SQLite, desktop sync mapping, and API sync schema. The frontend Finance tab renders a read-only hierarchy calendar from existing plan rows and updates payment facts through new Tauri commands.

**Tech Stack:** Tauri Rust commands, rusqlite, Python FastAPI/SQLAlchemy/Alembic sync API, vanilla JS frontend, browser mock smoke tests.

---

### Task 1: Backend Data Model And Commands

**Files:**
- Modify: `desktop-rust/src-tauri/src/db/models.rs`
- Modify: `desktop-rust/src-tauri/src/db/mod.rs`
- Modify: `desktop-rust/src-tauri/src/db/queries.rs`
- Modify: `desktop-rust/src-tauri/src/commands/finance.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`

- [ ] Add `FinancePayment` model with local ids, `plan_id`, `item_id`, `month_key`, paid state, amount, note, timestamps, deterministic `uuid`, sync fields.
- [ ] Add SQLite table/index/migration for `finance_payments`.
- [ ] Add CRUD query helpers: list by plan, upsert by plan/item/month, UUID/id mapping.
- [ ] Add Tauri commands: `list_finance_payments`, `upsert_finance_payment`.
- [ ] Add Rust tests for month validation, payment upsert, and cascade soft-delete behavior.

### Task 2: Sync API And Desktop Sync

**Files:**
- Modify: `desktop-rust/src-tauri/src/sync/schema.rs`
- Modify: `desktop-rust/src-tauri/src/sync/client.rs`
- Modify: `api/models.py`
- Add: `api/alembic/versions/017_add_finance_payments.py`
- Modify: `api/routes/sync.py`

- [ ] Add `finance_payments` to synced table lists after `finance_plans` and `finance_items`.
- [ ] Map desktop `plan_id`/`item_id` to `plan_uuid`/`item_uuid` on push.
- [ ] Map pulled `plan_uuid`/`item_uuid` to local ids on desktop pull, skipping unresolved rows.
- [ ] Add server model/migration and validation for `YYYY-MM` month keys, non-negative amount, required UUID relations, same-plan item relation, and monthly plan kind.
- [ ] Add sync tests where practical using existing unit test style.

### Task 3: Frontend Calendar UI

**Files:**
- Modify: `desktop-rust/src/tabs/finance.js`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] Add Finance internal view state: `structure` / `calendar`.
- [ ] Render tabs only for monthly lists; force `structure` for other kinds.
- [ ] Render calendar from the existing visible Finance tree.
- [ ] Use terminal cells for checkbox + amount input and group cells for paid descendant totals.
- [ ] Add `+` month button and old-month hide/show toggle.
- [ ] Add mock commands/storage for `finance_payments`.
- [ ] Add smoke test for monthly-only Calendar tab, month add, fact edit, group total, and non-monthly hiding.

### Task 4: Docs, Version, Release

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock`

- [ ] Update Help in EN/RU.
- [ ] Add release history/changelog.
- [ ] Bump minor version.
- [ ] Run `cargo check`, targeted Rust tests, `node --check`, `python3 dev-test.py`, `git diff --check`.
- [ ] Commit, tag `v*`, push, and monitor GitHub Actions.
