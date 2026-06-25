# Desktop Micro Launchpad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a global-hotkey frameless Launchpad window for opening standalone modules, opening specific objects, and running Exec commands.

**Architecture:** Add a native `launchpad` command module modeled after `micro_picker.rs`, with a new custom URL mode in `main.js`. The frontend Launchpad lives in a focused component that stores per-machine layout/settings via existing `get_setting`/`set_setting`, uses existing data-list commands for search/add, and uses existing standalone modules plus a URL target route for object opening.

**Tech Stack:** Tauri/Rust commands, vanilla JavaScript frontend, existing app settings, existing `run_command`, existing browser `dev-test.py` smoke tests.

---

### Task 1: Native Window And Hotkey Contract

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/mod.rs`
- Create: `desktop-rust/src-tauri/src/commands/launchpad.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`
- Modify: `desktop-rust/src-tauri/src/commands/ota.rs`
- Modify: `desktop-rust/src-tauri/src/commands/module_windows.rs`
- Modify: `desktop-rust/src-tauri/capabilities/default.json`

- [x] Add Rust tests first:
  - `launchpad::default_hotkey()` returns `Ctrl+Alt+L`.
  - `launchpad::window_label()` returns `micro_launchpad`.
  - `launchpad::window_spec()` returns URL `khapp://localhost/index.html?launchpad=1`, size `640x430`, `resizable=false`, `decorations=false`, `always_on_top=true`.
  - `module_window_spec()` accepts `finance`, `clickhouse-docs`, and `ai`.
  - OTA reload logic recognizes `micro_launchpad`.

- [x] Run `cd desktop-rust/src-tauri && cargo test launchpad module_window --lib`.
  Expected before implementation: tests fail because `launchpad` module does not exist and module specs are missing.

- [x] Implement `commands::launchpad`:
  - `open_launchpad(app)` toggles the window.
  - `close_launchpad(app)` closes it.
  - window URL: `khapp://localhost/index.html?launchpad=1`.
  - size: about `640x430`, non-resizable, decorations false, always-on-top true.
  - position: centered near the upper third of the primary monitor.

- [x] Register commands in `lib.rs` invoke handler and register the default hotkey from setting key `launchpad.hotkey`, fallback `Ctrl+Alt+L`.

- [x] Add `micro_launchpad` to OTA reload window labels/capabilities.

- [x] Extend standalone module specs for `finance`, `clickhouse-docs`, and `ai`.

### Task 2: Standalone Object Route

**Files:**
- Modify: `desktop-rust/src/main.js`
- Modify: `desktop-rust/src-tauri/src/commands/module_windows.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`
- Modify: `desktop-rust/src/dev-mock.js`

- [x] Add frontend smoke test first in `desktop-rust/src/dev-test.py`:
  - open standalone `?standalone=1&module=tasks&objectType=task&objectUuid=<uuid>`;
  - verify the Tasks module receives and opens the target task.

- [x] Run `cd desktop-rust/src && python3 dev-test.py`.
  Expected before implementation: new test fails because standalone route ignores object target params.

- [x] Implement parsing for standalone object params:
  - `objectType`
  - `objectId`
  - `objectUuid`
  - `title`
  - optional `detailTab`

- [x] After the standalone module loader resolves, dispatch `view-history:open` with the parsed entry.

- [x] Add and register explicit native command `open_module_object_window`.

- [x] `open_module_object_window` accepts `moduleId`, `objectType`,
  `objectId`, `objectUuid`, `title`, and optional detail fields.

- [x] When no standalone module window exists, it URL-encodes target params into
  `?standalone=1&module=...&objectType=...&objectUuid=...`.

- [x] When the standalone module window already exists, it focuses the window
  and emits an event such as `standalone:open-object` to the module window with
  the same view-history-style detail.

- [x] Add dev mock coverage for both new-window and existing-window paths.

### Task 3: Launchpad Frontend Shell

**Files:**
- Create: `desktop-rust/src/components/micro-launchpad.js`
- Modify: `desktop-rust/src/main.js`
- Modify: `desktop-rust/src/styles.css`
- Modify: `desktop-rust/src/dev-mock.js`

