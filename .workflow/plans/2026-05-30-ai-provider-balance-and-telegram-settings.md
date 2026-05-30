# AI Provider Balance And Telegram Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DeepSeek balance checks, per-user Telegram bot token management, and AI/Telegram help text to the API and desktop app.

**Architecture:** Server owns all provider secrets and calls DeepSeek balance with the current user's stored token. Desktop Settings invokes new Tauri commands that proxy to the sync API; Telegram bot polling uses only the current user's token and user-scoped offset handling.

**Tech Stack:** FastAPI, SQLAlchemy/Alembic, pytest, Tauri Rust commands, vanilla JS desktop frontend, browser mock/CDP smoke tests.

---

### Task 1: API Tests

**Files:**
- Modify: `tests/api/test_deepseek_client.py`
- Modify: `tests/api/test_ai_route.py`
- Modify: `tests/api/test_admin_user_model.py`
- Modify: `tests/api/test_telegram_bot.py`

- [ ] Write failing tests for parsing DeepSeek balance via a fake HTTP client.
- [ ] Write failing tests that provider settings include Telegram configured flags without exposing secrets.
- [ ] Write failing tests for save/clear Telegram bot token.
- [ ] Write failing tests that user model exposes Telegram token columns.
- [ ] Write failing tests that processed Telegram messages expose `user_id`.
- [ ] Write failing tests that Telegram bot API does not fall back to global config token.
- [ ] Run targeted pytest and verify the failures are for missing behavior.

### Task 2: API Implementation

**Files:**
- Modify: `api/deepseek_client.py`
- Modify: `api/schemas.py`
- Modify: `api/models.py`
- Create: `api/alembic/versions/013_add_user_telegram_bot_settings.py`
- Modify: `api/routes/ai.py`
- Modify: `api/telegram_bot.py`
- Modify: `api/routes/telegram.py`

- [ ] Add DeepSeek balance response schemas and `DeepSeekClient.balance()`.
- [ ] Add Telegram bot token columns to `User` and `user_id` to `TelegramProcessedMessage`.
- [ ] Add Alembic migration `013`.
- [ ] Extend provider settings response and add Telegram save/clear endpoints.
- [ ] Add `/ai/provider-balance`.
- [ ] Remove server-global Telegram token config and admin/global poll routes.
- [ ] Add user-scoped Telegram token helper, status, and poll-once flow.
- [ ] Run targeted pytest and then the API test suite.

### Task 3: Desktop Tests

**Files:**
- Modify: `desktop-rust/src/dev-test.py`

- [ ] Extend Settings AI smoke test to verify DeepSeek balance UI and usage button.
- [ ] Extend Settings AI smoke test to save/clear Telegram bot token without leaking it.
- [ ] Add AI tab smoke test for the help modal and its Telegram examples.
- [ ] Run `python3 dev-test.py` and verify failures are for missing UI/mock behavior.

### Task 4: Desktop Implementation

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/ai.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/tabs/settings.js`
- Modify: `desktop-rust/src/tabs/ai/ai-main.js`
- Modify: `desktop-rust/src/tabs/ai/ai-css.js`

- [ ] Add Rust command structs and endpoints for balance and Telegram token save/clear.
- [ ] Register new Tauri commands.
- [ ] Add browser mock handlers for balance and Telegram settings.
- [ ] Replace Settings AI with two provider blocks and balance rendering.
- [ ] Add Open usage button using existing `open_url`.
- [ ] Add AI tab help button and modal.
- [ ] Add AI voice provider selector for local Whisper vs Deepgram live.
- [ ] Add command follow-up handling after search-only AI plans for mutation requests.
- [ ] Run `node --check` on changed JS files.

### Task 5: Help, Version, And Release Gate

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock`

- [ ] Update global Help in EN/RU.
- [ ] Add a top release-history entry for `v1.3.49`.
- [ ] Add a top changelog entry for `v1.3.49`.
- [ ] Bump desktop native version to `1.3.49`.
- [ ] Refresh `Cargo.lock` with `cargo check`.

### Task 6: Verification And Release

**Files:** no new source files.

- [ ] Run targeted API tests.
- [ ] Run full API tests.
- [ ] Run `node --check` for changed JS.
- [ ] Run `cd desktop-rust/src && python3 dev-test.py`.
- [ ] Run `cd desktop-rust/src-tauri && /home/aster/.cargo/bin/cargo check`.
- [ ] Review diff and run an extra reviewer pass if available.
- [ ] Commit with a short one-line message.
- [ ] Tag and push `v1.3.49`.
- [ ] Monitor GitHub Actions and verify release assets.
- [ ] Deploy API migration and run a production smoke check for health, settings, and non-secret responses.
