# Desktop Finance Collapse Bands Hotfix

## Requirement

Desktop Finance must keep level color bands when nested rows are collapsed.

## Problem

The desktop Finance renderer calculates the maximum depth from the visible
flattened rows. When every branch is collapsed, only top-level rows remain
visible, so max depth becomes `0` and the renderer treats those rows as neutral
terminal rows.

## Expected Behavior

- Level band assignment is based on the full active item tree, not only visible
  rows.
- Collapsing children hides rows but does not change the band assigned to the
  visible parent rows.
- This is frontend-only and can ship as a desktop `f-*` OTA.
