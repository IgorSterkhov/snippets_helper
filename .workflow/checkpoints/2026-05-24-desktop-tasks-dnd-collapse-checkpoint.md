# Checkpoint: Desktop Tasks DnD and Collapse Persistence

Date: 2026-05-24
Created at: 2026-05-24T16:17:55Z
Branch/worktree: current folder, `main`
Current git state before this checkpoint: clean, `main...origin/main`
Current HEAD before this checkpoint:

```text
9179c47 (HEAD -> main, tag: f-20260524-4, origin/main) persist task checkbox collapse
```

## User-Verified Status

The user confirmed the latest desktop Tasks fix works in the live desktop app:

> отлично, все работает

This confirmation applies to frontend OTA `f-20260524-4`, which fixes collapsed
checkbox branches expanding after OTA WebView reload.

## Desktop Frontend Releases In This Pass

### `f-20260524-2`

Commit:

```text
c039b12 add pinned task chip reorder
```

User-facing change:

- Pinned task chips in the desktop Tasks tab can be reordered directly in the
  top chip strip by pointer drag.
- Wrapped chip rows use a same-size placeholder and FLIP animation.
- Normal click behavior still opens the task.

Verification:

- `node --check` on changed JS files: passed.
- `cd desktop-rust/src && python3 dev-test.py`: `28/28 passed`.
- `cd desktop-rust/src-tauri && cargo check`: passed with existing warnings.
- GitHub release assets published.
- OTA manifest version: `1.3.29-fc039b12`.

### `f-20260524-3`

Commit:

```text
97e9a74 fix hidden checkbox dnd drop
```

User-facing change:

- Checkbox drag-and-drop now commits to the same visible slot shown by the
  placeholder when completed checklist rows are hidden.
- Hidden completed rows no longer become implicit drop targets or parents.

Regression coverage:

- Added `T15c Tasks checkbox DnD hidden completed context`.
- RED before fix: dragged root checkbox got `parent_id=10`.
- GREEN after fix: regression passes.

Verification:

- `node --check` on changed JS files: passed.
- `cd desktop-rust/src && python3 dev-test.py`: `29/29 passed`.
- `cd desktop-rust/src-tauri && cargo check`: passed with existing warnings.
- GitHub release assets published.
- OTA manifest version: `1.3.29-f97e9a74`.

### `f-20260524-4`

Commit:

```text
9179c47 persist task checkbox collapse
```

Root cause:

- Desktop Tasks checkbox collapse state was stored only in frontend memory:
  `collapsedNodes = new Map()` in `desktop-rust/src/tabs/tasks/card.js`.
- Frontend OTA reloads the WebView, which clears this in-memory state.
- On the next render every `isCollapsed(id)` returned `false`, so previously
  collapsed descendants became visible.

Fix:

- Persist collapsed checkbox IDs locally through existing app settings using
  `tasks_collapsed_checkbox_ids`.
- Load the setting before the first Tasks render.
- Persist after arrow collapse/expand and recursive Ctrl/Cmd-click collapse.
- Keep the state local to the desktop app; it is not server-synced.

Regression coverage:

- Added `T15d Tasks checkbox collapse survives frontend reload`.
- RED before fix: child row became visible after `Page.reload`.
- GREEN after fix: child row remains hidden after reload.

Verification:

- `node --check` on changed JS files: passed.
- `python3 -m py_compile desktop-rust/src/dev-test.py`: passed.
- `cd desktop-rust/src && python3 dev-test.py`: `30/30 passed`.
- `cd desktop-rust/src-tauri && cargo check`: passed with existing warnings.
- GitHub release assets published.
- OTA manifest version: `1.3.29-f9179c47`.

## Release History and Help Updates

These changes are user-facing behavior changes, so they are not considered too
minor for release history.

Updated files:

- `desktop-rust/src/release-history.md`
  - sections added for `f-20260524-2`, `f-20260524-3`, `f-20260524-4`.
- `desktop-rust/CHANGELOG.md`
  - same release sections added.
- `desktop-rust/src/tabs/help.js`
  - Tasks feature description updated in English and Russian.
- `desktop-rust/src/tabs/tasks/help-content.js`
  - Tasks help updated for hidden-completed DnD and persisted collapsed
    checklist branches.
- `FRONTEND_PATTERNS.md`
  - DnD hidden-row commit guidance added.
  - Persisted local UI state pattern added.

## Current Working Notes

- `gh` is not installed in this environment; release verification was done with
  GitHub API and direct `wget` checks.
- A raw `git ls-remote` without the explicit `GIT_SSH_COMMAND` can fail because
  of local `/etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf` permissions. Pushes
  work using the approved explicit SSH command pattern.
- `dev-test.py` may print a non-fatal `rm: cannot remove .../Default` warning
  while cleaning temporary Chrome profiles. The test exit code was still 0 and
  the suite reported all tests passed.
