# Desktop Tasks Checkbox Collapse Persistence

**Date:** 2026-05-24
**Status:** approved
**Scope:** `desktop-rust/src/tabs/tasks/`

## Problem

Checkbox collapse state in desktop Tasks is kept only in frontend memory.
After a frontend OTA update applies, the WebView reloads and all previously
collapsed checkbox parents expand again.

## Requirement

- Persist collapsed task checkbox IDs in the existing app settings storage.
- Restore collapsed IDs before rendering Tasks after launch, tab init, or OTA
  WebView reload.
- Keep the state local to the desktop app; do not sync it to the server.
- Collapse/expand from both the arrow and recursive Ctrl/Cmd-click flow should
  update the persisted state.
- If a persisted checkbox ID no longer exists, it may be ignored.

## Acceptance Test

Browser mock regression:

1. Seed a task with a parent checkbox and child checkbox.
2. Collapse the parent and verify the child is hidden.
3. Reload the page to simulate frontend OTA WebView reload.
4. Reopen the task and verify the child remains hidden.
