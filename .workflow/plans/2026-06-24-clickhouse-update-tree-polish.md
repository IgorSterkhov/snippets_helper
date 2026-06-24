# ClickHouse Update Control and Tree Polish Plan

## Goal

Implement the approved UI polish for the ClickHouse docs module:
merged update control, hidden update details popover, hierarchical left tree,
and clearer `Update log` naming.

## Steps

1. Add RED smoke coverage in `desktop-rust/src/dev-test.py`.
   - Assert `.ch-update-control` exists.
   - Assert no visible `.ch-update-progress` strip remains after update.
   - Assert the merged update control contains `Update docs` and last-update
     status after update.
   - Assert the merged control is one visual object with two zones:
     `[data-action="update"]` starts the refresh and
     `[data-action="update-details"]` opens details inside the same control.
   - Assert running progress renders percent and current/total source pages
     inside the merged control.
   - Assert update details contain the update summary.
   - Assert nav uses `.ch-nav-tree`, branch rows, depth-marked page/section
     rows, and `Update log` opens the update history modal.
   - Assert branch rows collapse and expand descendants, and opening a result
     auto-expands its ancestors.

2. Implement `desktop-rust/src/tabs/clickhouse-docs.js`.
   - Replace the standalone update strip with a header update control and
     hidden popover.
   - Keep `Run update` and `Show details` as segmented zones inside one visual
     `.ch-update-control`, not as separate adjacent buttons.
   - Refactor update rendering into control + details popover helpers.
   - Build a nested navigation tree from slash-separated categories.
   - Add branch expand/collapse state and keep active page ancestors expanded.
   - Rename visible changelog copy to `Update log`.

3. Update Help and release history.
   - Mention the merged update control and hierarchical docs tree in
     `desktop-rust/src/tabs/help.js`.
   - Add `f-20260624-N` entries to `desktop-rust/src/release-history.md` and
     `desktop-rust/CHANGELOG.md`.

4. Verify.
   - `node --check desktop-rust/src/tabs/clickhouse-docs.js`
   - `node --check desktop-rust/src/tabs/help.js`
   - `python3 -m py_compile desktop-rust/src/dev-test.py`
   - `grep -F "<TAG>" desktop-rust/src/release-history.md`
   - `cd desktop-rust/src-tauri && cargo check`
   - `cd desktop-rust/src && python3 dev-test.py`
   - `git diff --check`

5. Commit and release.
   - Commit with a short one-line message.
   - Use the next `f-20260624-N` tag.
   - Push main and tag, monitor GitHub Actions, verify three frontend assets
     and `frontend-version.json`.
