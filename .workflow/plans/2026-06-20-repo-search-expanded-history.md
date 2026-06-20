# Repo Search Expanded Syntax and File History Plan

1. Inspect current Repo Search frontend and Rust command patterns for git
   history/diff execution.
2. Add Rust structs and commands:
   - `repo_search_file_history(repo_path, file_path, limit)` runs
     `git log --follow --name-status --date=iso-strict --format=... -- <relative path>`;
   - `repo_search_file_diff(repo_path, file_path, hash)` runs
     `git show --format= --find-renames -- <relative path>` for one commit.
   Resolve `file_path` to a repo-relative path when it is absolute, validate
   that the file is inside `repo_path`, and cap history limit. History entries
   carry the path valid for that commit so pre-rename commits can load diffs.
3. Register new Tauri commands in `lib.rs` and add mocks in `dev-mock.js`.
4. Restore syntax highlighting in the expanded line renderer:
   - highlight each line with highlight.js to avoid splitting cross-line HTML
     spans;
   - overlay search match marks by walking text nodes inside the highlighted
     DOM so syntax spans and search marks can coexist.
5. Add expanded file history UI:
   - header `History` / `Back to file`;
   - split view with commit list and diff preview;
   - selected commit state and loading/error states;
   - diff rendered with highlight.js.
6. Extend browser smoke test for:
   - syntax span presence in expanded Python sample;
   - History button;
   - history list render;
   - diff render and highlighted diff content;
   - Back to file.
7. Add Rust unit tests for repo-relative path resolution and git-log parsing
   helpers where practical.
8. Update Help, module help, release history, changelog, and version files for
   `v1.14.0`.
9. Run `node --check`, `python3 dev-test.py`, `cargo check`,
   `git diff --check`.
10. Commit, tag `v1.14.0`, push, monitor CI, and verify release assets.
