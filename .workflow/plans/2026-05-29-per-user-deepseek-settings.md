# Per-User DeepSeek Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store a DeepSeek API key per API user and let desktop users manage it from Settings.

**Architecture:** Add server-side user fields and authenticated provider-settings endpoints. Desktop calls these endpoints through new Tauri commands using the existing sync API URL/key. AI chat and Telegram runtime pass the current user's key explicitly into the DeepSeek client.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, Tauri Rust commands, vanilla desktop JS, existing CDP browser mock smoke tests.

---

### Task 1: Server Tests First

**Files:**
- Modify: `tests/api/test_ai_route.py`
- Modify: `tests/api/test_telegram_bot.py`
- Modify: `tests/api/test_admin_user_model.py`

- [ ] Add failing tests for provider settings status/save/clear.
- [ ] Add failing test that public AI chat returns HTTP 400 when the user has no DeepSeek key.
- [ ] Add failing test that Telegram AI uses the bound user's DeepSeek key.
- [ ] Add failing model test for `users.deepseek_api_key` and `users.deepseek_updated_at`.
- [ ] Run the targeted API tests and confirm the expected failures.

### Task 2: Server Implementation

**Files:**
- Modify: `api/models.py`
- Modify: `api/schemas.py`
- Modify: `api/routes/ai.py`
- Modify: `api/telegram_bot.py`
- Add: `api/alembic/versions/012_add_user_deepseek_settings.py`

- [ ] Add nullable user DeepSeek fields.
- [ ] Add provider settings request/response schemas.
- [ ] Add authenticated GET/PUT/DELETE provider settings endpoints.
- [ ] Make public AI chat require and pass `user.deepseek_api_key`.
- [ ] Make Telegram AI require and pass the bound user's key.
- [ ] Add Alembic migration 012.
- [ ] Run the targeted API tests and then `tests/api/run.sh`.

### Task 3: Desktop Tests First

**Files:**
- Modify: `desktop-rust/src/dev-test.py`
- Modify: `desktop-rust/src/dev-mock.js`

- [ ] Add a smoke test that opens Settings -> AI.
- [ ] Test the status starts as not configured.
- [ ] Test saving a mock key updates status without displaying the key.
- [ ] Test clearing the key resets status.
- [ ] Run `python3 dev-test.py` and confirm the new test fails before the UI exists.

### Task 4: Desktop Implementation

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/ai.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/tabs/settings.js`

- [ ] Add Tauri commands: `get_ai_provider_settings`, `save_ai_provider_settings`, `clear_ai_provider_settings`.
- [ ] Reuse existing sync API URL/key lookup and HTTP client behavior.
- [ ] Add Settings `AI` sub-tab with status, password input, Save/Clear/Refresh actions.
- [ ] Add browser mock handlers for the new commands.
- [ ] Run `node --check` on changed JS files.
- [ ] Run `python3 dev-test.py`.
- [ ] Run `cargo check` from `desktop-rust/src-tauri`.

### Task 5: Release Documentation And Versioning

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock`

- [ ] Document that AI uses a per-user DeepSeek key configured in Settings.
- [ ] Add a release-history entry for the next full release.
- [ ] Bump desktop native version from `1.3.47` to `1.3.48`.
- [ ] Refresh `Cargo.lock` via `cargo check`.
- [ ] Commit, tag `v1.3.48`, push, and monitor GitHub Actions if all checks pass.
