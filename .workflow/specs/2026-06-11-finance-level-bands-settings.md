# Finance Level Bands And Display Settings

## Goal

Improve Finance row readability by removing the separate visual idea of
“groups” as a different row type. Finance items remain one tree entity; the UI
derives whether a row is a grouping/subtotal row from the presence of visible
or stored children.

## Requirements

- Remove the `+ Group` action from the Finance header. New rows are created as
  ordinary rows; adding a child row makes a parent visually act as a subtotal
  row.
- Keep one data model: no DB, API, sync, or share schema changes.
- Apply background fill by hierarchy level, not by group/leaf role.
- Rows at the same depth must have the same background treatment, regardless
  of whether they have children.
- Depth calculations use zero-based visible depth indices:
  - one visible level means `maxVisibleDepthIndex = 0`;
  - two visible levels means `maxVisibleDepthIndex = 1`;
  - three visible levels means `maxVisibleDepthIndex = 2`.
- The deepest visible depth index remains neutral by default. Filled levels are
  all visible depth indices lower than `maxVisibleDepthIndex`.
- If the visible tree has two levels, only depth `0` is filled.
- If the visible tree has three levels, depths `0` and `1` are filled.
- Terminal rows use consistent typography and controls at every depth; only
  indentation and depth background change their visual position.
- Parent/subtotal rows still need enough distinction to read as financial
  report headings: chevron, stronger title weight, and stronger total weight.
  This distinction is derived from stored children, including collapsed
  children. Background banding is derived from visible row depths.
- Add a Finance display settings modal in the Finance module header.
- The modal must allow configuring level fill colors.
- The modal must allow choosing fill assignment order:
- `Strong first`: depth 0 uses the strongest configured fill, then weaker
    fills as depth increases.
- `Soft first`: depth 0 uses the softest configured fill, then stronger
    fills as depth increases.
- Settings are local desktop UI preferences stored through the existing
  `get_setting` / `set_setting` commands. They are not synced.

## Default Design

- Use a soft cyan family by default.
- Provide three configurable band colors:
  - Strong level fill.
  - Medium level fill.
  - Soft level fill.
- If there are more filled depths than configured colors, reuse the closest
  end color. This keeps very deep trees stable without expanding the settings
  UI.
- Exact slot mapping:
  - `Strong first`: strong, medium, soft, then soft.
  - `Soft first`: soft, medium, strong, then strong.
- Stored colors are validated as `#RRGGBB`. Invalid values fall back per slot
  to default theme-safe colors.
- The actual row background uses `color-mix(..., var(--bg))` so user-selected
  opaque colors remain soft and readable in the dark UI.
- The modal should preview the effect on a small sample table before saving.

## Out Of Scope

- Mobile Finance UI.
- Public share visual redesign.
- Finance sync/API/storage changes.
- Per-plan styling; settings are module-level local preferences.
