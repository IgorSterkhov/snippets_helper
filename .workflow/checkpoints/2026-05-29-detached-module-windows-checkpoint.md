# Checkpoint: Detached Module Windows

Date: 2026-05-29
Repo: `/home/aster/Dev/snippets_helper`
Branch: `main`
Current HEAD: `64e7480 add detached module windows (v1.3.46)`
Current tag: `v1.3.46`

## Current Goal

The desktop task is complete: main sidebar modules can be opened in detached
single-module windows through a right-click menu.

## What Was Done

- Added spec: `.workflow/specs/2026-05-29-desktop-module-detached-windows.md`.
- Added implementation plan: `.workflow/plans/2026-05-29-desktop-module-detached-windows.md`.
- Added native command `open_module_window` in
  `desktop-rust/src-tauri/src/commands/module_windows.rs`.
- Added module allowlist for:
  `shortcuts`, `notes`, `tasks`, `sql`, `superset`, `commits`, `exec`,
  `repo-search`, `vps`, `whisper`.
- Right-clicking a main sidebar module button now shows
  `Open in separate window`.
- Detached windows use stable labels such as `module_tasks`.
- Reopening an already-open detached module window runs
  `show()`, `unminimize()`, then `set_focus()`.
- Standalone frontend mode loads one module without the main sidebar,
  Settings/Help buttons, or status bar.
- Invalid standalone URLs render `Unsupported module window` instead of falling
  back to the normal sidebar shell.
- Detached windows do not update `last_active_tab`.
- Detached windows do not run main-window sync/update/status side effects.
- Frontend OTA reload now covers `main`, `whisper-overlay`, and all open
  `module_*` windows during apply/revert/drop/rollback paths.
- Help, release history, and changelog were updated for `v1.3.46`.

## Review Notes

Reviewer found no blocking issues. Important feedback was applied:

- Existing detached windows now show/unminimize/focus.
- Invalid standalone URLs no longer expose the full sidebar.
- `checkFirstRun()` remains main-window only.
- `last_active_tab` preservation is covered by browser smoke tests.
- Detached `module_*` windows are included in frontend OTA reload.
- Main-only sync/update/status side effects are gated out of standalone windows.

## Verification

Local verification completed before release:

- `cargo check`: passed with existing warnings.
- `cargo test module_windows --lib`: 2/2 passed.
- `node --check main.js`: passed.
- `node --check dev-mock.js`: passed.
- `node --check tabs/help.js`: passed.
- `python3 dev-test.py`: 52/52 passed.
- `git diff --check`: passed.

Release verification:

- GitHub Actions run `26641497194`: completed successfully.
- Release tag: `v1.3.46`.
- Commit: `64e748047789f89ab900dd1669bc98db7dcb0554`.
- Release assets: 8 uploaded assets.
- `frontend-version.json`: `1.3.46-f64e7480`.
- `latest.json`: native `1.3.46`.

## Open Questions

- No known open issue for detached module windows at checkpoint time.
- User still needs to test the real installed app workflow manually:
  right-click a module in the sidebar, open detached window, close/reopen,
  verify duplicate prevention/focus behavior.

## Constraints To Remember

- Current workflow rule: the user does not approve written specs and
  implementation plans by default. Unless the user explicitly asks to review
  them, write the spec/plan, run an additional reviewer agent, apply blocking
  or important feedback, and continue to implementation.
- Do not modify the legacy Python desktop app unless explicitly requested.
- Desktop native changes require full `v*` release, not frontend-only OTA.
- User-facing desktop releases must update:
  - `desktop-rust/src/tabs/help.js`
  - `desktop-rust/src/release-history.md`
  - `desktop-rust/CHANGELOG.md`
- Preserve unrelated worktree changes.
- Use direct inline work if subagents/MCP tools hang.
- `rg` may be unavailable in this environment; use `grep`/`find`.
- Use `wget` for GitHub API/release inspection if `gh` is unavailable.

## Worktree State At Checkpoint

After the release, the working tree had one unrelated untracked checkpoint:

- `.workflow/checkpoints/2026-05-29-whisper-overlay-checkpoint.md`

This file predates the detached module windows checkpoint and was intentionally
not included in the `v1.3.46` feature commit.

## Next Step If Returning Here

If the user reports a bug:

1. Confirm installed native version is `1.3.46`.
2. Confirm frontend version is `1.3.46-f64e7480` or newer.
3. Ask which module was opened and whether the issue occurs in the main window,
   detached window, or both.
4. Check `desktop-rust/src/main.js` standalone mode and
   `desktop-rust/src-tauri/src/commands/module_windows.rs` window creation first.

If no bug is reported, continue with the next product task.
