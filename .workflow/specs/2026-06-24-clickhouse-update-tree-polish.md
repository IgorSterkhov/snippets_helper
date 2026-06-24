# ClickHouse Update Control and Tree Polish Spec

## Goal

Polish the desktop ClickHouse docs module after the Reference Console release.
The module should keep the compact console layout, but remove the persistent
full-width update status strip, make documentation navigation genuinely
hierarchical, and make the update history action easier to understand.

## Scope

- Desktop frontend only.
- Primary file: `desktop-rust/src/tabs/clickhouse-docs.js`.
- Supporting files:
  - `desktop-rust/src/dev-test.py`
  - `desktop-rust/src/tabs/help.js`
  - `desktop-rust/src/release-history.md`
  - `desktop-rust/CHANGELOG.md`
- Preserve existing Tauri command names and payloads.
- Release as a frontend-only `f-*` tag.

## Requirements

1. Update status:
   - Remove the persistent `.ch-update-progress` strip from the page flow.
   - Merge the update action and its last status into one header control.
   - During refresh, the same control shows progress percent and current/total
     source pages.
   - After refresh, the same control shows the last update time.
   - Details of the last update are hidden by default and shown in a compact
     popover opened from the same update control.

2. Left navigation:
   - Render category paths such as `Functions / Arrays` as a nested tree.
   - Branch rows are collapsible.
   - Page and section rows stay left-aligned; hierarchy is shown by indentation,
     not centered terminal text.
   - Active page/section remains highlighted with the ClickHouse yellow rail.
   - Large page lazy-loading behavior stays unchanged.

3. Changelog naming:
   - Rename the visible `Changelog` action to `Update log`.
   - Modal copy should refer to docs update history rather than app changelog.

## Non-Goals

- No backend schema changes.
- No new Tauri commands.
- No changes to ClickHouse parser/indexer behavior.
