# Finance Mapped-To-Group Protection

## Goal

Finance facts and payment-calendar entries should end up attached to terminal
expense items. A user may still reorganize expense lists freely, but if a
previously terminal item with direct fact mappings becomes a group, the UI must
surface and help repair that state instead of silently leaving facts on a group.

## Current Model

- Finance facts are assigned through `finance_transaction_allocations`.
- Payment-calendar rows are assigned directly through `finance_payments`.
- Allocation targets are `plan_uuid` plus optional `item_uuid`.
- Finance items do not have a persisted `group` or `terminal` type.
  Group/terminal status is inferred from whether an item has children.
- Existing mappings continue to point to the same item UUID after rename or
  hierarchy moves.

## Requirements

- Add a Facts filter for allocations whose target item currently has children.
  User-facing label should be short: `Group target`.
- The filter chip/button should include a red alert marker so these facts read
  as something to fix, not as a normal category.
- A fact row mapped to a group should show a small alert marker near the target
  label in both desktop and mobile Facts views.
- When the user is about to make an item with direct facts or payment-calendar
  entries become a parent, show a soft-protection confirmation. This includes:
  adding a child, indenting another item under it, or dropping an item inside it.
  - primary action completes the hierarchy change and moves the direct facts and
    payment-calendar entries to the new/moved terminal child;
  - secondary action cancels;
  - no option leaves facts or payments attached to the group.
- The created child should be terminal by default, named from the parent with a
  practical suffix, and should inherit relevant plan/date fields.
- Existing already-created group targets or cross-device edge cases are surfaced
  through the diagnostic filter and can be repaired by remapping affected facts
  to terminal items.

## Non-Goals

- Do not add a persisted `item_kind`/`is_group` column in this pass.
- Do not change the API schema in this pass.
- Do not hard-block all restructuring actions; this is a soft protection and
  repair flow.
