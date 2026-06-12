# Mobile Finance Module

## Goal

Add Finance as a first-class module in the Android mobile app.

The mobile module should work with the same synced Finance data model that is
already used by desktop and the API:

- `finance_plans`;
- `finance_items`;
- public share links with `item_type = finance_plan`.

## Product Scope

Recommended option A is approved:

- Add a dedicated `Finance` tab to the mobile bottom navigation.
- Support synced read/write finance lists:
  - list creation;
  - list rename;
  - currency edit;
  - list type edit: `monthly`, `project`, `one_time`, `general`;
  - list deletion.
- Support nested finance rows:
  - name;
  - direct amount;
  - aggregate total computed from descendants;
  - optional note;
  - optional date value.
- Date behavior follows desktop:
  - monthly lists edit `due_day` as day of month `1..31`;
  - other list types edit `due_date` as `YYYY-MM-DD`;
  - switching list type preserves both stored date fields.
- Add public share management for the selected Finance list by reusing the
  existing mobile `ShareLinkSheet`.
- Trigger sync after local edits through the existing mobile sync service.

## Mobile UX

Finance uses a dark, compact, utilitarian mobile layout consistent with
existing Tasks and Notes screens.

Main screen:

- top sync status bar;
- header with `Finance`, current total, and a share action when a list exists;
- horizontal list selector chips/cards for finance lists;
- selected list metadata editor:
  - name;
  - currency;
  - type segmented/dropdown-like selector;
- hierarchy rows below.

Rows:

- one entity type only; a row becomes a subtotal/group visually when it has
  children;
- indentation shows hierarchy;
- parent rows show stronger name/total text;
- rows at upper visible depths receive soft background bands using the same
  depth rules as desktop;
- deepest visible depth stays neutral.
- Main Finance rows must be compact report rows, not full inline edit forms:
  - target visual height is roughly 44-56 px for ordinary rows;
  - row shows collapse control, title, optional note/date hint, and amount/total;
  - row action buttons and full field labels are not shown in the main list;
  - tapping a row opens a bottom-sheet style editor for full editing.
- The row editor sheet contains name, amount, date/day, note, add child, move,
  and delete actions.

Mobile structure editing:

- Do not implement pointer drag-and-drop in this first mobile pass.
- Use an explicit reorder mode, similar to mobile Tasks:
  - select a row;
  - move up/down among siblings;
  - indent under previous sibling;
  - outdent to parent level.
- Add child/sibling actions should be available without hidden desktop-only
  hover behavior.
- In compact mode these actions live in the row editor sheet, not permanently
  in every visible list row.

## Data Model

Local SQLite tables:

`finance_plans`:

- `uuid TEXT PRIMARY KEY`
- `id INTEGER`
- `name TEXT NOT NULL`
- `currency TEXT NOT NULL DEFAULT 'RUB'`
- `kind TEXT NOT NULL DEFAULT 'monthly'`
- `sort_order INTEGER DEFAULT 0`
- `created_at TEXT`
- `updated_at TEXT NOT NULL`
- `is_deleted INTEGER DEFAULT 0`

`finance_items`:

- `uuid TEXT PRIMARY KEY`
- `id INTEGER`
- `plan_id INTEGER`
- `plan_uuid TEXT NOT NULL`
- `parent_id INTEGER`
- `parent_uuid TEXT`
- `name TEXT NOT NULL DEFAULT ''`
- `amount_cents INTEGER NOT NULL DEFAULT 0`
- `due_day INTEGER`
- `due_date TEXT`
- `note TEXT NOT NULL DEFAULT ''`
- `sort_order INTEGER DEFAULT 0`
- `created_at TEXT`
- `updated_at TEXT NOT NULL`
- `is_deleted INTEGER DEFAULT 0`

Mobile should use UUID relationships for all local UI and sync behavior.
Integer ids are kept only for compatibility with server payload fields and
future diagnostics.

## Sync

Extend mobile sync:

- pull order includes `finance_plans` before `finance_items`;
- push includes modified finance plans and items;
- pulled non-deleted `finance_items` without `plan_uuid` are ignored;
- local changes use `updated_at` and `is_deleted` in the same pattern as Tasks;
- existing installs get one full pull through a Finance sync-enabled backfill
  marker. Use a marker version that could not have been written by a build
  where Finance tables existed but Finance sync was not yet fully wired.

Because the server already validates Finance UUID relationships, mobile must
push `plan_uuid` for every non-deleted item and `parent_uuid` when nested.

## Sharing

Finance screen should expose a link/share action for the selected list.

Before opening or creating a share link:

- persist current local edits;
- call sync and wait for the real active sync operation to finish, so the
  public live page sees the latest mobile changes even if another sync was
  already in progress;
- open `ShareLinkSheet` with `itemType="finance_plan"` and the selected plan
  UUID.

## Release Impact

This pass is expected to be JS-only:

- `mobile/src/**`;
- `mobile/App.js` or navigation only if needed;
- no new native dependencies;
- no new Android permissions.

Therefore it should ship as a mobile OTA release by bumping
`mobile/package.json` from the current version to the next patch version.

If implementation unexpectedly requires native files, switch to APK release
rules from `mobile/RELEASES.md`.

## Out Of Scope

- Mobile pointer drag-and-drop.
- Per-user/per-device Finance color settings on mobile.
- Charts, paid/fact tracking, bank imports, recurring payment generation.
- Telegra.ph publishing for Finance.
