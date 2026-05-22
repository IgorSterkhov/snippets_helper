# Help Release History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Help release history update through frontend OTA and enforce that every release tag is documented before packaging.

**Architecture:** `desktop-rust/src/release-history.md` becomes the frontend asset used by Help. `help.js` loads it via `fetch(new URL('../release-history.md', import.meta.url))` and falls back to the native `get_changelog` command. `.github/workflows/release-desktop.yml` checks that the current tag is present before creating the frontend zip.

**Tech Stack:** Vanilla JS frontend, Python CDP smoke tests, GitHub Actions release workflow.

---

### Task 1: Smoke Test

**Files:**
- Modify: `desktop-rust/src/dev-test.py`

- [ ] Update the Help changelog smoke test to assert that the new `f-20260522-6` release note appears.
- [ ] Run `python3 dev-test.py` from `desktop-rust/src` and verify the test fails before implementation.

### Task 2: Help Loader

**Files:**
- Create: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/src/tabs/help.js`

- [ ] Move frontend OTA notes out of the hardcoded JS string.
- [ ] Load `release-history.md` first.
- [ ] Fall back to `get_changelog` if the asset cannot be loaded.
- [ ] Keep the current markdown renderer behavior.

### Task 3: Release Guard and Docs

**Files:**
- Modify: `.github/workflows/release-desktop.yml`
- Modify: `desktop-rust/RELEASES.md`
- Modify: `desktop-rust/CHANGELOG.md`

- [ ] Add a CI step before frontend packaging that fails when the current tag
      is missing from `desktop-rust/src/release-history.md`.
- [ ] Document the new release-history requirement in the release guide.
- [ ] Add release notes for `f-20260522-6`.

### Task 4: Verification and Release

- [ ] Run `node --check desktop-rust/src/tabs/help.js`.
- [ ] Run `python3 -m py_compile desktop-rust/src/dev-test.py`.
- [ ] Run `python3 dev-test.py` from `desktop-rust/src`.
- [ ] Run `cargo check` from `desktop-rust/src-tauri`.
- [ ] Commit, tag `f-20260522-6`, push `main` and the tag, then verify the
      frontend release asset.
