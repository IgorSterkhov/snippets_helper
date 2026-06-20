# VPS SSH Config Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a VPS toolbar import action and settings modal fields that import new SSH config aliases as normal machine-local VPS servers.

**Architecture:** Implement SSH config parsing and a single import command in `desktop-rust/src-tauri/src/commands/vps.rs`, backed by the existing `vps_servers` and machine-local settings storage. Use existing generic `get_setting`/`set_setting` for path settings, expose only the native import command, mirror it in the browser mock, then add compact VPS toolbar/settings UI and smoke coverage.

**Tech Stack:** Rust/Tauri commands, serde JSON, existing SQLite settings helpers, vanilla JS frontend, browser mock smoke tests.

---

## File Structure

- Modify `desktop-rust/src-tauri/src/commands/vps.rs`
  - Add parser helpers and unit tests.
  - Add command for importing servers from configured path settings.
- Modify `desktop-rust/src-tauri/src/lib.rs`
  - Register new VPS commands.
- Modify `desktop-rust/src/tabs/vps.js`
  - Add settings button/modal and `Import SSH configs` toolbar action.
- Modify `desktop-rust/src/dev-mock.js`
  - Add mock settings/import commands.
- Modify `desktop-rust/src/dev-test.py`
  - Add smoke tests for VPS settings and import action.
- Modify release/help files before tagging:
  - `desktop-rust/src/tabs/help.js`
  - `desktop-rust/src/release-history.md`
  - `desktop-rust/CHANGELOG.md`

## Tasks

- [ ] Add Rust parser tests for concrete aliases, multiple aliases, mixed wildcard/concrete `Host`, `Match` isolation, quoted values, inline comments, duplicate-by-normalized-name import, unreadable file summary, and malformed existing server JSON.
- [ ] Implement parser and import command in `vps.rs` with `lock_recover()`, strict existing-server loading, and no file reads while holding the DB mutex.
- [ ] Register commands in `lib.rs`.
- [ ] Add browser mock command and frontend smoke test coverage, including re-run no-duplicate behavior.
- [ ] Add VPS toolbar settings/import UI.
- [ ] Run Rust/frontend verification.
- [ ] Update Help, release history, changelog, bump semver to `v1.16.0`, commit, tag, push, and monitor release.

## Verification Commands

```bash
cd desktop-rust/src-tauri && cargo test vps_ssh --lib
cd desktop-rust/src-tauri && cargo check
cd desktop-rust/src && python3 dev-test.py
node --check desktop-rust/src/tabs/vps.js
node --check desktop-rust/src/dev-mock.js
node --check desktop-rust/src/tabs/help.js
git diff --check
```
