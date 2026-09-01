# Share Link Preview Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, automatically refreshed title and short-description metadata to public note share pages so Telegram can render a useful text preview.

**Architecture:** Keep `render_share_html(payload)` as the public HTML boundary and derive a deterministic plain-text description from the same current payload used for the visible page. A focused helper removes structural Markdown that is unsuitable for metadata, normalizes readable inline content, truncates at a word boundary, and returns text that is escaped only when inserted into `<head>`.

**Tech Stack:** Python 3, standard-library `re` and `html`, pytest, FastAPI HTML responses.

**Spec:** `.workflow/specs/2026-09-02-share-link-previews.md`

## Global Constraints

- Work in current `main` and preserve unrelated user and Claude changes.
- Preview descriptions contain at most 200 characters including the ellipsis.
- Metadata is derived per request; there is no database, payload-schema,
  dependency, packaged desktop/mobile asset, IPC, or native version change.
  The existing `public_url` response value gains the stable query suffix.
- User-controlled title and description values are escaped with `html.escape(..., quote=True)` before attribute insertion.
- Do not add an AI summary, manual summary field, preview image, or Telegra.ph behavior.
- Derive descriptions from note `content` only; never expose shortcut `value`
  through metadata.
- Use a short one-line commit and no desktop release tag.

---

### Task 1: Safe Public Share Preview Metadata

**Files:**
- Modify: `tests/api/test_share_utils.py`
- Modify: `api/share_utils.py`

**Interfaces:**
- Consumes: `render_share_html(payload: dict) -> str` and the existing public note payload fields.
- Produces: `_share_preview_description(payload: dict, limit: int = 200) -> str` and the unchanged `render_share_html(payload: dict) -> str` interface with preview metadata in `<head>`.

- [x] **Step 1: Add failing boundary tests**

  Add literal `render_share_html` fixtures proving that:

  - `meta[name="description"]` and `meta[property="og:description"]` contain
    readable note text while table rows, fenced code, image targets, raw tags,
    and Markdown markers do not appear;
  - inline `[label](relative-file.md)` and reference `[label][id]` links both
    preserve only `label` after their reference definitions are removed;
  - `og:title` and note content containing `"'><meta property="evil"` remain
    quoted attribute content and cannot create an additional metadata tag;
  - exact 200-character content remains unchanged; 201+ characters with spaces
    truncate at a word boundary; a 250-character unbroken Cyrillic/emoji token
    hard-truncates to 199 characters plus `…`;
  - short content remains unchanged and empty/markup-only content omits both
    description elements;
  - a shortcut payload never emits its `value` as a description;
  - ordinary text `2 < 3 > 1` survives HTML-tag removal.

- [x] **Step 2: Run the new tests and verify RED**

  Run:

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_share_utils.py -q
  ```

  Expected: the new metadata assertions fail because the current renderer emits
  only `<title>` and has no preview-description helper.

- [x] **Step 3: Implement the minimal description extractor and metadata**

  In `api/share_utils.py`:

  - return no description unless `payload["type"] == "note"`, then use its
    `content` as the only textual preview source;
  - reuse `FENCE_RE`, `_table_start_at`, and `_split_table_row` while scanning
    source lines to omit fenced blocks and complete Markdown tables;
  - reuse `REFERENCE_DEF_RE`, `REFERENCE_LINK_RE`, `LINK_RE`, and
    `SAFE_LINE_BREAK_RE` to remove definitions, keep link labels, normalize
    breaks, and avoid divergent Markdown parsing rules;
  - remove Markdown images and syntactically valid letter-named raw HTML tags
    without consuming ordinary comparison text such as `2 < 3 > 1`;
  - strip structural Markdown markers, normalize whitespace, and truncate to
    200 characters with `…`, hard-cutting when no word boundary exists;
  - escape the result with `html.escape(description, quote=True)`;
  - emit `description`, `og:title`, `og:description`, `og:type=article`, and
    `og:site_name=Ister App` in `<head>`, omitting both description tags when the
    helper returns an empty string.

- [x] **Step 4: Verify GREEN and regressions**

  Run:

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_share_utils.py -q
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api -q
  git diff --check
  ```

  Expected: all tests pass with only already-known suite warnings, and the diff
  has no whitespace errors.

- [ ] **Step 5: Review, commit, deploy, and verify production**

  Obtain repository-required independent code review with no Critical or
  Important findings, commit the implementation with a short one-line message,
  push `main`, update the production checkout, rebuild/restart the API, and
  verify:

  ```text
  https://ister-app.ru/snippets-api/v1/health
  https://ister-app.ru/share/JZsRs5YOiLkwmWekg9p3l4qDUCeNuzm0jqUkYRO8dQY
  ```

  The health response must be OK. The reported page `<head>` must contain an
  escaped title and a readable description derived from its current content.
  Then create a new note share URL that Telegram has not cached, paste it into
  Telegram, and confirm the rendered card contains its title and description.
  Do not create a desktop release tag.

---

### Task 2: Stable Telegram Cache Version

**Files:**
- Modify: `tests/api/test_share_utils.py`
- Modify: `tests/post_release/test_share_links_contract.py`
- Modify: `api/share_utils.py`
- Modify: `desktop-rust/src/dev-test.py`
- Modify: `desktop-rust/src/dev-mock.js`

**Interfaces:**
- Consumes: `build_public_url(request_url: str, token: str, forwarded_proto: str | None = None) -> str`.
- Produces: the same function signature, returning a stable
  `/share/<token>?preview=1` public URL.

- [x] **Step 1: Update public URL contract tests**

  Change both literal `build_public_url` expectations to include
  `?preview=1`. Keep the forwarded-protocol case so the cache suffix cannot
  regress HTTPS handling. Extend the post-release contract to assert that both
  note and shortcut API responses carry the exact query, and that both the
  versioned and legacy query-free forms serve the same current content. Add a
  desktop smoke assertion for the matching development-mock response.

- [x] **Step 2: Run the focused tests and verify RED**

  Run:

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_share_utils.py -q
  cd desktop-rust/src && python3 dev-test.py
  ```

  Expected: the two URL assertions fail because `build_public_url` still
  returns the legacy query-free path, and the browser smoke assertion fails
  because the development mock still returns the legacy URL. Metadata tests
  remain green. Do not run the production post-release contract before deploy.

- [x] **Step 3: Add the stable cache version**

  Change the final `build_public_url` return value to append the literal query
  `?preview=1`, and make the same one-line change in `dev-mock.js`. Do not
  derive it from timestamps, note updates, or user content, and do not change
  route matching or payload schemas.

- [x] **Step 4: Verify GREEN and regressions**

  Run:

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_share_utils.py -q
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api -q
  node --check desktop-rust/src/dev-mock.js
  cd desktop-rust/src && python3 dev-test.py
  git diff --check
  ```

  Expected: all tests pass with only the existing `datetime.utcnow()` warnings.

- [ ] **Step 5: Review, commit, deploy, and validate cache-busted copy**

  Obtain independent review with no Critical or Important findings, commit and
  push the change on current `main`, rebuild/restart the production API, and
  verify that the share-link API returns `?preview=1`, that both versioned and
  legacy URLs return HTTP 200 with current content, and that Telegram renders
  the already-confirmed preview for this distinct URL. Do not create a desktop
  tag: `dev-mock.js` is a development-only fixture excluded from packaged OTA
  assets. After production is restarted, run:

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/post_release/test_share_links_contract.py -q
  ```

  Expected: the production contract passes; it may skip only when smoke
  credentials are unavailable.
