# Mobile Task Checkbox Reorder Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mobile checkbox reorder mode with floating arrow controls.

**Architecture:** Put hierarchy movement rules in pure helpers in `mobile/src/db/taskRepo.js`, then keep `TaskEditorScreen` responsible only for entering reorder mode, rendering controls, persisting changed rows, and expanding the new parent after indent. This keeps sync-compatible data writes centralized on `parent_uuid`, `sort_order`, and `updated_at`.

**Tech Stack:** React Native JavaScript, SQLite repository helpers, Jest, existing mobile OTA release flow.

---

### Task 1: Add Reorder Helper Tests

**Files:**
- Modify: `mobile/__tests__/db/taskRepo.test.js`

- [x] Add RED tests for:
  - `getCheckboxMoveAvailability()` exposes possible directions for a middle child;
  - `moveCheckboxInTree(..., 'up')` moves a sibling before the previous sibling;
  - `moveCheckboxInTree(..., 'right')` indents a row under the previous sibling;
  - `moveCheckboxInTree(..., 'left')` outdents a row immediately after its parent;
  - boundary moves return no changed rows.
- [x] Run:
  ```bash
  cd mobile && npm test -- --runTestsByPath __tests__/db/taskRepo.test.js
  ```
  Expected: FAIL because the new helpers are not exported yet.

### Task 2: Implement Pure Reorder Helpers

**Files:**
- Modify: `mobile/src/db/taskRepo.js`

- [x] Add `getCheckboxMoveAvailability(items, uuid)`.
- [x] Add `moveCheckboxInTree(items, uuid, direction, updatedAt)`.
- [x] Ensure moved parents keep their descendants attached.
- [x] Normalize affected sibling groups to `sort_order = 0..n`.
- [x] Return `{ items, changed, parentToExpand }`.
- [x] Run task repo tests and verify PASS:
  ```bash
  cd mobile && npm test -- --runTestsByPath __tests__/db/taskRepo.test.js
  ```

### Task 3: Wire Reorder Mode Into Task Editor

**Files:**
- Modify: `mobile/src/screens/Tasks/TaskEditorScreen.js`

- [x] Import the new helpers.
- [x] Add `reorderCheckboxUuid` and busy state.
- [x] Add `Переместить` to the long-press dot menu.
- [x] Render a highlighted selected row.
- [x] Render floating arrow controls and `OK`.
- [x] Apply moves through `moveCheckboxInTree()`.
- [x] Persist changed rows immediately with `upsertTaskCheckbox()` for existing tasks.
- [x] Call `notifyLocalChange()` after successful persisted moves.
- [x] Expand `parentToExpand` after a right-indent move.
- [x] Run:
  ```bash
  node --check mobile/src/screens/Tasks/TaskEditorScreen.js
  ```

### Task 4: Version, Verify, and OTA

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`

- [x] Bump mobile version from `1.0.14` to `1.0.15`.
- [x] Run:
  ```bash
  node --check mobile/src/db/taskRepo.js
  node --check mobile/src/screens/Tasks/TaskEditorScreen.js
  cd mobile && npm test
  ```
- [x] Build OTA bundle with top-level `output/`.
- [x] Upload `bundle-1.0.15.zip`.
- [x] Update mobile `latest.json`.
- [x] Verify manifest and bundle URL.
- [ ] Run post-release smoke for `f-20260524-1` and mobile `1.0.15`.
- [ ] Commit and push.
