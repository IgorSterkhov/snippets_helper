# Mobile Task Checkbox Dot Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mobile checkbox dot controls, collapse/expand, action-menu delete, and display preferences.

**Architecture:** Extend the pure checkbox flattening helper to understand collapsed IDs and hide-completed filtering. Keep UI state in `TaskEditorScreen`, persist display preferences through AsyncStorage, and expose preference toggles in mobile Settings.

**Tech Stack:** React Native JavaScript, AsyncStorage, Jest, existing mobile OTA release flow.

---

### Task 1: Extend Checkbox Tree Helper

**Files:**
- Modify: `mobile/src/db/taskRepo.js`
- Modify: `mobile/__tests__/db/taskRepo.test.js`

- [x] Add RED tests for:
  - collapsed parent hides descendants and reports hidden count;
  - hide completed hides checked leaves;
  - hide completed keeps a checked parent if it has unchecked descendants.
- [x] Run task repo tests and verify they fail.
- [x] Extend `flattenCheckboxTree(items, options)` with:
  - `collapsedIds`;
  - `hideDone`;
  - `hasChildren`;
  - `hiddenDescendantCount`.
- [x] Run task repo tests and verify they pass.

### Task 2: Add Task Preference Storage

**Files:**
- Create: `mobile/src/screens/Tasks/taskPreferences.js`
- Create: `mobile/__tests__/tasks/taskPreferences.test.js`

- [x] Add tests for default values and persistence.
- [x] Implement AsyncStorage-backed preferences:
  - `tasks.hide_completed_checkboxes`;
  - `tasks.wrap_checkbox_text`.
- [x] Run the new preference tests.

### Task 3: Update Task Editor UI

**Files:**
- Modify: `mobile/src/screens/Tasks/TaskEditorScreen.js`

- [x] Replace right-side `Del` text with left dot handle/action flow.
- [x] Dot tap toggles collapse for rows with children.
- [x] Dot long-press opens menu with Collapse/Expand, Delete, Cancel.
- [x] Render hidden descendant count when a row is collapsed.
- [x] Use wrap-text preference for checkbox text inputs.
- [x] Use hide-completed preference when flattening checkbox rows.
- [x] Keep delete subtree behavior unchanged.
- [x] Run `node --check mobile/src/screens/Tasks/TaskEditorScreen.js`.

### Task 4: Update Settings UI

**Files:**
- Modify: `mobile/src/screens/Settings/SettingsScreen.js`

- [x] Add Tasks section with switches:
  - hide completed checkboxes;
  - wrap checkbox text.
- [x] Persist changes through `taskPreferences.js`.
- [x] Run `node --check mobile/src/screens/Settings/SettingsScreen.js`.

### Task 5: OTA 1.0.13

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`

- [x] Bump mobile version to `1.0.13`.
- [x] Run full mobile Jest.
- [x] Build OTA bundle with top-level `output/`.
- [x] Upload `bundle-1.0.13.zip`.
- [x] Update mobile `latest.json`.
- [x] Verify manifest, bundle URL, and post-release smoke.
- [x] Commit and push.