- [x] Add smoke tests first:
  - `?launchpad=1` renders a frameless Launchpad root.
  - `?launchpad=1` does not create the main status bar and does not call sync/update startup paths.
  - gear menu toggles `Show search` and `Show recent` via mocked `set_setting`.
  - `Ctrl+E` enters edit mode and `Esc` exits edit mode.

- [x] Run `cd desktop-rust/src && python3 dev-test.py`.
  Expected before implementation: tests fail because `launchpad=1` is not handled.

- [x] Implement `getLaunchpadRequest()` in `main.js` and load `micro-launchpad.js`.

- [x] Ensure Launchpad boot mode returns before main-window side effects:
  first-run check, `TabContainer`, status bar, sync/update watchers,
  visibility-change sync, and main-window Escape-to-hide.

- [x] Implement component state:
  - settings keys: `launchpad.show_search`, `launchpad.show_recent`, `launchpad.items`.
  - default settings: search on, recent on, empty manual item list.

- [x] Implement dark compact Launchpad shell with gear menu, optional search, grid, optional recent, footer hints.

### Task 4: Launchpad Items, Add Picker, Reorder

**Files:**
- Modify: `desktop-rust/src/components/micro-launchpad.js`
- Modify: `desktop-rust/src/styles.css`
- Modify: `desktop-rust/src/dev-test.py`

- [x] Add smoke tests first:
  - Add picker can add a module tile.
  - Add picker can add a task tile by UUID.
  - Edit mode remove deletes a tile from persisted settings.
  - Pointer reorder changes persisted item order.

- [x] Run `cd desktop-rust/src && python3 dev-test.py`.
  Expected before implementation: tests fail because Add/reorder/remove do not exist.

- [x] Implement Add picker data collection:
  - modules from the same tab metadata used by `main.js`;
  - tasks via `list_tasks`;
  - snippets via `list_shortcuts`;
  - notes by `list_note_folders` + `list_notes`;
  - Exec commands by `list_exec_categories` + `list_exec_commands`.

- [x] Implement item serialization as JSON in `launchpad.items`.

- [x] Implement pointer reorder with same-size placeholder and simple FLIP or existing wrapped-chip principles.

### Task 5: Search, Recent, Actions, And Command Status

**Files:**
- Modify: `desktop-rust/src/components/micro-launchpad.js`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [x] Add smoke tests first:
  - searching finds module, task, note, snippet, and Exec command results.
  - module tile invokes `open_module_window`.
  - task/note/snippet tiles invoke `open_module_object_window`.
  - Exec command tile invokes `run_command` with saved shell/wsl settings.
  - command status shows success output and closes on Esc after completion.
  - opening an item writes it into persisted `launchpad.recent`.

- [x] Run `cd desktop-rust/src && python3 dev-test.py`.
  Expected before implementation: tests fail because tile actions are inert.

- [x] Implement search aggregation/filtering for modules, tasks, notes, snippets, and Exec commands.

- [x] Implement action dispatch:
  - module: `open_module_window({ moduleId })`;
  - object: `open_module_object_window({ moduleId, objectType, objectId, objectUuid, title })`;
  - exec command: `run_command({ command, shell, wslDistro })`.

- [x] Persist `launchpad.recent` after successful open/run. Keep the list capped at 12 items.

- [x] Implement compact status view with running, success, and failure states.

### Task 6: Help, Release History, Verification, Release

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock`

- [x] Update Help in EN/RU with Launchpad behavior and hotkey.

- [x] Bump native version from the current version to the next minor version.

- [x] Add release history and changelog section for the release tag.

- [x] Run:
  - `node --check desktop-rust/src/main.js`
  - `node --check desktop-rust/src/components/micro-launchpad.js`
  - `node --check desktop-rust/src/tabs/help.js`
  - `cd desktop-rust/src && python3 dev-test.py`
  - `cd desktop-rust/src-tauri && cargo test launchpad --lib`
  - `cd desktop-rust/src-tauri && cargo test module_windows --lib`
  - `cd desktop-rust/src-tauri && cargo test frontend_window_labels_include_micro_launchpad --lib`
  - `cd desktop-rust/src-tauri && cargo check`

- [x] Commit with a one-line message.

- [x] Tag and push a full `v*` release, then monitor GitHub Actions and verify release assets.
