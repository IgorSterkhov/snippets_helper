# ClickHouse Full Doc Discovery Spec

## Current Goal

Make the ClickHouse module import the full Russian ClickHouse documentation tree instead of the current functions-only discovery, and fix the left navigation so terminal page rows are visually left-aligned with the tree structure.

## Decisions

- `Update docs` should discover Markdown sources under `i18n/ru/docusaurus-plugin-content-docs/current/` through the GitHub Trees API `recursive=1`, then filter paths locally. This avoids hundreds of GitHub Contents API calls and the unauthenticated REST rate limit problem.
- Discovery should accept both `.md` and `.mdx` files.
- `_category_.json` and non-Markdown files are not stored as pages.
- If the GitHub tree response is truncated, the updater should treat discovery as failed and fall back to the built-in seed list rather than silently importing a partial tree.
- Public URLs should stay on the Russian docs route: `https://clickhouse.com/docs/ru/<path>`.
- Large pages remain parsed into sections by existing Markdown heading logic, so the frontend still opens lightweight section indexes instead of rendering full articles upfront.
- The navigation tree should keep indentation by category/page depth, but page labels and section labels must align text to the left, not center within the row.

## User-Visible Result

- After `Update docs`, pages such as `engines/table-engines/mergetree-family/aggregatingmergetree` become searchable and visible in the left tree.
- The left tree terminal page rows read as a normal hierarchical tree with left-aligned labels.

## Release

This changes native Rust discovery code, so it must ship as a full desktop patch release `v1.19.1`.
