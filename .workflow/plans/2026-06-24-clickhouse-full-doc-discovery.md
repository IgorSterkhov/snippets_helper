# ClickHouse Full Doc Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the complete Russian ClickHouse Markdown documentation tree and fix left navigation terminal row alignment.

**Architecture:** Replace the Rust GitHub Contents directory walk with one GitHub Trees API `recursive=1` discovery request, then filter full-tree paths under the RU docs prefix while keeping the existing local SQLite schema and section parser. Apply a small CSS correction in `clickhouse-docs.js` so page and section buttons left-align consistently.

**Tech Stack:** Rust/Tauri commands, reqwest GitHub Contents API, vanilla JS/CSS, local SQLite docs cache.

---

### Task 1: Rust Discovery Coverage

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/clickhouse_docs.rs`

- [ ] Add a failing unit test that parses a GitHub Trees API response containing `engines/table-engines/mergetree-family/aggregatingmergetree.md` and expects a `RuntimeDocSource` with public URL `/ru/engines/table-engines/mergetree-family/aggregatingmergetree`.
- [ ] Add a failing unit test for `.mdx` path normalization and one for `truncated: true` discovery failure.
- [ ] Run `cd desktop-rust/src-tauri && cargo test clickhouse_docs_github_tree` and verify the new tests fail because current discovery only accepts GitHub Contents entries under `sql-reference/functions/`.
- [ ] Replace functions-only Contents recursion with a full-doc Git Trees API parser, accepting `.md` and `.mdx` files, skipping non-doc paths, and failing on truncated trees.
- [ ] Run targeted ClickHouse docs unit tests and verify they pass.

### Task 2: Navigation Alignment

**Files:**
- Modify: `desktop-rust/src/tabs/clickhouse-docs.js`

- [ ] Add or update a browser smoke assertion that `.ch-reference-console .ch-nav-page` and `.ch-reference-console .ch-nav-section` compute left text alignment and `justify-content: flex-start`.
- [ ] Run `cd desktop-rust/src && python3 dev-test.py` and verify the assertion fails if the CSS is not applied.
- [ ] Adjust page and section navigation CSS to left-align terminal rows and avoid inherited centering.
- [ ] Run `node --check desktop-rust/src/tabs/clickhouse-docs.js` and the smoke suite.

### Task 3: Help, Release History, Version

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock`

- [ ] Update Help copy to say ClickHouse docs discovery covers the full RU documentation tree, not only functions.
- [ ] Add top release notes for `v1.19.1`.
- [ ] Bump native version from `1.19.0` to `1.19.1`.
- [ ] Run `cd desktop-rust/src-tauri && cargo check`.

### Task 4: Release Verification

- [ ] Run `cd desktop-rust/src-tauri && cargo check`.
- [ ] Run `cd desktop-rust/src && python3 dev-test.py`.
- [ ] Run `grep -F "v1.19.1" desktop-rust/src/release-history.md`.
- [ ] Commit with a one-line message and tag `v1.19.1`.
- [ ] Push `main` and `v1.19.1`, monitor GitHub Actions, and verify release assets.
