# Launchpad Add Drill-down

## Goal

Improve Micro Launchpad editing so `Add item` can add either a whole module or
a specific object inside a module.

## Behavior

- The first Add screen lists modules.
- Each module row has `Add module`.
- Modules with object collections also have `Browse`.
- `Browse` opens a second screen with Back, module title, local search, and
  objects from that module.
- Supported object modules:
  - Snippets
  - Notes
  - Tasks
  - Exec commands
  - Finance lists
- Selecting an object adds that object tile to Launchpad.
- Finance object tiles open the Finance detached module focused on the selected
  finance list.

## Release

Frontend-only. Use an `f-*` release after verification.
