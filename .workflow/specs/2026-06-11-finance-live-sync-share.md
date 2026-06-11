# Finance Live Sync And Share

## Goal

Make Finance lists first-class synced data and allow sharing a Finance list
through a live public link.

This replaces the earlier "desktop-local only" Finance scope with a server/API
contract:

- `finance_plans` and `finance_items` sync between devices through the existing
  `/v1/sync/push` and `/v1/sync/pull` endpoints.
- A Finance list can be shared through the existing Share dialog pattern.
- Public Finance share pages render the current server copy of the list, not a
  desktop snapshot.

## Product Scope

- Desktop Finance remains the first client UI.
- Mobile Finance UI is out of scope for this pass, but the API model must be
  usable by mobile later.
- Sharing a Finance list should behave like Notes/Snippets:
  - create or reuse an active public link;
  - copy/open/revoke from the Share dialog;
  - run sync before creating the link so the first public view sees the latest
    local edits.
- Telegra.ph publishing is not required for Finance in this pass.

## Data Model

Add server-side synced tables matching the current desktop data model.

`finance_plans`:

- `uuid`
- `user_id`
- `id`
- `name`
- `currency`
- `kind`
- `sort_order`
- `created_at`
- `updated_at`
- `is_deleted`

`finance_items`:

- `uuid`
- `user_id`
- `id`
- `plan_id`
- `plan_uuid`
- `parent_id`
- `parent_uuid`
- `name`
- `amount_cents`
- `due_day`
- `due_date`
- `note`
- `sort_order`
- `created_at`
- `updated_at`
- `is_deleted`

`plan_id` and `parent_id` are local integer ids and are not portable across
devices. Sync must use `plan_uuid` and `parent_uuid` as the authoritative
relationships, following the existing Tasks pattern.

Validation:

- `finance_plans.kind` is one of `monthly`, `project`, `one_time`, `general`.
- `finance_items.amount_cents >= 0`.
- `finance_items.due_day` is null or `1..31`.
- `finance_items.due_date` is null or an ISO `YYYY-MM-DD` date string.
- Non-deleted items pushed to the server must include `plan_uuid`.
- If `parent_uuid` is present, it must belong to an item in the same plan.

## Sync Behavior

Push:

- Add `finance_plans` and `finance_items` to the server and desktop sync
  registries.
- When pushing `finance_items`, desktop maps:
  - `plan_id -> plan_uuid`;
  - `parent_id -> parent_uuid`.
- Rows that cannot resolve a required `plan_uuid` are not sent by desktop and
  remain `pending`.
- Server responses include accepted UUIDs by table. Desktop marks Finance rows
  as synced or purges Finance deletes only when the API explicitly accepted
  those UUIDs. This prevents a desktop client talking to an older API from
  silently losing pending Finance sync state.
- Server validates Finance relationships before accepting a row:
  `plan_uuid` must refer to an owned active plan or a plan in the same push
  batch; `parent_uuid`, when present, must resolve to a Finance item in the
  same plan.

Pull:

- Pull `finance_plans` before `finance_items`.
- Desktop maps:
  - `plan_uuid -> plan_id`;
  - `parent_uuid -> parent_id`.
- If an item arrives before its parent exists locally, upsert the item with a
  null parent first, then apply a deferred parent update after all pulled
  Finance rows are inserted.
- Last-write-wins remains based on `updated_at`.

Deletes:

- Existing desktop soft-delete behavior remains.
- Server uses `is_deleted`.
- Confirmed deleted rows are purged locally after successful push, matching the
  existing sync client behavior.

## Public Share

Extend share links with item type `finance_plan`.

Public payload contains:

- type: `finance_plan`;
- plan metadata: title/name, currency, kind;
- list of active finance items with UUID relationships and sort order;
- aggregate totals computed server-side for a stable public read-only page.

Public HTML should render:

- title and compact metadata line;
- total amount;
- hierarchical table with name, amount, date, total, and note;
- indentation based on item nesting;
- dark visual style consistent with existing public share pages.

If the plan or active link is deleted/revoked, public endpoints return 404.

Public Finance share queries must use portable UUID relationships only:
`FinancePlan.uuid == ShareLink.item_uuid` and
`FinanceItem.plan_uuid == ShareLink.item_uuid`. Local integer ids are ignored
for public rendering.

## Desktop UX

Finance header gains a compact link/share icon button.

Before opening or creating a Finance share link, desktop should save current
field changes through existing `change` handlers and trigger sync. The Share
dialog can then use:

- `itemType: "finance_plan"`;
- `itemUuid: activePlan.uuid`;
- title from the active list name.

The Share dialog should hide or disable Telegra.ph publishing for unsupported
item types instead of showing a failing action.

## Keyboard Editing

Add task-like keyboard editing for Finance rows:

- `Enter` in the row name creates a sibling row at the same nesting level,
  immediately below the current row.
- `Tab` in the row name nests the row under the previous sibling/visible row
  when valid.
- `Shift+Tab` in the row name outdents the row one level.
- `ArrowUp` at the beginning of the row name focuses the previous visible row
  name.
- `ArrowDown` at the end of the row name focuses the next visible row name.

Amount/date/note fields keep normal input behavior in this pass.

## Release Impact

This changes API tables, server migrations, sync behavior, Tauri commands, and
desktop UI. It requires a full `v*` desktop release, not frontend-only OTA.
