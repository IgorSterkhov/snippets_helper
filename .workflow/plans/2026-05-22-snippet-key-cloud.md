# Snippet Key Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and refine a frontend-only key cloud modal and related-snippets tab derived from snippet names.

**Architecture:** `shortcuts.js` computes keys from snippet names and keeps an unfiltered `allShortcuts` cache for analytics. It also owns the small deterministic packed-cloud layout because it depends only on already-derived key counts. `styles.css` owns the reusable key-cloud, zoom controls, tooltip, and related-list styling. `dev-test.py` adds smoke coverage using underscore-named snippets from `dev-mock.js`.

**Tech Stack:** Vanilla JavaScript, existing modal/toast components, existing CDP smoke tests.

---

### Task 1: Failing Smoke Coverage

**Files:**
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] Add mock snippets named `bash_cd_guide`, `bash_cd_cheatsheet`,
      `bash_ssh_guide`, and `sql_guide`.
- [ ] Add a smoke test that opens `Key Cloud` and verifies the `bash` bubble
      count is `3`.
- [ ] Add a smoke test that opens `bash_cd_guide`, switches to `Related`, and
      verifies rows are ordered as `bash_cd_cheatsheet`,
      `bash_ssh_guide`, `sql_guide`.
- [ ] Run `python3 dev-test.py` and verify the new tests fail before
      implementation because the UI does not exist yet.

### Task 2: Key Derivation and Related Data

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`

- [ ] Add `allShortcuts`.
- [ ] Populate `allShortcuts` from `list_shortcuts` before applying search/tag
      filtering.
- [ ] Add `extractSnippetKeys`, `getSnippetKeySet`, `getKeyColor`,
      `getKeyCloudItems`, and `getRelatedSnippets`.
- [ ] Keep the implementation frontend-only; do not add Tauri calls.

### Task 3: UI

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`
- Modify: `desktop-rust/src/styles.css`

- [ ] Add the `Key Cloud` header button.
- [ ] Implement `openKeyCloudModal`.
- [ ] Make key bubbles clickable: close the modal, clear selected tag, set the
      search input to the key, and reload the snippet list.
- [ ] Add `Related` to detail tabs only when related snippets exist.
- [ ] Implement `renderRelatedTab`.
- [ ] Add compact styles for cloud bubbles, related rows, and key pills.

### Task 4: Help and Release Notes

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src/release-history.md`

- [ ] Mention key cloud and related snippets in Snippets help text.
- [ ] Add release note for the frontend-only tag.
- [ ] Ensure `release-history.md` includes the release tag before tagging.

### Task 5: Verification and Release

- [ ] Run `node --check desktop-rust/src/tabs/shortcuts.js desktop-rust/src/tabs/help.js`.
- [ ] Run `python3 -m py_compile desktop-rust/src/dev-test.py`.
- [ ] Run `python3 dev-test.py` from `desktop-rust/src`.
- [ ] Run `cargo check` from `desktop-rust/src-tauri`.
- [ ] Commit, tag, push, and verify frontend release assets.

### Task 6: Variant C Packed Cloud Upgrade

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`
- Modify: `desktop-rust/src/styles.css`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] Extend the smoke test for `Key Cloud` so it verifies the packed viewport,
      zoom controls, proportional bubble diameters, tooltip text, and visible
      center bias for high-count keys.
- [ ] Run the smoke test and verify it fails against the old flex-wrap cloud.
- [ ] Replace flex-wrap cloud rendering with an organic packed absolute layout:
      largest keys sorted first, relaxed collision resolution, larger keys near
      the center, smaller keys toward the edges.
- [ ] Add zoom in/out, wheel zoom, drag-to-pan, and `Fit` behavior without
      adding Tauri commands.
- [ ] Make bubble font size depend on diameter and key length, and show a
      hover tooltip with full key and count.
- [ ] Run `node --check desktop-rust/src/tabs/shortcuts.js` and
      `python3 dev-test.py` from `desktop-rust/src`.
