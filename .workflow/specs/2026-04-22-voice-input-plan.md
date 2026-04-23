# Whisper Voice Input — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new left-sidebar tab "Whisper" that allows local voice dictation via whisper.cpp, with a global hotkey, floating overlay, onboarding model installer, and per-machine settings — per the spec at `.workflow/specs/2026-04-22-voice-input-design.md`.

**Architecture:** Native audio capture via `cpal` → WAV in memory → lazy-spawned `whisper-server` sidecar (HTTP on localhost, random port) with idle-timeout unload → post-processing (rules + optional LLM) → inject to active window (clipboard / Ctrl+V / type). Floating overlay is a second Tauri WebviewWindow. UI follows existing two-pane pattern (Shortcuts/Notes).

**Tech Stack:** Tauri v2, Rust (new deps: `cpal`, `hound`, `enigo`, `sysinfo`), vanilla JS (no build step), SQLite via `rusqlite`, whisper.cpp as `externalBin` sidecar from `ggml-org/whisper.cpp` releases.

**Spec reference:** `/home/aster/dev/snippets_helper-feat-whisper/.workflow/specs/2026-04-22-voice-input-design.md` — all architectural decisions are pinned there; this plan is purely about execution order.

**Branch:** `feat/whisper` (worktree at `/home/aster/dev/snippets_helper-feat-whisper`)

**CLAUDE.md reminders:**
- п.5: commit messages — one line each
- п.7: before any change under `desktop-rust/src-tauri/`, `desktop-rust/src/`, or `.github/workflows/release-desktop.yml` — RE-READ `desktop-rust/RELEASES.md`. It governs OTA, versioning, manifest/signature requirements.
- п.6: spec stays in `.workflow/specs/`

**Important testing convention for this project:**
- UI iteration: `cd desktop-rust/src && python3 -m http.server 8000` then open `dev.html`. Uses `dev-mock.js` for Tauri command stubs.
- Smoke tests: `cd desktop-rust/src && python3 dev-test.py` (CDP-based, 7 tests must pass before any `v-*` tag).
- Native dev: `cd desktop-rust && ./dev-docker.sh dev` (real Tauri + WebKit in Docker).

---

## Chunk 0: Baseline verification

Before touching anything else, confirm the worktree is in a known-good state. This chunk exists so any later failure can be attributed to new work rather than pre-existing issues.

### Task 0.1: Verify clean worktree and build baseline

**Files:** none (verification only)

- [ ] **Step 1: Confirm worktree branch and status**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git status
git branch --show-current
```

Expected: clean working tree, branch `feat/whisper`.

- [ ] **Step 2: Read RELEASES.md completely**

```bash
cat desktop-rust/RELEASES.md
```

This is mandatory per CLAUDE.md п.7. Note OTA flow, version gotchas, and where `tauri.conf.json` + `Cargo.toml` versions must stay aligned. You will need this knowledge every time you touch `src-tauri/`.

- [ ] **Step 3: Cold `cargo check` on Rust side**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo check 2>&1 | tail -30
```

Expected: finishes with warnings allowed, but no errors. First run on a cold worktree can take 10+ minutes (Tauri + rusqlite-bundled + all transitive deps); subsequent incremental builds are fast. Do NOT interpret a long wait as failure — wait for the command to return.

If errors appear: STOP. These are pre-existing, not yours. Report to the human before proceeding.

- [ ] **Step 4: Verify smoke tests pass on the current tree**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src
python3 dev-test.py 2>&1 | tail -20
```

Expected: 7/7 PASS.

If any fail: STOP, pre-existing failure; report.

- [ ] **Step 5: No commit** — this chunk changes nothing.

---

## Chunk 1: Dependencies, config, SQLite schema, module skeleton

This chunk sets up the foundation: adds the 4 new Rust crates, declares the overlay window + `externalBin` in `tauri.conf.json`, extends `init_db()` with the two whisper tables, and creates empty (but compilable) Rust module files so subsequent chunks have somewhere to put code. No behavior yet.

### Task 1.1: Add new Rust dependencies to `Cargo.toml`

**Files:**
- Modify: `desktop-rust/src-tauri/Cargo.toml` (add entries to `[dependencies]`)

- [ ] **Step 1: Inspect current deps to find the right block**

```bash
grep -n '^\[dependencies\]' /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri/Cargo.toml
grep -n 'tauri-plugin-global-shortcut\|rdev\|arboard' /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri/Cargo.toml
```

- [ ] **Step 2: Add the new deps**

Append to the end of the `[dependencies]` block (before the next `[...]` section):

```toml
# Whisper voice input
cpal = "0.15"
hound = "3.5"
enigo = "0.2"
sysinfo = "0.30"
```

- [ ] **Step 3: Run cargo check**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo check 2>&1 | tail -20
```

