# Repo Search Scope, Git Diff Search, and Chip Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Search group scoping and Git code-change matching, then add persistent drag-reorder for Search group tabs and repository chips.

**Architecture:** Keep repo/group data in the existing JSON settings and add narrow reorder commands that rewrite item order without changing ownership/group assignment. Frontend Search uses one helper for current scoped active repos, applies a stronger active group visual state, and reuses the existing wrapped-chip DnD helper where possible.

**Tech Stack:** Rust/Tauri commands, SQLite app settings JSON, vanilla JavaScript frontend, existing `installWrappedChipDnd`, CDP browser smoke tests.

---

### Task 1: RED Tests for Backend Search and Reorder

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/repo_search.rs`

- [ ] Add Rust tests in the existing `#[cfg(test)]` module for:
  - `search_git_in_repo` finds a commit where the query appears in changed code
    but not in the commit message, and the query occurrence count is unchanged
    so old `git log -S` would miss it.
  - `reorder_groups_in_place` updates `sort_order` for known ids and leaves missing ids after known ids.
  - `reorder_repos_in_place` orders known repo names first and keeps unmentioned repos after them.
  - `reorder_repo_groups_for_test` / `reorder_repos_for_test` persist JSON
    setting order through the same load/save helpers used by commands.
- [ ] Run:

```bash
cd desktop-rust/src-tauri && cargo test repo_search --lib
```

Expected before implementation: at least the Git code-change and reorder helper tests fail because helpers/behavior are missing.

### Task 2: Backend Implementation

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/repo_search.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`

- [ ] Replace/augment code-change Git search with `git log -G<escaped query> --regexp-ignore-case`.
- [ ] Add pure helper functions:
  - `reorder_groups_in_place(groups: &mut Vec<RepoGroup>, ids: &[i64])`;
  - `reorder_repos_in_place(repos: &mut Vec<RepoEntry>, names: &[String])`.
- [ ] Add Tauri commands:
  - `reorder_repo_groups(state: State<DbState>, ids: Vec<i64>) -> Result<(), String>`;
  - `reorder_repos(state: State<DbState>, names: Vec<String>) -> Result<(), String>`.
- [ ] Register both commands in `desktop-rust/src-tauri/src/lib.rs`.
- [ ] Run:

```bash
cd desktop-rust/src-tauri && cargo test repo_search --lib
```

Expected: repo_search tests pass.

### Task 3: RED Browser Smoke Tests

**Files:**
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] Extend the repo-search mock to record the last `repos` argument for
  `search_filenames`, `search_content`, and `search_git_history`.
- [ ] Add mock commands `reorder_repo_groups` and `reorder_repos`.
- [ ] Add smoke tests for:
  - selecting a group then searching sends only active repo names in that group;
  - active group tab has the visible active marker and scope badge;
  - calling reorder commands changes returned group/repo order.
- [ ] Run:

```bash
cd desktop-rust/src && python3 dev-test.py
```

Expected before frontend implementation: the group scoped search / active visual tests fail.

### Task 4: Frontend Scope and Visuals

**Files:**
- Modify: `desktop-rust/src/tabs/repo-search.js`

- [ ] Add helpers:
  - `scopedActiveRepos()`;
  - `scopeLabel()`;
  - `updateScopeBadge()`.
- [ ] Change `doSearch()` to pass `scopedActiveRepos().map(r => r.name)`.
- [ ] If `scopedActiveRepos()` is empty, render `No active repos in this scope`
  and do not call native search commands.
- [ ] Render a scope badge in the sort bar beside `#rs-count`.
- [ ] Strengthen `.rs-tab.active` styling with group color CSS variables.
- [ ] Render user group tabs by `sort_order` and ensure tab click rerenders
  chips and scope badge.

### Task 5: Frontend DnD

**Files:**
- Modify: `desktop-rust/src/tabs/repo-search.js`

- [ ] Import `installWrappedChipDnd`.
- [ ] Use one custom repo-chip pointer DnD handler that preserves existing
  drag-to-group behavior and also supports in-bar reordering with a same-size
  placeholder. Do not add a second pointer handler for repo chips.
- [ ] Install wrapped-chip DnD on group tab strip for user groups only:
  - group tabs get `data-group-id`;
  - reorder sends user group ids to `reorder_repo_groups`.

### Task 6: Help, Release Metadata, and Verification

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock`

- [ ] Bump native version to `1.7.0`.
- [ ] Update Help in EN/RU to mention group-scoped Search, stronger scope badge,
  Git code-change search, and drag-reordering groups/repos.
- [ ] Add `v1.6.1 (2026-06-04)` to `CHANGELOG.md` and
  `desktop-rust/src/release-history.md`.
- [ ] Run:

```bash
node --check desktop-rust/src/tabs/repo-search.js
node --check desktop-rust/src/dev-mock.js
python3 -m py_compile desktop-rust/src/dev-test.py
cd desktop-rust/src-tauri && cargo check
cd ../src && python3 dev-test.py
```

Expected: all checks pass.
