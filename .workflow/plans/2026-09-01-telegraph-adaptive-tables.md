# Adaptive Telegra.ph Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep narrow Telegra.ph tables aligned while turning wide or link-bearing Markdown tables into mobile-readable, clickable vertical records.

**Architecture:** Preserve the shared Markdown table recognizer, but retain parsed table data until the Telegra.ph node-rendering stage. Measure normalized visible cell content with the existing Unicode display-width rules; render qualifying body rows as atomic `blockquote` records and keep other tables as the existing aligned `<pre>` fallback.

**Tech Stack:** Python 3, Telegra.ph Node JSON, pytest, vanilla JavaScript Help copy, desktop CDP smoke tests.

**Spec:** `.workflow/specs/2026-09-01-telegraph-adaptive-tables.md`

## Global Constraints

- Work in the current `main` branch as explicitly requested by the user.
- Record mode requires at least one visibly non-empty normalized body row and triggers on any syntactic Markdown link, a safe bare URL, or compact width greater than 32 display columns.
- Exactly 32 columns remains compact; 33 columns becomes records.
- Row and column counts alone never trigger record mode; header-only tables remain compact.
- Each non-empty record is one top-level `blockquote`; empty fields and all-empty rows are omitted.
- Safe Markdown/bare table-cell URLs become clickable; unsafe Markdown targets trigger records but degrade to their visible labels.
- Public-share HTML, API contracts, database schema, dependencies, Tauri IPC, native Rust, mobile, and legacy Python desktop behavior remain unchanged.
- Preserve unrelated user changes and keep commits one line.
- Use TDD: watch each new behavior test fail before adding production code.

---

### Task 1: Complete Adaptive Decision and Record Nodes

**Files:**
- Modify: `tests/api/test_telegraph.py`
- Modify: `api/telegraph.py`

**Interfaces:**
- Consumes: `table_start_at`, `split_table_row`, `normalize_table_cells`, `_plain_text`, `_display_width`, `_safe_href`.
- Produces: internal parsed table blocks, `TELEGRAPH_COMPACT_TABLE_MAX_WIDTH = 32`, normalized visible-width/link detection, and record node rendering; public `markdown_to_telegraph_nodes(title, markdown) -> list` remains unchanged.

- [ ] **Step 1: Add failing adaptive-rendering tests**

  Add literal fixtures proving: a two-column formatted width of exactly 32
  emits `<pre>`; width 33 emits `blockquote`; a narrow safe Markdown link and a
  narrow safe bare URL emit clickable `a` nodes; a narrow unsafe Markdown link
  still emits `blockquote` but contains no anchor, target, or raw Markdown.
  Change the existing 42-column Cyrillic fixture from an obsolete `<pre>`
  expectation to literal record-node expectations. In the same RED batch, add
  the representative four-column article fixture, omitted empty fields/rows,
  all-empty-body compact fallback, exact record-child structure, safe
  `mailto:`, trailing punctuation, Markdown-image protection, and no duplicate
  anchors around Markdown link targets. When an emitted field has an empty
  visible header, assert that its value has neither a label nor a leading
  `": "`. Add a wide/link shared-parser fixture proving Telegra.ph produces
  records while `render_share_html` still produces an HTML `<table>`. Add the
  header-only compact case as an unchanged-behavior characterization test.

