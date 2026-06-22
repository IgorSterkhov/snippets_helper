# ClickHouse Reference Console Redesign Spec

## Goal

Redesign the desktop ClickHouse module using the approved `A. Reference Console`
direction. The module should feel like a fast local engineering reference for
ClickHouse rather than a generic documentation page.

## Scope

- Desktop frontend only; primary implementation file is
  `desktop-rust/src/tabs/clickhouse-docs.js`.
- Supporting files are `desktop-rust/src/dev-test.py`,
  `desktop-rust/src/tabs/help.js`, `desktop-rust/src/release-history.md`, and
  `desktop-rust/CHANGELOG.md`.
- Preserve existing Rust/Tauri IPC commands and lazy-loading behavior.
- Keep startup fast: loading the tree must not fetch a page body.
- Keep large pages section-first: page open shows a section index before
  fetching a single selected section body.
- Keep search, update progress, changelog, and official docs link.
- Update Help and release history for the visible redesign.

## Design Direction

Subject: ClickHouse local reference console for engineers who need to quickly
find functions, syntax, and examples while coding.

Palette:

- `ch-ink`: `#07090d`
- `ch-panel`: `#0d1117`
- `ch-panel-raised`: `#101722`
- `ch-line`: `#26313e`
- `ch-yellow`: `#ffcc02`
- `ch-text`: `#e8edf2`

Layout:

- Header becomes a console-style command bar:
  - ClickHouse bar-logo mark.
  - Title and local index status.
  - Search input remains central and prominent.
  - `Update docs` and `Changelog` stay on the right.
- Body remains a three-zone reference layout:
  - Left: categorized navigation tree with active page and active section.
  - Center: section index or article content.
  - Right: compact local index/status rail.
- Update progress remains a full-width status strip under the header.

Signature Element:

- Use the ClickHouse vertical-bar logo motif as structural UI language:
  small logo in the header, yellow active rail for selected nav rows, and
  compact stats in the right rail. This is the only bold visual signature; the
  rest stays restrained and utilitarian.

## Behavior Requirements

- Existing `T26j` and `T27` ClickHouse smoke guarantees must keep passing.
- Add test coverage that:
  - the header exposes the new Reference Console frame;
  - the right status rail shows local section/page counts;
  - active navigation still expands sections;
  - search opens only the relevant section.

## Release

This is a frontend-only visible UI change. Release as `f-20260622-N` after
`node --check`, `python3 dev-test.py`, release-history grep, commit, tag, and
CI asset verification.
