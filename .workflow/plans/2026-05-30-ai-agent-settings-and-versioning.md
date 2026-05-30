# AI Agent Settings And Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI agent settings/capabilities/preview, Telegram task rendering, and explicit desktop semver bump rules.

**Architecture:** Extend the API first with persisted per-user custom instructions, generated capabilities, dry-run preview, and a non-mutating `show_task` command. Proxy the new API paths through Tauri commands, then add a compact AI-tab gear modal backed by browser mock tests. Finish with version policy docs, Help/release history, and a full `v1.4.0` release because the IPC/API surface changes.

**Tech Stack:** FastAPI + SQLAlchemy/Alembic + pytest, DeepSeek OpenAI-compatible tool calls, Tauri Rust commands, vanilla JS desktop frontend, browser mock/CDP smoke tests.

---

### Task 1: API Tests For Settings, Capabilities, Preview, And Show Task

**Files:**
- Modify: `tests/api/test_ai_route.py`
- Modify: `tests/api/test_ai_commands.py`
- Modify: `tests/api/test_ai_runtime.py`
- Modify: `tests/api/test_telegram_bot.py`

- [ ] Add a failing route test that `update_ai_agent_settings` trims and stores custom instructions, and `get_ai_agent_settings` returns only `custom_instructions`, timestamps, and read-only core instructions.
- [ ] Add a failing prompt test that custom instructions appear after immutable safety rules and do not replace them.
- [ ] Add a failing capabilities test that `show_task` is listed in `deepseek_tools()` and `GET /ai/capabilities` exposes generated tools plus context fields.
- [ ] Add a failing preview test with a fake DeepSeek client returning `create_task`; assert the response contains the command and the repository/database mutation path is not used.
- [ ] Add a failing runtime test for `show_task` that returns task details with nested checked/unchecked checkboxes.
- [ ] Add a failing Telegram formatting test that a `show_task` command result is rendered as readable task text.
- [ ] Run targeted pytest and verify the failures are missing-feature failures.

### Task 2: API Implementation

**Files:**
- Modify: `api/models.py`
- Create: `api/alembic/versions/014_add_ai_agent_settings.py`
- Modify: `api/schemas.py`
- Modify: `api/ai_prompt.py`
- Modify: `api/ai_commands.py`
- Modify: `api/ai_runtime.py`
- Modify: `api/routes/ai.py`
- Modify: `api/telegram_bot.py`

- [ ] Add `users.ai_custom_instructions` and `users.ai_custom_instructions_updated_at`.
- [ ] Add Pydantic models for agent settings, capabilities, and preview.
- [ ] Split the prompt builder into immutable core instructions plus optional custom instructions and channel/context sections.
- [ ] Add generated capability helpers based on `deepseek_tools()`.
- [ ] Add `show_task` to the command catalog and validator.
- [ ] Extend `SqlAlchemyAiRepository` with `get_task_details`.
- [ ] Implement `execute_command(... show_task ...)` as a non-mutating command result with task summary text.
- [ ] Add `/ai/agent-settings`, `/ai/capabilities`, and `/ai/preview`.
- [ ] Make `/ai/chat` and Telegram AI use the new prompt builder with the current user's custom instructions.
- [ ] Update Telegram response formatting so detailed command messages are sent cleanly.
- [ ] Run targeted API tests and then the full API suite.

### Task 3: Desktop Tauri Proxy

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/ai.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`

- [ ] Add URL helpers for `/ai/agent-settings`, `/ai/capabilities`, and `/ai/preview`.
- [ ] Add serializable request/response structs where typed structs are useful; use `serde_json::Value` for capability and preview payloads.
- [ ] Add commands `get_ai_agent_settings`, `save_ai_agent_settings`, `get_ai_capabilities`, and `preview_ai_prompt`.
- [ ] Register the new commands in `lib.rs`.
- [ ] Extend Rust URL unit tests to cover both plain API base and `/v1` base.
- [ ] Run `cargo test ai::tests` or `cargo check` after implementation.

### Task 4: Desktop UI Tests And Mock

**Files:**
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] Add mock handlers for the four new AI agent commands.
- [ ] Extend the AI tab smoke test to assert the gear button exists and opens the modal.
- [ ] Add a smoke test that saves custom instructions and then resets them.
- [ ] Add a smoke test that capabilities render `show_task` and a safety rule.
- [ ] Add a smoke test that Preview returns a command list without switching to Tasks or creating a task.
- [ ] Run `python3 dev-test.py` and verify failures are missing-UI failures before implementation.

### Task 5: Desktop UI Implementation

**Files:**
- Modify: `desktop-rust/src/tabs/ai/ai-api.js`
- Modify: `desktop-rust/src/tabs/ai/ai-main.js`
- Modify: `desktop-rust/src/tabs/ai/ai-css.js`
- Modify: `desktop-rust/src/tabs/ai/ai-dispatcher.js`

- [ ] Add API helpers for agent settings, capabilities, and preview.
- [ ] Add a gear icon button in the AI header.
- [ ] Implement the AI Agent Settings modal with Instructions, Capabilities, and Test Prompt sections.
- [ ] Save/reset custom instructions with copyable error dialogs on failure.
- [ ] Render generated capability data without hardcoding the tool list in UI.
- [ ] Render preview reply and command cards without executing app commands.
- [ ] Treat local `show_task` commands like `open_task` so desktop can navigate when a model returns it outside preview.
- [ ] Run `node --check` on changed JS files.

### Task 6: Version Policy, Help, And `v1.4.0`

**Files:**
- Modify: `desktop-rust/RELEASES.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock`

- [ ] Add explicit patch/minor/major version bump policy to release docs.
- [ ] Update Help in EN/RU with AI agent settings, capabilities, preview, and Telegram "show task" behavior.
- [ ] Add top entries for `v1.4.0` in release history and changelog.
- [ ] Bump native version from `1.3.50` to `1.4.0` in both Tauri version files.
- [ ] Refresh `Cargo.lock` with `/home/aster/.cargo/bin/cargo check`.

### Task 7: Verification, Review, Commit, Release, Deploy

**Files:** no new source files.

- [ ] Run targeted API tests for AI route/runtime/commands/Telegram.
- [ ] Run `tests/api/run.sh`.
- [ ] Run `node --check` for changed JS files.
- [ ] Run `cd desktop-rust/src && python3 dev-test.py`.
- [ ] Run `cd desktop-rust/src-tauri && /home/aster/.cargo/bin/cargo check`.
- [ ] Run `git diff --check`.
- [ ] Run an extra reviewer pass if the subagent tool is available; if it is not, do an inline blocking review against the spec.
- [ ] Commit with a short one-line message.
- [ ] Push, tag `v1.4.0`, push the tag, monitor GitHub Actions, and verify release assets.
- [ ] Deploy the API migration/server and smoke-check health plus the new AI endpoints.
