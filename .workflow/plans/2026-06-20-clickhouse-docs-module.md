# ClickHouse Docs Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DEV sidebar `ClickHouse` module with local section-level documentation search and manual update/digest support.

**Architecture:** Store ClickHouse docs pages, sections, update runs, and changes in local SQLite tables. Fetch official raw Markdown from `ClickHouse/clickhouse-docs`, not rendered HTML. Add one focused Rust/Tauri command module for listing/searching/updating docs. Add a vanilla JS frontend module with a compact docs browser UI and browser mock coverage.

**Tech Stack:** Rust/Tauri, rusqlite, reqwest, sha2, regex, vanilla JS, local `marked` renderer, existing CDP smoke tests.

---

## File Structure

- Modify `desktop-rust/src-tauri/src/db/mod.rs`
  - Add ClickHouse docs local tables, uniqueness constraints, FK cascade, and indexes.
- Create `desktop-rust/src-tauri/src/commands/clickhouse_docs.rs`
  - Seed URLs, parser helpers, search, update, digest commands, unit tests.
- Modify `desktop-rust/src-tauri/src/commands/mod.rs`
  - Register module.
- Modify `desktop-rust/src-tauri/src/lib.rs`
  - Register Tauri commands.
- Create `desktop-rust/src/tabs/clickhouse-docs.js`
  - New module UI.
- Modify `desktop-rust/src/main.js`
  - Add tab and DEV group placement after Search.
- Modify `desktop-rust/src/dev-mock.js`
  - Add mock ClickHouse docs commands.
- Modify `desktop-rust/src/dev-test.py`
  - Add smoke test for tab placement, search result, article rendering, and changelog modal.
- Modify release/help files before release:
  - `desktop-rust/src/tabs/help.js`
  - `desktop-rust/src/release-history.md`
  - `desktop-rust/CHANGELOG.md`
  - `desktop-rust/src-tauri/Cargo.toml`
  - `desktop-rust/src-tauri/Cargo.lock`
  - `desktop-rust/src-tauri/tauri.conf.json`

## Tasks

- [ ] Add failing Rust unit tests for Markdown section splitting, search ranking, and digest classification.
- [ ] Add DB migrations for ClickHouse docs tables.
- [ ] Implement ClickHouse docs command module and register IPC.
  - Use raw GitHub Markdown URLs plus separate public docs URLs.
  - Split only on `##` section headings; keep `###` inside the owning section.
  - Compute `section_path` and `normalized_search_text`.
  - Stage network fetch/parse before locking DB; apply successful pages in one transaction.
  - First release is manual update only; no once-daily auto-update.
- [ ] Add failing browser smoke test for the new module.
- [ ] Implement frontend module and browser mock.
- [ ] Run Rust/frontend verification.
- [ ] Update Help, release history, changelog, bump semver to `1.17.0`, commit, tag, push, and monitor release.

## Verification Commands

```bash
cd desktop-rust/src-tauri && cargo test clickhouse_docs --lib
cd desktop-rust/src-tauri && cargo check
cd desktop-rust/src && python3 dev-test.py
node --check desktop-rust/src/tabs/clickhouse-docs.js
node --check desktop-rust/src/main.js
node --check desktop-rust/src/dev-mock.js
node --check desktop-rust/src/tabs/help.js
git diff --check
```
