# Desktop Sync Datetime Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize desktop synced datetime strings so API-pulled `updated_at` values remain usable for UI sorting and sync LWW checks.

**Architecture:** Extend Rust datetime parsing in `db/queries.rs`, normalize server-pulled datetime fields before SQLite upsert, and normalize existing rows during DB migrations. Keep the existing DB schema and Tauri IPC unchanged.

**Tech Stack:** Rust/Tauri backend, rusqlite, chrono, existing CDP frontend smoke tests.

---

### Task 1: Regression Tests

**Files:**
- Modify: `desktop-rust/src-tauri/src/db/queries.rs`

- [x] Add tests proving ISO/RFC3339 strings parse into real `NaiveDateTime`
      values, not defaults.
- [x] Add a shortcut `upsert_from_server` test with ISO `updated_at`; assert
      `list_shortcuts()` returns the real timestamp.
- [x] Add an LWW test where an existing ISO-formatted local row is normalized
      before a newer server row is compared and applied.
- [x] Add a migration test proving existing synced `created_at` / `updated_at`
      values normalize without changing `sync_status` or `user_id`.
- [x] Run targeted `cargo test` and confirm the parser/upsert/LWW tests fail
      before the fix.

### Task 2: Implementation

**Files:**
- Modify: `desktop-rust/src-tauri/src/db/queries.rs`
- Modify: `desktop-rust/src-tauri/src/db/mod.rs`

- [x] Add `parse_dt_opt`, `normalize_dt_string`, and canonical formatting.
- [x] Update `parse_dt()` to accept desktop, ISO, and RFC3339 strings.
- [x] Normalize `created_at` and `updated_at` values while building
      `upsert_from_server` SQL params.
- [x] Normalize existing `created_at` / `updated_at` strings for synced tables
      during migrations.
- [x] Normalize the deferred task-checkbox parent update timestamp before its
      LWW comparison.

### Task 3: Release

**Files:**
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`

- [x] Bump native version to `1.3.30`.
- [x] Add release-history/changelog entries for `v1.3.30`.
- [x] Run `cargo check`, targeted Rust tests, and `python3 dev-test.py`.
- [ ] Commit, push, tag `v1.3.30`, push tag, and verify release assets.
