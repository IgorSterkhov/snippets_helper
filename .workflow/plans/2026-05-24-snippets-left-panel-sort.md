# Snippets Left Panel Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted Snippets left-panel sort mode switcher for name and modified date.

**Architecture:** Keep sorting in the Snippets frontend module after backend search/tag filtering. Persist only the selected mode through existing `get_setting` / `set_setting`; do not change Rust commands or sync data.

**Tech Stack:** Vanilla JavaScript in `desktop-rust/src/tabs/shortcuts.js`, shared CSS in `desktop-rust/src/styles.css`, CDP smoke tests in `desktop-rust/src/dev-test.py`.

---

### Task 1: Smoke Test

**Files:**
- Modify: `desktop-rust/src/dev-test.py`

- [ ] Add a Snippets smoke test that seeds deterministic `updated_at` values,
      verifies the default alphabetical order, switches the new sort menu to
      modified-date order, verifies newest-first ordering, and verifies the
      persisted setting survives page reload.
- [ ] Run `cd desktop-rust/src && python3 dev-test.py`.
      Expected before implementation: FAIL because `.snippet-sort-button` does
      not exist.

### Task 2: Snippets UI + Sorting

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`
- Modify: `desktop-rust/src/styles.css`

- [ ] Load `snippets_sort_mode` during Snippets init and default to `name`.
- [ ] Add a compact `.snippet-sort-button` next to search using labels `A-Z`
      and `Modified`.
- [ ] Add a two-item `.snippet-sort-menu` with `data-sort-mode="name"` and
      `data-sort-mode="modified"`.
- [ ] Sort the current filtered `shortcuts` array after each load.
- [ ] Persist mode changes with `set_setting`.
- [ ] Preserve selected snippet by id when changing sort mode.
- [ ] Run `node --check desktop-rust/src/tabs/shortcuts.js` and the smoke test.

### Task 3: Help + Release History

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`

- [ ] Mention the sort switcher in the EN/RU Snippets feature description.
- [ ] Add a release-history entry for the planned `f-*` tag.
- [ ] Add the same changelog entry.

### Task 4: Release

**Files:**
- Commit all modified files.

- [ ] Run `cd desktop-rust/src-tauri && cargo check`.
- [ ] Run `cd desktop-rust/src && python3 dev-test.py`.
- [ ] Commit with a short one-line message.
- [ ] Push `main`, tag the next `f-20260524-*`, push the tag.
- [ ] Verify the GitHub release assets and `frontend-version.json`.
