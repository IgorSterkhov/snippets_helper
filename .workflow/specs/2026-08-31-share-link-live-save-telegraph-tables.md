# Share Link Live Save and Telegra.ph Tables Spec

## Requirement

Improve the desktop Share link workflow in two places:

1. A note that already has an active `https://ister-app.ru/share/...` URL must
   publish its saved edits without revoking or recreating the URL.
2. Markdown tables exported to Telegra.ph must look like aligned tables rather
   than raw Markdown pipe syntax.

The product direction was confirmed on 2026-08-31:

- the live public page updates after the user presses **Save**;
- Telegra.ph uses option **B**, an aligned monospaced representation.

## Existing Behavior and Root Cause

The public Ister share URL is already live on the server: every request loads
the current server-side note or snippet row. The post-release API contract also
proves that an unchanged token returns version 2 after the item is synced.

The stale-note defect is in the desktop save path. `update_note` writes the
editor content to local SQLite, while `trigger_sync` currently runs only when a
live link is first created or a Telegra.ph snapshot is published/updated.
Revoking and recreating a link appears to fix the page because link creation
incidentally runs that missing sync.

The public HTML route also lacked explicit anti-cache headers. A browser or
reverse proxy could therefore reuse an older response for the unchanged URL,
while a recreated token appeared fresh. A live page must prevent this caching
in addition to syncing the source row.

Telegra.ph does not accept `table`, `thead`, `tr`, `th`, or `td` nodes. Its
official NodeElement allow-list provides only basic text, list, media, and
preformatted-content tags. The current converter therefore sends every
pipe-looking table line unchanged inside `<pre>`, including the Markdown
separator row. This preserves data but does not produce a readable table.

## Live Public Link Semantics

- Pressing **Save** remains the publication boundary; typing alone does not
  publish drafts.
- After a successful local save of an existing note, desktop completes the UI
  transition immediately, then asynchronously checks the existing
  `get_share_link` status. Only a note with an active live link starts the
  centralized `doSync()` flow. No new API or Tauri command is introduced.
- When online, the existing `ister-app.ru/share/...` token immediately serves
  the newly synced title and body. Its URL never changes.
- The public HTML response sends `Cache-Control: no-store, no-cache,
  must-revalidate, max-age=0` with legacy `Pragma`/`Expires` fallbacks so the
  unchanged live URL is revalidated instead of displaying a cached revision.
- Link lookup or sync failure must not turn a successful local save into a
  false “save failed” result. The editor closes/reloads normally. If an active
  link was found but sync failed, the user sees a clear warning that the note
  was saved locally and the public page will update after the next successful
  sync; the centralized sync status/log retains the technical failure.
- A successful shared-note sync states that the public link was synced.
- An unshared note does not start `trigger_sync`, so ordinary Save does not
  become a full push/pull operation. A local-write failure starts neither link
  lookup nor sync and leaves the editor open.
- Share-status lookup and sync do not block editor close/list reload. Slow or
  unavailable networking therefore cannot make local Save feel stuck.
- Existing Create/Copy/Open/Revoke behavior and Telegra.ph’s explicit snapshot
  Update behavior remain unchanged.

## Telegra.ph Table Representation

A valid Markdown pipe table is recognized only when it contains:

- a header row with at least two cells;
- an immediately following separator row whose cells contain at least three
  hyphens and optional leading/trailing alignment colons;
- zero or more following pipe rows until a blank or non-table line.

For each valid table, the converter emits one allowed Telegra.ph `<pre>` node:

- leading/trailing Markdown pipes are removed;
- the Markdown separator syntax is replaced by a clean visual divider;
- each column width is calculated from its header and body values;
- cells are padded with spaces and columns are separated by two spaces;
- `:---` is left-aligned, `---:` is right-aligned, and `:---:` is centered;
- rows with missing cells are padded and extra cells are ignored to the header
  width;
- escaped pipes and pipes inside inline-code spans do not split a cell;
- each cell is converted to final plain text before width calculation: raw HTML
  is stripped and HTML entities are decoded; Markdown backticks, emphasis, and
  link source syntax remain literal to preserve data in the non-interactive
  `<pre>` fallback;
- Unicode display width is used for padding so Cyrillic and common wide
  characters do not corrupt neighboring columns.

Example conversion:

```text
Назначение  Внешний порт  Внутренний адрес
──────────  ────────────  ────────────────
MTProxy             7443  192.168.1.96
SSH                  5555  192.168.1.96
```

Wide tables may still require Telegra.ph’s horizontal scrolling. Wrapping or
splitting columns is intentionally excluded because it would destroy row
alignment and contradict the selected monospaced-table direction.

## Error Handling and Compatibility

- Markdown table recognition and row normalization live in one small shared
  server module used by both `share_utils.py` and `telegraph.py`. The existing
  public-share HTML table output is behavior-compatible while both renderers
  agree on optional edge pipes, escapes, code spans, separators, and row width.
- Code fences containing pipes stay code blocks.
- A line containing pipes that is not followed by a valid separator remains
  ordinary content and is not misclassified as a table.
- Existing links, headings, lists, images, HTML-card degradation, payload size
  checks, and Telegraph access-token handling are unchanged.
- No database migration, sync protocol change, new dependency, or mobile
  change is required.

## Verification

- Python unit tests cover the exact aligned output, all three alignment modes,
  HTML/entity cleanup before measurement, escaped/code-span pipes, missing
  cells, non-table pipe text, CJK/emoji width, and combining marks. A parity
  fixture proves both share renderers recognize the same tables.
- Desktop browser smoke tests prove a shared note runs `update_note` before
  exactly one `trigger_sync`, an unshared note does not sync, and slow sync does
  not delay editor close.
- Desktop smoke tests prove local-write failure does not sync or close the
  editor, while sync failure still persists the local edit and shows the
  delayed-publication warning.
- An API unit test locks the no-store/no-cache response headers for the live
  public HTML route.
- Run the focused API test file, complete API tests when practical,
  `node --check`, and `python3 dev-test.py`.
- For production visual validation, publish/update one Telegra.ph test note
  containing narrow, Cyrillic, right-aligned, centered, escaped-pipe, and wide
  tables, then inspect both the desktop browser and Telegram preview.

## Documentation and Release

- Update desktop Help to explain Save-triggered live-link synchronization and
  aligned Telegra.ph table fallback.
- Update both English and Russian Help copy and the reusable external snapshot
  pattern in `FRONTEND_PATTERNS.md`.
- Add the changes under **Unreleased** in both desktop changelog sources.
- The implementation changes API Python and desktop frontend JavaScript only;
  it does not change `src-tauri`. Do not commit, tag, push, or deploy unless the
  user requests those operations separately.

## Out of Scope

- Real-time publication while the user is typing;
- automatically updating Telegra.ph snapshots after every Save;
- rendering Telegra.ph tables as images or responsive label/value cards;
- changing public-share token lifetime or permissions;
- changing the legacy Python desktop application or mobile client.
