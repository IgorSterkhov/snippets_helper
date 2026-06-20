# ClickHouse Section-First Navigation — Spec

**Date:** 2026-06-20
**Status:** approved direction
**Scope:** desktop frontend, ClickHouse Docs module

## Goal

Reduce ClickHouse Docs rendering work by treating large documentation pages as
containers of smaller sections. Users should browse and render individual
function/section blocks instead of full pages such as Array Functions.

## Requirements

- The existing local database model stays unchanged: pages are still stored in
  `clickhouse_doc_pages`, sections in `clickhouse_doc_sections`.
- The left navigation shows documentation pages grouped by category.
- The active page expands in the left navigation and shows its sections.
- Clicking a page shows a section index/overview for that page, not the full
  raw Markdown page.
- Clicking a section renders only that section body.
- Search result clicks continue to render only the matching section.
- If a page has no parsed sections, the module may fall back to rendering the
  full page.
- No new Tauri commands or DB migrations are required.

## Release

This is a frontend-only behavior change and can ship as an `f-*` OTA release.
