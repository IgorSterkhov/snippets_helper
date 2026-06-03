# Checkpoint: Tasks Checkbox Arrow Navigation

Date: 2026-06-03

## Current State

- Repository: `/home/aster/Dev/snippets_helper`
- Branch: `main`
- HEAD: `5cdb3c4 Expose Yandex SpeechKit settings (v1.5.2)`
- Latest release tag: `v1.5.2`
- Desktop native version: `1.5.2`
- Working tree before this checkpoint had one unrelated untracked file:
  `.workflow/checkpoints/2026-05-29-whisper-overlay-checkpoint.md`

## What Was Just Completed

- Yandex SpeechKit settings were exposed in the Whisper module.
- Release `v1.5.2` was published and verified:
  - GitHub Actions release run completed successfully.
  - `frontend-version.json` reports `1.5.2-f5cdb3c4`.
  - `latest.json` reports native `1.5.2`.
  - Local checks passed: Yandex Rust tests, JS syntax checks, and desktop smoke tests.

## New Task

Improve Tasks checkbox keyboard navigation in the desktop app.

Requested behavior:

- While editing a checkbox text, normal text navigation should remain unchanged:
  left/right move inside text; up/down move between visual lines inside the same
  multiline checkbox.
- If the caret is at the start of a checkbox text and the user presses ArrowUp,
  focus should move to the previous visible checkbox.
- If the caret is at the end of a checkbox text and the user presses ArrowDown,
  focus should move to the next visible checkbox and place the caret at the
  start of that checkbox text.
- Navigation must use the visible checkbox order, so hidden completed rows,
  collapsed descendants, and filtered-out rows must not become focus targets.

## Current Working Plan

1. Inspect the existing Tasks checkbox editor and keyboard handlers.
2. Add a focused frontend behavior spec in `.workflow/specs`.
3. Add an implementation plan in `.workflow/plans`.
4. Add/extend desktop browser smoke coverage for boundary ArrowUp/ArrowDown.
5. Implement the narrow frontend-only behavior.
6. Run `node --check` for changed JS and `python3 dev-test.py`.
7. Because this is a user-facing frontend-only behavior change, update release
   history/help if needed and publish an `f-*` OTA release after verification.

## Open Design Points

- When ArrowUp moves to the previous visible checkbox, likely caret placement
  should be at the end of the previous checkbox text. This should be confirmed
  before implementation.
- If the current checkbox is the first visible checkbox, ArrowUp at text start
  should do nothing.
- If the current checkbox is the last visible checkbox, ArrowDown at text end
  should do nothing.

## Important Constraints

- Do not modify the legacy Python desktop app.
- Desktop frontend code lives under `desktop-rust/src/`.
- Before desktop release, follow `desktop-rust/RELEASES.md`.
- Do not revert unrelated changes.
- Use visible checkbox DOM/order for navigation; do not navigate into hidden
  completed rows or collapsed descendants.
- Preserve native text editing behavior except at the explicit start/end
  boundary conditions.
- User does not want to approve formal spec/plan documents, but preliminary
  product/design discussion is still required.

## Next Step On Return

Continue with the Tasks implementation by inspecting the current checkbox
editing/navigation code, then present a short design and any remaining
clarifying question before editing behavior.
