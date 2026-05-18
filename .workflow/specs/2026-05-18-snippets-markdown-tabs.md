# Snippets Markdown and Tabs — Design Spec

**Date:** 2026-05-18
**Status:** draft for user review
**Scope:** `desktop-rust/src/tabs/shortcuts.js`, `desktop-rust/src/components/md-toolbar.js`, `desktop-rust/src/styles.css`, `desktop-rust/src/dev-mock.js`, `desktop-rust/src/dev-test.py`, help/changelog if released

---

## 1. Goal

Improve the Snippets module for long code snippets and Markdown-heavy content:

- make rendered Markdown code blocks easy to copy;
- make the Markdown toolbar better at inserting inline code and fenced code
  blocks;
- make new-snippet creation start in the name field;
- give code, description, links, and notes their own compact tabs in the
  snippet detail view;
- remove embedded Web viewing from the right panel and keep link opening as
  explicit actions.

This is a desktop frontend change. No new Tauri commands are planned.

---

## 2. Snippet Detail View

Replace the current `Main / Web / Note` switcher with one full-width tab row
under the snippet header.

The snippet header keeps the name and primary actions (`Copy`, `Edit`, `Del`).
The tab row sits directly below it. The header and tab row remain visible while
the active tab content scrolls.

Only one tab's content is visible at a time.

### Tabs

- `Code` always appears and is the default active tab.
- `Description` appears only when `shortcut.description` is non-empty after
  trimming.
- `Links` appears only when the snippet has at least one valid link.
- `Note` appears only when the snippet already has a linked Obsidian note.

Empty tabs are not shown.

### Code Tab

The `Code` tab renders the snippet value with the current behavior:

- Markdown-looking content is rendered with `marked()`.
- Plain content is shown as preformatted text.
- The global `Copy` action continues to copy the snippet value with Markdown
  fences stripped by the existing copy helper.

### Description Tab

The `Description` tab renders only the description:

- Markdown-looking content is rendered with `marked()`.
- Plain content is shown with preserved line breaks.
- There is no separate collapsible description section in the detail view,
  because the tab itself is the navigation surface.

### Links Tab

The old embedded `Web` view is removed from the right panel.

`Links` shows a compact list of links. Each row/chip shows:

- title, falling back to URL;
- URL, truncated with ellipsis when long;
- action to open in the system browser;
- action to open in a separate app window.

The existing app-window behavior should use the current `open_link_window`
command. Browser opening should use the current `open_url` command.

No iframe is embedded in the snippet detail panel.

### Note Tab

`Note` appears only for snippets with an existing `obsidian_note` value.

It shows the linked note path and rendered note content, keeping the current
read behavior. The empty-note screen with `Create note` / `Link existing note`
is removed from the detail view. Creating or linking a note remains available
through the edit flow only.

---

## 3. Markdown Code Block Copy

Rendered Markdown code blocks get a small copy button on the right side of the
block.

Behavior:

- The button copies only that code block's text, not the surrounding Markdown.
- The copied text does not include Markdown fences.
- On success, show the existing success toast.
- On failure, show the existing error toast.

Apply this to rendered Markdown in the Snippets module. If the implementation
can make the helper reusable without extra complexity, use the same helper for
other rendered Markdown surfaces later, but this first change is scoped to
Snippets.

---

## 4. Markdown Toolbar Code Button

The existing code button in `desktop-rust/src/components/md-toolbar.js` should
use the requested rules.

When there is no selected text:

````text
```

```
````

That means: insert an opening triple-backtick line, a blank line, and a closing
triple-backtick line. Place the caret on the blank line.

When text is selected:

- If the selection is inside a single line, wrap it in single backticks:
  `` `selected` ``.
- If the selection contains one or more complete lines, wrap the selected block
  with triple-backtick lines before and after the selected lines.
- If the selected text contains a newline, treat it as a block selection.

The toolbar should continue dispatching an `input` event after it modifies the
textarea.

---

## 5. Editor Layout

When creating a new snippet, focus the name input when the modal opens.

In the editor modal, the description area is collapsed by default for both new
and existing snippets. This gives more vertical space to the snippet code field.

The collapsed description row should still make it clear whether a description
exists:

- label: `Description`;
- state indicator: `filled` or `empty`;
- expand/collapse affordance.

When expanded, the description textarea and its Markdown toolbar are shown.
When collapsed, they do not consume editor height.

The snippet value field remains visible and keeps its toolbar.

---

## 6. State and Defaults

Detail view default active tab:

- `Code` when a snippet is selected;
- if the currently active tab disappears after editing or selecting another
  snippet, fall back to `Code`.

Editor description collapse state:

- default collapsed on modal open;
- local to the open modal;
- no persistence setting in the first version.

---

## 7. Testing

Update frontend smoke coverage where practical:

- create/open a new snippet editor and verify the name input receives focus;
- verify the detail view shows `Code` by default;
- verify `Description`, `Links`, and `Note` tabs are hidden when empty;
- verify `Description` appears when description exists;
- verify `Links` appears when links exist and does not render an embedded iframe;
- verify a rendered Markdown code block copy button copies only the block text;
- verify the toolbar code button inserts a fenced block with no selection and
  wraps selected text correctly.

Run before commit:

```bash
node --check desktop-rust/src/tabs/shortcuts.js
node --check desktop-rust/src/components/md-toolbar.js
node --check desktop-rust/src/dev-mock.js
cd desktop-rust/src && python3 dev-test.py
```

Because no Rust or IPC changes are planned, `cargo check` is optional for this
frontend-only feature unless implementation unexpectedly touches
`desktop-rust/src-tauri/`.

---

## 8. Release Notes

This is user-facing desktop behavior. If implemented, update:

- `desktop-rust/src/tabs/help.js` in English and Russian;
- `desktop-rust/CHANGELOG.md`.

If only `desktop-rust/src/` changes, release as frontend-only OTA tag
`f-YYYYMMDD-N`.
