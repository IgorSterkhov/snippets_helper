# Desktop Finance Collapse Bands Hotfix Plan

## Steps

1. Add a helper in `desktop-rust/src/tabs/finance.js` that computes maximum
   Finance tree depth from `roots`/`children` without using collapse state.
2. Use that helper in `renderTree()` instead of reducing over visible rows.
3. Extend the Finance level-band smoke test to collapse the root row and assert
   the visible parent keeps its band slot.
4. Update desktop release history/changelog/help for the user-facing fix.
5. Run frontend syntax and smoke checks, commit, tag a frontend-only desktop
   OTA, and verify release assets.