Expected: compiles. Four new crates resolved and downloaded.

If platform-specific deps fail on Linux dev machines (CI builds run inside Docker, which ships these, so CI is unaffected):

- `cpal` needs `libasound2-dev` (ALSA headers)
- `enigo` needs `libxdo-dev` (X11 automation), and on Wayland session you may also need `libxkbcommon-dev` plus running under Xwayland for key simulation to work

```bash
sudo apt-get install -y libasound2-dev libxdo-dev libxkbcommon-dev pkg-config
```

On macOS and Windows no extra system packages are needed.

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/Cargo.toml desktop-rust/src-tauri/Cargo.lock
git commit -m "whisper: add cpal, hound, enigo, sysinfo deps"
```

### Task 1.2: Declare overlay WebviewWindow and externalBin in `tauri.conf.json`

**Files:**
- Modify: `desktop-rust/src-tauri/tauri.conf.json`

- [ ] **Step 1: Inspect current shape**

```bash
cat /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri/tauri.conf.json
```

You will need to know the structure to place the new `windows[]` entry and the `bundle.externalBin` field. Existing code uses Tauri v2 config schema.

- [ ] **Step 2: Add the overlay window to `app.windows[]`**

Append to the `windows` array (keep existing main window first):

```json
{
  "label": "whisper-overlay",
  "url": "khapp://localhost/tabs/whisper/whisper-overlay.html",
  "title": "Whisper",
  "width": 260,
  "height": 90,
  "resizable": false,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "visible": false,
  "focus": false
}
```

The `khapp://localhost/...` URL matches this project's custom URI-scheme handler registered in `lib.rs:35` (`register_uri_scheme_protocol("khapp", ...)`). The CSP in `app.security.csp` whitelists `khapp://localhost`, so other URL forms would be CSP-blocked.

Use exactly the same key names (camelCase) as the existing main-window entry in the same file. If any key is rejected at compile time, drop only that key — the rest of the entry must remain.

The overlay HTML file at `khapp://localhost/tabs/whisper/whisper-overlay.html` is created in Chunk 11. Until then the window exists but is invisible (`visible: false`), so the missing file is harmless.

- [ ] **Step 3: Add `bundle.externalBin` entry**

In the `bundle` object, add:

```json
"externalBin": [
  "binaries/whisper-server"
]
```

Tauri expects the actual files on disk to be named `binaries/whisper-server-<target-triple>` (e.g. `binaries/whisper-server-aarch64-apple-darwin`, `binaries/whisper-server-x86_64-pc-windows-msvc.exe`). We will provide these in Chunk 12 (CI) — for now, just declare the reference.

- [ ] **Step 4: Verify config still parses**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo check 2>&1 | tail -10
```

Expected: compiles. (`tauri::generate_context!` parses this file at compile time. If JSON is malformed, you will see a clear error.)

- [ ] **Step 5: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/tauri.conf.json
git commit -m "whisper: declare overlay window + externalBin in tauri.conf.json"
```

### Task 1.3: Extend `run_migrations()` with whisper tables and update existing schema test

**Files:**
- Modify: `desktop-rust/src-tauri/src/db/mod.rs` — add two CREATE TABLE + index inside the `conn.execute_batch(...)` block in `run_migrations()` (line 23 onward), AND update `expected` array in `test_all_13_tables_exist` to include the two new tables.

**Background:** `init_db()` is a thin wrapper (opens file, sets WAL, calls `run_migrations`). All schema is created inside `run_migrations`'s giant `execute_batch` SQL string. There is already a test `test_all_13_tables_exist` which hardcodes an `expected` list and asserts `tables.len() == expected.len()` — adding new tables without updating this list will break the test.

- [ ] **Step 1: Read the current schema and test state**

```bash
sed -n '23,176p' /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri/src/db/mod.rs
sed -n '185,236p' /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri/src/db/mod.rs
```

Confirm `run_migrations` at line 23 holds the SQL, and `test_all_13_tables_exist` is at lines 196-234 with the `expected` vector.

- [ ] **Step 2: Add whisper tables inside `run_migrations`**

Inside the `conn.execute_batch("...")` SQL string, after the last existing `CREATE TABLE IF NOT EXISTS snippet_tags (...)` block and before the closing `",` (currently at line 163), append:

```sql

        CREATE TABLE IF NOT EXISTS whisper_models (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL UNIQUE,
            display_name    TEXT NOT NULL,
            file_path       TEXT NOT NULL,
            size_bytes      INTEGER NOT NULL,
            sha256          TEXT NOT NULL,
            is_default      INTEGER NOT NULL DEFAULT 0,
            installed_at    INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS whisper_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            text            TEXT NOT NULL,
            text_raw        TEXT,
            model_name      TEXT NOT NULL,
            duration_ms     INTEGER NOT NULL,
            transcribe_ms   INTEGER NOT NULL,
            language        TEXT,
            injected_to     TEXT,
            created_at      INTEGER NOT NULL
        );
```

