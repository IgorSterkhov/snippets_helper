# Adaptive Telegra.ph Tables Spec

## Requirement

Improve Telegra.ph export for Markdown tables after production inspection showed
that Telegra.ph wraps wide `<pre>` content instead of providing horizontal
scrolling. The wrapped monospace rows no longer align, and Markdown links inside
the preformatted fallback remain visible as raw source syntax.

The product direction was confirmed on 2026-09-01: keep a compact monospace
representation for genuinely narrow tables and render wide or link-bearing
tables as vertical records.

This specification supersedes only the Telegra.ph table representation in
`.workflow/specs/2026-08-31-share-link-live-save-telegraph-tables.md`. The live
`/share/<token>` behavior and explicit Telegra.ph snapshot update workflow are
unchanged.

## Adaptive Decision

A recognized Markdown table is rendered as vertical records when it has at
least one visibly non-empty normalized body row and either condition is true:

1. any header or body cell contains a syntactic Markdown link or a safe bare
   URL;
2. its compact formatted width is greater than 32 display columns.

Otherwise it remains one aligned `<pre>` node. A header plus separator with no
body rows, or with only all-empty normalized body rows, always remains compact,
even when the header is wider than 32 columns or contains a link.

Row count and column count are not independent triggers.

The compact width is calculated after normalizing every row to the header
width:

```text
sum(maximum visible display width of each column) + 2 * (column_count - 1)
```

One canonical visible-cell normalization is used before both measurement and
compact output: raw HTML tags are removed, HTML entities are decoded, escaped
pipes are already normalized by the shared table parser, every syntactic
Markdown link contributes only its visible label, combining marks contribute
zero columns, and East Asian wide/full-width characters contribute two
columns. Other characters contribute one column. The threshold is strict: 32
stays compact; 33 becomes records.

Every syntactic Markdown link is a record-mode trigger. Only `http`, `https`,
and `mailto` targets accepted by the existing safe-link policy become clickable
nodes; an unsafe Markdown target degrades to its visible label without exposing
the target or raw Markdown. Safe bare URLs are detected inside plain cell-text
spans and become clickable in record output; trailing `.`, `,`, `;`, `:`, `!`,
and `?` punctuation is not included in the link target. Markdown links and
Markdown images are protected before bare-URL detection, so their targets are
not double-linked or turned into unintended anchors. The shared inline tokenizer
supports nested label brackets, balanced parentheses or angle brackets in link
destinations, and optional single-quoted, double-quoted, or parenthesized
Markdown titles. A bare URL directly adjacent to any Unicode word character is
not treated as a separate link.

## Vertical Record Representation

Each non-empty body row becomes one top-level Telegra.ph `blockquote` node so
the row remains an atomic unit during payload-size fitting. Its children use
only inline NodeElements: the optional first-cell `strong` heading, then one
`{"tag": "br"}` between emitted entries, followed for each remaining field by
the field content. When the visible header is non-empty, its label `strong` and
the literal `": "` are emitted together before the value. When the header is
empty, the value nodes are emitted directly with no label or colon. No leading
or trailing `br` is emitted.

The record rules are:

- the first cell, when non-empty, is emitted as the record heading using
  `strong` inline content;
- each remaining non-empty cell is placed on its own line;
- a non-empty header is emitted as a `strong` label followed by `: ` and the
  cell content;
- when a remaining column has an empty header, its value is emitted without an
  invented label;
- empty cells are omitted;
- a body row with no non-empty cells is omitted;
- Markdown links and safe bare URLs in values remain clickable;
- HTML stays stripped and unsafe URLs never become link nodes.

Separate `blockquote` nodes provide the visual separation between records; no
orphan separator node is needed. The converter uses only tags supported by the
official Telegra.ph NodeElement allow-list.

## Size Limit

The existing 60 KiB serialized-content limit remains unchanged. Because every
vertical record is one top-level node, fitting may keep or omit only complete
records. It must never emit a partially sliced record. If the first record alone
cannot fit, the converter emits the existing truncation notice rather than a
partial record. If an oversized non-record block appears before record nodes,
the plain-text fallback is restricted to content before the first atomic record
and can never flatten or slice that record or later records. Compact tables and
documents without record nodes keep the existing fallback behavior.

## Compatibility

- Markdown table recognition and row normalization remain shared with the live
  public-share renderer in `api/markdown_tables.py`.
- Public `ister-app.ru/share/...` pages continue to render normal HTML tables.
- Narrow Telegra.ph tables preserve alignment, Unicode padding, missing/extra
  cell normalization, and left/center/right alignment while rendering link
  labels instead of raw Markdown link source.
- Code fences containing table-like text and pipe prose remain unchanged.
- Existing headings, lists, paragraphs, images, HTML-card degradation,
  credential handling, and create/update page workflows remain unchanged.
- No database migration, dependency, API contract, Tauri command, native Rust,
  mobile, or legacy Python desktop change is required.

## Verification

- Unit tests lock the 32/33 display-column boundary independently of the
  implementation helper.
- Unit tests prove narrow safe/unsafe Markdown links and safe bare URLs trigger
  record output, while only safe targets create anchors.
- A representative four-column table from the reported cancer-vaccine article
  renders as records rather than `<pre>`.
- Tests cover header-only/all-empty tables, omitted empty fields/rows, unsafe
  links, bare-URL punctuation, `mailto:`, Markdown images, duplicate-link
  prevention, Unicode width, existing compact alignment, compact and record
  parser parity, first-record-too-large truncation, and an oversized non-record
  before records.
- Run the focused Telegraph tests and the complete practical API suite.
- Update the reusable publishing pattern, English/Russian Help copy, desktop
  changelog, and Help release history.
- Run `node --check`, the complete desktop browser smoke suite, and the desktop
  Rust sanity check required before a frontend release tag.
- After deployment, update the reported Telegra.ph page and inspect desktop and
  320-390 px mobile layouts plus link behavior.

## Release

This is a user-facing narrow behavior fix: API Python changes implement the
export, while desktop frontend changes only update Help/release copy. Native
Rust and IPC stay untouched, so the desktop delivery channel is a patch-level
`f-20260901-N` frontend OTA tag with no native version bump. Follow the automatic
release sequence in `CLAUDE.md` and `desktop-rust/RELEASES.md` after all code,
documentation, review, and verification gates pass. Push the reviewed commit,
deploy the API by the existing fast-forward production workflow, verify health,
then publish the Help OTA tag and continue to visual acceptance.

## Out of Scope

- real HTML table nodes, custom CSS, JavaScript, images, or iframes in
  Telegra.ph;
- changing the live public-share HTML table renderer;
- using row or column count as a width heuristic;
- automatically updating Telegra.ph on every local Save;
- changing share tokens, sync semantics, database schema, mobile UI, or the
  legacy Python desktop application.
