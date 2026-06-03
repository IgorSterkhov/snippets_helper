# Tasks Checkbox Arrow Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add boundary ArrowUp/ArrowDown navigation between visible editable checkbox rows in the desktop Tasks module.

**Architecture:** Keep the change frontend-only. `card.js` will add small caret helpers and extend the existing checkbox `keydown` handler; tests will drive the behavior through the existing CDP smoke suite and mocked Tasks data.

**Tech Stack:** Vanilla JavaScript desktop frontend, Tauri browser mock, Python CDP smoke tests.

---

### Task 1: Add Failing Smoke Coverage

**Files:**
- Modify: `desktop-rust/src/dev-test.py`

- [ ] **Step 1: Add a failing test**

Add a new test after `T15e Tasks checkbox Enter inserts after current sibling` named `T15f Tasks checkbox arrow navigation uses visible rows`.

The test should:

1. Seed task `2` with visible, hidden-completed, and nested rows.
2. Open the Tasks tab and expand `Regular mock task`.
3. Confirm the hidden completed row is not rendered.
4. Put the caret at the start of the "Arrow current" row and dispatch `ArrowUp`.
5. Assert focus moves to "Arrow previous" and caret offset is `0`.
6. Put the caret at the end of "Arrow current" and dispatch `ArrowDown`.
7. Assert focus moves to "Arrow next" and caret offset is `0`.

- [ ] **Step 2: Run RED**

Run:

```bash
cd desktop-rust/src && python3 dev-test.py
```

Expected: the new `T15f` test fails because ArrowUp/ArrowDown do not yet move focus between checkbox rows.

### Task 2: Implement Boundary Navigation

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/card.js`

- [ ] **Step 1: Add caret helpers**

Add focused helpers near the existing `focusAfterReload` helper:

- `getTextSelectionOffset(textEl)` returns the current collapsed caret offset
  inside `textEl`, or `null` when selection is unavailable, non-collapsed, or
  outside the element.
- `placeCaret(textEl, atEnd = false)` focuses `textEl` and places the caret at
  offset `0` or at the end.
- `focusVisibleCheckboxNeighbor(textEl, direction)` finds visible sibling rows
  via the current row's parent container and moves focus to the previous or next
  editable `.tcb-text`.

- [ ] **Step 2: Extend keydown handling**

Inside the existing editable checkbox `keydown` listener:

- before Enter/Tab/Backspace branches, handle `ArrowUp` only when the caret
  offset is `0`;
- handle `ArrowDown` only when the caret offset equals `readText().length`;
- call `e.preventDefault()` only when a neighbor focus target exists;
- for both directions place the caret at the start of the target row, matching
  the chosen UX direction.

- [ ] **Step 3: Run GREEN for focused checks**

Run:

```bash
node --check desktop-rust/src/tabs/tasks/card.js
cd desktop-rust/src && python3 dev-test.py
```

Expected: JS syntax passes and all smoke tests pass.

### Task 3: Help and Release Metadata

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/help-content.js`
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `FRONTEND_PATTERNS.md`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`

- [ ] **Step 1: Update Tasks help**

Add a short note in the Tasks checkbox keyboard section:

- `ArrowUp` at the start of a checkbox moves to the previous visible checkbox.
- `ArrowDown` at the end of a checkbox moves to the next visible checkbox.

- [ ] **Step 2: Update global Help and release history**

Mention improved checkbox keyboard navigation in the Tasks feature text and add
a new top release-history/changelog section for the frontend OTA tag chosen in
Task 4.

- [ ] **Step 3: Update reusable frontend patterns**

Add a focused `FRONTEND_PATTERNS.md` note for contenteditable list boundary
navigation:

- intercept ArrowUp/ArrowDown only at absolute text boundaries;
- keep native browser movement inside multi-line text;
- derive list neighbors from currently rendered visible DOM rows.

- [ ] **Step 4: Verify release gate files**

Run:

```bash
grep -F "<TAG>" desktop-rust/src/release-history.md
grep -F "Tasks checkbox arrow navigation" desktop-rust/CHANGELOG.md
```

Expected: `desktop-rust/src/release-history.md` mentions the exact release tag
and `desktop-rust/CHANGELOG.md` mentions the change.

### Task 4: Release

**Files:**
- Commit changed frontend/workflow files.

- [ ] **Step 1: Final local verification**

Run:

```bash
node --check desktop-rust/src/tabs/tasks/card.js
node --check desktop-rust/src/tabs/tasks/help-content.js
node --check desktop-rust/src/tabs/help.js
cd desktop-rust/src && python3 dev-test.py
```

Expected: syntax checks pass and smoke tests report all passing.

- [ ] **Step 2: Commit and tag**

Because only `desktop-rust/src/` frontend files and workflow docs change, use a
frontend-only OTA tag. Before editing final release-history text or tagging,
choose the next available tag for the current date:

```bash
git tag --list "f-20260603-*"
wget -qO- https://api.github.com/repos/IgorSterkhov/snippets_helper/tags?per_page=100
```

If no `f-20260603-*` tag exists, use `f-20260603-1`; otherwise increment `N`.
Use the chosen `<TAG>` consistently in release-history, changelog, `git tag`,
and `git push origin`.

```bash
git add .workflow/checkpoints/2026-06-03-tasks-checkbox-arrow-navigation-checkpoint.md
git add .workflow/specs/2026-06-03-tasks-checkbox-arrow-navigation.md
git add .workflow/plans/2026-06-03-tasks-checkbox-arrow-navigation.md
git add desktop-rust/src/tabs/tasks/card.js desktop-rust/src/dev-test.py
git add desktop-rust/src/tabs/tasks/help-content.js desktop-rust/src/tabs/help.js
git add FRONTEND_PATTERNS.md
git add desktop-rust/src/release-history.md desktop-rust/CHANGELOG.md
git commit -m "Improve task checkbox arrow navigation"
git tag <TAG>
git push
git push origin <TAG>
```

- [ ] **Step 3: Monitor CI and verify assets**

Find and monitor the release run for `<TAG>`. Verify the release has
frontend assets and the tag-specific `frontend-version.json` points to the new
frontend build.
