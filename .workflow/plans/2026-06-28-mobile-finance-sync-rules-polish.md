# Mobile Finance Sync, Rules, and Header Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Finance `Group target` diagnostics, add editable Finance mapping rules, and make mobile Finance sync/header/row workflows usable.

**Architecture:** Keep desktop changes inside `desktop-rust/src/tabs/finance.js` using existing Tauri commands. Mobile changes stay in React Native JS: `FinanceScreen` owns Finance UI, `financeRepo` owns local rule mutation, and a small local sync-history repository records diagnostic sync events emitted by `syncService`.

**Tech Stack:** vanilla JS desktop frontend, React Native mobile, SQLite-backed mobile repositories, existing mobile sync service and desktop smoke/Jest tests.

---

### Task 1: Group Target Global Diagnostic

**Files:**
- Modify: `desktop-rust/src/tabs/finance.js`
- Modify: `desktop-rust/src/dev-test.py`
- Modify: `mobile/src/screens/Finance/FinanceScreen.js`
- Modify: `mobile/__tests__/finance/FinanceScreen.test.js`

- [x] Add failing desktop and mobile tests proving `Group target` is visible when a matching fact exists outside current date/search filters, and that clicking it clears those filters and shows the matching fact.
- [x] Implement global group-target existence helpers that ignore date/search filters.
- [x] Add click handlers that clear date/search filters before setting `group_target`.
- [x] Verify with `python3 dev-test.py` and mobile Jest.

### Task 2: Editable Finance Mapping Rules

**Files:**
- Modify: `desktop-rust/src/tabs/finance.js`
- Modify: `desktop-rust/src/dev-test.py`
- Modify: `mobile/src/db/financeRepo.js`
- Modify: `mobile/src/screens/Finance/FinanceScreen.js`
- Modify: `mobile/__tests__/finance/FinanceScreen.test.js`

- [x] Add failing tests for editing an existing Taxi rule from `expense` to `any` on desktop and mobile.
- [x] Desktop: change rules modal to show a compact rule selector/list and reuse the form for create/edit.
- [x] Desktop: call existing `update_finance_mapping_rule` for selected existing rules and keep `create_finance_mapping_rule` for new rules.
- [x] Explicitly encode rule direction edits through `conditions_json`: changing `expense` to `any` removes the `direction` condition before persisting.
- [x] Mobile: add `updateFinanceMappingRule` in `financeRepo.js` using `buildUpsertFinanceMappingRule` and `sync_status='pending'`.
- [x] Mobile: replace the long rules list with a selector plus visible form; support save/apply for existing and new rules.
- [x] Verify rule edits mark rows pending and can be synced.

### Task 3: Mobile Sync Details and History

**Files:**
- Create: `mobile/src/db/syncHistoryRepo.js`
- Modify: `mobile/src/db/database.js`
- Modify: `mobile/src/sync/syncService.js`
- Modify: `mobile/src/sync/useSyncStatus.js`
- Modify: `mobile/src/components/SyncStatusBar.js`
- Modify: `mobile/src/screens/Finance/FinanceScreen.js`
- Add/modify tests under `mobile/__tests__/sync/`.

- [x] Add a local SQLite table/repository for recent sync events with fields:
  `id`, `created_at`, `status`, `table_name`, `row_uuid`, `direction`,
  `action`, `details_json`.
- [x] Create `sync_history` and indexes in `database.js`, and prune history to a compact rolling window, e.g. last 200 events.
- [x] During sync, record summary events and row-level events for pulled,
  pushed, accepted, rejected, and conflicts.
- [x] Record full-pull events and sync error/warning paths too, including compact row context and expanded JSON for errors/conflicts.
- [x] Expose pending count, syncing flag, last debug, and recent history through
  `useSyncStatus`.
- [x] Enhance `SyncStatusBar` so tap opens a details modal/sheet showing summary
  plus recent history rows with expandable JSON/details.
- [x] Preserve manual sync behavior by adding an explicit `Sync now` action inside the details sheet.
- [x] Keep the compact pill behavior on phones and allow richer details on wide
  screens without adding a seventh bottom-tab item.
- [x] Add Jest coverage for the sync history repository, successful push/pull logging, warning/rejected logging, error logging, and full-pull logging.

### Task 4: Mobile Finance Header and Row Creation

**Files:**
- Modify: `mobile/src/screens/Finance/FinanceScreen.js`
- Modify: `mobile/__tests__/finance/FinanceScreen.test.js`

- [x] Add tests for compact selected-plan header, kind editing, overflow menu,
  and hidden visible trash/delete action.
- [x] Replace selected-list header with one compact row: name, currency, kind
  selector, overflow menu.
- [x] Move edit/delete actions into overflow.
- [x] Change `createItem`/`+ child` flow to set editing item UUID, expand parent,
  and scroll the new row into view.
- [x] Verify mobile Jest and manual smoke in the browser mock where possible.

### Task 5: Release Documentation and Verification

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `mobile/package.json`

- [x] Update Finance Facts help in EN/RU.
- [x] Add release-history/changelog entry for the desktop frontend tag.
- [x] Bump mobile OTA version.
- [x] Run `node --check` on changed JS files, `python3 dev-test.py`, focused mobile Jest, `cargo check`, and `git diff --check`.
- [ ] Commit and release as frontend-only desktop OTA plus mobile OTA unless native/API surface changes appear.
