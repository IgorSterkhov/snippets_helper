# VPS Detailed Analysis — Design Spec

**Date:** 2026-05-06
**Status:** approved for implementation planning
**Scope:** `desktop-rust/src/tabs/vps.js`, `desktop-rust/src/dev-mock.js`, `desktop-rust/src-tauri/src/commands/vps.rs`, `desktop-rust/src-tauri/src/lib.rs`, help/changelog if released

---

## 1. Goal

Add an explicit detailed analysis modal to the VPS module. The modal helps
diagnose disk usage by directory structure and memory usage by process without
making normal VPS tile refresh heavier.

The analysis runs only when the user asks for it.

---

## 2. User Flow

1. User opens the VPS tab.
2. User clicks a new `Detailed analysis` action on a server tile or in the tile
   context menu.
3. App opens a modal and starts an SSH analysis for that server.
4. Modal shows loading, success, or error state.
5. On success, user can switch between:
   - `Disk`
   - `Processes`
   - `Raw`
6. User can refresh the analysis manually from the modal.
7. Closing the modal does not affect cached tile stats.

Out of scope for first version:

- automatic detailed analysis during tile expand
- automatic detailed analysis during auto-refresh
- user-configurable depth/top-N controls
- full unbounded disk scan

---

## 3. Data Collection

Add a new Tauri command, `vps_get_detailed_analysis`, separate from the existing
`vps_get_stats`.

The command connects via the same SSH helper as current VPS stats and gathers:

```bash
df -h /
du -xhd 3 / | sort -hr | head -40
ps -eo pid,comm,args,rss,%mem --sort=-rss | head -40
uptime
hostname
```

Defaults are fixed in first version:

- disk depth: `3`
- disk item limit: `40`
- process item limit: `40`
- timeout: use a bounded timeout similar to current stats, with a modest
  increase only if needed for `du`

`-x` keeps `du` on one filesystem and avoids crossing mounted filesystems.
Errors from `du` are captured into raw output where practical, but permission
errors should not fail the entire modal if other sections parse successfully.

Because this adds a new Tauri command, this is a native IPC change and must be
released as a `v*` release, not frontend-only OTA.

---

## 4. Parsed Result Shape

Return JSON with structured data plus raw output:

```json
{
  "hostname": "api-prod",
  "uptime": "up 3 days, 4:12",
  "disk": {
    "mount": {
      "path": "/",
      "total": "50G",
      "used": "34G",
      "free": "16G",
      "pct": 67.0
    },
    "entries": [
      {
        "path": "/var/lib/docker",
        "name": "docker",
        "parent": "/var/lib",
        "depth": 3,
        "size": "12.4G",
        "bytes": 12400000000,
        "pct_of_used": 36.0
      }
    ]
  },
  "processes": [
    {
      "pid": 421,
      "command": "postgres",
      "args": "postgres",
      "rss_kb": 1887436,
      "memory": "1.8G",
      "mem_pct": 23.1
    }
  ],
  "raw": {
    "df": "...",
    "du": "...",
    "ps": "...",
    "stderr": "..."
  }
}
```

The exact Rust structs can differ, but frontend-facing field names should stay
stable and use snake_case from Rust through serde where practical. Existing
frontend conventions can map them to camelCase only inside JS helpers if needed.

---

## 5. Disk UI

Use the approved visual direction from the browser mockups:

- narrow modal by default, about `520px`
- horizontally resizable up to about `90vw`
- last width persisted as `vps.analysis_modal_width`
- real top tabs with underline style, not pill buttons
- default active tab: `Disk`

`Disk` tab content:

- compact mount summary for `/`
- collapsible tree from parsed `du` entries
- directory rows show:
  - expand/collapse marker
  - directory path/name with ellipsis for long paths
  - size
  - percentage of used disk where available
- `Collapse all`
- breadcrumb/drill-down state
- selected directory details below the tree:
  - selected path
  - total size
  - largest child
  - scan scope (`depth 3`, `top 40`)

Interaction:

- clicking the twisty expands/collapses a row
- clicking/double-clicking a directory name can drill into that subtree without
  another SSH request, because depth 3/top 40 data is already loaded
- long paths are truncated with ellipsis in narrow width and get more room when
  the modal is widened
- tree body scrolls internally when rows exceed available height

---

## 6. Processes UI

`Processes` tab shows top processes by RSS memory:

- summary cards/rows for RAM and swap if available
- process table columns:
  - process/command
  - memory
  - percent
- long command lines are truncated with ellipsis
- no kill/restart actions in first version

---

## 7. Raw UI

`Raw` tab is for troubleshooting:

- shows command output sections for `df`, `du`, `ps`, and stderr
- includes a copy action
- useful when parser output looks suspicious or SSH permissions hide paths

---

## 8. Error Handling

Modal states:

- loading: spinner and server identity
- success: tabs
- partial success: show parsed sections and a warning badge/message if stderr
  contains permission or command errors
- failure: show SSH/timeout error and `Retry`

Detailed analysis errors must not poison the existing VPS tile stats cache.

---

## 9. Frontend Integration

Add a `Detailed analysis` action in the VPS UI:

- context menu item near `Test Connection`
- optional icon/button in expanded detail panel action bar

Do not trigger detailed analysis from:

- tile body click
- tile expand
- tile stat refresh
- environment refresh
- auto-refresh timers

Browser mock (`desktop-rust/src/dev-mock.js`) must implement
`vps_get_detailed_analysis` with representative disk tree, process list, and
raw output so `dev.html` and `dev-test.py` can exercise the modal.

---

## 10. Testing

Rust:

- parser tests for `df`
- parser tests for `du` with nested paths and long paths
- parser tests for `ps` output
- test permission-denied stderr does not discard successfully parsed sections

Frontend:

- `node --check desktop-rust/src/tabs/vps.js`
- update browser mock command
- run `cd desktop-rust/src && python3 dev-test.py`
- add or update a smoke test if the current harness has modal coverage points

Release:

- because Rust/Tauri command surface changes, follow `desktop-rust/RELEASES.md`
  for a `v*` release after implementation is complete and verified
- update `desktop-rust/src/tabs/help.js` and `desktop-rust/CHANGELOG.md` before
  release because this is user-facing behavior

---

## 11. Files Expected To Change

| File | Change |
| --- | --- |
| `desktop-rust/src-tauri/src/commands/vps.rs` | New detailed analysis command, parsers, tests |
| `desktop-rust/src-tauri/src/lib.rs` | Register new Tauri command |
| `desktop-rust/src/tabs/vps.js` | Modal UI, tabs, tree state, resize persistence |
| `desktop-rust/src/dev-mock.js` | Mock detailed analysis command |
| `desktop-rust/src/tabs/help.js` | Help text update before release |
| `desktop-rust/CHANGELOG.md` | Release note before release |

---

## 12. Open Decisions Resolved

- Design direction: compact variant A
- Disk scan scope: fixed `depth 3 + top 40`
- Process scope: top 40 by RSS memory
- Modal width: narrow default with horizontal resize and persisted width
- Tabs: top underline tabs `Disk / Processes / Raw`
