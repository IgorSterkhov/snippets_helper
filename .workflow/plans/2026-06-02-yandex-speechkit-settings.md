# Yandex SpeechKit Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move user-relevant Yandex SpeechKit text options from native hardcode into Settings > Whisper.

**Architecture:** Extend the existing local settings path instead of adding new IPC commands. The frontend saves new `whisper.yandex_*` keys through the existing settings modal, and the Rust live config reads those keys before building SpeechKit v3 options.

**Tech Stack:** Rust/Tauri native commands, vanilla JS desktop frontend, SQLite-backed local settings, existing release workflow.

---

### Task 1: Native SpeechKit Config

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/yandex.rs`
- Modify: `desktop-rust/src-tauri/src/commands/whisper.rs`

- [ ] Add fields to `YandexSpeechKitConfig`: `literature_text`, `profanity_filter`, `phone_formatting`.
- [ ] Add failing tests asserting these fields drive `TextNormalizationOptions`.
- [ ] Read new settings in `yandex_config_from_settings` with defaults matching current behavior.
- [ ] Map `phone_formatting=false` to mode `1` (`DISABLED`) and `true` to mode
  `0` (`UNSPECIFIED`, meaning SpeechKit may apply phone formatting when text
  normalization is enabled).

### Task 2: Whisper Settings UI

**Files:**
- Modify: `desktop-rust/src/tabs/whisper/whisper-settings.js`
- Modify: `desktop-rust/src/dev-mock.js` if the smoke mock needs new defaults.

- [ ] Load the new setting keys in `loadAllSettings`.
- [ ] Add checkboxes in the existing Yandex SpeechKit block.
- [ ] Keep labels concise and explain dependencies in helper copy.

### Task 3: Help And Release Notes

**Files:**
- Modify: `desktop-rust/src/tabs/whisper/help-content.js`
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock`

- [ ] Document what each Yandex checkbox does.
- [ ] Add `v1.5.2` release notes.
- [ ] Bump native version to `1.5.2`.

### Task 4: Verification And Release

**Commands:**
- `cargo test whisper::yandex --lib`
- `cargo check`
- `node --check desktop-rust/src/tabs/whisper/whisper-settings.js`
- `node --check desktop-rust/src/tabs/whisper/help-content.js`
- `node --check desktop-rust/src/tabs/help.js`
- `python3 dev-test.py`

- [ ] Commit with a short one-line message.
- [ ] Tag `v1.5.2`, push main and tag.
- [ ] Monitor GitHub Actions and verify release assets plus manifests.
