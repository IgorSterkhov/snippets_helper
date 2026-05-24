# Desktop Pinned Task Chip Drag-Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pointer-based drag reorder for pinned task chips in the desktop Tasks tab.

**Architecture:** Extend `desktop-rust/src/tabs/tasks/dnd.js` with a third drag kind, `pinned-chip`, while keeping the existing card and checkbox flows intact. `dropdown.js` marks chips as draggable sources, and `index.js` commits the reordered pinned ids through the existing `reorder_tasks` command.

**Tech Stack:** Vanilla JavaScript, Pointer Events, existing Tauri frontend API wrapper, browser mock smoke tests.

---

### Task 1: Add Smoke Test

**Files:**
- Modify: `desktop-rust/src/dev-test.py`

- [x] Add a test after T15 that opens Tasks, drags the last pinned chip before the first pinned chip, verifies the chip order changes, then clicks the first chip to verify click still opens the task.
- [x] Run:
  ```bash
  cd desktop-rust/src && python3 dev-test.py
  ```
  Expected: FAIL because pinned chips are not draggable yet.

### Task 2: Mark Pinned Chips As Drag Sources

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/dropdown.js`

- [x] Add `chip.dataset.taskId = String(task.id)`.
- [x] Add `chip.dataset.dragKind = 'pinned-chip'`.
- [x] Add click suppression for the post-drag click by checking `chip.dataset.dragSuppressClick === '1'`.
- [x] Run:
  ```bash
  node --check desktop-rust/src/tabs/tasks/dropdown.js
  ```

### Task 3: Extend Tasks DnD Layer

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/dnd.js`

- [x] Accept `pinned-chip` in `installTaskDnd`.
- [x] Start pinned-chip drag only after a 5px movement threshold.
- [x] Reuse ghost creation and cleanup for the pinned chip source.
- [x] Use a same-size placeholder instead of the source slot.
- [x] Add flex-wrap placeholder positioning:
  - track chip and placeholder rects;
  - group by row using `top`;
  - compare `clientX` with row item midpoints;
  - insert placeholder before the computed chip or at end.
- [x] Animate placeholder movement with FLIP for X/Y deltas.
- [x] On pointerup inside `#tasks-pinned`, derive pinned ids from DOM order and call `onPinnedReorderCommit(ids)`.
- [x] On pointerup outside the strip, cancel without committing.
- [x] Run:
  ```bash
  node --check desktop-rust/src/tabs/tasks/dnd.js
  ```

### Task 4: Commit Reordered Pinned IDs

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/index.js`
- Modify: `desktop-rust/src/tabs/tasks/dnd.js`
- Modify: `desktop-rust/src/dev-mock.js`

- [x] Add `onPinnedReorderCommit` when installing DnD.
- [x] Implement `commitPinnedChipReorder(state, orderedPinnedIds)`:
  - use `state.tasks.map(t => t.id)` for visible task order;
  - remove pinned ids from that list;
  - call `reorder_tasks` with pinned ids first and remaining visible ids after them.
- [x] Ensure `dev-mock.js` has `reorder_tasks` behavior if missing.
- [x] Reload tasks after commit.
- [x] Run:
  ```bash
  node --check desktop-rust/src/tabs/tasks/index.js
  node --check desktop-rust/src/dev-mock.js
  ```

### Task 5: Docs, Verification, Release

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/help-content.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `FRONTEND_PATTERNS.md` if the chip-specific flex-wrap DnD details are worth preserving.

- [x] Update Tasks help to mention pinned chip drag reorder.
- [x] Add release-history entry for the chosen `f-*` tag.
- [x] Add changelog entry.
- [x] Run:
  ```bash
  node --check desktop-rust/src/tabs/tasks/dropdown.js
  node --check desktop-rust/src/tabs/tasks/dnd.js
  node --check desktop-rust/src/tabs/tasks/index.js
  cd desktop-rust/src && python3 dev-test.py
  ```
- [ ] Commit, tag a frontend OTA, push, monitor CI, and verify release assets.
