# Tasks Collapsed Links Spec

## Current Goal

Improve compact Tasks cards by optionally showing task links above collapsed checkbox lists, and fix checkbox indent behavior when the new parent is collapsed.

## Decisions

- The collapsed links option is a module-level Tasks setting, not per task.
- The default state is off, preserving the current compact collapsed-card behavior.
- The visual treatment is the selected "Soft shelf" design: a subtle panel above visible checkboxes inside collapsed cards.
- Link chips use a configurable marker. Default marker is `◈` (Diamond resource).
- Tasks Settings exposes all marker choices from the visual review: `⛓`, `⇱`, `⌘`, `◈`, `⌁`.
- Tasks Settings exposes a color picker for collapsed link chips.
- The shelf is rendered only when the module setting is enabled and the task has links.
- Clicking a link chip opens the URL in the browser.
- Link chips can be reordered by drag-and-drop inside the shelf using existing `reorder_task_links`.
- If a checkbox is indented with `Tab` under a collapsed previous sibling, that new parent is expanded before reload so the indented checkbox remains visible.

## User-Visible Result

- Tasks Settings controls compact-card link behavior globally for the module.
- Collapsed task cards can show a distinct link shelf above checkboxes.
- Link chips are visually different from top pinned task chips.
- Indenting a checkbox no longer makes it appear to disappear under a collapsed parent.

## Release

This should be frontend-only if no new Tauri command is needed, so release as an `f-*` desktop OTA.
