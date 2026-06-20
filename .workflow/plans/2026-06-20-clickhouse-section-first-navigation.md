# ClickHouse Section-First Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ClickHouse Docs navigation open lightweight section indexes and render only selected sections.

**Architecture:** Reuse the existing `get_clickhouse_doc_page` command, which already returns parsed sections. Keep a small frontend page cache, expand only the active page in the nav, and replace full-page rendering with a section index fallback.

**Tech Stack:** Vanilla JS, existing Tauri IPC wrapper, browser mock smoke tests.

---

## Tasks

- [ ] Add a failing browser smoke assertion in `desktop-rust/src/dev-test.py`:
  - opening the ClickHouse tab shows a section index for the first page;
  - the nav exposes section children for the active page;
  - clicking `arrayCompact` renders that section without `arrayConcat`.
- [ ] Update `desktop-rust/src/tabs/clickhouse-docs.js`:
  - add a `pageCache` map reset on init/destroy;
  - make `openPage(pageId, sectionPath)` load/cache the page;
  - render a page section index when `sectionPath` is empty;
  - render only the section body when `sectionPath` is set;
  - render active page sections under the page in the left nav.
- [ ] Update Help/release files:
  - `desktop-rust/src/tabs/help.js`;
  - `desktop-rust/src/release-history.md`;
  - `desktop-rust/CHANGELOG.md`.
- [ ] Verify:
  - `node --check desktop-rust/src/tabs/clickhouse-docs.js`;
  - `node --check desktop-rust/src/tabs/help.js`;
  - `python3 -m py_compile desktop-rust/src/dev-test.py`;
  - `cd desktop-rust/src && python3 dev-test.py`;
  - `git diff --check`.
