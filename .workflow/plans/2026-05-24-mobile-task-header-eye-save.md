# Mobile Task Header Eye Toggle and Save Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a task-editor header eye toggle for completed checkboxes and restyle `Сохранить` as an outline button.

**Architecture:** Reuse the existing mobile task preference key and add a tiny toggle helper in `taskPreferences.js`. `TaskEditorScreen` owns the immediate optimistic UI update, persistence error rollback, and header rendering with drawn React Native icons.

**Tech Stack:** React Native JavaScript, AsyncStorage, Jest, existing mobile OTA release flow.

---

### Task 1: Preference Toggle Helper

**Files:**
- Modify: `mobile/src/screens/Tasks/taskPreferences.js`
- Modify: `mobile/__tests__/tasks/taskPreferences.test.js`

- [x] Add RED tests for `toggleTaskPreference()` storing and returning the inverse boolean.
- [x] Run:
  ```bash
  cd mobile && npm test -- --runTestsByPath __tests__/tasks/taskPreferences.test.js
  ```
  Expected: FAIL because `toggleTaskPreference` is not exported yet.
- [x] Implement:
  ```javascript
  export async function toggleTaskPreference(key, currentValue) {
    const nextValue = !currentValue;
    await setTaskPreference(key, nextValue);
    return nextValue;
  }
  ```
- [x] Re-run the focused test and verify PASS.

### Task 2: Task Editor Header UI

**Files:**
- Modify: `mobile/src/screens/Tasks/TaskEditorScreen.js`

- [x] Import `TASK_PREF_KEYS`, `toggleTaskPreference`, and keep `loadTaskPreferences`.
- [x] Add an async `toggleHideDonePreference()` that optimistically updates `taskPrefs.hideDone`, persists the change, and rolls back on error.
- [x] Change `navigation.setOptions({ headerRight })` to render:
  - eye button first;
  - outline `Сохранить` pill second.
- [x] Add a drawn `EyeIcon` component with slashed hidden state.
- [x] Add compact header styles that fit beside the navigation title.
- [x] Run:
  ```bash
  node --check mobile/src/screens/Tasks/TaskEditorScreen.js
  ```

### Task 3: Version, Verify, and OTA

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`

- [x] Bump mobile version from `1.0.15` to `1.0.16`.
- [x] Run:
  ```bash
  node --check mobile/src/screens/Tasks/taskPreferences.js
  node --check mobile/src/screens/Tasks/TaskEditorScreen.js
  cd mobile && npm test
  ```
- [x] Build OTA bundle with top-level `output/`.
- [x] Upload `bundle-1.0.16.zip`.
- [x] Update mobile `latest.json`.
- [x] Verify manifest and bundle URL.
- [ ] Commit and push.
- [ ] Run post-release smoke for desktop `f-20260524-1` and mobile `1.0.16`.
