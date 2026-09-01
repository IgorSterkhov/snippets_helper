# Live Share `<br>` Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render explicitly allowlisted `<br>` spellings as safe line breaks on public live-share pages while keeping all other raw HTML escaped.

**Architecture:** Extend the existing token-based inline Markdown renderer rather than introducing generic HTML parsing. Protected code, link, and image spans remain stashed first; a dedicated no-attributes `<br>` regex then stashes canonical `<br>` nodes before `html.escape` handles everything else.

**Tech Stack:** Python 3, standard-library `re` and `html`, pytest.

**Spec:** `.workflow/specs/2026-09-01-live-share-br-tags.md`

## Global Constraints

- Only public live `/share` HTML changes; Telegra.ph and desktop/mobile renderers remain unchanged.
- Accept only `(?i)<br[ \t]*(?:/[ \t]*)?>`: case-insensitive, horizontal whitespace, and no attributes/newlines.
- Code spans/fences keep literal escaped tags; all other raw HTML stays escaped.
- No dependency, database, API contract, desktop asset, IPC, or native version change.
- Work in current `main`, preserve unrelated changes, and use a one-line commit.

---

### Task 1: Allowlisted Inline Break Rendering

**Files:**
- Modify: `tests/api/test_share_utils.py`
- Modify: `api/share_utils.py`

**Interfaces:**
- Consumes: `_render_inline_markdown(text: str, references: dict[str, str] | None = None) -> str` and `render_share_html(payload: dict) -> str`.
- Produces: the same interfaces with approved raw break spellings rendered as canonical `<br>` only in non-code inline text.

- [ ] **Step 1: Add public-boundary failing tests**

  Add literal `render_share_html` fixtures that prove:

  - `<br>`, `<BR/>`, `<br />`, `<br >`, `<br/ >`, and `<bR   /   >` inside a
    Markdown table cell become canonical `<br>` elements and do not leave
    escaped break tags in that ordinary cell content;
  - a paragraph and list item render an approved break;
  - inline code and fenced code render `&lt;br&gt;` literally;
  - `<br class="gap">`, `<br onerror="alert(1)">`, `<br / class="gap">`,
    `<brx>`, and `<script>` remain escaped and cannot create elements;
  - for a newline inside `<br\n>`, the tag-name fragments remain escaped as
    `&lt;br` and `&gt;` and are not recognized by the allowlist; the renderer's
    separate structural `<br>` between the two Markdown source lines remains
    expected paragraph behavior.

- [ ] **Step 2: Run the new tests and verify RED**

  Run the named tests with:

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_share_utils.py -q
  ```

  Expected: the approved raw-break assertions fail because
  `_render_inline_markdown` currently passes them through `html.escape`; the
  existing raw-HTML safety assertions remain green.

- [ ] **Step 3: Implement the minimal allowlist**

  In `api/share_utils.py`, add the compiled pattern
  `re.compile(r"<br[ \t]*(?:/[ \t]*)?>", re.IGNORECASE)`.
  After code/image/reference-link/inline-link substitutions have protected
  their spans, replace matches in the remaining marked text with
  `stash("<br>")`. Keep this before `rendered = html.escape(marked)` and use the
  existing final token-restoration loop. Do not decode or pass through any
  other raw tag.

- [ ] **Step 4: Verify GREEN and regressions**

  Run:

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_share_utils.py -q
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api -q
  git diff --check
  ```

  Expected: all tests pass with only the already-known `datetime.utcnow()`
  warnings in the full API suite.

- [ ] **Step 5: Review, commit, deploy, and verify production**

  Obtain the repository-required independent review with no Critical/Important
  findings, commit with a short one-line message, push `main`, fast-forward
  `/opt/snippets_helper`, rebuild/restart Docker Compose, and verify:

  ```text
  https://ister-app.ru/snippets-api/v1/health
  https://ister-app.ru/share/8oHNXu0IQjGGtGNmU-OlqaBeUpWyouy4ijPxUkiGOZc
  ```

  The health response must be OK. The reported page must contain real `<br>`
  elements in the affected ordinary table-cell fragments instead of their
  escaped source text; escaped break tags in `<code>`/`<pre>` remain correct.
  Do not create a desktop release tag.
