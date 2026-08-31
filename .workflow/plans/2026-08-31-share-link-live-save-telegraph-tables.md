# Share Link Live Save and Telegra.ph Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep existing Ister share URLs current after note Save and render Markdown tables as aligned monospaced text in Telegra.ph.

**Architecture:** Preserve the server’s existing live-read share contract, complete local Save immediately, then asynchronously query the existing link status and use centralized `doSync()` only for an active shared note. Move pipe-table recognition into one dependency-free server helper used by public-share HTML and Telegra.ph; Telegraph alone formats the normalized plain-text cells into one sanitized `<pre>` node.

**Tech Stack:** Python 3/FastAPI converter tests, vanilla JavaScript desktop UI, Tauri command bridge already present, CDP browser smoke tests.

**Spec:** `.workflow/specs/2026-08-31-share-link-live-save-telegraph-tables.md`

## Global Constraints

- Publication occurs after explicit **Save**, not while typing.
- The existing `ister-app.ru/share/...` URL and token remain unchanged.
- Live public HTML responses disable browser/proxy caching for the unchanged URL.
- Telegra.ph remains an explicitly updated snapshot/export channel.
- Telegra.ph output may use only officially allowed Node tags and attributes.
- No database migration, sync protocol change, Tauri command change, new dependency, legacy Python desktop change, or mobile change.
- Shared-note refresh must not block editor close/list reload; an unshared note must not trigger a full sync.
- Cell sanitization/entity decoding occurs before display-width calculation; inline Markdown source markers remain literal in the Telegra.ph preformatted fallback.
- Preserve unrelated user files, including `.workflow/Screenshot_1.png` and `.workflow/scr/`.
- Do not commit, tag, push, or deploy without a separate user request.

---

### Task 1: Aligned Telegra.ph Table Conversion

**Files:**
- Modify: `tests/api/test_telegraph.py`
- Modify: `tests/api/test_share_utils.py`
- Create: `api/markdown_tables.py`
- Modify: `api/share_utils.py`
- Modify: `api/telegraph.py`

**Interfaces:**
- Consumes: `markdown_to_telegraph_nodes(title: str, markdown: str) -> list`
- Produces: shared `split_table_row`, `parse_table_separator`, `table_start_at`, and `normalize_table_cells` helpers plus Telegraph-only sanitized preformatted text; both public renderer signatures remain unchanged.

- [ ] **Step 1: Add all table behavior tests before production changes**

  Replace the permissive legacy Telegraph assertion with tests whose
  hand-written literals cover:

  - Cyrillic headers, left/right alignment, and exact clean output;
  - center alignment, missing/extra cells, optional edge pipes, escaped pipes,
    and a pipe inside an inline-code span;
  - HTML/entity cleanup before width calculation;
  - CJK or emoji width plus a combining-mark value;
  - non-table pipe prose and fenced table-like code;
  - one shared fixture rendered by both `render_share_html` and
    `markdown_to_telegraph_nodes`, proving both recognize the same cell layout.

  The base Telegraph expectation is exactly:

  ```text
  Назначение  Внешний порт  Внутренний адрес
  ──────────  ────────────  ────────────────
  MTProxy             7443  192.168.1.96
  SSH                  5555  192.168.1.96
  ```

- [ ] **Step 2: Run the table tests and verify the RED state**

  Run:

  ```bash
  tests/api/.venv/bin/python -m pytest tests/api/test_telegraph.py tests/api/test_share_utils.py -q
  ```

  Expected: the new Telegraph exact-output/parity assertions FAIL because the
  current node contains the original pipes and separator row. Existing public
  HTML table assertions remain green.

- [ ] **Step 3: Extract the shared table recognizer without changing public HTML behavior**

  Move the existing parsing behavior from `api/share_utils.py` into
  `api/markdown_tables.py` with these stable interfaces:

  ```python
  def split_table_row(line: str) -> list[str] | None: ...
  def parse_table_separator(line: str, expected_cells: int) -> list[str] | None: ...
  def table_start_at(lines: list[str], index: int) -> tuple[list[str], list[str]] | None: ...
  def normalize_table_cells(cells: list[str], width: int) -> list[str]: ...
  ```

  Import them from `share_utils.py` and prove its complete table tests remain
  green before changing Telegraph output.

- [ ] **Step 4: Implement Telegraph formatting against the shared recognizer**

  Change `_split_blocks` to look ahead with `table_start_at`. Normalize rows to
  the header width. Convert every cell through `_plain_text` before measuring.
  Use `unicodedata.combining` and `unicodedata.east_asian_width` (`W`/`F` count
  as 2; combining marks count as 0), pad left/right/center, join columns with
  two spaces, and build a `─` divider. Emit the formatted string through the
  existing `("pre", body)` block.

- [ ] **Step 5: Run the complete focused table tests and verify GREEN**

  Run the command from Step 2. Expected: all tests PASS and the existing public
  share HTML strings are unchanged.

### Task 2: Live Public Page Cache Contract

**Files:**
- Modify: `tests/api/test_share_headers.py`
- Modify: `api/routes/share_links.py`

**Interfaces:**
- Consumes: existing `PUBLIC_SHARE_HEADERS` passed to `/share/{token}` HTML responses.
- Produces: explicit no-store/no-cache response policy for live public content.

- [ ] **Step 1: Add a failing cache-header test**

  Assert exact `Cache-Control`, `Pragma`, and `Expires` values in
  `PUBLIC_SHARE_HEADERS`, then run the single test and confirm RED because the
  keys are absent.

- [ ] **Step 2: Add the live response cache policy**

  Add `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`,
  `Pragma: no-cache`, and `Expires: 0` to the existing response header map.

