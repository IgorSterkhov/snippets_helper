# Public Share Markdown Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for the renderer change. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Markdown pipe tables correctly on public share pages and make the shortcut Copy button span the content width.

**Architecture:** Keep the hotfix inside the existing custom server-side renderer in `api/share_utils.py`. Add a small block-level pipe-table parser before paragraph/list handling, reuse `_render_inline_markdown` for cells, and style tables through the existing share-page CSS.

**Tech Stack:** Python server utility module, pytest unit tests, existing post-release share-link contract tests.

---

### Task 1: Add Regression Tests

**Files:**
- Modify: `tests/api/test_share_utils.py`
- Modify: `tests/post_release/test_share_links_contract.py`

- [ ] Add a shortcut share test whose value contains a Markdown pipe table with right-aligned numeric columns and an inline code span.
- [ ] Assert the rendered HTML contains `<table>`, `<thead>`, `<tbody>`, `<th>`, `<td>`, inline `<code>`, and no raw separator row.
- [ ] Add a shortcut share test whose value is only a table and assert it renders as `share-markdown` rather than a plain code block.
- [ ] Assert the Copy button has a dedicated class and full-width styling.
- [ ] Extend the live share-link contract fixture with a table and assert the public HTML contains table markup.
- [ ] Run `python3 -m pytest tests/api/test_share_utils.py -q` and confirm the new tests fail before implementation.

### Task 2: Implement Table Rendering

**Files:**
- Modify: `api/share_utils.py`

- [ ] Add helpers to split pipe rows, validate separator rows, derive alignment, and render table HTML.
- [ ] Update `_is_markdown_like` so table-only values are routed through the Markdown renderer.
- [ ] Convert `_render_markdown` from a `for` loop to an indexed loop so it can consume a table header, separator, and following body rows as one block.
- [ ] Reuse `_render_inline_markdown` for every table cell.
- [ ] Add dark-theme table CSS and a horizontal-scroll wrapper.
- [ ] Replace the generic Copy button with a `.share-copy-button` class and full-width CSS.

### Task 3: Verify and Commit

**Files:**
- Verify: `api/share_utils.py`
- Verify: `tests/api/test_share_utils.py`
- Verify: `tests/post_release/test_share_links_contract.py`

- [ ] Run `python3 -m pytest tests/api/test_share_utils.py -q`.
- [ ] Run the post-release share-link contract test if the local environment has the required smoke config; otherwise document why it was not run.
- [ ] Inspect the diff to ensure unrelated Rust/native changes are not staged.
- [ ] Commit only the scoped files for the share-renderer hotfix.
- [ ] Deploy the API hotfix if the repository exposes a known deployment path; otherwise report the tested commit and the missing deployment input.
