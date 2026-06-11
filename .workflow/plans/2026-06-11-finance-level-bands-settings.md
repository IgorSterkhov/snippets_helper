# Finance Level Bands And Settings Plan

## Implementation

1. Add Finance display preference constants in `desktop-rust/src/tabs/finance.js`:
   - setting keys for strong/medium/soft colors;
   - setting key for fill assignment order;
   - validated defaults and normalization helpers.
2. Load Finance display settings during tab initialization and apply CSS
   variables on the Finance root.
3. Update Finance styles:
   - remove heavy group-only background treatment;
   - add `finance-band-slot-*` classes driven by CSS variables;
   - keep group/subtotal typography distinct without changing depth background;
   - keep leaf rows consistent at all depths.
4. Update tree rendering:
   - compute zero-based `maxVisibleDepthIndex` from `flattenVisible`;
   - assign a band slot only to rows with `depth < maxVisibleDepthIndex`;
   - assign slots by exact mapping:
     - strong-first = strong, medium, soft, then soft;
     - soft-first = soft, medium, strong, then strong;
   - add a group/subtotal class only for typography/chevron/total emphasis,
     based on stored children including collapsed children.
5. Update header actions:
   - remove `+ Group`;
   - add a compact settings button;
   - keep `+ Row`, Share, Delete.
6. Add Finance display settings modal:
   - three color inputs;
   - fill order select;
   - live preview and live application to the current Finance root;
   - Confirm persists settings;
   - Cancel restores previous settings.
7. Update microcopy from “row or group” to “row”.
8. Run checks:
   - `node --check desktop-rust/src/tabs/finance.js`;
   - add Finance coverage to `desktop-rust/src/dev-test.py` for no `+ Group`,
     band class assignment for 1/2/3 visible levels, settings save, and
     settings cancel restore;
   - `cd desktop-rust/src && python3 dev-test.py` unless blocked by the
     environment.
9. Update release materials before tagging:
   - `desktop-rust/src/tabs/help.js`;
   - `desktop-rust/src/release-history.md`;
   - `desktop-rust/CHANGELOG.md`.

## Release

This is a desktop frontend-only, user-facing UI change. It can ship as an
`f-*` OTA release after checks and release-material updates pass, unless
unrelated dirty files make release unsafe.
