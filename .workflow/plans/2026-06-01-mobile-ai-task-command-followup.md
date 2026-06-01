# Mobile AI Task Command Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mobile AI task commands complete the requested task action instead of stopping at search, and add a compact task editor mode in mobile Tasks.

**Architecture:** Keep DeepSeek command names unchanged. Support both sequential `search_tasks -> add_task_checkbox(task_uuid, text)` execution and direct `add_task_checkbox(task_query, text)` execution, then add deterministic mobile dispatcher guards for search-only and duplicate-create edge cases. Add local UI state in `TaskEditorScreen` for expanded/collapsed full task details, independent from per-checkbox subtree collapse.

**Tech Stack:** Python FastAPI AI prompt/tool schema, React Native mobile frontend, Jest mobile tests.

---

### Task 1: AI Dispatcher Tests

**Files:**
- Modify: `mobile/__tests__/ai/commandDispatcher.test.js`

- [ ] Add tests for:
  - `search_tasks` followed by a user phrase containing `добавь ... пункт ...`
    adds a checkbox to the unique matching task.
  - `create_task` with an existing title and checkbox-shaped user phrase does
    not create a duplicate task.
  - AI task open navigation includes `collapsed: true`.

- [ ] Run:
  `npm test -- commandDispatcher.test.js`

### Task 2: Mobile AI Dispatcher Fix

**Files:**
- Modify: `mobile/src/ai/commandDispatcher.js`

- [ ] Add a small parser for Russian/English add-checkbox task phrases.
- [ ] Let `openTask` pass `collapsed: true` for AI navigation.
- [ ] Make `search_tasks` action-aware:
  - list/search requests return choices only;
  - open/show requests open the single match;
  - add-checkbox requests add the checkbox to the single match.
- [ ] Guard `create_task` against duplicate task creation when an existing
  task matches a checkbox-shaped add phrase.

- [ ] Run:
  `npm test -- commandDispatcher.test.js`

### Task 3: API Tool Schema and Prompt

**Files:**
- Modify: `api/ai_commands.py`
- Modify: `api/ai_prompt.py`

- [ ] Allow `add_task_checkbox` args to include `task_query` and `query` as a
  direct convenience path while keeping sequential `search_tasks` result
  follow-up as the app-side safety path.
- [ ] Tell the model that add-checkbox requests must use
  `add_task_checkbox`, not stop at `search_tasks`.
- [ ] Keep `search_tasks` as final only for explicit list/search requests.

### Task 4: Mobile Task Collapsed Mode

**Files:**
- Modify: `mobile/src/screens/Tasks/TaskEditorScreen.js`

- [ ] Initialize task editor collapsed when route params include
  `collapsed: true`.
- [ ] Add a header triangle button before the eye icon.
- [ ] In collapsed mode, show title and checkboxes, and hide category, status,
  parameters, notes, links, and delete action.
- [ ] Keep hide-done and per-checkbox collapse behavior unchanged.

### Task 5: Verification and Release

**Files:**
- Update mobile OTA version/release files if required by the current release
  workflow.
- Update API deployment files only if needed by existing scripts.

- [ ] Run targeted Jest tests.
- [ ] Run syntax checks for changed JS/Python where practical.
- [ ] Run reviewer on the patch.
- [ ] If checks pass, publish mobile OTA and deploy/restart API because the
  server prompt/tool schema changed.
