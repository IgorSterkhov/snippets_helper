# Synced Pinned Snippets And Note Chip Ordering Spec

## Requirement

Add synced pinned snippets to the desktop Snippets tab and add drag reorder to
the existing pinned note chips. Keep mobile changes limited to data and sync
compatibility; do not add mobile UI in this task.

## Desktop Snippets UX

- Add a `Tags / Pinned` panel selector near the existing Snippets sort selector.
- `Tags` mode keeps the current tag chip panel behavior.
- `Pinned` mode replaces the tag panel with pinned snippet chips.
- Pinned snippet chips use the same wrapped chip-strip drag reorder behavior as
  Tasks pinned chips, including a same-size placeholder and FLIP movement.
- Clicking a pinned snippet chip selects that snippet in the current Snippets
  detail area.
- The left snippets list remains unchanged: no pin controls and no pinned-first
  sorting.
- Add a compact pin/unpin control in the snippet detail header and editor flow.
- If a pinned snippet is renamed, its chip label updates from the current
  shortcut row on reload/render.

## Desktop Notes UX

- Keep the existing pinned notes chip strip.
- Add wrapped-chip drag reorder using the same visual behavior as Tasks pinned
  chips.
- Preserve existing note list behavior; pinned chip order affects only the chip
  strip.

## Data Model

Use fields on existing synced tables:

- `shortcuts.is_pinned INTEGER NOT NULL DEFAULT 0`
- `shortcuts.pinned_sort_order INTEGER NOT NULL DEFAULT 0`
- `notes.pinned_sort_order INTEGER NOT NULL DEFAULT 0`

`notes.is_pinned` already exists. `pinned_sort_order` is separate from normal
list ordering so pinned chip reordering does not alter existing Snippets or
Notes list sort behavior.

## Sync And API

- Add an Alembic migration for the API.
- Add fields to API SQLAlchemy models.
- Add fields to shared sync schema.
- Add fields to desktop Rust sync schema and local migrations.
- Add fields to mobile SQLite schema and mobile repository upsert builders so
  mobile pull/push preserves pinned state and pinned order.
- Existing API dynamic sync routes should continue to include the fields through
  model-column introspection.
- Last Write Wins stays row-level by `updated_at`, matching current sync
  behavior. Reordering pinned chips updates `pinned_sort_order`, `updated_at`,
  and `sync_status = 'pending'` for affected rows.

## Commands

Desktop needs new or changed native commands:

- Snippets: update pin state and reorder pinned snippet chips.
- Notes: reorder pinned note chips.

Because this changes native command surface and synced DB schema, desktop must
ship as a full `v*` release, not a frontend-only OTA.

## Mobile Scope

Mobile must:

- Create new columns on fresh installs.
- Migrate existing SQLite installs with idempotent `ALTER TABLE`.
- Preserve `is_pinned` and `pinned_sort_order` for shortcuts and
  `pinned_sort_order` for notes during pull/push.

Mobile must not:

- Add Snippets pinned chips UI.
- Add Notes pinned chip reorder UI.

## Release Scope

- API: deploy migration and server code.
- Desktop: full native release.
- Mobile: JS-only OTA after data/sync compatibility changes.

## Acceptance Criteria

- Desktop can pin/unpin snippets and show them as chips in the Snippets `Pinned`
  panel.
- Desktop can reorder pinned snippet chips and the order survives app reload and
  sync.
- Desktop can reorder existing pinned note chips and the order survives app
  reload and sync.
- Renaming a pinned snippet updates its chip label.
- Tags panel behavior remains unchanged when `Tags` is selected.
- Snippets left list sorting remains controlled only by the existing sort mode.
- Mobile sync keeps the new fields instead of dropping or resetting them.
