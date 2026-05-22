# Snippets Code Block Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render indented Markdown fences correctly and show a compact language header on every fenced code block in Snippets.

**Architecture:** Keep the change frontend-only. Normalize Markdown fence-marker lines immediately before `marked(...)`, then decorate rendered `<pre><code>` blocks in the existing `enhanceMarkdownCodeBlocks(root)` helper.

**Tech Stack:** Vanilla JavaScript in `desktop-rust/src/tabs/shortcuts.js`, CSS in `desktop-rust/src/styles.css`, browser mock smoke tests in `desktop-rust/src/dev-test.py` and fixtures in `desktop-rust/src/dev-mock.js`.

---

### Task 1: Add Red Smoke Coverage

**Files:**
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] Add a snippet fixture named `Indented fenced blocks` with value:

```markdown
Indented fences:

   ```bash
   echo ok
   ```

```sql
select 1;
```

```
plain text
```
```

- [ ] Add a smoke test after the existing Snippets tests:
  - Open Shortcuts.
  - Select `Indented fenced blocks`.
  - Assert `.markdown-code-header` labels are `['bash', 'sql', 'plain']`.
  - Assert there are three `.markdown-code-copy` buttons.
  - Click the first copy button and assert copied text includes `echo ok` and does not include `bash`.

- [ ] Run `cd desktop-rust/src && python3 dev-test.py`.
  - Expected RED: the new test fails because `.markdown-code-header` does not exist yet.

### Task 2: Implement Markdown Fence Normalization

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`

- [ ] Add `normalizeMarkdownFences(text)`:

```js
function normalizeMarkdownFences(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(/^[ \t]+(```[^\n\r]*)$/gm, '$1');
}
```

- [ ] Add `renderMarkdownHtml(text)`:

```js
function renderMarkdownHtml(text) {
  return marked(normalizeMarkdownFences(text || ''));
}
```

- [ ] Replace direct `marked(...)` calls for snippet value, description, and note content with `renderMarkdownHtml(...)`.

### Task 3: Add Code Block Headers

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`
- Modify: `desktop-rust/src/styles.css`

- [ ] In `enhanceMarkdownCodeBlocks(root)`, detect the rendered language from `code.className`, using `plain` when missing.
- [ ] Add `.markdown-code-block`, `.markdown-code-header`, `.markdown-code-lang`, `.markdown-code-lang-dot`, and language group classes to each `<pre>`.
- [ ] Move/create the copy button inside the header so it copies `code.textContent`.
- [ ] Add CSS matching visual option B: compact header strip, dot, muted language label, copy button on the right, and calm language colors.

### Task 4: Verify and Document

**Files:**
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src/tabs/help.js`

- [ ] Run `node --check desktop-rust/src/tabs/shortcuts.js`.
- [ ] Run `node --check desktop-rust/src/tabs/help.js` if edited.
- [ ] Run `cd desktop-rust/src && python3 dev-test.py`.
- [ ] Update Help and Changelog to mention language headers and indented fence support.
- [ ] Commit with a short one-line message.
- [ ] Because this is frontend-only user-facing behavior, cut an `f-*` OTA release after verification.
