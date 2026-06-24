# Exec Local Copy Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add destination folder picking to copy templates and add a new local
copy template for multi-file host copy commands.

**Architecture:** Keep all behavior in `desktop-rust/src/tabs/exec-templates.js`.
Add small reusable helpers for native folder picking and destination path input
rows, then reuse the existing source-list component. No Rust changes.

**Tech Stack:** Vanilla JavaScript frontend, existing `showModal`, existing
Tauri dialog plugin exposed as `window.__TAURI__.dialog.open`, browser mock
smoke tests in `desktop-rust/src/dev-test.py`.

---

### Task 1: RED Tests

**Files:**
- Modify: `desktop-rust/src/dev-test.py`
- Existing mock support: `desktop-rust/src/dev-mock.js`

- [ ] Add smoke coverage for `SCP` destination folder picker:
  - open `New Command`;
  - open `Use template`;
  - choose `SCP`;
  - set destination host to `Local`;
  - mock dialog result for `directory: true`;
  - click `#scp-pick-dst-folder`;
  - assert `#scp-dst-path` receives the selected folder.

- [ ] Add smoke coverage for `rsync` destination folder picker:
  - open `Use template`;
  - choose `rsync`;
  - set destination host to `Local`;
  - mock dialog result for `directory: true`;
  - click `#rs-pick-dst-folder`;
  - assert `#rs-dst-path` receives the selected folder.

- [ ] Add smoke coverage for `Local copy`:
  - open `Use template`;
  - choose `Local copy`;
  - select two source files through picker;
  - select destination folder through picker;
  - choose `Windows PowerShell`;
  - confirm;
  - assert the command textarea contains `powershell`, `Copy-Item`, both files,
    destination folder, and quoted path with spaces.

- [ ] Ensure the browser mock can return different results for consecutive
  picker calls, either through a function keyed by `options.directory` or an
  explicit queue.

### Task 2: Template Helpers

**Files:**
- Modify: `desktop-rust/src/tabs/exec-templates.js`

- [ ] Add `pickLocalFolder()` using `window.__TAURI__.dialog.open` with
  `{ multiple: false, directory: true }`.
- [ ] Add `createDestinationPath()` helper that renders a path input, `Choose
  folder...` button, and inline message area.
- [ ] For remote destinations, `createDestinationPath()` must not open the
  native picker and must show a clear inline message. It must inspect the
  current destination host at click time.

### Task 3: Apply To Existing Templates

**Files:**
- Modify: `desktop-rust/src/tabs/exec-templates.js`

- [ ] Replace the plain `scp` destination input with `createDestinationPath()`
  while preserving `#scp-dst-path`.
- [ ] Replace the plain `rsync` destination input with `createDestinationPath()`
  while preserving `#rs-dst-path`.
- [ ] Keep all existing `scp` and `rsync` validation and command generation.

### Task 4: Local Copy Template

**Files:**
- Modify: `desktop-rust/src/tabs/exec-templates.js`

- [ ] Add `Local copy` to the template picker.
- [ ] Add `buildLocalCopyTemplate()` with source list, destination folder, and
  target shell selector.
- [ ] Generate Windows PowerShell and POSIX `cp` commands with safe quoting.
- [ ] Use a dedicated PowerShell single-quoted literal helper that doubles
  embedded `'` characters; do not reuse POSIX `shellQuote` inside PowerShell.

### Task 5: Help, Release Notes, Verification

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`

- [ ] Document destination folder picking and `Local copy`.
- [ ] Add `f-20260624-5` release notes.
- [ ] Run `node --check` for changed JS files.
- [ ] Run `python3 -m py_compile desktop-rust/src/dev-test.py`.
- [ ] Run `python3 dev-test.py` from `desktop-rust/src`.
- [ ] Run `git diff --check`.