Then, after the closing `)?;` of the `execute_batch` call (around line 164), add a separate `execute_batch` for the index:

```rust
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_whisper_history_created ON whisper_history(created_at DESC);",
    )?;
```

(Keeping the index in its own statement matches how the existing `ALTER TABLE` migrations at lines 167-173 are structured — one `execute_batch` per SQL statement for readability.)

- [ ] **Step 3: Update `test_all_13_tables_exist`**

Rename the test and extend `expected` to cover 15 tables:

```rust
    #[test]
    fn test_all_15_tables_exist() {
        let conn = init_test_db();

        let tables: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let expected = vec![
            "app_settings",
            "commit_history",
            "commit_tags",
            "exec_categories",
            "exec_commands",
            "note_folders",
            "notes",
            "obfuscation_mappings",
            "shortcuts",
            "snippet_tags",
            "sql_macrosing_templates",
            "sql_table_analyzer_templates",
            "superset_settings",
            "whisper_history",
            "whisper_models",
        ];

        for table_name in &expected {
            assert!(
                tables.contains(&table_name.to_string()),
                "Missing table: {}",
                table_name
            );
        }
        assert_eq!(tables.len(), expected.len(), "Unexpected extra tables: {:?}", tables);
    }
```

- [ ] **Step 4: Add a focused test for the whisper-history index**

Inside the same `mod tests` block, add:

```rust
    #[test]
    fn whisper_history_index_created() {
        let conn = init_test_db();
        let indexes: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='whisper_history'")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(
            indexes.iter().any(|n| n == "idx_whisper_history_created"),
            "indexes on whisper_history: {:?}",
            indexes,
        );
    }
```

- [ ] **Step 5: Run tests**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo test --lib db:: 2>&1 | tail -30
```

Expected: all of `test_migrations_idempotent`, `test_all_15_tables_exist`, `whisper_history_index_created` pass. No failures.

If `test_migrations_idempotent` fails: the migration is not idempotent (check that `CREATE INDEX IF NOT EXISTS` has the `IF NOT EXISTS`).

If `test_all_15_tables_exist` fails with "Unexpected extra tables" and shows 16: there's already a `whisper_*` table present or you pasted something extra — inspect and fix.

- [ ] **Step 6: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/db/mod.rs
git commit -m "whisper: schema (whisper_models, whisper_history) + index"
```

### Task 1.4: Create skeleton Rust module tree

**Files:**
- Create: `desktop-rust/src-tauri/src/whisper/mod.rs`
- Create: `desktop-rust/src-tauri/src/whisper/service.rs`
- Create: `desktop-rust/src-tauri/src/whisper/server.rs`
- Create: `desktop-rust/src-tauri/src/whisper/audio.rs`
- Create: `desktop-rust/src-tauri/src/whisper/models.rs`
- Create: `desktop-rust/src-tauri/src/whisper/catalog.rs`
- Create: `desktop-rust/src-tauri/src/whisper/gpu_detect.rs`
- Create: `desktop-rust/src-tauri/src/whisper/bin_manager.rs`
- Create: `desktop-rust/src-tauri/src/whisper/postprocess.rs`
- Create: `desktop-rust/src-tauri/src/whisper/inject.rs`
- Create: `desktop-rust/src-tauri/src/whisper/events.rs`
- Create: `desktop-rust/src-tauri/src/commands/whisper.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs` (add `mod whisper;` and `mod commands::whisper` declarations)

- [ ] **Step 1: Create `whisper/mod.rs` with empty sub-module declarations**

```rust
pub mod audio;
pub mod bin_manager;
pub mod catalog;
pub mod events;
pub mod gpu_detect;
pub mod inject;
pub mod models;
pub mod postprocess;
pub mod server;
pub mod service;
```

- [ ] **Step 2: Create each sub-module file with a single doc comment so it compiles**

Template for every file listed above (except `mod.rs`):

```rust
//! <module-name> — see .workflow/specs/2026-04-22-voice-input-design.md
```

Use exactly that one-line content for each of: `service.rs`, `server.rs`, `audio.rs`, `models.rs`, `catalog.rs`, `gpu_detect.rs`, `bin_manager.rs`, `postprocess.rs`, `inject.rs`, `events.rs`.

- [ ] **Step 3: Create `commands/whisper.rs` empty**

```rust
//! whisper Tauri commands — see .workflow/specs/2026-04-22-voice-input-design.md
```

- [ ] **Step 4: Wire modules into `lib.rs` and `commands/mod.rs`**

