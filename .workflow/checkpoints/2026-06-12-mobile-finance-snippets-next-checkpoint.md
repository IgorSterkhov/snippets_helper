# Checkpoint: Mobile Finance OTA, Next Snippets Improvements

Date: 2026-06-12
Branch: `main`
Latest commit: `3d9c269 tighten mobile finance rows`
Latest mobile OTA: `1.0.27`

## Current Goal

Mobile Finance is implemented and released through OTA. The next requested
task is a desktop Snippets/Notes improvement batch:

1. make markdown images open in an original-size modal when the magnifier
   overlay is clicked;
2. add quote formatting for selected text in Snippets/Notes text blocks,
   analogous to existing code-block wrapping;
3. ensure snippet search treats spaces as token separators, so `bash setup`
   matches names like `bash_obsidian_setup` and `setup_bash_chrome_keenetic`;
4. add a hotkey-driven micro snippet picker near the active text cursor in an
   external app such as DataGrip, focused on code snippets such as `code_*`.

## What Was Resolved

- Mobile Finance was added as a first-class mobile module:
  - `finance_plans` / `finance_items` local SQLite tables;
  - Finance repository with UUID-based hierarchy, totals, and reorder helpers;
  - mobile sync pull/push for Finance;
  - Finance backfill marker `finance_sync_enabled_backfill_v2`;
  - Finance bottom tab and screen;
  - live share links through existing `ShareLinkSheet`.
- Mobile OTA `1.0.25` was released for the initial Finance module.
- Mobile Finance rows were redesigned from large inline forms to compact report
  rows with a bottom-sheet editor.
- Mobile OTA `1.0.26` was released for compact rows.
- Row height/padding/typography was tightened further.
- Mobile OTA `1.0.27` was released for the final compact row polish.

## Verification Already Run

For the initial Finance module:

- `node --check` on changed mobile JS files: passed.
- Targeted Jest: database, financeRepo, syncService: passed.
- Full mobile Jest: 21 suites / 86 tests passed.
- OTA `1.0.25` public `latest.json` and bundle URL were verified.

For compact row follow-ups:

- `node --check mobile/src/screens/Finance/FinanceScreen.js`: passed.
- `git diff --check`: passed.
- Full mobile Jest: 21 suites / 86 tests passed.
- OTA `1.0.26` and `1.0.27` public manifests and bundle URLs were verified.

Current public mobile manifest:

- `https://ister-app.ru/snippets-updates/latest.json`
- version: `1.0.27`
- bundle: `https://ister-app.ru/snippets-updates/bundle-1.0.27.zip`
- still preserves required APK metadata for APK `versionCode 7`.

## Current Working Tree Notes

At checkpoint creation, worktree was clean.

## Next Task: Snippets / Notes Improvements

Requested behavior:

- Image magnifier overlay:
  - existing magnifier appears on hover over saved markdown images;
  - clicking it currently does nothing;
  - implement a modal that displays the image at the original saved-file size,
    with reasonable viewport constraints/scroll or zoom behavior.
- Quote formatting:
  - in Snippets and Notes text blocks, selecting text and pressing a quote
    toolbar button should format the selection as Markdown quote text;
  - behavior should be analogous to existing code-block wrapping with triple
    backticks;
  - quote formatting likely means prefixing each selected line with `> `.
- Snippet search tokenization:
  - search text with spaces should be interpreted as tokens;
  - all tokens should match in any order;
  - example: `bash setup` should match `bash_obsidian_setup` and
    `setup_bash_chrome_keenetic`.
- External-app micro snippet picker:
  - new hotkey opens a small picker near the active text cursor in the
    currently focused external app, e.g. DataGrip;
  - user types a pattern;
  - snippets that are probably code snippets, possibly by `code_` prefix, are
    searched;
  - a neighboring preview shows snippet text;
  - Enter inserts the selected snippet into the external app.

## Design Questions To Resolve Before Implementation

- Whether image modal should be desktop-only first, mobile too, or both.
- For original-size image display: scrollable actual pixel size, fit-to-screen
  with click-to-actual-size, or zoom controls.
- Quote button placement and icon in Snippets/Notes editors.
- Quote operation details:
  - prefix each line with `> `;
  - toggle quote off if all selected lines are already quoted;
  - preserve selection/cursor after formatting if practical.
- Snippet search matching semantics:
  - tokens AND together in any order;
  - whether tokens search name only or name/value/description depending on the
    existing search mode;
  - whether `_`, `-`, `/`, and camelCase should be treated as boundaries.
- Micro picker implementation:
  - desktop native `v*` release is likely required if a new global hotkey,
    overlay window, cursor-position detection, or external text insertion
    command is needed;
  - need choose first scope: simple centered overlay + paste insertion, or true
    near-cursor positioning;
  - need define code-snippet filter: `code_` prefix only, tag/type metadata, or
    heuristic over snippet value.

## Important Constraints

- Before implementation, do preliminary product/design discussion with the
  user. This is especially important for the micro picker.
- New requirement specs go in `.workflow/specs`.
- New implementation plans go in `.workflow/plans`.
- Do not ask for final written spec/plan approval unless explicitly requested;
  run an additional reviewer agent when possible.
- For desktop changes, read and follow:
  - `CLAUDE.md`;
  - `FRONTEND_PATTERNS.md`;
  - `desktop-rust/RELEASES.md`.
- Desktop user-facing release gate:
  - `desktop-rust/src/tabs/help.js`;
  - `desktop-rust/src/release-history.md`;
  - `desktop-rust/CHANGELOG.md`.
- If the implementation adds or changes native Tauri commands/global hotkeys,
  use a full `v*` desktop release. Frontend-only changes may use `f-*`.

## Next Step On Return

Discuss the Snippets/Notes direction before code:

1. confirm image modal scope and behavior;
2. confirm quote formatting semantics and toolbar placement;
3. confirm snippet search matching rules;
4. choose the first implementation scope for the external-app micro picker.

After confirmation, write/update spec and plan, run reviewer, implement, verify,
and release through the correct desktop channel.
