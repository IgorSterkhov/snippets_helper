# Repo Search Scope, Git Diff Search, and Chip Reorder Spec

Date: 2026-06-04

## Goal

Make the desktop Search module behave predictably when a repository group is
selected: search only that group's active repositories, make the selected group
visually obvious, search Git commits by changed code as well as commit message,
and allow drag-reordering groups and repository chips.

## Current Problems

- Git history search promises "message or code changes", but native search only
  partly satisfies this with `git log -S<query>`. Pickaxe misses cases where the
  query appears in changed patch lines but the number of occurrences does not
  change.
- Search ignores the active group tab. `doSearch()` sends all globally active
  repository names, while Manage already uses `reposForActiveTab() ∩ activeRepos`.
- The active group tab is hard to distinguish from ordinary tabs.
- Groups and repository chips have no persistent manual order.

## Search Scope Rules

- `All`: search every repo whose chip is active.
- User group: search only active repos inside that group.
- `Ungrouped`: search only active repos with no `group_id`.
- Manage keeps the same scope behavior.
- Empty scoped selection must be guarded in the frontend before calling native
  search commands. Passing an empty `repos` array to the existing backend means
  "all repos", so scoped Search must never call native search with an empty
  scoped list.

## Git History Search Rules

- Search commit messages with case-insensitive `git log --grep`.
- Search changed code with case-insensitive diff regex search using
  `git log -G<escaped query> --regexp-ignore-case`.
- Deduplicate commits by hash across message and code searches.
- Keep existing result shape: repo name, commit hash/date/author/message, and
  changed files.
- Preserve `repo_search_commit_diff` behavior for opening patch previews.

## Active Group Visuals

- Active tab should be visibly stronger than the current subtle background:
  use group color for a top accent line, border, and soft glow.
- Add a compact scope badge near the results counter:
  `Scope: All · N repos`, `Scope: GroupName · N repos`, or
  `Scope: Ungrouped · N repos`.
- The badge count reflects active repos in the current scope.

## Drag-Reorder Rules

- Group tabs:
  - `All` is fixed first.
  - `+` is fixed last.
  - `Ungrouped` remains a system tab after user groups.
  - User groups can be reordered by dragging their tab.
  - Order persists in existing `repo_search_groups[].sort_order`.
  - The tab strip renders user groups by `sort_order`, not alphabetically.
- Repository chips:
  - Visible repo chips can be reordered by dragging inside the current chip bar.
  - In `All`, reorder writes the full global repo order.
  - In a user group, reorder only changes order within that group and preserves
    other groups' relative order.
  - In `Ungrouped`, reorder only changes ungrouped repo order and preserves
    grouped repos' relative order.
  - Existing drag-to-group behavior for moving a repo chip onto a group tab is
    preserved. Repo chip dragging uses one combined pointer handler that chooses
    either in-bar reorder or drop-on-group move; do not install a second
    independent pointer DnD handler on the same chips.

## Storage and IPC

- Reuse existing JSON settings:
  - `repo_search_repos`;
  - `repo_search_groups`.
- Add Tauri commands:
  - `reorder_repo_groups(ids: Vec<i64>)`;
  - `reorder_repos(names: Vec<String>)`.
- Commands use `DbState::lock_recover()`.

## Tests

- Rust unit tests cover Git code-change search with `-G` on a temporary git
  repository.
- Rust unit tests cover repo/group reorder persistence in JSON settings.
- Browser smoke tests cover:
  - group tab search sends only scoped active repos;
  - active group has a visible active class/badge;
  - group tab reorder persists order;
  - repo chip reorder persists order;
  - git search mock can return a commit found by code change.

## Release

This changes native Tauri command surface and frontend behavior, so it must ship
as a full minor `v*` desktop release. Bump from `1.6.0` to `1.7.0`.
