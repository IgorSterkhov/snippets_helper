# Tasks Checkbox Arrow Navigation Spec

Date: 2026-06-03

## Goal

Make checkbox text editing in the desktop Tasks module behave like a standard
multi-line editor at list boundaries: when the caret cannot move farther inside
the current checkbox text, ArrowUp/ArrowDown should move focus to the adjacent
visible checkbox.

## User Behavior

- Normal text editing remains browser-native:
  - Left/Right move within text.
  - Up/Down move between visual lines inside the same multi-line checkbox.
  - If the caret is not at the relevant absolute boundary, the app does not
    intercept ArrowUp/ArrowDown.
- If a focused checkbox text has the caret at the start of its text and the
  user presses ArrowUp:
  - focus moves to the previous visible checkbox in the same rendered checklist;
  - the caret is placed at the start of that previous checkbox text.
- If a focused checkbox text has the caret at the end of its text and the user
  presses ArrowDown:
  - focus moves to the next visible checkbox in the same rendered checklist;
  - the caret is placed at the start of that next checkbox text.
- If there is no previous or next visible checkbox, the key press is left as a
  no-op beyond the browser's normal boundary behavior.

## Visibility Rules

Navigation targets are the currently rendered `.tcb-item` rows in the same
checkbox list container. This means hidden completed rows, collapsed descendants,
and rows absent because of filtering are not focus targets.

## Scope

In scope:

- Desktop Tasks frontend only.
- Editable checkbox text rows rendered by `desktop-rust/src/tabs/tasks/card.js`.
- Browser smoke coverage in `desktop-rust/src/dev-test.py`.
- Reusable frontend pattern note in `FRONTEND_PATTERNS.md`.
- Help/release-history/changelog updates for the user-facing behavior.

Out of scope:

- Mobile Tasks keyboard behavior.
- Data model, sync, Rust/Tauri command changes.
- Preserving visual X-column across rows.
- Navigating into hidden rows.
