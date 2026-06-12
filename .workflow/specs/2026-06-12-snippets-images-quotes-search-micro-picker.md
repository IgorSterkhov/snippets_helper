# Snippets Images, Quotes, Token Search, Micro Picker

## Goal

Improve desktop Snippets/Notes editing and code-snippet retrieval:

- make markdown image magnifier controls useful;
- add Markdown quote formatting for selected text;
- improve snippet search token matching;
- add a global-hotkey micro snippet picker for inserting code snippets into
  external applications such as DataGrip.

## Scope

### 1. Image Original-Size Modal

Existing saved markdown images show a magnifier overlay on hover. Clicking the
magnifier should open a modal viewer.

Requirements:

- desktop-first implementation;
- works for markdown images rendered in Snippets and Notes;
- modal uses the saved image identity for caption/actions, and uses the native
  data-url preview fallback when the WebView cannot load the remote media URL;
- default view fits image inside the viewport;
- actual saved-file size is available through an `Actual size` toggle/button;
- actual-size mode may scroll when the image is larger than the viewport;
- modal has close affordance and Escape support through the existing modal
  infrastructure where practical.

### 2. Markdown Quote Formatting

Snippets and Notes text editing controls should support quote formatting for
selected text.

Requirements:

- update the existing `>` quote toolbar button so it behaves as a toggle;
- selecting text and pressing quote prefixes each selected line with `> `;
- if every selected non-empty line is already quoted with `>`, pressing quote
  removes one quote prefix from each selected line;
- works in relevant Snippets/Notes text blocks:
  - snippet value/code block;
  - snippet description when editable;
  - note content editor.
- preserve cursor/selection as well as practical after formatting.

### 3. Snippet Search Tokenization

Snippet search should treat spaces as token separators.

Requirements:

- verify and preserve the existing whitespace-token search behavior;
- split user search text on whitespace;
- all tokens must match in any order;
- `bash setup` should match names such as:
  - `bash_obsidian_setup`;
  - `setup_bash_chrome_keenetic`;
- token matching should use the same search scope currently selected by the UI:
  - name-only mode searches only snippet names;
  - content mode searches name/value/description.

### 4. External-App Micro Snippet Picker

Add a global-hotkey micro picker for code snippets.

Requirements:

- desktop native release is expected;
- add a new global hotkey, default `Ctrl+Alt+K`, with non-fatal diagnostics if
  registration fails or conflicts with another app shortcut;
- hotkey opens a compact always-on-top picker window;
- first implementation may position the picker near the active cursor when a
  reliable cursor/caret position is available, but must fall back to a compact
  centered-on-active-monitor window if not;
- picker input filters code snippets;
- first filter scope: snippets whose name starts with `code_`;
- matching uses tokenized search by name and may include snippet value for
  preview/search if already cheap;
- selected result shows a neighboring preview of snippet text;
- Enter inserts selected snippet into the previously focused external app when
  the platform can restore that window focus reliably;
- insertion uses clipboard + paste simulation in the first version;
- if focus restoration is unavailable or fails, fall back to copy-only and show
  a clear status so the user can paste manually;
- Escape closes without inserting.

## Release Impact

- Items 1-3 may be frontend-only if they use existing commands and APIs.
- Item 4 likely requires new Tauri command/global shortcut/window behavior, so
  the combined implementation should ship as a full desktop `v*` release.
- Update desktop Help and release history before release:
  - `desktop-rust/src/tabs/help.js`;
  - `desktop-rust/src/release-history.md`;
  - `desktop-rust/CHANGELOG.md`.

## Out Of Scope

- Exact OS-level caret positioning for every external editor if not available
  through existing dependencies.
- New snippet metadata type beyond the `code_` prefix.
- Fuzzy ranking beyond existing simple scoring/token matching.
- Mobile implementation.
