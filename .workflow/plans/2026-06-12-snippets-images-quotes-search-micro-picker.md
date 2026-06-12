# Snippets Images, Quotes, Token Search, Micro Picker Plan

## 1. Discovery

- Inspect Snippets/Notes markdown image rendering and magnifier overlay.
- Inspect existing code-block toolbar behavior and shared text-format helpers.
- Inspect snippet list search implementation and search-mode toggle.
- Inspect desktop Tauri global hotkey / overlay / clipboard / paste simulation
  patterns, especially Whisper overlay and existing hotkey commands.

## 2. Image Modal

- Reuse existing modal primitives where possible.
- Add image-viewer state/handlers to the markdown/image renderer.
- Magnifier click opens a modal with:
  - saved image identity/caption;
  - native data-url display fallback when the remote media URL is blocked;
  - title/caption when available;
  - fit/actual toggle;
  - scrollable actual-size content.
- Make the magnifier button stop propagation so normal editor/list clicks do
  not also fire.

## 3. Quote Formatting

- Identify existing code-block and quote formatting functions.
- Extract or extend a helper for selection wrapping/toggling.
- Change the existing `>` quote button into a toggle instead of adding a
  duplicate quote control.
- Quote algorithm:
  - determine selected line range;
  - if all non-empty selected lines start with optional whitespace then `>`,
    remove one quote marker;
  - otherwise prefix selected lines with `> `;
  - restore a reasonable selection range.

## 4. Token Search

- Verify the existing tokenizer helper and AND matching path still satisfy the
  requested examples.
- Preserve existing name-only vs content-search behavior.
- Keep or extend browser mock tests/dev-test coverage only if a failing case is
  found.

## 5. Micro Picker Native Surface

- Add native state to remember the previously focused window before showing
  the picker if the platform support is already present or can be added
  narrowly; otherwise use copy-only fallback.
- Add a new Tauri command/global shortcut for opening a micro picker window:
  default `Ctrl+Alt+K`, non-fatal startup logging if registration fails.
- Add a lightweight frontend micro picker view/module:
  - input;
  - result list;
  - preview pane;
  - keyboard navigation;
  - Enter insert;
  - Escape close.
- Add command to insert selected text into the previous app through clipboard
  and paste simulation, following existing Whisper live-dictation insertion
  patterns.
- Include the picker window in OTA reload handling or create it on demand so it
  always uses the active frontend bundle.
- If accurate caret coordinates are not available safely, position the window
  compactly on the active monitor as the first release fallback.

## 6. Verification

- `node --check` for changed desktop JS files.
- Update `desktop-rust/src/dev-mock.js` if frontend calls new commands in
  browser mock.
- Run focused unit/smoke coverage where available.
- Run `cd desktop-rust/src && python3 dev-test.py`.
- For native changes:
  - `cd desktop-rust/src-tauri && cargo check`;
  - add Rust tests only if string truncation or non-trivial backend logic is
    introduced.

## 7. Release

- Because micro picker likely changes native command/hotkey/window behavior,
  bump desktop semver as a minor release unless implementation proves
  frontend-only.
- Update:
  - `desktop-rust/src/tabs/help.js`;
  - `desktop-rust/src/release-history.md`;
  - `desktop-rust/CHANGELOG.md`.
- Commit with a short one-line message.
- Tag and publish a `v*` desktop release per `desktop-rust/RELEASES.md`.
