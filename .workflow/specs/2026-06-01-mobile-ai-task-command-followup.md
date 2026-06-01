# Mobile AI Task Command Follow-Up

## Goal

Fix mobile AI task commands so search is not a dead-end for action requests,
voice recognition mistakes do not create duplicate tasks, and mobile task
details have the same compact/full task mode concept as desktop Tasks.

## Requirements

- `search_tasks` may be a final result only when the user asked for a list or
  search results.
- If the user asked to open/show a task and AI returns only `search_tasks`, the
  mobile dispatcher opens the single matching task or asks for clarification.
- If the user asked to add a checkbox and AI returns only `search_tasks`, the
  mobile dispatcher continues to `add_task_checkbox` when the task match is
  unique.
- If speech recognition drops a preposition and AI returns `create_task` for a
  phrase shaped like “add task <title> checkbox <text>”, the mobile app must not
  silently create a duplicate task when a matching task already exists.
- `add_task_checkbox` remains the command name. Two paths are valid:
  - sequential path: `search_tasks` finds one task, then the app continues with
    `add_task_checkbox(task_uuid, text)`;
  - direct path: the API tool schema also allows a task title/query target so a
    cloud agent can request `add_task_checkbox(task_query, text)` without
    inventing UUIDs.
- Mobile task editor gets an expanded/collapsed task mode:
  - expanded shows the full editor as today;
  - collapsed hides task metadata/notes/links/delete controls and keeps the
    title plus checkboxes visible;
  - a triangle button in the task header, left of the hide-done eye, toggles
    the mode;
  - tasks opened from mobile AI open collapsed by default.

## Non-Goals

- No native Android changes and no APK release for this task.
- No new multi-turn clarification UI beyond existing `needs_clarification`
  command results.
- No changes to desktop task card behavior.
