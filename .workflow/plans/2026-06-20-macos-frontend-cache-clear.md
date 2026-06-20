# macOS Frontend Cache Clear Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale macOS WebView frontend assets after OTA reloads and expose a manual Settings reset action.

**Architecture:** Make `khapp://` frontend asset responses non-cacheable so normal OTA reloads deterministically fetch the active bundle. Reuse the existing OTA command module as the source of truth for frontend window selection, and keep full browsing-data clear as an explicit manual recovery command only. The Settings UI calls the new command after a warning; smoke tests assert the native contract and UI behavior.

**Tech Stack:** Rust/Tauri 2.10.3, vanilla JavaScript Settings UI, browser mock `dev-test.py`.

---

### Task 1: Native OTA Cache Prevention

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/ota.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`

- [ ] Add no-store/no-cache response headers to both override and bundled `khapp://` asset responses in `desktop-rust/src-tauri/src/lib.rs`.
- [ ] Add a private frontend-window predicate or helper so `reload_frontend_windows` and the new cache clear use the same labels: `main`, `whisper-overlay`, `micro_picker::picker_label()`, and labels starting with `module_`.
- [ ] Add `clear_frontend_browsing_data_for_frontend_windows(&AppHandle) -> Vec<String>` that iterates frontend windows, calls `window.clear_all_browsing_data()`, logs failures, and returns failed labels.
- [ ] Do not call full browsing-data clear from `apply_frontend_update`; normal OTA should rely on no-cache headers and reload.
- [ ] Add `#[tauri::command] pub async fn clear_frontend_browsing_data(app: AppHandle) -> Result<Vec<String>, String>` that clears browsing data, reloads frontend windows, and returns failed labels.
- [ ] Register `commands::ota::clear_frontend_browsing_data` in `desktop-rust/src-tauri/src/lib.rs`.

### Task 2: Settings Manual Reset UI

**Files:**
- Modify: `desktop-rust/src/tabs/settings.js`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] Add a `Clear frontend cache & reload` secondary button in the Settings > Update frontend OTA row.
- [ ] On click, show a warning confirmation, disable the button, call `clear_frontend_browsing_data`, show a success toast, and re-enable on error.
- [ ] Add a dev mock for `clear_frontend_browsing_data`.
- [ ] Add smoke assertions that Settings exposes the button, clicking it invokes the mock command, `lib.rs` has no-cache headers for `khapp://`, and the command is registered.

### Task 3: Release Docs and Verification

**Files:**
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Refresh: `desktop-rust/src-tauri/Cargo.lock`

- [ ] Bump native version from `1.14.0` to `1.15.0`.
- [ ] Add release notes for `v1.15.0`.
- [ ] Update Help > Settings/Updates text to mention frontend cache reset.
- [ ] Run `node --check` for changed JS files.
- [ ] Run `python3 dev-test.py` from `desktop-rust/src`.
- [ ] Run `cargo check` from `desktop-rust/src-tauri`.
- [ ] Run focused Rust OTA tests if present; otherwise rely on `cargo check` and smoke-contract tests.
- [ ] Commit, tag `v1.15.0`, push, monitor GitHub Actions, and verify release assets plus `frontend-version.json`.
