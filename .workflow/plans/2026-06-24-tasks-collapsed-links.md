# Tasks Collapsed Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add module-level collapsed link shelves to Tasks and keep indented checkboxes visible when their new parent was collapsed.

**Architecture:** Keep all product changes in the desktop frontend. Store module settings through existing `get_setting`/`set_setting`, load task links through existing `list_task_links`, reorder through existing `reorder_task_links`, and adjust checkbox collapse state through existing local collapsed-node persistence.

**Tech Stack:** Vanilla JS Tasks tab, browser mock smoke tests, existing Tauri commands, local app settings.

---

### Task 1: Browser Smoke Tests

**Files:**
- Modify: `desktop-rust/src/dev-test.py`
- Modify: `desktop-rust/src/dev-mock.js`

- [ ] Add mock support for `list_task_links`, `create_task_link`, `update_task_link`, `reorder_task_links`, and `delete_task_link` if missing.
- [ ] Add a failing smoke test that enables `tasks_collapsed_links_enabled`, `tasks_collapsed_link_marker`, and `tasks_collapsed_link_color`, opens Tasks, verifies collapsed link shelf chips render above checkboxes, clicking chips uses browser/open behavior, and DnD calls `reorder_task_links`.
- [ ] Add a failing smoke test that collapses a checkbox parent, indents the next sibling with `Tab`, and verifies the parent is expanded and the moved child remains visible.

### Task 2: Tasks Settings

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/index.js`

- [ ] Load/save three module settings: `tasks_collapsed_links_enabled`, `tasks_collapsed_link_marker`, and `tasks_collapsed_link_color`.
- [ ] Add a "Collapsed links" section to the existing Tasks settings modal.
- [ ] Use default marker `◈` and a green link color when no setting exists.
- [ ] Re-render visible task cards after saving collapsed link settings.

### Task 3: Collapsed Link Shelf

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/card.js`
- Modify: `desktop-rust/src/tabs/tasks/tasks-css.js`
- Modify: `desktop-rust/src/tabs/tasks/dnd.js`

- [ ] In collapsed cards, render a soft shelf above checkboxes only when enabled and task links are present.
- [ ] Render chips with the selected marker and selected chip color.
- [ ] Clicking a chip opens the URL in a new browser tab/window.
- [ ] Add DnD support for `.task-link-chip` using the same wrapped-chip placeholder logic as pinned task chips.
- [ ] Commit reordered link ids through existing `reorder_task_links`.

### Task 4: Checkbox Tab Auto-Expand

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/card.js`

- [ ] In `nestUnderPrev`, if the previous sibling is collapsed, remove it from the collapsed set before reload.
- [ ] Persist collapse state before re-render.
- [ ] Keep focus restoration on the moved checkbox.

### Task 5: Help, Release History, Verification

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/help-content.js`
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`

- [ ] Update Tasks help with collapsed link shelf settings and indent auto-expand behavior.
- [ ] Add frontend release notes.
- [ ] Run `node --check` on changed JS files.
- [ ] Run `cd desktop-rust/src && python3 dev-test.py`.
- [ ] Commit and release as `f-20260624-2` unless a newer same-day tag exists.
