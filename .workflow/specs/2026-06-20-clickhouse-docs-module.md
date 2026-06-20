# ClickHouse Docs Module — Design Spec

**Date:** 2026-06-20
**Status:** approved direction with pragmatic scope reduction
**Scope:** desktop app only, new DEV sidebar module

## Goal

Add a desktop `ClickHouse` module in the DEV sidebar group under `Search`.
The module provides a local searchable reference for ClickHouse documentation,
with section-level search so large pages such as function indexes return the
relevant function block instead of the entire article.

## First-Release Scope

The original brief is treated as a direction, not a hard first-release scope.
This release implements the local module, local database, manual update, digest,
and section-level search. It does not implement a separate OS cron/daemon or a
full recursive crawler of the entire ClickHouse website.

## Sidebar Placement

- Add `ClickHouse` as a real module tab, not an inner SQL tab.
- Add it to the existing `DEV` group immediately after `Search`.
- Use the existing Simple Icons logo mechanism: `logo:clickhouse`.

## User Interface

The first screen is the usable docs browser, not a landing page.

- Header:
  - search input;
  - `Update docs` button;
  - `Changelog` button;
  - compact status text with page/section count and last update time.
- Left panel:
  - navigation tree grouped by documentation category.
- Main panel:
  - when no search is active: selected article rendered as Markdown;
  - when search is active: ranked section-level results;
  - selecting a result opens only the matching section context by default.

## Data Source

Use official ClickHouse documentation Markdown from the
`ClickHouse/clickhouse-docs` GitHub repository as the update source, and keep
the public ClickHouse docs URL separately for UI/source links. First release
uses a curated seed list rather than a full crawler. The seed list focuses on
high value SQL reference pages:

- Array functions
- String functions
- Date/time functions
- JSON functions
- Data types overview
- SELECT
- CREATE TABLE
- INSERT
- MergeTree

The seed list can be expanded later without changing UI architecture.

## Local Storage

Add local SQLite tables:

- `clickhouse_doc_pages`: page metadata, raw source URL, public docs URL,
  content hash, raw markdown.
- `clickhouse_doc_sections`: section title, level, slug, category, parent page,
  stable `section_path`, normalized searchable text, section content hash.
- `clickhouse_doc_update_runs`: update timestamp, status, counts, and summary.
- `clickhouse_doc_changes`: per-run added/changed/removed page or section rows.

This is local desktop data and is not synced between devices in this release.

Required invariants:

- `clickhouse_doc_pages.source_url` is unique.
- `clickhouse_doc_sections(page_id, section_path)` is unique.
- sections are deleted with their page via `ON DELETE CASCADE`.
- indexes exist for page/category navigation, page sections, section slug, and
  normalized search text.

## Parsing

The updater fetches raw Markdown over HTTP, strips frontmatter and MDX comment
blocks, and splits it by Markdown headings.

The section parser treats `## functionName` as the searchable section boundary.
Nested `###` headings stay inside the function body, so search results do not
show generic fragments such as `Arguments` without the owning function name.
Fenced code blocks are ignored when detecting headings.

If the website HTML extraction fails, the updater keeps the previous local data
and records a failed update run.

## Search

Search is implemented over local sections:

- tokenize query by spaces after lowercasing, punctuation splitting, and
  camelCase splitting;
- match against section title, page title, and section body;
- exact title and exact compact function-name matches rank highest;
- all query tokens should be present somewhere in the searchable text;
- return the relevant section excerpt and metadata.

This is intentionally simpler than FTS5 in the first release, but the table
layout leaves room for FTS later.

## Updates

- User can run `Update docs` manually.
- No OS-level cron, background daemon, or server-side scheduled job in this
  release.

## Digest

Each update compares content hashes against the previous local database:

- added pages/sections;
- changed pages/sections;
- removed sections from pages still in the seed set;
- failed source URLs.

Fetch/parse happens before DB writes. Successfully parsed pages are applied in
a DB transaction; failed URLs leave the previous local page/sections untouched
and are recorded as `partial` or `failed` update rows. Removed sections are
only calculated for sources that were fetched and parsed successfully.

The `Changelog` modal shows recent update runs and their change rows.

## Release

This adds DB migrations and new Tauri commands, so it must ship as full desktop
release `v1.17.0`.
