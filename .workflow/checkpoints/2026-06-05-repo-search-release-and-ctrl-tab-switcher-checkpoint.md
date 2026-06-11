# Checkpoint: Repo Search v1.7.0 Release, Next Ctrl+Tab Switcher

Date: 2026-06-05
Branch: `main`
Latest commit: `c04ccda Improve repo search scope and ordering`
Latest release tag: `v1.7.0`

## Current Goal

The previous Repo Search task is complete and released. The next requested
task is a desktop-app Ctrl+Tab switcher for recently opened views/objects.

## What Was Resolved

- Repo Search Git history search now checks both commit messages and changed
  patch lines.
- Repo Search group selection now scopes searches to active repositories inside
  the selected group instead of leaking to all active repositories.
- Repo Search shows a scope badge and clearer active group tab styling.
- Repo Search group tabs and repository chips can be reordered with persistent
  drag-and-drop order.
- Help, `desktop-rust/src/release-history.md`, and
  `desktop-rust/CHANGELOG.md` were updated for the user-facing release.
- Desktop release `v1.7.0` was published successfully:
  - Actions run: `26952838766`
  - Release URL:
    `https://github.com/IgorSterkhov/snippets_helper/releases/tag/v1.7.0`

## Verification Already Run

- `cargo test repo_search --lib`: 13/13 passed.
- `cargo check`: passed with existing warnings.
- `node --check desktop-rust/src/tabs/repo-search.js desktop-rust/src/dev-mock.js desktop-rust/src/tabs/help.js`: passed.
- `python3 dev-test.py`: 63/63 passed.
- GitHub Actions `Release Desktop (Rust)` for `v1.7.0`: completed with
  `success`.

## Current Working Tree Notes

After the `v1.7.0` commit/release, the repository still has unrelated dirty
files in many `desktop-rust/src-tauri/src/**` modules and an untracked older
checkpoint file:

- `.workflow/checkpoints/2026-05-29-whisper-overlay-checkpoint.md`

These were pre-existing/unrelated and must not be reverted or included in the
next task unless the user explicitly asks.

## Next Task: Ctrl+Tab Recent View Switcher

Requested behavior:

- Add desktop Ctrl+Tab switching between recently opened objects/views.
- Example: open snippet `bash_vps`, then task `сделай vps`, then note
  `как сделать vps`; Ctrl+Tab should show the note first, then the task, then
  the snippet.
- The switcher modal should show a horizontal sequence of icons and labels.
- Each item icon represents object/module type: snippet, task, note, etc.
- Each label is the opened object title/name.
- Ordering is most recent on the left, decreasing recency to the right.
- While the modal is open:
  - `Tab` moves selection forward.
  - `Shift+Tab` moves selection backward.
  - `Enter` opens the selected object/view.

## Main Design Questions To Resolve

- Scope of tracked entries: object-level only, module-level fallback, or both.
- Whether plain Ctrl+Tab should immediately switch to the previous item on
  key release, or always require Enter after the modal opens.
- Maximum number of recent entries shown.
- Whether recent history persists across app restart or is session-only.
- How to handle duplicate opens of the same object: move existing item to the
  front, or keep multiple historical entries.
- What APIs/helpers already exist to navigate directly to a specific snippet,
  note, task, or other module item.

## Important Constraints

- Before implementation, do preliminary design discussion with the user; do
  not skip directly to code.
- New specs go in `.workflow/specs/`.
- New plans go in `.workflow/plans/`.
- Do not ask for final written spec/plan approval unless explicitly requested;
  instead run an additional reviewer agent for spec/plan when possible.
- For desktop changes, continue to follow:
  - `CLAUDE.md`
  - `FRONTEND_PATTERNS.md`
  - `desktop-rust/RELEASES.md`
- If the implementation adds/changes Tauri commands, this becomes a native
  `v*` release. If it is frontend-only and uses existing APIs, it can be an
  `f-*` OTA release.
- For user-facing desktop releases, update:
  - `desktop-rust/src/tabs/help.js`
  - `desktop-rust/src/release-history.md`
  - `desktop-rust/CHANGELOG.md`

## Next Step On Return

Start with preliminary design discussion for the Ctrl+Tab switcher. Because the
feature is visual, offer visual companion/mockups if useful, then agree on:

1. recent-entry scope;
2. exact keyboard behavior;
3. supported modules for first implementation;
4. persistence/session behavior;
5. navigation integration points.

Only after the user confirms the direction, write the spec and implementation
plan, run reviewer, then implement.
