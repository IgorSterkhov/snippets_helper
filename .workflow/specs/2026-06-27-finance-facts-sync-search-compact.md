# Finance Facts sync recovery, search, and compact mobile view

## Goal

Fix the case where a Finance fact mapped on mobile does not become mapped on
desktop after sync, and add two usability improvements for reviewing imported
bank facts.

## Requirements

- Mobile fact assignments must be pushed even when their `updated_at` is older
  than the local `last_sync_at` cursor.
- Existing active mobile assignments made before the fix should be retried once
  after the next mobile update.
- Dirty mobile assignment rows must be marked clean only after the API accepts
  their UUIDs.
- Desktop Finance Facts needs a search field above the facts registry that
  searches across dates, amounts, bank fields, description, raw data, mapping
  state, lock state, and mapped Finance target.
- Mobile Finance Facts needs a persistent `Cards / Compact` view switch.
- Compact mobile rows should fit the key fields on one line on wide/foldable
  screens: date, amount, description, bank category/card/MCC, mapped target, and
  Map/Edit.

## Constraints

- Keep the sync fix mobile-only and backwards-compatible with existing server
  API payloads.
- Do not make a full pull a prerequisite for pushing mobile manual mappings.
- Keep the existing card layout available on mobile.
- Desktop search should not recreate the whole Finance module on every
  keystroke, so the input keeps focus while filtering.
