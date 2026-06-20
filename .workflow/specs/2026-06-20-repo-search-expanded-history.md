# Repo Search Expanded Syntax and File History

## Goal

Improve Repo Search expanded file view:

- restore syntax highlighting that regressed after line-based match rendering;
- add per-file commit history inside the expanded file view.

## Confirmed Direction

Use option A:

- Keep the current line-based expanded file renderer because it supports
  matched-line markers, active match state, and local in-file search.
- Restore syntax highlighting inside each line, while keeping search highlights
  over the highlighted code.
- Add a `History` action in the expanded file header next to `Open in editor`,
  `Copy path`, and `Collapse`.
- `History` switches the expanded view from file content to a file-history
  mode with:
  - commit list for this file;
  - date, author, short hash, and commit message;
  - selected commit diff for this file;
  - diff syntax highlighting;
  - `Back to file` action.

## Native Surface

This requires new Tauri commands:

- `repo_search_file_history(repo_path, file_path, limit)`
- `repo_search_file_diff(repo_path, file_path, hash)`

Therefore this must ship as a `v*` native patch release, not as frontend-only
OTA. Because the change adds new Tauri IPC commands, the release is a minor
native release: `v1.14.0`.

## Non-Goals

- No DB/schema changes.
- No sync/API changes.
- No commit editing or checkout.
- No regex search in expanded file.

## Acceptance

- Python/Rust/JS code in expanded file view has syntax coloring again.
- Existing local search line highlights and active-line navigation still work.
- Expanded file header has `History`.
- History view lists commits for the opened file and shows highlighted diffs.
- If history cannot be loaded, the user sees a clear inline error in the
  expanded view.
