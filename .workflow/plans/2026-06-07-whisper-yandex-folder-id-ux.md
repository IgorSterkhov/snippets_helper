# Whisper Yandex Folder ID UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clear Yandex SpeechKit Folder ID guidance when batch recognition is selected without required configuration.

**Architecture:** Keep existing recognition routing unchanged. Add a frontend warning based on persisted settings and improve existing validation/help text so both tab clicks and global hotkey failures explain the same mode/config relationship.

**Tech Stack:** Vanilla JavaScript desktop frontend, Tauri Rust command validation, Python CDP smoke tests, browser mock.

---

### Task 1: Regression Coverage

**Files:**
- Modify: `desktop-rust/src/dev-test.py`
- Modify: `desktop-rust/src/dev-mock.js`

- [ ] Add a smoke assertion that selects Yandex, turns Live dictate off, clears `whisper.yandex_folder_id`, and expects a visible warning in the Whisper header.
- [ ] Add a smoke assertion that clicking Record opens a persistent error dialog with text explaining Yandex batch mode requires Folder ID and that Live dictate is the streaming alternative.
- [ ] Update the mock `whisper_start_recording` Yandex Folder ID error to match native wording so the smoke test exercises the user-facing copy.

### Task 2: Frontend Warning And Help

**Files:**
- Modify: `desktop-rust/src/tabs/whisper/whisper-tab.js`
- Modify: `desktop-rust/src/tabs/whisper/help-content.js`
- Modify: `desktop-rust/src/tabs/help.js`

- [ ] Add a compact warning element in the Whisper header, hidden by default.
- [ ] Load `whisper.yandex_folder_id` with the existing settings refresh path.
- [ ] Show the warning only when `recognitionEngine === 'yandex'`, `liveDictate === false`, and Folder ID is empty.
- [ ] Refresh the warning after engine changes, Live dictate changes, and Whisper settings changes.
- [ ] Extend Whisper help with a clear Folder ID path: Yandex Cloud Console -> cloud -> folder -> copy the folder identifier from the folder page.
- [ ] Update general Help copy to mention the inline warning and batch/live choice.

### Task 3: Native Error Copy

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/whisper.rs`

- [ ] Replace the existing missing Folder ID message with actionable copy explaining the current mode and alternatives.
- [ ] Add a unit test for the helper/error copy if the implementation extracts the string into a helper.

### Task 4: Verification And Release Prep

**Files:**
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src/release-history.md`

- [ ] Add an Unreleased or release entry describing the Yandex batch setup guidance.
- [ ] Run `node --check` on changed JavaScript files.
- [ ] Run the targeted CDP smoke test or full `python3 dev-test.py` from `desktop-rust/src`.
- [ ] Run `cargo test yandex --lib` or `cargo test whisper --lib`, then `cargo check` from `desktop-rust/src-tauri` if Rust changed.
- [ ] If all checks pass, cut a patch `v*` release because `desktop-rust/src-tauri/` changed.
