# Desktop Ctrl+Tab View History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for the smoke coverage and superpowers:verification-before-completion before release. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global `Ctrl+Tab` recent-view switching with immediate previous-view jump and a repeated-press switcher overlay.

**Architecture:** Add a frontend-only `view-history` component that listens for `view-history:record` events from modules and controls `Ctrl+Tab`. The component activates modules through `TabContainer`, then dispatches a `view-history:open` event for object restoration. Snippets, Tasks, and Notes add small hooks to record/open object views.

**Tech Stack:** Vanilla JS desktop frontend, existing browser mock/CDP smoke tests, CSS in `desktop-rust/src/styles.css`.

---

### Task 1: Smoke Test First

**Files:**
- Modify: `desktop-rust/src/dev-test.py`

- [ ] Add a smoke test that opens `bash_obsidian_setup`, opens `Regular mock task`, presses `Ctrl+Tab`, and asserts the active tab returns to Shortcuts with `bash_obsidian_setup` selected.
- [ ] In the same smoke test, press `Ctrl+Tab` twice in one sequence and assert `.view-history-switcher` appears with both task and snippet labels.
- [ ] Run `cd desktop-rust/src && python3 dev-test.py` and confirm the new test fails before implementation.

### Task 2: View History Component

**Files:**
- Create: `desktop-rust/src/components/view-history.js`
- Modify: `desktop-rust/src/main.js`
- Modify: `desktop-rust/src/styles.css`

- [ ] Implement bounded MRU storage with dedupe by `entry.key`.
- [ ] Install a global `keydown`/`keyup` handler for `Ctrl+Tab`, `Shift+Ctrl+Tab`, and `Escape`.
- [ ] Bail out of the entire `Ctrl+Tab` flow when `.modal-overlay` is present, so neither immediate jumps nor switcher rendering happen behind modals.
- [ ] On first `Ctrl+Tab`, activate the previous entry immediately.
- [ ] On repeated `Ctrl+Tab`, render a compact overlay from the frozen cycle snapshot and update the selected entry.
- [ ] Activate target modules through `tabContainer.activate(moduleId)`, then dispatch `view-history:open`.
- [ ] Add CSS for the dark compact overlay.

### Task 3: Module Hooks

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`
- Modify: `desktop-rust/src/tabs/tasks/index.js`
- Modify: `desktop-rust/src/tabs/notes.js`

- [ ] Snippets: record selected snippet and detail tab; restore by id/uuid and tab.
- [ ] Tasks: record selected expanded task; restore by id/uuid/title via `openExpanded`.
- [ ] Notes: record opened existing notes; restore by id/uuid/title using existing note loading.
- [ ] Avoid recording when a module is not the active visible module.

### Task 4: Release Documentation and Verification

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`

- [ ] Document `Ctrl+Tab` in Help hotkeys/changelog.
- [ ] Add release history/changelog entry for the frontend OTA tag.
- [ ] Run `node --check` for changed JS files.
- [ ] Run `cd desktop-rust/src && python3 dev-test.py`.
- [ ] Commit scoped frontend files and cut an `f-*` release.