In `desktop-rust/src-tauri/src/lib.rs`, find the top-of-file module declarations (around lines 4-11, where `mod db;`, `mod commands;`, etc. live) and add below them:

```rust
mod whisper;
```

In `desktop-rust/src-tauri/src/commands/mod.rs` (it already exists and lists `pub mod notes; pub mod settings; …` — 12 entries as of baseline), append one line:

```rust
pub mod whisper;
```

**Do NOT** touch `lib.rs`'s `tauri::generate_handler![...]` block yet — it remains unchanged until Chunk 6, when the actual `#[tauri::command]` handlers exist. Chunk 1 only declares modules; the absence of registered commands inside those modules is fine for compilation.

- [ ] **Step 5: cargo check**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo check 2>&1 | tail -15
```

Expected: compiles, no errors. There will likely be "unused module" warnings — leave them; they'll go away as real code lands.

- [ ] **Step 6: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/mod.rs \
        desktop-rust/src-tauri/src/whisper/audio.rs \
        desktop-rust/src-tauri/src/whisper/bin_manager.rs \
        desktop-rust/src-tauri/src/whisper/catalog.rs \
        desktop-rust/src-tauri/src/whisper/events.rs \
        desktop-rust/src-tauri/src/whisper/gpu_detect.rs \
        desktop-rust/src-tauri/src/whisper/inject.rs \
        desktop-rust/src-tauri/src/whisper/models.rs \
        desktop-rust/src-tauri/src/whisper/postprocess.rs \
        desktop-rust/src-tauri/src/whisper/server.rs \
        desktop-rust/src-tauri/src/whisper/service.rs \
        desktop-rust/src-tauri/src/commands/whisper.rs \
        desktop-rust/src-tauri/src/commands/mod.rs \
        desktop-rust/src-tauri/src/lib.rs
git commit -m "whisper: scaffold Rust module tree"
```

(Explicit paths — avoid `git add -u` here, because the Chunk 0 baseline `cargo check` may have left `Cargo.lock` or other unintended edits in the tree.)

---

## Chunk 2 placeholder (NOT YET WRITTEN)

Remaining chunks — to be written after Chunk 1 passes review:

- **Chunk 2:** models catalog (const list) + downloader (reqwest, SHA256 verify, progress events) + `app_settings` helpers + SQLite CRUD for `whisper_models` and `whisper_history` + unit tests.
- **Chunk 3:** `audio.rs` — cpal input device enumeration, recording into WAV buffer via hound, RMS emit via Tauri events. Unit test: encode known PCM, decode, check sample count/rate.
- **Chunk 4:** `server.rs` — spawn whisper-server sidecar on free port, parse "listening" from stderr, healthcheck; `gpu_detect.rs` — nvidia-smi parse + Metal detect + sysinfo CPU/RAM; `bin_manager.rs` — resolve bundled CPU bin vs GPU-bin-on-demand; `service.rs` — state machine (idle/warming/ready/recording/transcribing/unloading), idle timer, early-stop-during-warming buffer handling. State-transition unit tests.
- **Chunk 5:** `postprocess.rs` — rules + optional LLM HTTP call; `inject.rs` — enigo Ctrl+V / Cmd+V / type with clipboard save+restore-after-200ms.
- **Chunk 6:** `commands/whisper.rs` — all 15 Tauri commands wired, `#[tauri::command]` handlers delegating to service/models/etc., registered in `lib.rs`'s `generate_handler!` macro; `events.rs` — typed event emit helpers.
- **Chunk 7:** frontend — `tabs/whisper/whisper-api.js` + entry `whisper-main.js` + `dev-mock.js` stubs with synthetic level/state events.
- **Chunk 8:** frontend — onboarding UI (catalog list, install progress, hw hint).
- **Chunk 9:** frontend — settings modal (mic, model default, hotkey, inject method, idle-timeout, overlay pos, LLM config, postprocess rules).
- **Chunk 10:** frontend — two-pane tab (history list ↔ transcript pane with Copy/Paste/Edit/Re-transcribe/Delete).
- **Chunk 11:** `whisper-overlay.html` + Rust wiring to show/hide the overlay window and stream level events.
- **Chunk 12:** CI — fetch whisper.cpp release, extract, rename, place in `src-tauri/binaries/`; update `desktop-rust/WHISPER_CPP_VERSION`; update `.github/workflows/release-desktop.yml`; update `desktop-rust/RELEASES.md` with whisper-bin docs and mic-permission gotchas.
- **Chunk 13:** manual integration checklist in `RELEASES.md` (mic permission on macOS, first-record warming path, idle-timeout unload verified with `ps`, hotkey-from-other-window→overlay→inject, unload-now).

Each subsequent chunk will be appended to this file only after the preceding chunk passes reviewer approval. This keeps the plan document honest: you are never asked to execute steps that haven't been reviewed.
