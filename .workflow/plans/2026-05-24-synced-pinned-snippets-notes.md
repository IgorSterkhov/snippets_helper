# Synced Pinned Snippets And Note Chip Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add synced pinned snippets and synced pinned-note chip ordering, with mobile data compatibility but no mobile UI.

**Architecture:** Store pin state and pinned chip order on existing synced rows. Desktop Rust owns DB migrations, commands, and sync schema; desktop frontend renders panel switching and chip DnD; API and mobile data layers preserve the new fields during sync.

**Tech Stack:** Rust/Tauri, vanilla JS desktop frontend, Python FastAPI/SQLAlchemy/Alembic API, React Native SQLite mobile data layer, existing browser mock tests.

---

### Task 1: API And Shared Sync Schema

**Files:**
- Create: `api/alembic/versions/007_add_pinned_shortcuts_and_note_order.py`
- Modify: `api/models.py`
- Modify: `shared/sync_schema.py`

- [ ] Add Alembic migration:
  - `shortcuts.is_pinned INTEGER DEFAULT 0`
  - `shortcuts.pinned_sort_order INTEGER DEFAULT 0`
  - `notes.pinned_sort_order INTEGER DEFAULT 0`
- [ ] Add matching SQLAlchemy model fields on `Shortcut` and `Note`.
- [ ] Add `is_pinned` and `pinned_sort_order` to shared `shortcuts.data_fields`.
- [ ] Add `pinned_sort_order` to shared `notes.data_fields`.
- [ ] Verify no API route change is needed because sync routes introspect SQLAlchemy columns.

### Task 2: Desktop Native DB, Models, Commands, Sync

**Files:**
- Modify: `desktop-rust/src-tauri/src/db/mod.rs`
- Modify: `desktop-rust/src-tauri/src/db/models.rs`
- Modify: `desktop-rust/src-tauri/src/db/queries.rs`
- Modify: `desktop-rust/src-tauri/src/commands/shortcuts.rs`
- Modify: `desktop-rust/src-tauri/src/commands/notes.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`
- Modify: `desktop-rust/src-tauri/src/sync/schema.rs`

- [ ] Add desktop migrations for the same three columns.
- [ ] Extend `Shortcut` with `is_pinned: bool` and `pinned_sort_order: i32`.
- [ ] Extend `Note` with `pinned_sort_order: i32`.
- [ ] Update shortcut SELECT/INSERT/UPDATE code to preserve pin fields.
- [ ] Add `set_shortcut_pinned(id, is_pinned)`:
  - when pinning, assign next `pinned_sort_order`;
  - when unpinning, keep order value harmless but exclude from pinned list;
  - update `updated_at` and `sync_status = 'pending'`.
- [ ] Add `reorder_pinned_shortcuts(ids)` and `reorder_pinned_notes(ids)`:
  - update only passed pinned rows;
  - set sequential `pinned_sort_order`;
  - update `updated_at` and `sync_status = 'pending'`.
- [ ] Add native commands and register them in `lib.rs`.
- [ ] Add Rust tests for shortcut pin, shortcut reorder, note reorder, and sync upsert preserving fields.

### Task 3: Desktop Snippets UI

**Files:**
- Modify: `desktop-rust/src/tabs/shortcuts.js`
- Modify: `desktop-rust/src/styles.css`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] Add persisted panel setting `snippets_panel_mode = tags|pinned`.
- [ ] Add a compact selector beside sort with `Tags` and `Pinned`.
- [ ] Render existing tag panel when mode is `tags`.
- [ ] Render pinned snippet chips when mode is `pinned`, ordered by
  `pinned_sort_order`, then name.
- [ ] Add pin/unpin button in snippet detail header.
- [ ] Keep edit/save rename flow unchanged except that chip labels update after
  `loadShortcuts()`.
- [ ] Reuse/adapt Tasks wrapped chip pointer DnD for snippets.
- [ ] Add mock commands `set_shortcut_pinned` and `reorder_pinned_shortcuts`.
- [ ] Add browser smoke coverage for pinning, panel switch, chip reorder, and
  rename updating the pinned chip label.

### Task 4: Desktop Notes UI

**Files:**
- Modify: `desktop-rust/src/tabs/notes.js`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] Sort `pinnedNotes` by `pinned_sort_order`, then title.
- [ ] Add Tasks-style wrapped chip DnD to notes pinned chips.
- [ ] Call `reorder_pinned_notes` on drop.
- [ ] Add mock command `reorder_pinned_notes`.
- [ ] Add browser smoke coverage for pinned note chip reorder.

### Task 5: Mobile Data Compatibility

**Files:**
- Modify: `mobile/src/db/database.js`
- Modify: `mobile/src/db/snippetRepo.js`
- Modify: `mobile/src/db/noteRepo.js`
- Modify: `mobile/__tests__/db/snippetRepo.test.js`
- Modify: `mobile/__tests__/db/noteRepo.test.js`
- Modify: `mobile/package.json`

- [ ] Add fresh-install columns to `CREATE TABLE`.
- [ ] Add idempotent `ALTER TABLE` migrations for existing installs.
- [ ] Preserve new fields in `buildUpsertSnippet` and `buildUpsertNote`.
- [ ] Ensure `getModified*Since` sends the fields through existing `SELECT *`.
- [ ] Bump mobile OTA version from `1.0.16` to `1.0.17`.
- [ ] Update Jest tests to assert new fields are included in INSERT params.

### Task 6: Help, Release History, And Verification

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock`

- [ ] Add Help text for Snippets pinned panel and pinned chip reorder.
- [ ] Add release history/changelog entries.
- [ ] Bump desktop native version to `1.3.31`.
- [ ] Run:
  - `cd desktop-rust/src-tauri && cargo check`
  - targeted Rust tests for shortcuts/notes pinning
  - `cd desktop-rust/src && python3 dev-test.py`
  - mobile Jest tests covering DB repos/sync compatibility
- [ ] Commit changes.
- [ ] Deploy API migration/server code.
- [ ] Release desktop `v1.3.31` and verify assets/manifests.
- [ ] Release mobile OTA `1.0.17` and verify `latest.json`.
