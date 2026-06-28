# Mobile Finance Sync, Rules, and Header Polish

## Goal

Make Finance diagnostics and editing usable enough to investigate sync issues
from the phone, edit mapping rules on both desktop and mobile, and reduce the
height of the mobile Finance list header.

## Requirements

- `Group target` remains a global diagnostic status:
  - show the button whenever any active imported fact is mapped to a group item,
    regardless of current date/search/status filters;
  - clicking it resets date/search/status filters and then shows all group-target
    facts.
- Finance mapping rules can be edited, not only created:
  - desktop and mobile must allow choosing an existing rule, editing conditions,
    direction (`Expense`, `Income`, `Any`), target list/item, enabled state, and
    priority;
  - direction is stored as part of rule conditions; changing a rule to `Any`
    removes the direction condition instead of writing a separate field;
  - rules can be saved without applying;
  - rules can be applied after save or from the rules list;
  - existing rules should be collapsed into a selector/list control so the form
    stays immediately visible.
- Mobile Finance sync diagnostics:
  - keep the compact Sync status pill (variant A) for narrow screens and a richer
    details surface for wide/foldable screens;
  - tapping Sync opens details, and the details surface keeps an explicit
    `Sync now` action;
  - Sync details show current status, pending count, last cursor, pull/push counts,
    accepted/rejected/conflict data, and errors;
  - keep local history of recent sync events so a user can inspect which concrete
    table/uuid rows were pulled, pushed, accepted, rejected, or conflicted and
    when;
  - history includes normal sync, forced full pull, warning/rejected rows, and
    errors; keep only a bounded recent window locally;
  - sync history is local diagnostic data and is not synced to the server.
- Mobile Finance row creation:
  - tapping `Добавить строку` or `+ child` creates the row, scrolls it into view,
    and immediately opens row editing;
  - `+ child` expands the parent if needed.
- Mobile Finance selected-list header:
  - replace the tall multi-line header with a compact one-line row:
    `Name | Currency | Kind dropdown | ...`;
  - list kind is editable from the compact row;
  - delete moves under the overflow menu instead of being a visible trash action.

## Non-Goals

- Do not add new server API endpoints.
- Do not sync mobile sync-history diagnostics to other devices.
- Do not redesign the whole mobile tab bar in this pass.
