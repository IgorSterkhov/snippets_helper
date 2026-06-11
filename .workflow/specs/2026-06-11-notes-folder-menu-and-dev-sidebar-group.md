# Notes Folder Menu and DEV Sidebar Group

## Goal

Reduce visual noise in the Notes folder tree and group developer-oriented
modules in the main sidebar.

## Product Decisions

- In Notes, remove inline folder action buttons from each folder row.
- Keep the folder row drag grip, disclosure arrow, icon, and folder name.
- Move folder actions to a right-click context menu on each folder row:
  - `Add sub-folder`;
  - `Rename`;
  - `Delete`.
- Keep the `+` button in the `Folders` header for creating root folders.
- Add a static main-sidebar group named `DEV`.
- The `DEV` group contains:
  - SQL;
  - Superset;
  - Commits;
  - Search.
- The sidebar normally shows the `DEV` group button instead of showing those
  modules as top-level buttons.
- Clicking `DEV` expands or collapses its children.
- If one of the grouped modules is active in the main window, `DEV` stays
  expanded and the active child is highlighted.
- If the user switches to a non-DEV module, `DEV` collapses.
- If Ctrl+Tab or another programmatic navigation activates a DEV child, the
  group expands automatically.
- Detached module windows do not keep the main sidebar group expanded.

## UX

- Use a compact code-like `</>` icon for the `DEV` group.
- Child module buttons remain clickable and keep their existing labels/icons.
- Child buttons should look lightly nested with a subtle guide/indent, not a
  heavy secondary sidebar.
- Expansion/collapse should be soft and not shift unrelated sidebar controls
  unpredictably.

## Technical Scope

- Frontend-only desktop change.
- Do not add or change Tauri commands.
- Implement sidebar grouping through local tab metadata so future configurable
  groups can reuse the same rendering path.
- Preserve `TabContainer.buttons[tabId]`, tab panel ids, existing tab activation,
  right-click detached-window behavior, and test selectors such as
  `.tab-btn[data-tab-id="repo-search"]`.

## Release Impact

Ship as an `f-*` desktop OTA release after Help/release history updates.
