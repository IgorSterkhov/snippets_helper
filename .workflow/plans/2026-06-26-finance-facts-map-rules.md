# Finance Facts Map Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Finance Facts month filtering reliable and let users create/apply mapping rules directly from a fact row with terminal-only hierarchical item selection.

**Architecture:** This is a frontend-only change in `desktop-rust/src/tabs/finance.js`. It reuses existing backend commands for mapping facts and rules, adds reusable UI helpers for month picking and tree item selection, and extends the existing browser mock smoke test in `desktop-rust/src/dev-test.py`.

**Tech Stack:** Vanilla JavaScript frontend, existing modal/toast components, Tauri command wrapper, browser mock CDP smoke tests.

---

### Task 1: Failing Smoke Coverage

**Files:**
- Modify: `desktop-rust/src/dev-test.py`

- [x] Add Finance seed data with nested Finance items: one group row and at least two terminal child rows.
- [x] Add a smoke assertion that `Month` filter renders a `.finance-month-picker-trigger`, clicking its field opens `.finance-month-popover`, and choosing `2026-04` filters to the April fact.
- [x] Add a smoke assertion that the Map modal renders `.finance-tree-select`, group rows are marked disabled, terminal child rows are selectable, and clicking `Create rule from fact` opens a rule form prefilled from the fact.
- [x] Add a smoke assertion that confirming the prefilled rule applies it to existing unmapped facts and creates an allocation for the selected terminal item.
- [x] Run `python3 dev-test.py` and verify the new assertions fail before implementation.

### Task 2: Month Picker

**Files:**
- Modify: `desktop-rust/src/tabs/finance.js`

- [x] Replace the month filter's native `input[type="month"]` with a compact custom picker.
- [x] Render a clickable `.finance-month-picker-field` and `.finance-month-picker-trigger`.
- [x] On any field/trigger click, open `.finance-month-popover` with year controls and twelve month buttons.
- [x] Selecting a month writes `state.factsMonth = "YYYY-MM"` and re-renders the Facts table.

### Task 3: Terminal Item Tree Selector

**Files:**
- Modify: `desktop-rust/src/tabs/finance.js`

- [x] Add helpers to flatten all items for a selected plan with depth and terminal/group metadata.
- [x] Add a reusable `.finance-tree-select` control with a hidden value input, trigger button, and popover menu.
- [x] Render group rows as disabled structural rows and terminal rows as clickable options.
- [x] Use the tree selector in fact mapping and mapping-rule creation instead of the flat `appendItemOptions()` dropdown.

### Task 4: Create Rule From Fact

**Files:**
- Modify: `desktop-rust/src/tabs/finance.js`

- [x] Extend `renderRulesModalContent()` and `openFinanceRulesModal()` to accept a seed fact and target selection.
- [x] Prefill bank category, description, MCC, direction, target list, and target item from the seed.
- [x] Pre-check "apply existing" for seeded rules.
- [x] Add a secondary action in `openFactAssignmentModal()` named `Create rule from fact` that opens the seeded rule modal using the currently selected terminal target.
- [x] Keep manual `Save mapping` behavior unchanged.

### Task 5: Verification, Help, Release

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src/release-history.md`

- [x] Run `node --check desktop-rust/src/tabs/finance.js desktop-rust/src/tabs/help.js`.
- [x] Run `python3 -m py_compile desktop-rust/src/dev-test.py`.
- [x] Run `python3 dev-test.py` from `desktop-rust/src`.
- [x] Update Help and release history.
- [ ] Commit and publish a frontend-only `f-*` release if only `desktop-rust/src/` and workflow docs changed.
