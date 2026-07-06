# Telegra.ph Desktop Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Telegra.ph publishing through desktop native networking when the API server cannot reach Telegra.ph.

**Architecture:** API remains the source of truth for ownership, Markdown-to-Telegra.ph conversion, account/page storage, and stale-content validation. Desktop native performs only the external Telegra.ph HTTP calls and then commits the result back to the API.

**Tech Stack:** FastAPI/Pydantic/SQLAlchemy async, Python API tests, Rust/Tauri `reqwest`, vanilla JS Share modal smoke tests.

---

### Task 1: API Prepare/Complete Contract

**Files:**
- Modify: `api/schemas.py`
- Modify: `api/routes/share_links.py`
- Modify: `tests/api/test_telegraph.py`

- [ ] Write failing API tests for `prepare` returning content/token/page data, `complete` preserving the published content hash, token mismatch rejection, and canonical Telegra.ph URL/path validation.
- [ ] Add Pydantic request/response models for prepare and complete.
- [ ] Add helper to build the current Telegra.ph payload from an owned item.
- [ ] Add `POST /v1/share-links/telegraph/prepare`.
- [ ] Add `POST /v1/share-links/telegraph/complete`, validating ownership, token rules, canonical `https://telegra.ph/<path>` metadata, and existing-page path consistency before saving.
- [ ] Run `tests/api/.venv/bin/python -m pytest tests/api/test_telegraph.py`.

### Task 2: Desktop Native Telegra.ph Client

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/share_links.rs`

- [ ] Write failing Rust tests for Telegra.ph API response parsing and create/edit path selection.
- [ ] Add prepare/complete structs matching the API contract.
- [ ] Add a strict Telegra.ph `reqwest` client that posts form payloads to `https://api.telegra.ph`.
- [ ] Change `publish_telegraph_page` to use prepare -> create/edit -> complete.
- [ ] Run focused Rust tests and `cargo check`.

### Task 3: Desktop Mock, Smoke, Help, Release Notes

**Files:**
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`

- [ ] Keep the browser mock command response compatible with the unchanged JS command.
- [ ] Extend the existing share modal smoke test to cover a successful publish after a mocked failure flag is toggled.
- [ ] Update Help and release history to mention desktop-side Telegra.ph fallback, and ensure `desktop-rust/src/release-history.md` contains the exact `v1.24.0` tag before tagging.
- [ ] Run `node --check` on changed JS files and `python3 dev-test.py`.

### Task 4: Deploy and Release

**Files:**
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock` if changed by `cargo check`

- [ ] Deploy the API changes to `snippets-api` and restart the container.
- [ ] Bump desktop native version from `1.23.1` to `1.24.0`.
- [ ] Run API tests, `cargo check`, and desktop smoke tests.
- [ ] Commit with a one-line message.
- [ ] Push `main`, tag `v1.24.0`, push the tag, and verify release assets.