- [ ] **Step 2: Run the focused tests and verify RED**

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest \
    tests/api/test_telegraph.py -q
  ```

  Expected: new record-mode assertions fail because every valid table is still
  immediately converted to `<pre>`. The header-only characterization remains
  green.

- [ ] **Step 3: Retain parsed tables and implement the minimal adaptive renderer**

  In `api/telegraph.py`, add an internal `MarkdownTable` dataclass, change
  `_split_blocks` table output from preformatted text to the parsed object, and
  handle that block in `markdown_to_telegraph_nodes`. Add small helpers with
  these exact internal interfaces and responsibilities:

  - `_visible_table_text(text: str) -> str` returns HTML-stripped,
    entity-decoded text with every recognized Markdown link replaced by its
    label and is reused by measurement and compact output;
  - `_table_display_width(table: MarkdownTable) -> int` returns the
    hand-specified column maxima plus two-column gaps;
  - `_table_has_link(table: MarkdownTable) -> bool` checks any syntactic
    Markdown link and safe bare URLs across normalized cells;
  - `_should_render_table_records(table: MarkdownTable) -> bool` applies the
  visibly non-empty body-row, link, and strict 32-column conditions;
  - `_table_inline_nodes(text: str) -> list` preserves safe Markdown links and
    autolinks safe bare URLs without including trailing punctuation;
  - `_table_record_nodes(table: MarkdownTable) -> list[dict]` emits one atomic
    top-level `blockquote` for each non-empty normalized body row.

  Keep `_format_table` as the compact path, but feed it the same normalized
  link-label text used for width. Normalize every row to header width, omit
  empty fields/rows, require visible row content before record mode, and force
  header-only/all-empty-body tables through `_format_table`. Autolink bare URLs
  only inside plain-text spans of table records, protect Markdown links/images
  first, exclude trailing `.`, `,`, `;`, `:`, `!`, and `?`, and pass every
  target through `_safe_href`. Emit real `{"tag": "br"}` nodes only between
  entries. Emit a remaining field's `strong` label and `": "` together only
  when its visible header is non-empty; otherwise emit the value nodes directly.

- [ ] **Step 4: Run the focused tests and verify GREEN**

  Run the Task 1 command again. Expected: all focused tests pass.

---

### Task 2: Atomic Record Truncation

**Files:**
- Modify: `tests/api/test_telegraph.py`
- Modify: `api/telegraph.py`

**Interfaces:**
- Consumes: Task 1 adaptive table renderer and `_fit_nodes_to_limit`.
- Produces: payload fitting that never partially slices a table record.

- [ ] **Step 1: Add two failing truncation tests**

  After monkeypatching `TELEGRAPH_CONTENT_MAX_BYTES` to small deterministic
  values, add hand-written expectations proving output contains no partial
  record content and ends with the existing truncation notice in both cases:

  - the first atomic record alone is too large;
  - an oversized non-record block precedes atomic records.

- [ ] **Step 2: Run the new tests and verify RED**

  Run the two named tests with `pytest -q`. Expected: both fail because the
  current plain-text fallback can flatten and slice record content.

- [ ] **Step 3: Implement only the missing edge behavior**

  Make the no-first-node-fits branch return only the truncation notice when the
  rejected first node is an atomic table record, and restrict fallback text
  collection to nodes before the first atomic record so it can never flatten or
  slice that record or later records.

- [ ] **Step 4: Run all Telegraph tests and refactor while green**

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest \
    tests/api/test_telegraph.py -q
  ```

  Expected: PASS. The baseline currently reports five unrelated
  `datetime.utcnow()` deprecation warnings; no new warning or error may be
  introduced by this change.

---

### Task 3: User Help and Release Documentation

**Files:**
- Modify: `FRONTEND_PATTERNS.md`
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`

**Interfaces:**
- Consumes: the verified adaptive behavior from Tasks 1-2.
- Produces: accurate reusable guidance, bilingual Help, and the mandatory `f-20260901-1` release-history gate.

- [ ] **Step 1: Update the external snapshot pattern**

  Replace the unconditional aligned-pre rule in `FRONTEND_PATTERNS.md` §13
  with the 32-column/link adaptive rule and vertical-record behavior.

- [ ] **Step 2: Update English and Russian Help copy**

  Explain that narrow tables remain aligned monospace while wide or
  link-bearing tables become labeled vertical records with clickable links.

- [ ] **Step 3: Add matching release entries**

  Add `## f-20260901-1 (2026-09-01)` at the top of both release-history files,
  describing mobile-readable adaptive Telegra.ph tables. Leave native version
  `1.24.3` unchanged.

- [ ] **Step 4: Validate changed JavaScript syntax**

  ```bash
  node --check desktop-rust/src/tabs/help.js
  ```

  Expected: exit code 0.

---

### Task 4: Review, Verification, Release, and Production Validation

**Files:**
- Review: all files changed in Tasks 1-3 plus this spec/plan.
- No additional product files unless verification exposes a scoped defect.

**Interfaces:**
- Consumes: complete implementation and docs.
- Produces: reviewed commit, frontend OTA tag, deployed API, and visual evidence on the reported page.

- [ ] **Step 1: Run complete practical verification**

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api -q
  node --check desktop-rust/src/tabs/help.js
  cd desktop-rust/src && python3 dev-test.py
  cd ../src-tauri && cargo check
  ```

  Expected: API suite and frontend smoke suite pass, JavaScript parses, and
  Rust check exits 0 without modifying source files.

- [ ] **Step 2: Review the final diff**

  Confirm behavior against every spec criterion, inspect for unsafe URL
  handling and unintended public-share changes, and verify the worktree has no
  unrelated files. Apply all blocking/important review findings and rerun
  affected checks.

- [ ] **Step 3: Commit and push the reviewed implementation**

  Create one short one-line commit and push `main`.

- [ ] **Step 4: Deploy and smoke-test the API before Help OTA**

  Fast-forward `/opt/snippets_helper` on the configured production host,
  rebuild/restart with the existing Docker Compose workflow, verify migration
  completion and `https://ister-app.ru/snippets-api/health`.

- [ ] **Step 5: Publish and verify the automatic Help OTA**

  Create and push `f-20260901-1`, monitor the matching GitHub Actions run to
  completion, verify exactly three frontend assets, and fetch the tag-specific
  `frontend-version.json`.

- [ ] **Step 6: Validate the reported Telegra.ph page**

  Ask the user to press Update for
  `https://telegra.ph/Personalizirovannye-vakciny-ot-raka-09-01`, then inspect
  desktop and 320-390 px layouts and confirm every safe table link is clickable
  without raw Markdown syntax.