- [ ] **Step 3: Re-run share-header and focused share tests**

  Expected: cache-header, Telegraph, and public share rendering tests PASS.

### Task 3: Note Save Triggers Sync Without Losing Local Success

**Files:**
- Modify: `desktop-rust/src/dev-test.py`
- Modify: `desktop-rust/src/tabs/notes.js`

**Interfaces:**
- Consumes: existing `call('update_note', ...)`, `call('get_share_link', ...)`, and centralized `doSync()`.
- Produces: immediate local-save completion followed by `get_share_link -> doSync` only for an active link, with local success retained if lookup/sync rejects.

- [ ] **Step 1: Add all Save/sync behavior tests before production changes**

  Extend the Notes smoke section with independent tests that assert:

  ```text
  shared note: update_note happens before exactly one trigger_sync
  unshared note: update_note happens and trigger_sync does not
  slow shared-note sync: editor/list transition finishes before sync resolves
  rejected shared-note sync: local value persists and delayed-publication warning appears
  rejected update_note: editor stays open and trigger_sync does not run
  ```

  Use the existing `window.__mockTriggerSync` hook for controllable rejection
  or a pending promise. For the local-write failure case, temporarily wrap the
  browser mock `invoke` function around `update_note` only. Reset every test
  override in cleanup.

- [ ] **Step 2: Run the smoke suite and verify RED**

  Run from `desktop-rust/src`:

  ```bash
  python3 dev-test.py
  ```

  Expected: the shared-note ordering and sync feedback assertions FAIL because
  `onSaveNote` never checks link state or invokes `doSync()`.

- [ ] **Step 3: Implement non-blocking shared-note synchronization**

  Import `doSync` from `../components/status-bar.js`. Refactor `onSaveNote()` so
  the local write has its own failure boundary. After a successful update,
  capture the saved UUID, close/reload the editor immediately, then start (do
  not await from the click flow) a helper equivalent to:

  ```javascript
  async function syncSharedNoteAfterSave(itemUuid) {
    const link = await call('get_share_link', { itemType: 'note', itemUuid });
    if (!link) return;
    await doSync();
  }
  ```

  Handle lookup failure silently as deferred normal sync because link status is
  unknown. If an active link was found and `doSync()` rejects, show an info
  warning that local Save succeeded and the public link updates after the next
  successful sync. Keep technical state in centralized status-bar/log handling.
  Never start the helper after a failed local write or for a newly created note.

- [ ] **Step 4: Run the smoke suite and verify GREEN**

  Run `python3 dev-test.py`. Expected: all smoke tests PASS, including the new
  ordering assertion.

- [ ] **Step 5: Re-run the smoke suite and verify cleanup**

  Run `python3 dev-test.py` a second time. Expected: all tests PASS again and no
  mock rejection/pending promise leaks into later tests or the second run.

### Task 4: User Documentation and Unreleased Notes

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `FRONTEND_PATTERNS.md`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`

**Interfaces:**
- Consumes: the completed behaviors from Tasks 1 and 2.
- Produces: user-visible Help wording and matching Unreleased release entries.

- [ ] **Step 1: Update Help text**

  Update both `en` and `ru` Telegra.ph Help entries to state that valid Markdown
  tables are converted to aligned monospaced text because Telegra.ph has no
  table nodes. Update both Notes entries to state that Save of a note with an
  active live link triggers background sync so the existing URL receives the
  saved revision without recreation.

- [ ] **Step 2: Add matching Unreleased bullets**

  Add concise bullets below `## Unreleased` in both changelog sources:

  ```markdown
  - **Live note share refresh:** saving a note now triggers sync so an existing public URL serves the saved revision without recreation.
  - **Readable Telegra.ph tables:** Markdown tables now publish as aligned monospaced text instead of raw pipe/separator markup.
  ```

- [ ] **Step 3: Update the reusable frontend pattern**

  Extend `FRONTEND_PATTERNS.md` §13 with the aligned preformatted-table fallback
  and the rule that live-link Save refresh uses active-link detection plus
  centralized background sync without blocking or recreating the token.

- [ ] **Step 4: Validate changed JavaScript syntax**

  Run from `desktop-rust/src`:

  ```bash
  node --check tabs/notes.js
  node --check tabs/help.js
  ```

  Expected: both commands exit 0.

### Task 5: Integrated Verification

**Files:**
- Verify only; no new files.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: evidence that both behavior changes work together and unrelated Share behavior remains intact.

- [ ] **Step 1: Run focused API tests**

  ```bash
  tests/api/.venv/bin/python -m pytest tests/api/test_telegraph.py tests/api/test_share_utils.py -q
  ```

  Expected: PASS.

- [ ] **Step 2: Run the complete practical API suite**

  ```bash
  tests/api/.venv/bin/python -m pytest tests/api -q
  ```

  Expected: PASS, or report exact pre-existing/environmental failures without
  claiming completion.

- [ ] **Step 3: Run the complete desktop frontend smoke suite**

  From `desktop-rust/src`:

  ```bash
  python3 dev-test.py
  ```

  Expected: all checks PASS.

- [ ] **Step 4: Inspect the final diff and working-tree classification**

  Confirm the diff is limited to the spec/plan, Telegraph converter/tests,
  Notes save/test, Help, and Unreleased docs. Preserve the pre-existing deleted
  screenshot and untracked screenshot directory without staging or restoring
  them.

- [ ] **Step 5: Prepare the production visual fixture**

  Provide the user a Markdown note containing narrow, Cyrillic, alignment,
  escaped-pipe, inline-code-pipe, and wide-table cases. The user publishes or
  updates that note after deployment; inspect the resulting Telegra.ph URL in
  browser and Telegram before any release is considered visually accepted.
