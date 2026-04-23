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

---

## Chunk 2: Models — catalog, downloader, CRUD

This chunk makes two things possible: (a) listing available whisper.cpp models with their metadata/hashes (b) downloading one from HuggingFace, verifying SHA256, storing to disk, and inserting into `whisper_models`. No UI wiring yet — those come in Chunks 7-8. At chunk end, a test downloads a tiny real model to verify the full pipeline works (gated behind an env var so it doesn't run in CI by default).

### Task 2.1: Define the model catalog constant

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/catalog.rs`

- [ ] **Step 1: Replace the stub doc comment with the catalog types and data**

Overwrite the file with:

```rust
//! Catalog of available whisper.cpp models (ggml-format) — see spec.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelMeta {
    pub name: &'static str,           // "ggml-small", canonical file id
    pub display_name: &'static str,   // "small multilingual"
    pub size_bytes: u64,
    pub sha256: &'static str,         // lowercase hex, 64 chars
    pub download_url: &'static str,   // HuggingFace absolute URL
    pub ru_quality: u8,               // 1..5 stars
    pub recommended: bool,            // onboarding highlights this one
    pub notes: &'static str,          // short UI hint
}

/// Catalog pinned at compile time. Update by regenerating hashes from the
/// whisper.cpp manifest at:
///   https://huggingface.co/ggerganov/whisper.cpp/raw/main/ggml-<name>.bin
/// The SHA256 values below come from that repo — verify before upgrading.
pub const CATALOG: &[ModelMeta] = &[
    ModelMeta {
        name: "ggml-tiny",
        display_name: "tiny",
        size_bytes: 77_691_712,
        sha256: "bd577a113a864445d4c299885e0cb97d4ba92b5f",  // placeholder — see note below
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        ru_quality: 1,
        recommended: false,
        notes: "Fast but poor for Russian",
    },
    ModelMeta {
        name: "ggml-base",
        display_name: "base",
        size_bytes: 147_951_616,
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf",  // placeholder
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        ru_quality: 2,
        recommended: false,
        notes: "Weak for Russian",
    },
    ModelMeta {
        name: "ggml-small",
        display_name: "small (multilingual)",
        size_bytes: 487_601_967,
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e9",  // placeholder
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        ru_quality: 4,
        recommended: true,
        notes: "Best tradeoff for RU+EN",
    },
    ModelMeta {
        name: "ggml-medium",
        display_name: "medium",
        size_bytes: 1_533_763_059,
        sha256: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",  // placeholder
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
        ru_quality: 5,
        recommended: false,
        notes: "Top quality if RAM allows",
    },
    ModelMeta {
        name: "ggml-large-v3",
        display_name: "large-v3",
        size_bytes: 3_095_018_317,
        sha256: "ad82bf6a9043ceed055076d0fd39f5f186ff8062",  // placeholder
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
        ru_quality: 5,
        recommended: false,
        notes: "Best quality, GPU recommended",
    },
    ModelMeta {
        name: "ggml-large-v3-q5_0",
        display_name: "large-v3 (Q5 quantized)",
        size_bytes: 1_080_000_000,   // approx; will be overwritten by HTTP Content-Length on first probe
        sha256: "00000000000000000000000000000000",  // placeholder — MUST be updated before release
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin",
        ru_quality: 5,
        recommended: false,
        notes: "Quantized: large-quality at ~1GB",
    },
];

pub fn find(name: &str) -> Option<&'static ModelMeta> {
    CATALOG.iter().find(|m| m.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_exactly_one_recommended() {
        let rec: Vec<_> = CATALOG.iter().filter(|m| m.recommended).collect();
        assert_eq!(rec.len(), 1, "exactly one model should be marked recommended");
        assert_eq!(rec[0].name, "ggml-small");
    }

    #[test]
    fn catalog_names_unique() {
        let mut names: Vec<&str> = CATALOG.iter().map(|m| m.name).collect();
        let len_before = names.len();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), len_before, "catalog has duplicate names");
    }

    #[test]
    fn find_returns_known_model() {
        assert!(find("ggml-small").is_some());
        assert!(find("ggml-nonexistent").is_none());
    }
}
```

**Important — SHA256 placeholders:** the values above are stubs to keep the constant compilable. They are **wrong**. Before running Task 2.6 (real-model download test) or releasing, regenerate them by running:

```bash
for m in ggml-tiny ggml-base ggml-small ggml-medium ggml-large-v3 ggml-large-v3-q5_0; do
  url="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${m}.bin"
  curl -sL "$url" | sha256sum
done
```

and update each `sha256` field + the `size_bytes` for `large-v3-q5_0` which is approximate. Commit that refresh as its own commit named `whisper: refresh model catalog sha256 + sizes`.

- [ ] **Step 2: Run catalog tests**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo test --lib whisper::catalog 2>&1 | tail -15
```

Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/catalog.rs
git commit -m "whisper: model catalog constant + lookup"
```

### Task 2.2: Refresh catalog SHA256 hashes from upstream

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/catalog.rs` (sha256 and size_bytes values only)

- [ ] **Step 1: Fetch real hashes**

```bash
mkdir -p /tmp/whisper-hash-check
cd /tmp/whisper-hash-check
for m in ggml-tiny ggml-base ggml-small ggml-medium ggml-large-v3 ggml-large-v3-q5_0; do
  url="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${m}.bin"
  echo "=== $m ==="
  curl -sL -o "$m.bin" "$url"
  sha256sum "$m.bin"
  stat -c '%n %s' "$m.bin"
done
```

This will take ~5-10 minutes and consume ~7GB of disk. If disk-constrained, run one model at a time and delete after hashing.

- [ ] **Step 2: Update each `sha256` and any `size_bytes` that differs**

Edit the 6 entries in `CATALOG` to use the real values. Note: `sha256` must be **64 lowercase hex chars** (full SHA256), not the 40-char prefix shown in the stub.

- [ ] **Step 3: Delete temporary files**

```bash
rm -rf /tmp/whisper-hash-check
```

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/catalog.rs
git commit -m "whisper: refresh model catalog sha256 + sizes"
```

### Task 2.3: Implement `models.rs` — file I/O and SHA256 verification

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/models.rs`

- [ ] **Step 1: Write the helpers**

Overwrite with:

```rust
//! Model file management: path resolution, SHA256 verify, download with progress.

use crate::whisper::catalog::ModelMeta;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Base directory for installed model files (inside the OS app data dir).
pub fn models_dir(app_data: &Path) -> PathBuf {
    app_data.join("whisper-models")
}

/// Absolute path to a specific model's ggml .bin file.
pub fn model_path(app_data: &Path, name: &str) -> PathBuf {
    models_dir(app_data).join(format!("{}.bin", name))
}

/// Return true iff the file exists AND its SHA256 matches `expected`.
/// Non-existence or mismatch both return false. IO errors propagate as false
/// (they've been logged in the caller).
pub fn verify_file_sha256(path: &Path, expected: &str) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else { return false; };
    let mut hasher = Sha256::new();
    if std::io::copy(&mut file, &mut hasher).is_err() {
        return false;
    }
    let digest = hasher.finalize();
    let hex = digest.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    hex.eq_ignore_ascii_case(expected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn verify_returns_false_for_missing_file() {
        assert!(!verify_file_sha256(Path::new("/nonexistent/path.bin"), "deadbeef"));
    }

    #[test]
    fn verify_returns_true_for_matching_hash() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        tmp.as_file().write_all(b"hello world").unwrap();
        tmp.as_file().sync_all().unwrap();
        // SHA256("hello world") = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
        assert!(verify_file_sha256(
            tmp.path(),
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        ));
    }

    #[test]
    fn verify_returns_false_for_wrong_hash() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        tmp.as_file().write_all(b"hello world").unwrap();
        tmp.as_file().sync_all().unwrap();
        assert!(!verify_file_sha256(
            tmp.path(),
            "0000000000000000000000000000000000000000000000000000000000000000"
        ));
    }

    #[test]
    fn models_dir_and_path_are_under_app_data() {
        let base = Path::new("/tmp/app-data");
        assert_eq!(models_dir(base), PathBuf::from("/tmp/app-data/whisper-models"));
        assert_eq!(
            model_path(base, "ggml-small"),
            PathBuf::from("/tmp/app-data/whisper-models/ggml-small.bin")
        );
    }

    // Suppress unused warning from catalog import when tests focus on paths.
    #[allow(dead_code)]
    fn _ensure_meta_compiles(_: &ModelMeta) {}
}
```

- [ ] **Step 2: Add `tempfile` as a dev-dependency**

Inspect `Cargo.toml`; if `tempfile` is not already in `[dev-dependencies]`, add:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: Run tests**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo test --lib whisper::models 2>&1 | tail -20
```

Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/models.rs desktop-rust/src-tauri/Cargo.toml desktop-rust/src-tauri/Cargo.lock
git commit -m "whisper: model path helpers + SHA256 verify"
```

### Task 2.4: Implement the async downloader with progress events

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/models.rs` — append to existing file

- [ ] **Step 1: Define the event payload type**

Open `desktop-rust/src-tauri/src/whisper/events.rs` and replace the stub with:

```rust
//! Typed event payloads for whisper — emitted to the frontend via Tauri events.

use serde::{Deserialize, Serialize};

pub const EVT_STATE_CHANGED: &str = "whisper:state-changed";
pub const EVT_LEVEL: &str = "whisper:level";
pub const EVT_MODEL_DOWNLOAD: &str = "whisper:model-download";
pub const EVT_TRANSCRIBED: &str = "whisper:transcribed";
pub const EVT_ERROR: &str = "whisper:error";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDownloadPayload {
    pub model: String,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub speed_bps: u64,
    pub finished: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LevelPayload {
    pub rms: f32, // 0.0..1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatePayload {
    pub state: String, // "idle" | "warming" | "ready" | "recording" | "transcribing" | "unloading"
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscribedPayload {
    pub text: String,
    pub duration_ms: u64,
    pub transcribe_ms: u64,
    pub model: String,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}
```

- [ ] **Step 2: Append the download function to `models.rs`**

Append (before the `#[cfg(test)]` block):

```rust
use crate::whisper::events::{self, ModelDownloadPayload};
use std::io::Write;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Download a model to a temp file, verify SHA256, then atomically rename
/// into place. Emits progress events at ~5Hz while downloading.
///
/// On error, the partial temp file is removed.
/// On success returns the final file path.
pub async fn download_and_install(
    app: &AppHandle,
    app_data: &Path,
    meta: &ModelMeta,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(models_dir(app_data))
        .map_err(|e| format!("create models dir: {e}"))?;

    let final_path = model_path(app_data, meta.name);
    let tmp_path = final_path.with_extension("bin.part");

    // If already installed + verified, short-circuit.
    if final_path.exists() && verify_file_sha256(&final_path, meta.sha256) {
        emit_done(app, meta.name, meta.size_bytes);
        return Ok(final_path);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 30)) // 30 min cap per download
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let resp = client.get(meta.download_url)
        .send().await
        .map_err(|e| format!("http get: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("http status {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(meta.size_bytes);

    let mut file = std::fs::File::create(&tmp_path)
        .map_err(|e| format!("create tmp: {e}"))?;
    let mut stream = resp.bytes_stream();

    let mut done: u64 = 0;
    let mut last_emit = Instant::now();
    let started = Instant::now();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let _ = std::fs::remove_file(&tmp_path);
            format!("chunk: {e}")
        })?;
        file.write_all(&chunk).map_err(|e| {
            let _ = std::fs::remove_file(&tmp_path);
            format!("write: {e}")
        })?;
        done += chunk.len() as u64;
        if last_emit.elapsed().as_millis() > 200 {
            let secs = started.elapsed().as_secs_f64().max(0.001);
            let speed = (done as f64 / secs) as u64;
            let _ = app.emit(
                events::EVT_MODEL_DOWNLOAD,
                ModelDownloadPayload {
                    model: meta.name.to_string(),
                    bytes_done: done,
                    bytes_total: total,
                    speed_bps: speed,
                    finished: false,
                    error: None,
                },
            );
            last_emit = Instant::now();
        }
    }
    drop(file);

    if !verify_file_sha256(&tmp_path, meta.sha256) {
        let _ = std::fs::remove_file(&tmp_path);
        let _ = app.emit(
            events::EVT_MODEL_DOWNLOAD,
            ModelDownloadPayload {
                model: meta.name.to_string(),
                bytes_done: done,
                bytes_total: total,
                speed_bps: 0,
                finished: true,
                error: Some("sha256 mismatch".into()),
            },
        );
        return Err("sha256 mismatch".into());
    }

    std::fs::rename(&tmp_path, &final_path)
        .map_err(|e| format!("rename: {e}"))?;

    emit_done(app, meta.name, total);
    Ok(final_path)
}

fn emit_done(app: &AppHandle, name: &str, total: u64) {
    let _ = app.emit(
        events::EVT_MODEL_DOWNLOAD,
        ModelDownloadPayload {
            model: name.to_string(),
            bytes_done: total,
            bytes_total: total,
            speed_bps: 0,
            finished: true,
            error: None,
        },
    );
}
```

- [ ] **Step 2b: Add `futures-util` dep if not present**

```bash
grep -n 'futures-util\|reqwest' /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri/Cargo.toml
```

If `futures-util` is missing, add to `[dependencies]`:

```toml
futures-util = "0.3"
```

- [ ] **Step 3: cargo check**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo check 2>&1 | tail -15
```

Expected: compiles. No download test here — we test download end-to-end in Task 2.6.

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/models.rs \
        desktop-rust/src-tauri/src/whisper/events.rs \
        desktop-rust/src-tauri/Cargo.toml \
        desktop-rust/src-tauri/Cargo.lock
git commit -m "whisper: async downloader with SHA256 verify + progress events"
```

### Task 2.5: SQLite CRUD helpers for `whisper_models` and `whisper_history`

**Files:**
- Modify: `desktop-rust/src-tauri/src/db/queries.rs` (append helpers)

- [ ] **Step 1: Append model-CRUD helpers to `queries.rs`**

At the end of the file, append:

```rust
// ---------- whisper_models ----------

#[derive(Debug, Clone, serde::Serialize)]
pub struct WhisperModelRow {
    pub id: i64,
    pub name: String,
    pub display_name: String,
    pub file_path: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub is_default: bool,
    pub installed_at: i64,
}

pub fn whisper_list_models(conn: &Connection) -> Result<Vec<WhisperModelRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, display_name, file_path, size_bytes, sha256, is_default, installed_at
         FROM whisper_models ORDER BY installed_at ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(WhisperModelRow {
            id: r.get(0)?,
            name: r.get(1)?,
            display_name: r.get(2)?,
            file_path: r.get(3)?,
            size_bytes: r.get(4)?,
            sha256: r.get(5)?,
            is_default: r.get::<_, i64>(6)? != 0,
            installed_at: r.get(7)?,
        })
    })?;
    rows.collect::<Result<Vec<_>>>()
}

pub fn whisper_insert_or_upgrade_model(
    conn: &Connection,
    name: &str,
    display_name: &str,
    file_path: &str,
    size_bytes: i64,
    sha256: &str,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO whisper_models (name, display_name, file_path, size_bytes, sha256, is_default, installed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)
         ON CONFLICT(name) DO UPDATE SET
           display_name = excluded.display_name,
           file_path = excluded.file_path,
           size_bytes = excluded.size_bytes,
           sha256 = excluded.sha256,
           installed_at = excluded.installed_at",
        params![name, display_name, file_path, size_bytes, sha256, now],
    )?;
    Ok(())
}

pub fn whisper_delete_model(conn: &Connection, name: &str) -> Result<()> {
    conn.execute("DELETE FROM whisper_models WHERE name = ?1", params![name])?;
    Ok(())
}

pub fn whisper_set_default_model(conn: &mut Connection, name: &str) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("UPDATE whisper_models SET is_default = 0", [])?;
    let changed = tx.execute(
        "UPDATE whisper_models SET is_default = 1 WHERE name = ?1",
        params![name],
    )?;
    if changed == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    tx.commit()?;
    Ok(())
}

pub fn whisper_get_default_model(conn: &Connection) -> Result<Option<WhisperModelRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, display_name, file_path, size_bytes, sha256, is_default, installed_at
         FROM whisper_models WHERE is_default = 1 LIMIT 1",
    )?;
    let mut rows = stmt.query_map([], |r| {
        Ok(WhisperModelRow {
            id: r.get(0)?,
            name: r.get(1)?,
            display_name: r.get(2)?,
            file_path: r.get(3)?,
            size_bytes: r.get(4)?,
            sha256: r.get(5)?,
            is_default: r.get::<_, i64>(6)? != 0,
            installed_at: r.get(7)?,
        })
    })?;
    Ok(rows.next().transpose()?)
}

// ---------- whisper_history ----------

#[derive(Debug, Clone, serde::Serialize)]
pub struct WhisperHistoryRow {
    pub id: i64,
    pub text: String,
    pub text_raw: Option<String>,
    pub model_name: String,
    pub duration_ms: i64,
    pub transcribe_ms: i64,
    pub language: Option<String>,
    pub injected_to: Option<String>,
    pub created_at: i64,
}

pub fn whisper_insert_history(
    conn: &Connection,
    text: &str,
    text_raw: Option<&str>,
    model_name: &str,
    duration_ms: i64,
    transcribe_ms: i64,
    language: Option<&str>,
    injected_to: Option<&str>,
) -> Result<i64> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO whisper_history (text, text_raw, model_name, duration_ms, transcribe_ms, language, injected_to, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![text, text_raw, model_name, duration_ms, transcribe_ms, language, injected_to, now],
    )?;
    // Trim to last 200
    conn.execute(
        "DELETE FROM whisper_history WHERE id NOT IN
            (SELECT id FROM whisper_history ORDER BY created_at DESC LIMIT 200)",
        [],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn whisper_list_history(conn: &Connection, limit: i64) -> Result<Vec<WhisperHistoryRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, text, text_raw, model_name, duration_ms, transcribe_ms, language, injected_to, created_at
         FROM whisper_history ORDER BY created_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |r| {
        Ok(WhisperHistoryRow {
            id: r.get(0)?,
            text: r.get(1)?,
            text_raw: r.get(2)?,
            model_name: r.get(3)?,
            duration_ms: r.get(4)?,
            transcribe_ms: r.get(5)?,
            language: r.get(6)?,
            injected_to: r.get(7)?,
            created_at: r.get(8)?,
        })
    })?;
    rows.collect::<Result<Vec<_>>>()
}

pub fn whisper_delete_history(conn: &Connection, id: Option<i64>) -> Result<()> {
    match id {
        Some(id) => { conn.execute("DELETE FROM whisper_history WHERE id = ?1", params![id])?; }
        None => { conn.execute("DELETE FROM whisper_history", [])?; }
    }
    Ok(())
}
```

Note on imports: `queries.rs` already has `use rusqlite::{params, Connection, Result};` and `use chrono::...` — inspect the top of the file and add anything missing. If `chrono` is not currently used there, the existing code uses `crate::db::now_str()` or similar — inspect and use the existing pattern to get a timestamp. The snippet above assumes `chrono::Utc::now().timestamp()` works; if it doesn't, swap to whatever gives an i64 unix-seconds.

- [ ] **Step 2: Add tests for the CRUD helpers**

Inside a new `#[cfg(test)] mod whisper_crud_tests { … }` block appended to `queries.rs`, add tests exercising:

```rust
#[cfg(test)]
mod whisper_crud_tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn model_insert_then_list_roundtrip() {
        let conn = init_test_db();
        whisper_insert_or_upgrade_model(&conn, "ggml-small", "small", "/tmp/small.bin", 100, "abc").unwrap();
        let models = whisper_list_models(&conn).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "ggml-small");
        assert!(!models[0].is_default);
    }

    #[test]
    fn set_default_clears_previous_default() {
        let mut conn = init_test_db();
        whisper_insert_or_upgrade_model(&conn, "ggml-a", "a", "/tmp/a", 1, "h1").unwrap();
        whisper_insert_or_upgrade_model(&conn, "ggml-b", "b", "/tmp/b", 2, "h2").unwrap();
        whisper_set_default_model(&mut conn, "ggml-a").unwrap();
        whisper_set_default_model(&mut conn, "ggml-b").unwrap();
        let defaults: Vec<_> = whisper_list_models(&conn).unwrap()
            .into_iter().filter(|m| m.is_default).collect();
        assert_eq!(defaults.len(), 1);
        assert_eq!(defaults[0].name, "ggml-b");
    }

    #[test]
    fn set_default_errors_for_unknown_model() {
        let mut conn = init_test_db();
        assert!(whisper_set_default_model(&mut conn, "ggml-missing").is_err());
    }

    #[test]
    fn history_trim_keeps_last_200() {
        let conn = init_test_db();
        for i in 0..250 {
            whisper_insert_history(&conn, &format!("t{}", i), None, "ggml-small", 100, 50, None, None).unwrap();
        }
        let rows = whisper_list_history(&conn, 1000).unwrap();
        assert_eq!(rows.len(), 200);
        // Newest first
        assert_eq!(rows[0].text, "t249");
    }

    #[test]
    fn delete_history_all() {
        let conn = init_test_db();
        whisper_insert_history(&conn, "x", None, "m", 0, 0, None, None).unwrap();
        whisper_delete_history(&conn, None).unwrap();
        assert!(whisper_list_history(&conn, 100).unwrap().is_empty());
    }
}
```

- [ ] **Step 3: Run tests**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo test --lib whisper_crud 2>&1 | tail -30
```

Expected: 5 passed.

Two common failure modes:
- "no such function `init_test_db`" — it's under `#[cfg(test) pub fn init_test_db()` in `db/mod.rs:179`. If the `pub` is missing or test-gated in a way that blocks access, either make it `#[cfg(test)] pub(crate) fn` or duplicate a local init helper.
- A compile error about `chrono` — use whatever timestamp pattern the existing settings helpers in this file use (look for `get_setting` implementation).

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/db/queries.rs
git commit -m "whisper: SQLite CRUD for models + history"
```

### Task 2.6: End-to-end smoke download (opt-in, gated by env var)

Tests a real-world HTTPS download against HuggingFace, verifying:
- streaming download works
- SHA256 verify passes on the real tiny model
- atomic rename happens

Gated so CI doesn't hit HF by default.

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/models.rs` — append one test behind `#[cfg(feature = "e2e")]` OR `#[ignore]` with env-var check.

- [ ] **Step 1: Append the test**

Inside the existing `#[cfg(test)] mod tests { ... }` block of `models.rs`:

```rust
    /// Real-network smoke test. Run with:
    ///     WHISPER_E2E=1 cargo test --lib whisper::models::tests::e2e_download_tiny -- --nocapture
    /// Downloads ~77MB. Skipped by default.
    #[tokio::test]
    async fn e2e_download_tiny() {
        if std::env::var("WHISPER_E2E").is_err() {
            eprintln!("skipping e2e_download_tiny — set WHISPER_E2E=1 to run");
            return;
        }
        // Can't easily construct a real AppHandle here; use a dummy dir + call
        // the pure helpers.
        let tmp = tempfile::tempdir().unwrap();
        let meta = crate::whisper::catalog::find("ggml-tiny").expect("catalog has tiny");
        // Raw HTTP + verify without emitter:
        let resp = reqwest::get(meta.download_url).await.unwrap();
        assert!(resp.status().is_success(), "http {}", resp.status());
        let bytes = resp.bytes().await.unwrap();
        let path = tmp.path().join("ggml-tiny.bin");
        std::fs::write(&path, &bytes).unwrap();
        assert!(
            verify_file_sha256(&path, meta.sha256),
            "sha256 mismatch on downloaded tiny — refresh catalog or HF changed the file"
        );
    }
```

- [ ] **Step 2: Make sure `tokio` has the `macros` feature**

```bash
grep -n 'tokio = ' /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri/Cargo.toml
```

If `features = ["full"]` is not present, ensure `macros` and `rt-multi-thread` are enabled. The existing `tokio` dep in this project is `tokio = { version = "1", features = ["full"] }` per the Explore-agent audit; if so, nothing to add.

- [ ] **Step 3: Run, opted in**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
WHISPER_E2E=1 cargo test --lib whisper::models::tests::e2e_download_tiny -- --nocapture 2>&1 | tail -20
```

Expected: passes. If SHA256 mismatch: the catalog hash from Task 2.2 is wrong or HuggingFace re-uploaded the file. Re-fetch, re-hash, update catalog, re-run.

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/models.rs
git commit -m "whisper: e2e download smoke test (opt-in via WHISPER_E2E)"
```

---

## Chunk 3: Audio capture (`audio.rs`)

Native input-device enumeration + recording into a WAV buffer + live RMS emission for the overlay. Uses `cpal` for capture, `hound` for WAV encoding. No direct ties to whisper-server yet — this chunk just produces correctly-encoded 16kHz mono WAV bytes.

### Task 3.1: Input device enumeration

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/audio.rs`

- [ ] **Step 1: Write device-list helper and tests**

Overwrite `audio.rs` with the enumeration part first:

```rust
//! Audio capture (cpal) + WAV encoding (hound) + RMS emission.

use cpal::traits::{DeviceTrait, HostTrait};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputDevice {
    pub name: String,
    pub is_default: bool,
}

pub fn list_input_devices() -> Vec<InputDevice> {
    let host = cpal::default_host();
    let default_name = host.default_input_device().and_then(|d| d.name().ok());

    let devices = match host.input_devices() {
        Ok(it) => it,
        Err(_) => return Vec::new(),
    };

    devices
        .filter_map(|d| {
            let name = d.name().ok()?;
            Some(InputDevice {
                is_default: Some(&name) == default_name.as_ref(),
                name,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_does_not_panic() {
        // On CI/Docker there may be zero input devices — acceptable.
        let _ = list_input_devices();
    }
}
```

- [ ] **Step 2: cargo check**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo check 2>&1 | tail -10
```

Expected: compiles.

- [ ] **Step 3: Run test**

```bash
cargo test --lib whisper::audio::tests::list_does_not_panic 2>&1 | tail -10
```

Expected: pass (even if zero devices).

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/audio.rs
git commit -m "whisper: audio input device enumeration (cpal)"
```

### Task 3.2: Recorder (start/stop, PCM buffer, RMS events, WAV export)

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/audio.rs` — append the Recorder struct

- [ ] **Step 1: Append the recorder**

Append before the `#[cfg(test)]` block:

```rust
use cpal::traits::StreamTrait;
use cpal::{SampleFormat, StreamConfig};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use crate::whisper::events::{self, LevelPayload};

pub const WAV_SAMPLE_RATE: u32 = 16_000;
pub const WAV_CHANNELS: u16 = 1;

/// Owns the live stream + buffer. Dropping stops the stream.
pub struct Recorder {
    _stream: cpal::Stream, // Drop stops it
    buffer: Arc<Mutex<Vec<i16>>>,
    started_at: Instant,
}

impl Recorder {
    /// Start a new recorder bound to the given device (by name).
    /// Pass `None` to use the OS default. Emits `whisper:level` events.
    pub fn start(app: AppHandle, device_name: Option<&str>) -> Result<Self, String> {
        let host = cpal::default_host();
        let device = match device_name {
            None => host.default_input_device()
                .ok_or_else(|| "no default input device".to_string())?,
            Some(name) => host.input_devices()
                .map_err(|e| format!("enum: {e}"))?
                .find(|d| d.name().ok().as_deref() == Some(name))
                .ok_or_else(|| format!("device not found: {name}"))?,
        };

        // Pick a supported input config. Prefer 16kHz mono i16 when available;
        // otherwise take the default config and resample/convert on the fly.
        let default_config = device.default_input_config()
            .map_err(|e| format!("default config: {e}"))?;
        let sample_format = default_config.sample_format();
        let sample_rate = default_config.sample_rate().0;
        let channels = default_config.channels();
        let config: StreamConfig = default_config.into();

        let buffer: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::with_capacity(16_000 * 30)));
        let buf_for_cb = buffer.clone();
        let app_for_cb = app.clone();

        // Emit RMS at ~20Hz by accumulating samples between emits.
        let mut since_emit_samples: usize = 0;
        let emit_every: usize = (sample_rate as usize / 20).max(100);
        let mut rms_accum_sq: f64 = 0.0;
        let mut rms_accum_n: usize = 0;

        let err_fn = |e| eprintln!("[whisper audio] stream error: {e}");

        let stream = match sample_format {
            SampleFormat::F32 => device.build_input_stream(
                &config,
                move |data: &[f32], _| {
                    process_frames_f32(
                        data,
                        sample_rate,
                        channels,
                        &buf_for_cb,
                        &app_for_cb,
                        &mut since_emit_samples,
                        emit_every,
                        &mut rms_accum_sq,
                        &mut rms_accum_n,
                    );
                },
                err_fn,
                None,
            ),
            SampleFormat::I16 => device.build_input_stream(
                &config,
                move |data: &[i16], _| {
                    process_frames_i16(
                        data,
                        sample_rate,
                        channels,
                        &buf_for_cb,
                        &app_for_cb,
                        &mut since_emit_samples,
                        emit_every,
                        &mut rms_accum_sq,
                        &mut rms_accum_n,
                    );
                },
                err_fn,
                None,
            ),
            SampleFormat::U16 => device.build_input_stream(
                &config,
                move |data: &[u16], _| {
                    // Convert to i16 by shifting bias.
                    let mapped: Vec<i16> = data.iter()
                        .map(|&s| (s as i32 - 32_768) as i16)
                        .collect();
                    process_frames_i16(
                        &mapped,
                        sample_rate,
                        channels,
                        &buf_for_cb,
                        &app_for_cb,
                        &mut since_emit_samples,
                        emit_every,
                        &mut rms_accum_sq,
                        &mut rms_accum_n,
                    );
                },
                err_fn,
                None,
            ),
            other => return Err(format!("unsupported sample format: {:?}", other)),
        }.map_err(|e| format!("build_input_stream: {e}"))?;

        stream.play().map_err(|e| format!("stream.play: {e}"))?;

        Ok(Self {
            _stream: stream,
            buffer,
            started_at: Instant::now(),
        })
    }

    pub fn duration_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }

    /// Consume the recorder and return a WAV byte buffer (16kHz mono i16 PCM).
    pub fn finish_wav(self) -> Result<Vec<u8>, String> {
        let samples = Arc::try_unwrap(self.buffer)
            .map_err(|_| "buffer still shared".to_string())?
            .into_inner()
            .map_err(|e| format!("mutex poisoned: {e}"))?;
        encode_wav(&samples)
    }
}

fn encode_wav(samples: &[i16]) -> Result<Vec<u8>, String> {
    let spec = hound::WavSpec {
        channels: WAV_CHANNELS,
        sample_rate: WAV_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut out: Vec<u8> = Vec::with_capacity(samples.len() * 2 + 44);
    let cursor = std::io::Cursor::new(&mut out);
    let mut writer = hound::WavWriter::new(cursor, spec)
        .map_err(|e| format!("wav init: {e}"))?;
    for s in samples {
        writer.write_sample(*s).map_err(|e| format!("wav write: {e}"))?;
    }
    writer.finalize().map_err(|e| format!("wav finalize: {e}"))?;
    Ok(out)
}

fn process_frames_f32(
    data: &[f32],
    in_sample_rate: u32,
    in_channels: u16,
    buffer: &Arc<Mutex<Vec<i16>>>,
    app: &AppHandle,
    since_emit: &mut usize,
    emit_every: usize,
    rms_sq: &mut f64,
    rms_n: &mut usize,
) {
    // Mix-down to mono f32
    let mono: Vec<f32> = if in_channels == 1 {
        data.to_vec()
    } else {
        let c = in_channels as usize;
        data.chunks_exact(c)
            .map(|ch| ch.iter().sum::<f32>() / c as f32)
            .collect()
    };
    // Resample to 16kHz by linear interpolation
    let resampled = resample_linear_f32(&mono, in_sample_rate, WAV_SAMPLE_RATE);
    let i16s: Vec<i16> = resampled.iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect();

    // RMS accounting (on original f32 pre-resample for fidelity)
    for &s in &mono {
        *rms_sq += (s as f64) * (s as f64);
        *rms_n += 1;
    }
    *since_emit += mono.len();
    if *since_emit >= emit_every && *rms_n > 0 {
        let rms = ((*rms_sq / *rms_n as f64).sqrt() as f32).clamp(0.0, 1.0);
        let _ = app.emit(events::EVT_LEVEL, LevelPayload { rms });
        *since_emit = 0;
        *rms_sq = 0.0;
        *rms_n = 0;
    }

    if let Ok(mut buf) = buffer.lock() {
        buf.extend_from_slice(&i16s);
    }
}

fn process_frames_i16(
    data: &[i16],
    in_sample_rate: u32,
    in_channels: u16,
    buffer: &Arc<Mutex<Vec<i16>>>,
    app: &AppHandle,
    since_emit: &mut usize,
    emit_every: usize,
    rms_sq: &mut f64,
    rms_n: &mut usize,
) {
    // Reuse f32 path for simplicity
    let f32_data: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
    process_frames_f32(
        &f32_data, in_sample_rate, in_channels, buffer, app,
        since_emit, emit_every, rms_sq, rms_n,
    );
}

/// Linear-interpolation resampler — fine for speech.
/// Not great for music; we don't care here.
pub fn resample_linear_f32(input: &[f32], from_hz: u32, to_hz: u32) -> Vec<f32> {
    if from_hz == to_hz || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from_hz as f64 / to_hz as f64;
    let out_len = (input.len() as f64 / ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = (i as f64) * ratio;
        let lo = src.floor() as usize;
        let hi = (lo + 1).min(input.len() - 1);
        let frac = (src - lo as f64) as f32;
        let v = input[lo] * (1.0 - frac) + input[hi] * frac;
        out.push(v);
    }
    out
}
```

- [ ] **Step 2: Extend tests**

Append to the test module:

```rust
    #[test]
    fn resample_identity_when_rates_match() {
        let samples = vec![0.1, 0.2, 0.3, 0.4];
        assert_eq!(resample_linear_f32(&samples, 16_000, 16_000), samples);
    }

    #[test]
    fn resample_downsamples_length() {
        let samples: Vec<f32> = (0..48_000).map(|i| (i as f32) / 48_000.0).collect();
        let out = resample_linear_f32(&samples, 48_000, 16_000);
        // From 48kHz to 16kHz: ~3x reduction
        assert!((out.len() as i32 - 16_000).abs() < 5, "got {}", out.len());
    }

    #[test]
    fn encode_wav_produces_valid_header() {
        let samples: Vec<i16> = (0..16_000).map(|i| (i as i16).wrapping_mul(10)).collect();
        let bytes = encode_wav(&samples).unwrap();
        // RIFF header: "RIFF" ... "WAVE"
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        // Data chunk size should be 2 bytes per sample, ~32000 bytes
        // (plus 44 byte header). Allow some header variance.
        assert!(bytes.len() >= 32_000 + 40, "got {} bytes", bytes.len());
    }

    #[test]
    fn encode_wav_roundtrip_via_hound_reader() {
        let samples: Vec<i16> = vec![100, -100, 200, -200, 0];
        let bytes = encode_wav(&samples).unwrap();
        let cursor = std::io::Cursor::new(bytes);
        let reader = hound::WavReader::new(cursor).unwrap();
        let spec = reader.spec();
        assert_eq!(spec.sample_rate, WAV_SAMPLE_RATE);
        assert_eq!(spec.channels, WAV_CHANNELS);
        let decoded: Vec<i16> = reader.into_samples::<i16>().filter_map(|r| r.ok()).collect();
        assert_eq!(decoded, samples);
    }
```

- [ ] **Step 3: Run tests**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo test --lib whisper::audio 2>&1 | tail -25
```

Expected: 5 passed (list_does_not_panic + 4 new).

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/audio.rs
git commit -m "whisper: cpal recorder + WAV encode + linear resampler + RMS events"
```

---

## Chunk 4: whisper-server lifecycle (`server.rs`, `gpu_detect.rs`, `bin_manager.rs`, `service.rs`)

This is the heaviest chunk. It owns:
- Spawning `whisper-server` as a sidecar, discovering a free port, watching stderr for "listening" to transition warming→ready
- Detecting GPU (NVIDIA via `nvidia-smi`, Apple Metal, CPU fallback) + CPU/RAM via `sysinfo`
- Resolving which whisper-server binary to use (bundled CPU vs. downloaded GPU)
- The state machine itself (idle → warming → ready → recording → transcribing → idle-unload) with idle timer, early-stop-during-warming buffering, and graceful shutdown

### Task 4.1: `gpu_detect.rs`

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/gpu_detect.rs`

- [ ] **Step 1: Write the detection helpers**

Overwrite:

```rust
//! Hardware detection used by onboarding hints + bin selection.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub cpu_model: String,
    pub ram_mb: u64,
    pub cuda: bool,
    pub metal: bool,
    pub vram_mb: u64,
}

/// Cheap introspection intended to run once at onboarding time.
pub fn detect() -> HardwareInfo {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_all();
    let cpu_model = sys.cpus().first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "unknown".into());
    let ram_mb = sys.total_memory() / 1024 / 1024;

    let metal = cfg!(all(target_os = "macos", target_arch = "aarch64"));
    let (cuda, vram_mb) = detect_cuda();

    HardwareInfo { cpu_model, ram_mb, cuda, metal, vram_mb }
}

fn detect_cuda() -> (bool, u64) {
    // Only checked on Windows — macOS uses Metal, Linux CUDA is out-of-scope for MVP
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let out = Command::new("nvidia-smi")
            .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout);
                let first = s.lines().next().unwrap_or("").trim();
                if let Ok(mb) = first.parse::<u64>() {
                    return (true, mb);
                }
            }
        }
    }
    (false, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_returns_non_zero_ram() {
        let hw = detect();
        assert!(hw.ram_mb > 0, "ram should be detected on any running system");
        assert!(!hw.cpu_model.is_empty());
    }
}
```

- [ ] **Step 2: Run test**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo test --lib whisper::gpu_detect 2>&1 | tail -15
```

Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/gpu_detect.rs
git commit -m "whisper: hardware detection (sysinfo + nvidia-smi)"
```

### Task 4.2: `bin_manager.rs` — resolve which whisper-server binary to use

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/bin_manager.rs`

- [ ] **Step 1: Write the resolver**

```rust
//! Resolves which whisper-server binary to use for this platform/GPU combo.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub enum BinVariant {
    /// Pre-bundled CPU binary shipped via Tauri `externalBin`.
    BundledCpu,
    /// Downloaded variant living under `app_data/whisper-bin/`.
    DownloadedGpu { path: PathBuf },
}

/// Path where downloaded GPU builds are stored.
pub fn gpu_bin_dir(app_data: &Path) -> PathBuf {
    app_data.join("whisper-bin")
}

/// Return the GPU-variant file if one has been downloaded and exists on disk.
pub fn downloaded_gpu_bin(app_data: &Path) -> Option<PathBuf> {
    let dir = gpu_bin_dir(app_data);
    #[cfg(target_os = "windows")]
    {
        let cuda = dir.join("whisper-server-cuda.exe");
        if cuda.exists() { return Some(cuda); }
        let vulkan = dir.join("whisper-server-vulkan.exe");
        if vulkan.exists() { return Some(vulkan); }
    }
    // macOS and Linux: only the bundled variant in MVP
    let _ = dir;
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_gpu_bin_in_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(downloaded_gpu_bin(tmp.path()).is_none());
    }
}
```

- [ ] **Step 2: Run test**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo test --lib whisper::bin_manager 2>&1 | tail -10
```

Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/bin_manager.rs
git commit -m "whisper: bin manager skeleton (resolve bundled vs downloaded)"
```

### Task 4.3: `server.rs` — spawn + healthcheck + HTTP client

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/server.rs`

- [ ] **Step 1: Write the server wrapper**

```rust
//! Spawn and talk to whisper.cpp's `whisper-server` sidecar.

use crate::whisper::bin_manager::BinVariant;
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{Command, CommandChild, CommandEvent};
use tokio::sync::mpsc;
use tokio::time::timeout;

pub struct WhisperServer {
    child: CommandChild,
    pub port: u16,
    _rx_task: tokio::task::JoinHandle<()>,
}

impl WhisperServer {
    /// Spawn the server bound to `127.0.0.1:<free>`, wait up to 30s for
    /// "listening" stderr line, and return a handle.
    pub async fn spawn(
        app: &AppHandle,
        variant: &BinVariant,
        model_path: &Path,
    ) -> Result<Self, String> {
        let port = find_free_port()?;

        let cmd: Command = match variant {
            BinVariant::BundledCpu => {
                app.shell()
                    .sidecar("whisper-server")
                    .map_err(|e| format!("sidecar: {e}"))?
            }
            BinVariant::DownloadedGpu { path } => {
                Command::new(path.to_string_lossy())
            }
        }
        .args([
            "--host", "127.0.0.1",
            "--port", &port.to_string(),
            "--model", &model_path.to_string_lossy(),
            "--inference-path", "/inference",
            "--threads", "4",
        ]);

        let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;

        // Wait for "server is listening" or "listening on" on stderr within 30s
        let (ready_tx, mut ready_rx) = mpsc::channel::<Result<(), String>>(1);
        let rx_task = tokio::spawn(async move {
            let mut ready_sent = false;
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stderr(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        if !ready_sent && (line.contains("listening") || line.contains("Listening")) {
                            let _ = ready_tx.send(Ok(())).await;
                            ready_sent = true;
                        }
                        eprintln!("[whisper-server] {}", line.trim_end());
                    }
                    CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        eprintln!("[whisper-server] {}", line.trim_end());
                    }
                    CommandEvent::Terminated(payload) => {
                        if !ready_sent {
                            let _ = ready_tx.send(Err(format!(
                                "whisper-server exited before ready (code {:?})",
                                payload.code
                            ))).await;
                        }
                        return;
                    }
                    _ => {}
                }
            }
        });

        match timeout(Duration::from_secs(30), ready_rx.recv()).await {
            Ok(Some(Ok(()))) => Ok(Self { child, port, _rx_task: rx_task }),
            Ok(Some(Err(e))) => Err(e),
            Ok(None) => Err("server channel closed".into()),
            Err(_) => Err("timeout waiting for whisper-server to become ready".into()),
        }
    }

    /// POST /inference with a WAV body. Returns the transcript text.
    pub async fn transcribe(&self, wav: Vec<u8>, language: Option<&str>) -> Result<InferenceResult, String> {
        let client = reqwest::Client::new();
        let form = reqwest::multipart::Form::new()
            .part("file", reqwest::multipart::Part::bytes(wav)
                  .file_name("input.wav")
                  .mime_str("audio/wav").unwrap())
            .text("temperature", "0")
            .text("response_format", "json")
            .text("language", language.unwrap_or("auto").to_string());
        let url = format!("http://127.0.0.1:{}/inference", self.port);
        let resp = client.post(&url)
            .multipart(form)
            .timeout(Duration::from_secs(600))
            .send().await
            .map_err(|e| format!("inference: {e}"))?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("inference http: {}", body));
        }
        let json: serde_json::Value = resp.json().await
            .map_err(|e| format!("inference parse: {e}"))?;
        let text = json.get("text").and_then(|v| v.as_str())
            .unwrap_or("").trim().to_string();
        let language = json.get("language").and_then(|v| v.as_str()).map(|s| s.to_string());
        Ok(InferenceResult { text, language })
    }

    /// Graceful shutdown — send SIGTERM on Unix, kill on Windows.
    pub fn shutdown(self) {
        let _ = self.child.kill();
    }
}

#[derive(Debug, Clone)]
pub struct InferenceResult {
    pub text: String,
    pub language: Option<String>,
}

fn find_free_port() -> Result<u16, String> {
    use std::net::{TcpListener, SocketAddr};
    let addr: SocketAddr = "127.0.0.1:0".parse().unwrap();
    let listener = TcpListener::bind(addr).map_err(|e| format!("bind: {e}"))?;
    let port = listener.local_addr().map_err(|e| format!("local_addr: {e}"))?.port();
    drop(listener);
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_port_is_nonzero() {
        let p = find_free_port().unwrap();
        assert!(p > 0);
    }
}
```

**Note on `tauri-plugin-shell`:** the project's baseline may not have this plugin yet. Check with:

```bash
grep 'tauri-plugin-shell' /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri/Cargo.toml
```

If absent, add it:

```toml
tauri-plugin-shell = "2"
```

and register it in `lib.rs` alongside the other plugins (`.plugin(tauri_plugin_shell::init())`). Also allow sidecars in Tauri v2 capabilities: open `desktop-rust/src-tauri/capabilities/default.json` (or whatever the capabilities file is named), and add:

```json
{ "identifier": "shell:allow-execute", "allow": [{ "name": "whisper-server", "sidecar": true }] }
```

Exact shape depends on the existing capabilities file; match its style.

- [ ] **Step 2: cargo check**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo check 2>&1 | tail -15
```

Expected: compiles.

- [ ] **Step 3: Run test**

```bash
cargo test --lib whisper::server 2>&1 | tail -10
```

Expected: 1 passed (`free_port_is_nonzero`). No real spawn test here — integration test covered by the manual checklist in Chunk 13.

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/server.rs \
        desktop-rust/src-tauri/src/lib.rs \
        desktop-rust/src-tauri/Cargo.toml \
        desktop-rust/src-tauri/Cargo.lock \
        desktop-rust/src-tauri/capabilities/ 2>/dev/null
git commit -m "whisper: server spawn + inference HTTP client + port selection"
```

### Task 4.4: `service.rs` — state machine

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/service.rs`

- [ ] **Step 1: Write the service**

```rust
//! Owns the state machine for whisper. Lazy-start, idle-timeout unload,
//! early-stop buffering during warm-up.

use crate::whisper::audio::Recorder;
use crate::whisper::bin_manager::{self, BinVariant};
use crate::whisper::events::{self, StatePayload};
use crate::whisper::server::{WhisperServer, InferenceResult};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Idle,
    Warming,
    Ready,
    Recording,
    Transcribing,
    Unloading,
}
impl State {
    pub fn as_str(&self) -> &'static str {
        match self {
            State::Idle => "idle",
            State::Warming => "warming",
            State::Ready => "ready",
            State::Recording => "recording",
            State::Transcribing => "transcribing",
            State::Unloading => "unloading",
        }
    }
}

pub struct WhisperService {
    inner: Arc<Mutex<Inner>>,
    app: AppHandle,
}

struct Inner {
    state: State,
    server: Option<WhisperServer>,
    model_path: Option<PathBuf>,
    model_name: Option<String>,
    recorder: Option<Recorder>,
    idle_timer: Option<JoinHandle<()>>,
    pending_stop: bool, // user hit stop while warming
    idle_timeout: Duration,
}

impl WhisperService {
    pub fn new(app: AppHandle) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                state: State::Idle,
                server: None,
                model_path: None,
                model_name: None,
                recorder: None,
                idle_timer: None,
                pending_stop: false,
                idle_timeout: Duration::from_secs(300),
            })),
            app,
        }
    }

    pub async fn state(&self) -> State {
        self.inner.lock().await.state
    }

    pub async fn set_idle_timeout(&self, dur: Duration) {
        self.inner.lock().await.idle_timeout = dur;
    }

    /// Called by `whisper_start_recording` command.
    /// Starts cpal recorder immediately, lazy-starts whisper-server.
    pub async fn start_recording(
        &self,
        model_path: PathBuf,
        model_name: String,
        device_name: Option<String>,
    ) -> Result<(), String> {
        let mut g = self.inner.lock().await;
        if matches!(g.state, State::Recording | State::Transcribing) {
            return Err("already recording".into());
        }
        // cancel any pending idle timer
        if let Some(t) = g.idle_timer.take() { t.abort(); }

        // Start cpal immediately (independent of server readiness)
        let rec = Recorder::start(self.app.clone(), device_name.as_deref())?;
        g.recorder = Some(rec);

        match g.state {
            State::Idle => {
                g.model_path = Some(model_path.clone());
                g.model_name = Some(model_name.clone());
                drop(g); // release while we spawn
                self.transition(State::Warming).await;
                let app = self.app.clone();
                let inner = self.inner.clone();
                // Spawn warm-up in background
                tokio::spawn(async move {
                    let variant = match bin_manager::downloaded_gpu_bin(&app_data_dir(&app)) {
                        Some(p) => BinVariant::DownloadedGpu { path: p },
                        None => BinVariant::BundledCpu,
                    };
                    let server = match WhisperServer::spawn(&app, &variant, &model_path).await {
                        Ok(s) => s,
                        Err(e) => {
                            let _ = app.emit(events::EVT_ERROR, crate::whisper::events::ErrorPayload {
                                code: "server_spawn_failed".into(),
                                message: e,
                            });
                            let mut g = inner.lock().await;
                            g.state = State::Idle;
                            emit_state(&app, g.state, g.model_name.clone());
                            return;
                        }
                    };
                    let mut g = inner.lock().await;
                    g.server = Some(server);
                    // Transition: if we're still Warming AND the user hasn't hit stop,
                    // go to Recording (cpal already running). If pending_stop, flush.
                    if g.pending_stop {
                        g.pending_stop = false;
                        g.state = State::Transcribing;
                        emit_state(&app, g.state, g.model_name.clone());
                        // The actual transcribe call happens inside stop_recording;
                        // here we just set state so the blocked awaiter wakes up.
                    } else {
                        g.state = State::Recording;
                        emit_state(&app, g.state, g.model_name.clone());
                    }
                });
            }
            State::Ready => {
                g.state = State::Recording;
                emit_state(&self.app, g.state, g.model_name.clone());
            }
            _ => return Err(format!("cannot start from state {:?}", g.state)),
        }
        Ok(())
    }

    /// Called by `whisper_stop_recording`. Returns the transcript.
    pub async fn stop_recording(&self, language: Option<String>) -> Result<InferenceResult, String> {
        // 1) Detach recorder quickly and get its buffer
        let (recorder, model_name) = {
            let mut g = self.inner.lock().await;
            let rec = g.recorder.take().ok_or_else(|| "not recording".to_string())?;
            let name = g.model_name.clone().unwrap_or_default();
            // If still warming, mark pending_stop so the warm-up task knows
            if matches!(g.state, State::Warming) {
                g.pending_stop = true;
            } else {
                g.state = State::Transcribing;
                emit_state(&self.app, g.state, g.model_name.clone());
            }
            (rec, name)
        };

        let duration_ms = recorder.duration_ms();
        let wav = recorder.finish_wav()?;

        // 2) Wait for server to become available (may already be Ready; may
        //    still be Warming — the background spawn task will flip state).
        let t0 = std::time::Instant::now();
        loop {
            {
                let g = self.inner.lock().await;
                if g.server.is_some() && matches!(g.state, State::Transcribing) {
                    break;
                }
                if matches!(g.state, State::Idle) {
                    return Err("server failed to start".into());
                }
            }
            if t0.elapsed() > Duration::from_secs(60) {
                return Err("timeout waiting for server".into());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        // 3) Run inference — clone only the port+model bits we need; keep lock short.
        let (result, transcribe_ms) = {
            let g = self.inner.lock().await;
            let server = g.server.as_ref().ok_or_else(|| "no server".to_string())?;
            let start = std::time::Instant::now();
            let r = server.transcribe(wav, language.as_deref()).await?;
            let ms = start.elapsed().as_millis() as u64;
            drop(g);
            (r, ms)
        };

        // 4) Back to Ready; arm idle timer
        {
            let mut g = self.inner.lock().await;
            g.state = State::Ready;
            emit_state(&self.app, g.state, Some(model_name.clone()));
            let inner = self.inner.clone();
            let app = self.app.clone();
            let timeout = g.idle_timeout;
            let handle = tokio::spawn(async move {
                tokio::time::sleep(timeout).await;
                let mut g = inner.lock().await;
                if matches!(g.state, State::Ready) {
                    g.state = State::Unloading;
                    emit_state(&app, g.state, None);
                    if let Some(srv) = g.server.take() { srv.shutdown(); }
                    g.state = State::Idle;
                    g.model_path = None;
                    g.model_name = None;
                    emit_state(&app, g.state, None);
                }
            });
            g.idle_timer = Some(handle);
        }

        let _ = transcribe_ms; // consumed by caller via separate path if needed
        Ok(result)
    }

    /// Immediate tear-down.
    pub async fn unload_now(&self) {
        let mut g = self.inner.lock().await;
        if let Some(t) = g.idle_timer.take() { t.abort(); }
        g.state = State::Unloading;
        emit_state(&self.app, g.state, None);
        if let Some(srv) = g.server.take() { srv.shutdown(); }
        g.state = State::Idle;
        g.model_path = None;
        g.model_name = None;
        emit_state(&self.app, g.state, None);
    }

    /// Cancel an in-flight recording (overlay ✕).
    pub async fn cancel_recording(&self) {
        let mut g = self.inner.lock().await;
        g.recorder = None;
        if matches!(g.state, State::Recording | State::Warming) {
            if g.server.is_some() {
                g.state = State::Ready;
            } else {
                g.state = State::Idle;
            }
            emit_state(&self.app, g.state, g.model_name.clone());
        }
    }

    async fn transition(&self, new_state: State) {
        let mut g = self.inner.lock().await;
        g.state = new_state;
        emit_state(&self.app, new_state, g.model_name.clone());
    }
}

fn emit_state(app: &AppHandle, state: State, model: Option<String>) {
    let _ = app.emit(events::EVT_STATE_CHANGED, StatePayload {
        state: state.as_str().to_string(),
        model,
    });
}

fn app_data_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::State;

    #[test]
    fn state_string_matches_frontend_contract() {
        assert_eq!(State::Idle.as_str(), "idle");
        assert_eq!(State::Warming.as_str(), "warming");
        assert_eq!(State::Ready.as_str(), "ready");
        assert_eq!(State::Recording.as_str(), "recording");
        assert_eq!(State::Transcribing.as_str(), "transcribing");
        assert_eq!(State::Unloading.as_str(), "unloading");
    }
}
```

Note: unit-testing the full state machine with real cpal/spawn is hard; the integration checks live in Chunk 13 (manual checklist). The `state_string_matches_frontend_contract` test is the only meaningful pure test — it guards against accidental renaming that would silently break the frontend.

- [ ] **Step 2: cargo check**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo check 2>&1 | tail -20
```

Expected: compiles. There may be warnings about unused fields on `Inner` during transient states — leave them.

- [ ] **Step 3: Run test**

```bash
cargo test --lib whisper::service 2>&1 | tail -10
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/service.rs
git commit -m "whisper: service state machine (idle/warming/ready/recording/transcribing/unloading)"
```

---

## Chunk 5: Post-processing (`postprocess.rs`) + injection (`inject.rs`)

### Task 5.1: `postprocess.rs` — rules + optional LLM

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/postprocess.rs`

- [ ] **Step 1: Write rules-based cleanup + pure-function tests**

```rust
//! Post-processing of whisper transcripts.
//!
//! - `apply_rules` is synchronous and cheap (filler removal, capitalize).
//! - `apply_llm` is optional; calls a user-configured HTTP endpoint.
//!
//! Both return the transformed text, or the original on any failure.

use serde::{Deserialize, Serialize};

/// User-configurable LLM endpoint settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub endpoint: String,   // e.g. "https://api.openai.com/v1/chat/completions"
    pub api_key: String,
    pub model: String,      // "gpt-4o-mini" etc.
    pub prompt: String,     // "Clean up filler words; fix punctuation." (system prompt)
}

/// Pure-function cleanup. Always safe, always fast.
pub fn apply_rules(text: &str) -> String {
    let mut out = strip_fillers(text);
    out = collapse_whitespace(&out);
    out = capitalize_first(&out);
    out
}

fn strip_fillers(text: &str) -> String {
    // Russian filler words. Case-insensitive, word-boundaries only.
    const FILLERS_RU: &[&str] = &["эээ", "ээ", "ммм", "мм", "ну", "типа", "короче"];
    const FILLERS_EN: &[&str] = &["uh", "um", "like", "you know"];

    let mut result = text.to_string();
    for &w in FILLERS_RU.iter().chain(FILLERS_EN.iter()) {
        let re = regex::Regex::new(&format!(r"(?iu)\b{}\b[,\s]*", regex::escape(w))).unwrap();
        result = re.replace_all(&result, "").into_owned();
    }
    result
}

fn collapse_whitespace(text: &str) -> String {
    let re = regex::Regex::new(r"\s+").unwrap();
    re.replace_all(text.trim(), " ").into_owned()
}

fn capitalize_first(text: &str) -> String {
    let trimmed = text.trim_start();
    let mut chars = trimmed.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

/// Fire a chat-completion against the configured endpoint. Returns the cleaned
/// text on success, or the original `text` on any failure (soft fallback).
pub async fn apply_llm(text: &str, cfg: &LlmConfig) -> String {
    let body = serde_json::json!({
        "model": cfg.model,
        "messages": [
            { "role": "system", "content": cfg.prompt },
            { "role": "user", "content": text },
        ],
        "temperature": 0,
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .ok();
    let Some(client) = client else { return text.to_string(); };

    let resp = client.post(&cfg.endpoint)
        .bearer_auth(&cfg.api_key)
        .json(&body)
        .send().await;
    let Ok(resp) = resp else { return text.to_string(); };
    if !resp.status().is_success() { return text.to_string(); }
    let json: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return text.to_string(),
    };
    json.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_strip_russian_filler() {
        assert_eq!(apply_rules("эээ привет, мир"), "Привет, мир");
    }

    #[test]
    fn rules_capitalize_first_letter() {
        assert_eq!(apply_rules("hello world"), "Hello world");
    }

    #[test]
    fn rules_collapse_spaces() {
        assert_eq!(apply_rules("hello   world"), "Hello world");
    }

    #[test]
    fn rules_empty_input() {
        assert_eq!(apply_rules(""), "");
        assert_eq!(apply_rules("   "), "");
    }

    #[test]
    fn rules_multi_filler() {
        let input = "ну эээ типа это то, ммм, что я хотел сказать";
        let out = apply_rules(input);
        assert!(!out.to_lowercase().contains("эээ"));
        assert!(!out.to_lowercase().contains("ммм"));
        assert!(!out.to_lowercase().contains("типа"));
        assert!(out.to_lowercase().contains("это то"));
    }
}
```

- [ ] **Step 2: Add `regex` to deps if missing**

```bash
grep -n '^regex' /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri/Cargo.toml
```

If not present:

```toml
regex = "1"
```

- [ ] **Step 3: Run tests**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo test --lib whisper::postprocess 2>&1 | tail -15
```

Expected: 5 passed.

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/postprocess.rs \
        desktop-rust/src-tauri/Cargo.toml desktop-rust/src-tauri/Cargo.lock
git commit -m "whisper: postprocess rules (filler strip, capitalize) + LLM soft-fallback"
```

### Task 5.2: `inject.rs` — clipboard / paste / type

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/inject.rs`

- [ ] **Step 1: Write the injector**

```rust
//! Inject transcript into the active window: clipboard copy, auto-paste
//! (Ctrl+V / Cmd+V), or typed-key simulation.

use arboard::Clipboard;
use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub enum InjectMethod {
    CopyOnly,   // just place on clipboard
    Paste,      // place on clipboard, simulate Ctrl+V / Cmd+V, restore original clipboard
    Type,       // enigo type-through (Unicode)
}

impl InjectMethod {
    pub fn from_setting(s: &str) -> Self {
        match s {
            "copy" => InjectMethod::CopyOnly,
            "paste" => InjectMethod::Paste,
            "type" => InjectMethod::Type,
            _ => InjectMethod::Paste,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            InjectMethod::CopyOnly => "copy",
            InjectMethod::Paste => "paste",
            InjectMethod::Type => "type",
        }
    }
}

/// Inject text. Returns the label ("copy"/"paste"/"type") that was used, so
/// it can be stored in `whisper_history.injected_to`.
pub async fn inject(text: &str, method: InjectMethod, clipboard_restore_delay_ms: u64) -> Result<&'static str, String> {
    match method {
        InjectMethod::CopyOnly => {
            copy_to_clipboard(text)?;
            Ok("copy")
        }
        InjectMethod::Paste => {
            let prev = read_clipboard().ok();
            copy_to_clipboard(text)?;
            simulate_paste()?;
            // Restore previous clipboard after a small delay so the target app
            // has time to read our new value first.
            if let Some(prev_text) = prev {
                tokio::time::sleep(Duration::from_millis(clipboard_restore_delay_ms)).await;
                let _ = copy_to_clipboard(&prev_text);
            }
            Ok("paste")
        }
        InjectMethod::Type => {
            type_text(text)?;
            Ok("type")
        }
    }
}

fn copy_to_clipboard(text: &str) -> Result<(), String> {
    let mut cb = Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
    cb.set_text(text.to_string()).map_err(|e| format!("clipboard set: {e}"))?;
    Ok(())
}

fn read_clipboard() -> Result<String, String> {
    let mut cb = Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
    cb.get_text().map_err(|e| format!("clipboard get: {e}"))
}

fn simulate_paste() -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    enigo.key(modifier, Direction::Press).map_err(|e| format!("mod down: {e}"))?;
    enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| format!("v: {e}"))?;
    enigo.key(modifier, Direction::Release).map_err(|e| format!("mod up: {e}"))?;
    Ok(())
}

fn type_text(text: &str) -> Result<(), String> {
    use enigo::{Enigo, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;
    enigo.text(text).map_err(|e| format!("type: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_setting_parses_known_values() {
        assert!(matches!(InjectMethod::from_setting("copy"), InjectMethod::CopyOnly));
        assert!(matches!(InjectMethod::from_setting("paste"), InjectMethod::Paste));
        assert!(matches!(InjectMethod::from_setting("type"), InjectMethod::Type));
        // Unknown -> Paste (default)
        assert!(matches!(InjectMethod::from_setting("garbage"), InjectMethod::Paste));
    }

    #[test]
    fn method_str_roundtrip() {
        assert_eq!(InjectMethod::CopyOnly.as_str(), "copy");
        assert_eq!(InjectMethod::Paste.as_str(), "paste");
        assert_eq!(InjectMethod::Type.as_str(), "type");
    }

    // No real enigo/clipboard tests here — those need display/session and
    // are checked in the manual integration checklist (Chunk 13).
}
```

- [ ] **Step 2: cargo check + test**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo check 2>&1 | tail -10
cargo test --lib whisper::inject 2>&1 | tail -10
```

Expected: 2 tests passed.

On Linux dev without a display, `cargo check` must still succeed; actual `Enigo::new` is not invoked by the tests.

- [ ] **Step 3: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/whisper/inject.rs
git commit -m "whisper: inject (clipboard/Ctrl+V/type) with clipboard restore"
```

---

## Chunk 6: Tauri commands + state wiring

Connect everything so the frontend can actually call into the service. This chunk:
- Declares the `WhisperService` as Tauri state via `.manage(...)`
- Implements all 15 `#[tauri::command]` handlers in `commands/whisper.rs`
- Registers them in `lib.rs`'s `generate_handler!` block

### Task 6.1: Store service in Tauri state at startup

**Files:**
- Modify: `desktop-rust/src-tauri/src/lib.rs`

- [ ] **Step 1: Add state registration inside `run()`**

Locate the `tauri::Builder::default()` chain in `lib.rs` (starts around line 30). After `.manage(db)` add:

```rust
        .setup(|app| {
            let svc = crate::whisper::service::WhisperService::new(app.handle().clone());
            app.manage(svc);
            Ok(())
        })
```

If an existing `.setup(...)` closure is already present, merge inside it instead of adding a new one.

- [ ] **Step 2: Register the shell plugin if not yet registered**

Near the other `.plugin(...)` calls, add (only if missing):

```rust
        .plugin(tauri_plugin_shell::init())
```

- [ ] **Step 3: cargo check**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo check 2>&1 | tail -15
```

Expected: compiles.

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/lib.rs
git commit -m "whisper: register WhisperService in Tauri state + shell plugin"
```

### Task 6.2: Implement all Tauri commands

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/whisper.rs`

- [ ] **Step 1: Write the full command surface**

Overwrite with:

```rust
//! Tauri commands for the whisper voice-input feature.
//!
//! All commands are thin — they validate inputs and delegate to
//! `crate::whisper::*` or `crate::db::queries::*`.

use tauri::{AppHandle, Manager, State};
use crate::db::DbState;
use crate::db::queries::{
    self,
    WhisperHistoryRow, WhisperModelRow,
};
use crate::whisper::catalog::{self, ModelMeta};
use crate::whisper::events;
use crate::whisper::gpu_detect::{self, HardwareInfo};
use crate::whisper::bin_manager;
use crate::whisper::inject::{self, InjectMethod};
use crate::whisper::models;
use crate::whisper::postprocess::{self, LlmConfig};
use crate::whisper::service::WhisperService;

fn app_data(app: &AppHandle) -> std::path::PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn computer_id(db: &rusqlite::Connection) -> String {
    // Mirror whatever pattern the existing settings API uses. Fallback: "default".
    queries::get_setting(db, "default", "computer_id")
        .ok()
        .flatten()
        .unwrap_or_else(|| "default".into())
}

fn get_string(db: &rusqlite::Connection, key: &str) -> Option<String> {
    let cid = computer_id(db);
    queries::get_setting(db, &cid, key).ok().flatten()
}

fn set_string(db: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    let cid = computer_id(db);
    queries::set_setting(db, &cid, key, value).map_err(|e| e.to_string())
}

// ========== Model catalog / installation ==========

#[tauri::command]
pub fn whisper_list_catalog() -> Vec<ModelMeta> {
    catalog::CATALOG.to_vec()
}

#[tauri::command]
pub fn whisper_list_models(db: State<DbState>) -> Result<Vec<WhisperModelRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::whisper_list_models(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn whisper_install_model(
    app: AppHandle,
    db: State<'_, DbState>,
    name: String,
) -> Result<WhisperModelRow, String> {
    let meta = catalog::find(&name).ok_or_else(|| format!("unknown model: {name}"))?;
    let app_data_dir = app_data(&app);
    let path = models::download_and_install(&app, &app_data_dir, meta).await?;
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::whisper_insert_or_upgrade_model(
            &conn,
            meta.name,
            meta.display_name,
            &path.to_string_lossy(),
            meta.size_bytes as i64,
            meta.sha256,
        ).map_err(|e| e.to_string())?;
        // Auto-default if this is the only installed model
        let all = queries::whisper_list_models(&conn).map_err(|e| e.to_string())?;
        if all.len() == 1 {
            drop(conn);
            let mut conn2 = db.0.lock().map_err(|e| e.to_string())?;
            queries::whisper_set_default_model(&mut conn2, meta.name).map_err(|e| e.to_string())?;
        }
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let rows = queries::whisper_list_models(&conn).map_err(|e| e.to_string())?;
    rows.into_iter()
        .find(|m| m.name == meta.name)
        .ok_or_else(|| "install succeeded but model not found".into())
}

#[tauri::command]
pub fn whisper_delete_model(
    app: AppHandle,
    db: State<DbState>,
    name: String,
) -> Result<(), String> {
    let app_data_dir = app_data(&app);
    let path = models::model_path(&app_data_dir, &name);
    let _ = std::fs::remove_file(&path);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::whisper_delete_model(&conn, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn whisper_set_default_model(db: State<DbState>, name: String) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::whisper_set_default_model(&mut conn, &name).map_err(|e| e.to_string())
}

// ========== Recording & transcription ==========

#[tauri::command]
pub async fn whisper_start_recording(
    app: AppHandle,
    db: State<'_, DbState>,
    svc: State<'_, WhisperService>,
) -> Result<(), String> {
    let (model_path, model_name, device_name, idle_timeout_sec) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let def = queries::whisper_get_default_model(&conn).map_err(|e| e.to_string())?
            .ok_or_else(|| "no default model installed".to_string())?;
        let cid = computer_id(&conn);
        let mic = queries::get_setting(&conn, &cid, "whisper.mic_device").ok().flatten().filter(|s| !s.is_empty());
        let idle = queries::get_setting(&conn, &cid, "whisper.idle_timeout_sec").ok().flatten()
            .and_then(|s| s.parse::<u64>().ok()).unwrap_or(300);
        (std::path::PathBuf::from(def.file_path), def.name, mic, idle)
    };
    svc.set_idle_timeout(std::time::Duration::from_secs(idle_timeout_sec)).await;
    svc.start_recording(model_path, model_name, device_name).await
}

#[tauri::command]
pub async fn whisper_stop_recording(
    app: AppHandle,
    db: State<'_, DbState>,
    svc: State<'_, WhisperService>,
) -> Result<String, String> {
    // Read settings
    let (inject_method_str, restore_delay_ms, rules_on, llm_cfg_opt) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let cid = computer_id(&conn);
        let inj = queries::get_setting(&conn, &cid, "whisper.inject_method").ok().flatten().unwrap_or_else(|| "paste".into());
        let delay = queries::get_setting(&conn, &cid, "whisper.clipboard_restore_delay_ms").ok().flatten()
            .and_then(|s| s.parse::<u64>().ok()).unwrap_or(200);
        let rules = queries::get_setting(&conn, &cid, "whisper.postprocess_rules").ok().flatten()
            .map(|s| s == "true").unwrap_or(true);
        let llm_enabled = queries::get_setting(&conn, &cid, "whisper.llm_enabled").ok().flatten()
            .map(|s| s == "true").unwrap_or(false);
        let llm_cfg = if llm_enabled {
            Some(LlmConfig {
                endpoint: queries::get_setting(&conn, &cid, "whisper.llm_endpoint").ok().flatten().unwrap_or_default(),
                api_key: queries::get_setting(&conn, &cid, "whisper.llm_api_key").ok().flatten().unwrap_or_default(),
                model: queries::get_setting(&conn, &cid, "whisper.llm_model").ok().flatten().unwrap_or_else(|| "gpt-4o-mini".into()),
                prompt: queries::get_setting(&conn, &cid, "whisper.llm_prompt").ok().flatten()
                    .unwrap_or_else(|| "Clean up filler words; fix punctuation. Keep language.".into()),
            })
        } else { None };
        (inj, delay, rules, llm_cfg)
    };

    // Run inference
    let lang = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let cid = computer_id(&conn);
        queries::get_setting(&conn, &cid, "whisper.language").ok().flatten()
    };
    let result = svc.stop_recording(lang).await?;
    let model_name = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::whisper_get_default_model(&conn).map_err(|e| e.to_string())?
            .map(|m| m.name).unwrap_or_default()
    };

    // Postprocess
    let raw = result.text.clone();
    let mut text = if rules_on { postprocess::apply_rules(&raw) } else { raw.clone() };
    if let Some(cfg) = llm_cfg { text = postprocess::apply_llm(&text, &cfg).await; }

    // Inject
    let method = InjectMethod::from_setting(&inject_method_str);
    let injected = inject::inject(&text, method, restore_delay_ms).await
        .unwrap_or_else(|e| {
            eprintln!("[whisper inject] fallback: {e}");
            "copy"
        });

    // Emit transcribed event
    let _ = tauri::Emitter::emit(&app, events::EVT_TRANSCRIBED, events::TranscribedPayload {
        text: text.clone(),
        duration_ms: 0, // filled on frontend if needed; actual duration stored in history row
        transcribe_ms: 0,
        model: model_name.clone(),
        language: result.language.clone(),
    });

    // Persist to history
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::whisper_insert_history(
            &conn,
            &text,
            Some(&raw).filter(|r| *r != text.as_str()),
            &model_name,
            0,
            0,
            result.language.as_deref(),
            Some(injected),
        ).map_err(|e| e.to_string())?;
    }

    Ok(text)
}

#[tauri::command]
pub async fn whisper_cancel_recording(svc: State<'_, WhisperService>) -> Result<(), String> {
    svc.cancel_recording().await;
    Ok(())
}

#[tauri::command]
pub async fn whisper_unload_now(svc: State<'_, WhisperService>) -> Result<(), String> {
    svc.unload_now().await;
    Ok(())
}

#[tauri::command]
pub async fn whisper_inject_text(
    text: String,
    method: String,
    db: State<'_, DbState>,
) -> Result<&'static str, String> {
    let delay = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let cid = computer_id(&conn);
        queries::get_setting(&conn, &cid, "whisper.clipboard_restore_delay_ms").ok().flatten()
            .and_then(|s| s.parse::<u64>().ok()).unwrap_or(200)
    };
    inject::inject(&text, InjectMethod::from_setting(&method), delay).await
}

// ========== History ==========

#[tauri::command]
pub fn whisper_get_history(db: State<DbState>, limit: Option<i64>) -> Result<Vec<WhisperHistoryRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::whisper_list_history(&conn, limit.unwrap_or(200)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn whisper_delete_history(db: State<DbState>, id: Option<i64>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::whisper_delete_history(&conn, id).map_err(|e| e.to_string())
}

// ========== Mics & GPU ==========

#[tauri::command]
pub fn whisper_list_mics() -> Vec<crate::whisper::audio::InputDevice> {
    crate::whisper::audio::list_input_devices()
}

#[tauri::command]
pub fn whisper_gpu_info() -> HardwareInfo {
    gpu_detect::detect()
}

#[derive(serde::Serialize)]
pub struct WhisperBinInfo {
    pub variant: &'static str,
    pub installed: bool,
    pub path: Option<String>,
    pub dl_url: Option<String>,
    pub dl_size_bytes: Option<u64>,
}

#[tauri::command]
pub fn whisper_detect_whisper_bin(app: AppHandle) -> WhisperBinInfo {
    let data = app_data(&app);
    if let Some(p) = bin_manager::downloaded_gpu_bin(&data) {
        return WhisperBinInfo {
            variant: if p.to_string_lossy().contains("cuda") { "cuda" }
                else if p.to_string_lossy().contains("vulkan") { "vulkan" }
                else { "metal" },
            installed: true,
            path: Some(p.to_string_lossy().to_string()),
            dl_url: None, dl_size_bytes: None,
        };
    }
    WhisperBinInfo {
        variant: "cpu",
        installed: true, // bundled CPU is always available
        path: None,
        dl_url: None,
        dl_size_bytes: None,
    }
}
```

- [ ] **Step 2: cargo check**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo check 2>&1 | tail -25
```

Expected: compiles. Likely errors here:
- `State<'_, WhisperService>` lifetime issues in async commands → use `State<'_, WhisperService>` and make function async; already reflected above.
- `Emitter::emit` trait not in scope for the helper import → add `use tauri::Emitter;` at top of file (already imported? check).

Fix any surface-level compile errors; do not change semantics.

- [ ] **Step 3: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/commands/whisper.rs
git commit -m "whisper: Tauri commands (catalog, install, record, inject, history, gpu)"
```

### Task 6.3: Register all commands in `generate_handler!`

**Files:**
- Modify: `desktop-rust/src-tauri/src/lib.rs` — inside `.invoke_handler(tauri::generate_handler![...])`

- [ ] **Step 1: Append the 15 whisper commands**

In the `generate_handler!` list (currently lists shortcuts/notes/sql_tools/etc. commands — grep for `generate_handler!`), add at the end:

```rust
            commands::whisper::whisper_list_catalog,
            commands::whisper::whisper_list_models,
            commands::whisper::whisper_install_model,
            commands::whisper::whisper_delete_model,
            commands::whisper::whisper_set_default_model,
            commands::whisper::whisper_start_recording,
            commands::whisper::whisper_stop_recording,
            commands::whisper::whisper_cancel_recording,
            commands::whisper::whisper_unload_now,
            commands::whisper::whisper_inject_text,
            commands::whisper::whisper_get_history,
            commands::whisper::whisper_delete_history,
            commands::whisper::whisper_list_mics,
            commands::whisper::whisper_gpu_info,
            commands::whisper::whisper_detect_whisper_bin,
```

Mind the comma after the previous last entry.

- [ ] **Step 2: cargo check**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo check 2>&1 | tail -15
```

Expected: compiles. This is a big moment — all backend pieces now stitched together.

- [ ] **Step 3: Run the full test suite**

```bash
cargo test 2>&1 | tail -30
```

Expected: all existing + new tests pass (approx 20+ tests total).

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src-tauri/src/lib.rs
git commit -m "whisper: register 15 commands in generate_handler!"
```

---

## Chunk 7: Frontend entry, API wrapper, dev-mock stubs

Now the frontend side. This chunk creates the new tab folder, registers the tab in `TABS`, wires a typed-ish JS wrapper over `call()`, and adds dev-mock stubs so UI can be iterated in the browser without running Tauri.

### Task 7.1: Register the tab in `main.js`

**Files:**
- Modify: `desktop-rust/src/main.js` — the `TABS` array (lines 6-15 as of baseline)

- [ ] **Step 1: Inspect current TABS**

```bash
sed -n '1,25p' /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src/main.js
```

- [ ] **Step 2: Add the whisper entry**

Insert before the closing `];` of `TABS`:

```javascript
  { id: 'whisper', label: 'Whisper', icon: '🎤', loader: (el) => import('./tabs/whisper/whisper-main.js').then(m => m.init(el)) },
```

Choose placement consistent with existing tab ordering — current order is functional (SQL/Superset cluster together). Reasonable: place `whisper` after `exec` or `repo-search`. Check how tabs render and pick whichever feels best grouped.

- [ ] **Step 3: Commit** (still nothing loads — whisper-main.js not created yet; the tab button will 404 on click until Task 7.2)

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src/main.js
git commit -m "whisper: register tab in TABS array"
```

### Task 7.2: API wrapper + entry stub

**Files:**
- Create: `desktop-rust/src/tabs/whisper/whisper-api.js`
- Create: `desktop-rust/src/tabs/whisper/whisper-main.js`

- [ ] **Step 1: Write `whisper-api.js`**

```javascript
// Thin typed-ish wrapper over Tauri invoke for whisper commands.
// Also exposes listen() helpers for the 5 events.

import { call } from '../../tauri-api.js';

export const whisperApi = {
  // catalog / models
  listCatalog: () => call('whisper_list_catalog'),
  listModels: () => call('whisper_list_models'),
  installModel: (name) => call('whisper_install_model', { name }),
  deleteModel: (name) => call('whisper_delete_model', { name }),
  setDefaultModel: (name) => call('whisper_set_default_model', { name }),

  // recording
  startRecording: () => call('whisper_start_recording'),
  stopRecording: () => call('whisper_stop_recording'),
  cancelRecording: () => call('whisper_cancel_recording'),
  unloadNow: () => call('whisper_unload_now'),
  injectText: (text, method) => call('whisper_inject_text', { text, method }),

  // history
  getHistory: (limit = 200) => call('whisper_get_history', { limit }),
  deleteHistory: (id = null) => call('whisper_delete_history', { id }),

  // diagnostics
  listMics: () => call('whisper_list_mics'),
  gpuInfo: () => call('whisper_gpu_info'),
  detectWhisperBin: () => call('whisper_detect_whisper_bin'),

  // settings (app_settings via get_setting/set_setting)
  getSetting: (key) => call('get_setting', { key }),
  setSetting: (key, value) => call('set_setting', { key, value: String(value) }),
};

// Event helpers
const EVENTS = {
  stateChanged: 'whisper:state-changed',
  level: 'whisper:level',
  modelDownload: 'whisper:model-download',
  transcribed: 'whisper:transcribed',
  error: 'whisper:error',
};

export async function onWhisperEvent(name, handler) {
  // In Tauri env, window.__TAURI__.event.listen exists; in dev-mock we shim it.
  const listen = window.__TAURI__?.event?.listen || window.__TAURI_LISTEN__;
  if (!listen) {
    console.warn('[whisper-api] no event listener available');
    return () => {};
  }
  const event = EVENTS[name] || name;
  const unlisten = await listen(event, (e) => handler(e.payload));
  return unlisten;
}
```

Note: the exact API to invoke Tauri commands in this project is `call()` exported from `src/tauri-api.js` (confirmed from Explore audit). If the signature differs (e.g. named args vs positional object), inspect one existing tab (like `src/tabs/shortcuts.js`) and mirror its usage.

The `call('get_setting', { key })` pattern — if the existing `get_setting` command expects `{ computer_id, key }` explicitly, update the helper; the Rust command does `settings::get_setting` which internally resolves computer_id. See existing usage in `shortcuts.js` or `settings.js` for reference.

- [ ] **Step 2: Write `whisper-main.js` (placeholder entry)**

```javascript
// Entry point for the Whisper tab. Switches between onboarding and the
// main two-pane layout based on whether any model is installed.

import { whisperApi } from './whisper-api.js';

export async function init(container) {
  container.innerHTML = '';
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;height:100%;overflow:hidden;padding:0';

  const loading = document.createElement('div');
  loading.textContent = 'Loading…';
  loading.style.cssText = 'padding:24px;color:var(--text-muted,#8b949e)';
  container.appendChild(loading);

  let models = [];
  try {
    models = await whisperApi.listModels();
  } catch (e) {
    console.error('[whisper] listModels failed', e);
  }

  container.innerHTML = '';
  if (!models || models.length === 0) {
    const { initOnboarding } = await import('./whisper-onboarding.js');
    await initOnboarding(container, { onInstalled: () => init(container) });
  } else {
    const { initTab } = await import('./whisper-tab.js');
    await initTab(container);
  }
}
```

- [ ] **Step 3: Add dev-mock stubs**

Inspect existing `src/dev-mock.js` to learn the mocking pattern.

```bash
grep -n 'register\|whisper\|case ' /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src/dev-mock.js | head -30
```

Add a section for whisper commands. Pattern (adapt to existing style):

```javascript
// ----- whisper mocks -----
const whisperMockState = {
  installedModels: [],
  history: [],
  currentState: 'idle',
  levelTimer: null,
};

const whisperCatalog = [
  { name: 'ggml-tiny',         display_name: 'tiny',                 size_bytes: 77_691_712,    sha256: '…', download_url: '', ru_quality: 1, recommended: false, notes: 'Fast but poor for Russian' },
  { name: 'ggml-base',         display_name: 'base',                 size_bytes: 147_951_616,   sha256: '…', download_url: '', ru_quality: 2, recommended: false, notes: 'Weak for Russian' },
  { name: 'ggml-small',        display_name: 'small (multilingual)', size_bytes: 487_601_967,   sha256: '…', download_url: '', ru_quality: 4, recommended: true,  notes: 'Best tradeoff for RU+EN' },
  { name: 'ggml-medium',       display_name: 'medium',               size_bytes: 1_533_763_059, sha256: '…', download_url: '', ru_quality: 5, recommended: false, notes: 'Top quality if RAM allows' },
  { name: 'ggml-large-v3',     display_name: 'large-v3',             size_bytes: 3_095_018_317, sha256: '…', download_url: '', ru_quality: 5, recommended: false, notes: 'Best quality, GPU recommended' },
  { name: 'ggml-large-v3-q5_0',display_name: 'large-v3 (Q5)',        size_bytes: 1_080_000_000, sha256: '…', download_url: '', ru_quality: 5, recommended: false, notes: 'Quantized: large-quality at ~1GB' },
];

const whisperMocks = {
  whisper_list_catalog: () => whisperCatalog,
  whisper_list_models: () => whisperMockState.installedModels,
  whisper_install_model: async ({ name }) => {
    const meta = whisperCatalog.find(m => m.name === name);
    if (!meta) throw new Error('unknown model');
    // Simulate download with fake progress
    let done = 0;
    const total = meta.size_bytes;
    const tick = 50;
    const stepBytes = Math.max(1, Math.floor(total / 40));
    return new Promise((resolve) => {
      const iv = setInterval(() => {
        done = Math.min(total, done + stepBytes);
        window.dispatchEvent(new CustomEvent('whisper:model-download', {
          detail: { model: name, bytes_done: done, bytes_total: total, speed_bps: stepBytes * (1000 / tick), finished: done === total, error: null }
        }));
        if (done >= total) {
          clearInterval(iv);
          const installed = { id: whisperMockState.installedModels.length + 1, name: meta.name, display_name: meta.display_name, file_path: `/mock/${meta.name}.bin`, size_bytes: meta.size_bytes, sha256: meta.sha256, is_default: whisperMockState.installedModels.length === 0, installed_at: Date.now() / 1000 };
          whisperMockState.installedModels.push(installed);
          resolve(installed);
        }
      }, tick);
    });
  },
  whisper_delete_model: ({ name }) => {
    whisperMockState.installedModels = whisperMockState.installedModels.filter(m => m.name !== name);
    return null;
  },
  whisper_set_default_model: ({ name }) => {
    whisperMockState.installedModels = whisperMockState.installedModels.map(m => ({ ...m, is_default: m.name === name }));
    return null;
  },
  whisper_start_recording: () => {
    whisperMockState.currentState = 'recording';
    window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: 'recording', model: 'ggml-small' }}));
    // Fake RMS oscillation
    whisperMockState.levelTimer = setInterval(() => {
      const rms = 0.2 + 0.5 * Math.abs(Math.sin(Date.now() / 120));
      window.dispatchEvent(new CustomEvent('whisper:level', { detail: { rms }}));
    }, 50);
    return null;
  },
  whisper_stop_recording: async () => {
    if (whisperMockState.levelTimer) clearInterval(whisperMockState.levelTimer);
    whisperMockState.levelTimer = null;
    whisperMockState.currentState = 'transcribing';
    window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: 'transcribing', model: 'ggml-small' }}));
    await new Promise(r => setTimeout(r, 400));
    const text = 'Mocked transcript: это тестовая запись, привет мир.';
    whisperMockState.history.unshift({
      id: Date.now(), text, text_raw: null, model_name: 'ggml-small',
      duration_ms: 3000, transcribe_ms: 400, language: 'ru', injected_to: 'paste',
      created_at: Math.floor(Date.now()/1000),
    });
    whisperMockState.currentState = 'ready';
    window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: 'ready', model: 'ggml-small' }}));
    return text;
  },
  whisper_cancel_recording: () => {
    if (whisperMockState.levelTimer) clearInterval(whisperMockState.levelTimer);
    whisperMockState.levelTimer = null;
    whisperMockState.currentState = 'idle';
    window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: 'idle', model: null }}));
    return null;
  },
  whisper_unload_now: () => {
    whisperMockState.currentState = 'idle';
    window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: 'idle', model: null }}));
    return null;
  },
  whisper_inject_text: ({ text, method }) => method || 'copy',
  whisper_get_history: ({ limit }) => whisperMockState.history.slice(0, limit || 200),
  whisper_delete_history: ({ id }) => {
    if (id === null || id === undefined) whisperMockState.history = [];
    else whisperMockState.history = whisperMockState.history.filter(h => h.id !== id);
    return null;
  },
  whisper_list_mics: () => ([
    { name: 'MacBook Pro Microphone', is_default: true },
    { name: 'External USB Mic', is_default: false },
  ]),
  whisper_gpu_info: () => ({ cpu_model: 'Apple M2 Pro', ram_mb: 16384, cuda: false, metal: true, vram_mb: 0 }),
  whisper_detect_whisper_bin: () => ({ variant: 'metal', installed: true, path: null, dl_url: null, dl_size_bytes: null }),
};
```

Also shim `window.__TAURI_LISTEN__` to bridge CustomEvent → handler for dev:

```javascript
// Shim for whisper-api.js onWhisperEvent in non-Tauri browser
if (!window.__TAURI__?.event?.listen) {
  window.__TAURI_LISTEN__ = async (event, cb) => {
    const handler = (ev) => cb({ payload: ev.detail });
    window.addEventListener(event, handler);
    return () => window.removeEventListener(event, handler);
  };
}
```

Register `whisperMocks` into the dispatcher the same way existing mocks are registered (check the dev-mock.js pattern — likely a big switch or a lookup object).

- [ ] **Step 4: Verify via browser**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src
python3 -m http.server 8000 &
```

Open `http://localhost:8000/dev.html` in a browser. Click the Whisper tab. Since no models are installed in mock state, it should show the onboarding screen — but that component doesn't exist yet (comes in Chunk 8), so for now you'll see a "Loading…" then an error in the console about missing `whisper-onboarding.js`. That's expected.

Kill the server:

```bash
kill %1 2>/dev/null || pkill -f 'http.server 8000'
```

- [ ] **Step 5: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src/tabs/whisper/whisper-api.js \
        desktop-rust/src/tabs/whisper/whisper-main.js \
        desktop-rust/src/dev-mock.js
git commit -m "whisper: frontend entry + API wrapper + dev-mock stubs"
```

---

## Chunk 8: Onboarding UI

First-run model picker. Triggered automatically when `whisper-main.js` detects zero installed models.

### Task 8.1: Onboarding screen

**Files:**
- Create: `desktop-rust/src/tabs/whisper/whisper-onboarding.js`

- [ ] **Step 1: Build the screen**

Implement (see `/home/aster/dev/snippets_helper-feat-whisper/.superpowers/brainstorm/*/onboarding.html` for the approved visual for reference):

```javascript
import { whisperApi, onWhisperEvent } from './whisper-api.js';

export async function initOnboarding(container, { onInstalled } = {}) {
  container.innerHTML = '';
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;height:100%;overflow:auto;padding:20px;font-family:-apple-system,sans-serif;color:var(--text,#c9d1d9)';

  const [catalog, hw, bin] = await Promise.all([
    whisperApi.listCatalog(),
    whisperApi.gpuInfo(),
    whisperApi.detectWhisperBin(),
  ]);

  const title = document.createElement('h2');
  title.textContent = 'Выберите модель для распознавания';
  title.style.cssText = 'margin:0 0 4px 0;font-size:18px';
  container.appendChild(title);

  const sub = document.createElement('p');
  sub.textContent = 'Модели загружаются с Hugging Face. Можно установить несколько и переключаться в настройках.';
  sub.style.cssText = 'margin:0 0 16px 0;color:var(--text-muted,#8b949e);font-size:13px';
  container.appendChild(sub);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:16px';
  container.appendChild(grid);

  for (const m of catalog) {
    grid.appendChild(renderCard(m, bin, (name) => installModel(name, container, onInstalled)));
  }

  const hint = document.createElement('div');
  hint.style.cssText = 'padding:10px;background:var(--bg-secondary,#161b22);border:1px solid var(--border,#30363d);border-radius:4px;color:var(--text-muted,#8b949e);font-size:12px';
  const gpuLabel = hw.cuda ? 'CUDA' : (hw.metal ? 'Metal' : 'CPU');
  const rec = recommended(hw);
  hint.innerHTML = `💡 <b>Система определила:</b> ${escapeHtml(hw.cpu_model)}, ${Math.round(hw.ram_mb/1024)} GB RAM, ${gpuLabel} доступен. Лучший выбор — <b>${rec}</b>.`;
  container.appendChild(hint);
}

function renderCard(meta, bin, onInstall) {
  const card = document.createElement('div');
  const highlighted = !!meta.recommended;
  card.style.cssText = `background:var(--bg-secondary,#161b22);border:${highlighted ? '2px solid var(--accent,#388bfd)' : '1px solid var(--border,#30363d)'};border-radius:6px;padding:12px;position:relative`;

  if (highlighted) {
    const badge = document.createElement('span');
    badge.textContent = 'рекомендую';
    badge.style.cssText = 'position:absolute;top:-8px;right:8px;background:var(--accent,#388bfd);color:#fff;padding:1px 8px;border-radius:8px;font-size:10px;font-weight:600';
    card.appendChild(badge);
  }

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
  header.innerHTML = `<span style="font-weight:600">${escapeHtml(meta.display_name)}</span><span style="background:var(--border,#30363d);color:var(--text-muted,#8b949e);padding:1px 6px;border-radius:8px;font-size:10px">${formatBytes(meta.size_bytes)}</span>`;
  card.appendChild(header);

  const info = document.createElement('div');
  info.style.cssText = 'color:var(--text-muted,#8b949e);font-size:11px;line-height:1.6';
  info.innerHTML = `
    Скорость: ${'⚡'.repeat(Math.max(1, 6 - Math.ceil(meta.size_bytes / 5e8)))}<br>
    Качество RU: ${'★'.repeat(meta.ru_quality)}${'☆'.repeat(5 - meta.ru_quality)}<br>
    Размер: ${formatBytes(meta.size_bytes)}
  `;
  card.appendChild(info);

  if (meta.notes) {
    const note = document.createElement('div');
    note.textContent = meta.notes;
    note.style.cssText = 'margin-top:8px;padding:4px 6px;background:var(--bg,#0d1117);border-radius:3px;color:var(--text-muted,#8b949e);font-size:10px';
    card.appendChild(note);
  }

  const btn = document.createElement('button');
  btn.textContent = `Install ${meta.display_name}`;
  btn.style.cssText = `margin-top:10px;width:100%;padding:6px;background:${highlighted ? 'var(--accent,#388bfd)' : 'var(--bg,#0d1117)'};border:1px solid ${highlighted ? 'var(--accent,#388bfd)' : 'var(--border,#30363d)'};color:${highlighted ? '#fff' : 'var(--text,#c9d1d9)'};font-size:11px;border-radius:4px;cursor:pointer;font-weight:${highlighted ? '600' : 'normal'}`;
  btn.onclick = () => onInstall(meta.name);
  card.appendChild(btn);

  return card;
}

async function installModel(name, container, onInstalled) {
  // Lock UI: replace with a progress banner
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;background:rgba(13,17,23,.9);display:flex;align-items:center;justify-content:center;z-index:10';
  container.style.position = 'relative';
  container.appendChild(overlay);

  const panel = document.createElement('div');
  panel.style.cssText = 'max-width:420px;width:100%;background:var(--bg-secondary,#161b22);border:1px solid var(--border,#30363d);border-radius:6px;padding:14px;color:var(--text,#c9d1d9)';
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="font-weight:600">Скачиваю ${escapeHtml(name)}</span>
      <span id="dl-stat" style="margin-left:auto;color:var(--text-muted,#8b949e);font-size:12px">0 / ?</span>
    </div>
    <div style="height:4px;background:var(--border,#30363d);border-radius:2px;overflow:hidden">
      <div id="dl-bar" style="width:0%;height:100%;background:var(--accent,#388bfd)"></div>
    </div>
    <div id="dl-meta" style="display:flex;gap:8px;margin-top:8px;font-size:11px;color:var(--text-muted,#8b949e)"></div>
  `;
  overlay.appendChild(panel);

  const bar = panel.querySelector('#dl-bar');
  const stat = panel.querySelector('#dl-stat');
  const meta = panel.querySelector('#dl-meta');

  const unlisten = await onWhisperEvent('modelDownload', (p) => {
    if (p.model !== name) return;
    const pct = p.bytes_total > 0 ? Math.min(100, p.bytes_done / p.bytes_total * 100) : 0;
    bar.style.width = pct + '%';
    stat.textContent = `${formatBytes(p.bytes_done)} / ${formatBytes(p.bytes_total)}`;
    const speed = p.speed_bps > 0 ? `${formatBytes(p.speed_bps)}/s` : '';
    const etaSec = p.speed_bps > 0 ? Math.max(0, Math.floor((p.bytes_total - p.bytes_done) / p.speed_bps)) : null;
    meta.textContent = [speed, etaSec !== null ? `осталось ~${formatEta(etaSec)}` : ''].filter(Boolean).join(' · ');
    if (p.finished && !p.error) meta.innerHTML += ' <span style="color:var(--green,#3fb950);margin-left:auto">✓ checksum ok</span>';
    if (p.error) meta.innerHTML = `<span style="color:var(--red,#f85149)">Ошибка: ${escapeHtml(p.error)}</span>`;
  });

  try {
    await whisperApi.installModel(name);
    if (unlisten) unlisten();
    overlay.remove();
    if (onInstalled) onInstalled();
  } catch (e) {
    if (unlisten) unlisten();
    meta.innerHTML = `<span style="color:var(--red,#f85149)">Ошибка: ${escapeHtml(String(e))}</span>`;
  }
}

function recommended(hw) {
  if (hw.ram_mb >= 8000 && (hw.metal || hw.cuda)) return 'small или large-v3-q5';
  if (hw.ram_mb >= 8000) return 'small';
  return 'tiny';
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let x = n;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(x >= 100 ? 0 : 1)} ${units[i]}`;
}
function formatEta(sec) {
  if (sec < 60) return `${sec} сек`;
  if (sec < 3600) return `${Math.floor(sec/60)} мин ${sec%60} сек`;
  return `${Math.floor(sec/3600)} ч ${Math.floor((sec%3600)/60)} мин`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
```

- [ ] **Step 2: Test in browser**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src
python3 -m http.server 8000 &
```

Open `http://localhost:8000/dev.html`, click Whisper tab. Expected: onboarding screen with 6 cards + system-hint banner. Click "Install small". Progress bar animates (mock download). On finish, the tab re-inits — it will now try to load `whisper-tab.js` which doesn't exist yet (console error is OK).

```bash
kill %1 2>/dev/null || pkill -f 'http.server 8000'
```

- [ ] **Step 3: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src/tabs/whisper/whisper-onboarding.js
git commit -m "whisper: onboarding screen (catalog cards + install progress)"
```

---

## Chunk 9: Settings modal

### Task 9.1: `whisper-settings.js`

**Files:**
- Create: `desktop-rust/src/tabs/whisper/whisper-settings.js`

- [ ] **Step 1: Build a modal that reads/writes all whisper settings**

Settings surface (keys from the spec):
- `whisper.hotkey` (default `Ctrl+Alt+Space`)
- `whisper.mic_device` (dropdown, empty = OS default)
- `whisper.default_model` (from installed models)
- `whisper.idle_timeout_sec` (slider 60–1800, default 300)
- `whisper.inject_method` (radio: copy/paste/type)
- `whisper.clipboard_restore_delay_ms` (hidden for now, default 200 — not in UI)
- `whisper.postprocess_rules` (checkbox)
- `whisper.llm_enabled` + endpoint/api_key/model/prompt
- `whisper.overlay_position` (corner select)
- `whisper.overlay_hide_on_tab` (checkbox)
- `whisper.language` (dropdown auto/ru/en)

```javascript
import { whisperApi } from './whisper-api.js';

export async function openSettingsModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-overlay';
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;display:flex;align-items:center;justify-content:center';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:var(--bg,#0d1117);border:1px solid var(--border,#30363d);border-radius:8px;width:min(560px,90vw);max-height:90vh;overflow:auto;display:flex;flex-direction:column';
  backdrop.appendChild(modal);

  modal.innerHTML = `
    <div style="padding:12px 16px;border-bottom:1px solid var(--border,#30363d);display:flex;align-items:center">
      <h3 style="margin:0;font-size:14px">Настройки Whisper</h3>
      <button id="close-btn" style="margin-left:auto;background:transparent;border:0;color:var(--text-muted,#8b949e);font-size:16px;cursor:pointer">✕</button>
    </div>
    <div id="content" style="padding:16px;display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--text,#c9d1d9)"></div>
    <div style="padding:10px 16px;border-top:1px solid var(--border,#30363d);display:flex;justify-content:flex-end;gap:8px">
      <button id="save-btn" style="padding:6px 14px;background:var(--accent,#388bfd);color:#fff;border:0;border-radius:4px;cursor:pointer">Сохранить</button>
    </div>
  `;

  document.body.appendChild(backdrop);
  const content = modal.querySelector('#content');

  // Load state in parallel
  const [mics, models, settingsRaw] = await Promise.all([
    whisperApi.listMics(),
    whisperApi.listModels(),
    loadAllSettings(),
  ]);
  const s = settingsRaw;

  content.appendChild(section('Микрофон', micSelect(mics, s['whisper.mic_device'] || '')));
  content.appendChild(section('Модель по умолчанию', modelSelect(models, s['whisper.default_model'] || '')));
  content.appendChild(section('Язык', langSelect(s['whisper.language'] || 'auto')));
  content.appendChild(section('Hotkey', textInput('hotkey', s['whisper.hotkey'] || 'Ctrl+Alt+Space', 'напр. Ctrl+Alt+Space')));
  content.appendChild(section('Метод вставки', injectRadio(s['whisper.inject_method'] || 'paste')));
  content.appendChild(section('Idle timeout (сек)', numInput('idle_timeout_sec', s['whisper.idle_timeout_sec'] || '300', 60, 1800, 30)));
  content.appendChild(section('Постобработка', checkbox('postprocess_rules', (s['whisper.postprocess_rules'] || 'true') === 'true', 'Лёгкие правила (убрать «эээ», заглавная буква)')));
  content.appendChild(llmBlock(s));
  content.appendChild(section('Overlay', overlayBlock(s)));

  modal.querySelector('#close-btn').onclick = () => backdrop.remove();
  modal.querySelector('#save-btn').onclick = async () => {
    const formValues = collect(modal);
    for (const [key, value] of Object.entries(formValues)) {
      await whisperApi.setSetting(key, value);
    }
    backdrop.remove();
    // Tell the parent tab to reload defaults if needed:
    window.dispatchEvent(new CustomEvent('whisper:settings-changed'));
  };
}

async function loadAllSettings() {
  const keys = [
    'whisper.hotkey','whisper.mic_device','whisper.default_model','whisper.idle_timeout_sec',
    'whisper.inject_method','whisper.postprocess_rules','whisper.llm_enabled',
    'whisper.llm_endpoint','whisper.llm_api_key','whisper.llm_model','whisper.llm_prompt',
    'whisper.overlay_position','whisper.overlay_hide_on_tab','whisper.language',
  ];
  const result = {};
  for (const k of keys) {
    try { result[k] = await whisperApi.getSetting(k); } catch { result[k] = null; }
  }
  return result;
}

function section(label, node) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';
  const lbl = document.createElement('div');
  lbl.textContent = label;
  lbl.style.cssText = 'color:var(--text-muted,#8b949e);font-size:11px;text-transform:uppercase;letter-spacing:.5px';
  wrap.appendChild(lbl);
  wrap.appendChild(node);
  return wrap;
}

function micSelect(mics, current) {
  const sel = document.createElement('select');
  sel.dataset.key = 'whisper.mic_device';
  sel.className = 'w-input';
  sel.innerHTML = `<option value="">(системный по умолчанию)</option>` + mics.map(m =>
    `<option value="${escapeAttr(m.name)}" ${m.name === current ? 'selected' : ''}>${escapeHtml(m.name)}${m.is_default ? ' (default)' : ''}</option>`
  ).join('');
  stylizeInput(sel);
  return sel;
}

function modelSelect(models, current) {
  const sel = document.createElement('select');
  sel.dataset.key = 'whisper.default_model';
  sel.innerHTML = models.map(m =>
    `<option value="${escapeAttr(m.name)}" ${m.name === current || m.is_default ? 'selected' : ''}>${escapeHtml(m.display_name)}</option>`
  ).join('') || `<option value="">(нет установленных моделей)</option>`;
  stylizeInput(sel);
  return sel;
}

function langSelect(current) {
  const sel = document.createElement('select');
  sel.dataset.key = 'whisper.language';
  sel.innerHTML = ['auto','ru','en'].map(l =>
    `<option value="${l}" ${l === current ? 'selected' : ''}>${l}</option>`
  ).join('');
  stylizeInput(sel);
  return sel;
}

function textInput(shortKey, value, placeholder) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.dataset.key = 'whisper.' + shortKey;
  inp.value = value;
  inp.placeholder = placeholder || '';
  stylizeInput(inp);
  return inp;
}

function numInput(shortKey, value, min, max, step) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.dataset.key = 'whisper.' + shortKey;
  inp.min = String(min); inp.max = String(max); inp.step = String(step);
  inp.value = String(value);
  stylizeInput(inp);
  return inp;
}

function injectRadio(current) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:12px';
  for (const v of ['copy','paste','type']) {
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer';
    lbl.innerHTML = `<input type="radio" name="whisper.inject_method" value="${v}" ${v===current?'checked':''} data-key="whisper.inject_method"> <span>${v}</span>`;
    wrap.appendChild(lbl);
  }
  return wrap;
}

function checkbox(shortKey, checked, label) {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer';
  wrap.innerHTML = `<input type="checkbox" data-key="whisper.${shortKey}" ${checked ? 'checked' : ''}> <span>${escapeHtml(label)}</span>`;
  return wrap;
}

function llmBlock(s) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px;border:1px dashed var(--border,#30363d);border-radius:4px';
  wrap.appendChild(checkbox('llm_enabled', (s['whisper.llm_enabled'] || 'false') === 'true', 'Постобработка через внешний LLM'));
  wrap.appendChild(textInput('llm_endpoint', s['whisper.llm_endpoint'] || '', 'https://api.openai.com/v1/chat/completions'));
  wrap.appendChild(textInput('llm_api_key', s['whisper.llm_api_key'] || '', 'API key'));
  wrap.appendChild(textInput('llm_model', s['whisper.llm_model'] || 'gpt-4o-mini', 'модель'));
  const prompt = document.createElement('textarea');
  prompt.dataset.key = 'whisper.llm_prompt';
  prompt.rows = 3;
  prompt.value = s['whisper.llm_prompt'] || 'Clean up filler words; fix punctuation. Keep language.';
  stylizeInput(prompt);
  wrap.appendChild(prompt);
  return wrap;
}

function overlayBlock(s) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  const posSel = document.createElement('select');
  posSel.dataset.key = 'whisper.overlay_position';
  const current = s['whisper.overlay_position'] || 'bottom-right';
  posSel.innerHTML = ['bottom-right','bottom-left','top-right','top-left'].map(p =>
    `<option value="${p}" ${p===current?'selected':''}>${p}</option>`
  ).join('');
  stylizeInput(posSel);
  wrap.appendChild(posSel);
  wrap.appendChild(checkbox('overlay_hide_on_tab', (s['whisper.overlay_hide_on_tab'] || 'false') === 'true', 'Скрывать overlay когда вкладка Whisper активна'));
  return wrap;
}

function stylizeInput(el) {
  el.style.cssText = 'padding:6px 8px;background:var(--bg-secondary,#161b22);border:1px solid var(--border,#30363d);color:var(--text,#c9d1d9);border-radius:4px;font-size:13px;font-family:inherit';
}

function collect(root) {
  const out = {};
  root.querySelectorAll('[data-key]').forEach(el => {
    if (el.type === 'checkbox') out[el.dataset.key] = el.checked ? 'true' : 'false';
    else if (el.type === 'radio') { if (el.checked) out[el.dataset.key] = el.value; }
    else out[el.dataset.key] = el.value;
  });
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
```

- [ ] **Step 2: Test**

Manual in browser — need the main tab from Chunk 10 to have a ⚙ button that calls `openSettingsModal`. For now: add a quick smoke by importing from DevTools console:

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src
python3 -m http.server 8000 &
```

Open `http://localhost:8000/dev.html`. In DevTools console:

```js
const mod = await import('./tabs/whisper/whisper-settings.js');
mod.openSettingsModal();
```

Verify the modal renders and all inputs are populated/clickable. Close it, kill the server.

- [ ] **Step 3: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src/tabs/whisper/whisper-settings.js
git commit -m "whisper: settings modal (mic, model, hotkey, inject, LLM, overlay)"
```

---

## Chunk 10: Two-pane tab

Main tab UI: history list on the left, transcript detail on the right, with Record/Stop in header, state chip, and the ⚙ button.

### Task 10.1: `whisper-tab.js`

**Files:**
- Create: `desktop-rust/src/tabs/whisper/whisper-tab.js`

- [ ] **Step 1: Build the two-pane layout**

```javascript
import { whisperApi, onWhisperEvent } from './whisper-api.js';
import { openSettingsModal } from './whisper-settings.js';

export async function initTab(container) {
  container.innerHTML = '';
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;height:100%;overflow:hidden;padding:0';

  const state = {
    recording: false,
    currentState: 'idle',
    selectedId: null,
    history: [],
    cleanup: [],
  };

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border,#30363d);background:var(--bg-secondary,#161b22);flex-shrink:0';
  header.innerHTML = `
    <span style="font-weight:600;color:var(--text,#c9d1d9)">🎤 Whisper</span>
    <span id="state-chip" style="padding:2px 8px;background:var(--bg,#0d1117);border-radius:10px;font-size:11px;color:var(--text-muted,#8b949e)">○ idle</span>
    <span id="default-model" style="margin-left:8px;font-size:11px;color:var(--text-muted,#8b949e)"></span>
    <span style="flex:1"></span>
    <button id="record-btn" style="padding:5px 14px;background:var(--accent,#388bfd);color:#fff;border:0;border-radius:4px;cursor:pointer;font-weight:600">🎤 Record</button>
    <button id="settings-btn" style="padding:5px 10px;background:transparent;color:var(--text-muted,#8b949e);border:1px solid var(--border,#30363d);border-radius:4px;cursor:pointer">⚙</button>
  `;
  container.appendChild(header);

  // Body: two-pane
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex:1;overflow:hidden';
  container.appendChild(body);

  const left = document.createElement('div');
  left.style.cssText = 'width:38%;min-width:240px;border-right:1px solid var(--border,#30363d);overflow-y:auto';
  body.appendChild(left);

  const right = document.createElement('div');
  right.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';
  body.appendChild(right);

  const detail = document.createElement('div');
  detail.style.cssText = 'flex:1;padding:14px;overflow:auto;display:flex;flex-direction:column;gap:10px';
  right.appendChild(detail);

  const actions = document.createElement('div');
  actions.style.cssText = 'padding:10px;border-top:1px solid var(--border,#30363d);display:flex;gap:6px;flex-wrap:wrap';
  right.appendChild(actions);

  // State chip updater
  const chip = header.querySelector('#state-chip');
  const modelLabel = header.querySelector('#default-model');
  const recordBtn = header.querySelector('#record-btn');

  function setChip(st) {
    const stateMap = {
      idle:         { label: '○ idle',           color: 'var(--text-muted,#8b949e)' },
      warming:      { label: '⏳ warming up',    color: 'var(--warn,#f0883e)' },
      ready:        { label: '● ready',          color: 'var(--green,#3fb950)' },
      recording:    { label: '🔴 recording',     color: 'var(--red,#f85149)' },
      transcribing: { label: '💭 transcribing',  color: 'var(--blue,#58a6ff)' },
      unloading:    { label: '… unloading',      color: 'var(--text-muted,#8b949e)' },
    };
    const m = stateMap[st] || stateMap.idle;
    chip.textContent = m.label;
    chip.style.color = m.color;
    state.currentState = st;
    recordBtn.textContent = st === 'recording' ? '⏹ Stop' : '🎤 Record';
    recordBtn.dataset.mode = st === 'recording' ? 'stop' : 'start';
  }

  // Record button
  recordBtn.onclick = async () => {
    try {
      if (recordBtn.dataset.mode === 'stop') {
        await whisperApi.stopRecording();
        await reloadHistory();
      } else {
        await whisperApi.startRecording();
      }
    } catch (e) {
      alert(`Whisper error: ${e}`);
    }
  };
  header.querySelector('#settings-btn').onclick = () => openSettingsModal();

  // Keyboard: Ctrl+Space as in-tab shortcut (different from global hotkey)
  const onKey = (e) => {
    if (e.ctrlKey && e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      recordBtn.click();
    }
  };
  document.addEventListener('keydown', onKey);
  state.cleanup.push(() => document.removeEventListener('keydown', onKey));

  // Listen for events
  const offState = await onWhisperEvent('stateChanged', (p) => {
    setChip(p.state);
    if (p.model) modelLabel.textContent = p.model;
  });
  state.cleanup.push(offState);

  const offTranscribed = await onWhisperEvent('transcribed', async () => {
    await reloadHistory();
  });
  state.cleanup.push(offTranscribed);

  // Initial state
  const models = await whisperApi.listModels();
  const def = models.find(m => m.is_default);
  if (def) modelLabel.textContent = def.display_name;
  setChip('idle');

  // History pane
  async function reloadHistory() {
    state.history = await whisperApi.getHistory(200);
    left.innerHTML = '';
    if (state.history.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'Нет записей. Нажмите Record.';
      empty.style.cssText = 'padding:14px;color:var(--text-muted,#8b949e);font-size:12px';
      left.appendChild(empty);
      renderDetail(null);
      return;
    }
    for (const h of state.history) {
      left.appendChild(renderHistoryRow(h, (id) => {
        state.selectedId = id;
        Array.from(left.children).forEach(c => c.style.background = '');
        const sel = Array.from(left.children).find(c => c.dataset.id === String(id));
        if (sel) sel.style.background = 'var(--bg-secondary,#161b22)';
        const row = state.history.find(r => r.id === id);
        renderDetail(row);
      }));
    }
    // Auto-select newest
    state.selectedId = state.history[0].id;
    Array.from(left.children).forEach(c => c.style.background = '');
    if (left.children[0]) left.children[0].style.background = 'var(--bg-secondary,#161b22)';
    renderDetail(state.history[0]);
  }

  function renderHistoryRow(h, onClick) {
    const row = document.createElement('div');
    row.dataset.id = String(h.id);
    row.style.cssText = 'padding:8px 10px;border-bottom:1px solid var(--border,#30363d);cursor:pointer';
    const when = formatRelativeTime(h.created_at);
    row.innerHTML = `
      <div style="color:var(--text,#c9d1d9);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml((h.text || '').slice(0, 120))}</div>
      <div style="color:var(--text-muted,#8b949e);font-size:10px;margin-top:2px">${when} · ${h.model_name} · ${(h.text || '').trim().split(/\s+/).filter(Boolean).length} words</div>
    `;
    row.onclick = () => onClick(h.id);
    return row;
  }

  function renderDetail(h) {
    detail.innerHTML = '';
    actions.innerHTML = '';
    if (!h) {
      const empty = document.createElement('div');
      empty.textContent = 'Выберите запись слева или сделайте новую.';
      empty.style.cssText = 'color:var(--text-muted,#8b949e);font-size:12px';
      detail.appendChild(empty);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = h.text;
    textarea.style.cssText = 'width:100%;min-height:220px;flex:1;padding:10px;background:var(--bg,#0d1117);border:1px solid var(--border,#30363d);color:var(--text,#c9d1d9);border-radius:4px;font-family:inherit;font-size:13px;line-height:1.55;resize:vertical';
    detail.appendChild(textarea);

    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:11px;color:var(--text-muted,#8b949e)';
    meta.textContent = `${formatRelativeTime(h.created_at)} · ${h.model_name} · ${h.language || 'auto'} · duration ${h.duration_ms}ms · transcribe ${h.transcribe_ms}ms${h.injected_to ? ' · ' + h.injected_to : ''}`;
    detail.appendChild(meta);

    // Buttons
    actions.appendChild(btn('📋 Copy', async () => { await whisperApi.injectText(textarea.value, 'copy'); toast('Скопировано'); }));
    actions.appendChild(btn('⎘ Paste', async () => { await whisperApi.injectText(textarea.value, 'paste'); toast('Вставлено'); }));
    actions.appendChild(btn('Type', async () => { await whisperApi.injectText(textarea.value, 'type'); toast('Напечатано'); }));
    actions.appendChild(btn('🗑 Delete', async () => {
      if (!confirm('Удалить эту запись?')) return;
      await whisperApi.deleteHistory(h.id);
      await reloadHistory();
    }, true));
  }

  function btn(label, onClick, danger = false) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `padding:5px 10px;background:var(--bg-secondary,#161b22);border:1px solid var(--border,#30363d);color:${danger ? 'var(--red,#f85149)' : 'var(--text,#c9d1d9)'};border-radius:4px;cursor:pointer;font-size:12px`;
    b.onclick = onClick;
    return b;
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--bg-secondary,#161b22);border:1px solid var(--border,#30363d);color:var(--text,#c9d1d9);padding:8px 16px;border-radius:4px;z-index:2000;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,.3)';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  }

  await reloadHistory();

  // Cleanup on tab teardown. The existing tab-container in this project may
  // or may not dispatch a teardown event — if it does, hook into it here.
  // For now, cleanup accumulates in state.cleanup and would be called by a
  // future teardown hook.
}

function formatRelativeTime(unixSec) {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - Number(unixSec);
  if (diff < 60) return `${diff} sec ago`;
  if (diff < 3600) return `${Math.floor(diff/60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)} hours ago`;
  return new Date(Number(unixSec) * 1000).toLocaleDateString();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
```

- [ ] **Step 2: Test the full flow in browser**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src
python3 -m http.server 8000 &
```

Open `http://localhost:8000/dev.html`. Click Whisper tab. Since no models installed in fresh mock state, you land on onboarding. Click Install small; wait for the mock download. After it completes, the tab re-inits → two-pane UI. Click Record → chip turns red, wait a few seconds, click Stop → transcript appears in left list + right pane. Click Copy/Paste/Type/Delete buttons — all should work (mock-level). Click ⚙ → settings modal opens.

```bash
kill %1 2>/dev/null || pkill -f 'http.server 8000'
```

- [ ] **Step 3: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src/tabs/whisper/whisper-tab.js
git commit -m "whisper: two-pane tab (history + transcript + record + settings)"
```

---

## Chunk 11: Floating overlay window

The second Tauri window, declared earlier in `tauri.conf.json` (Chunk 1, Task 1.2). We now create its HTML content, show/hide it from Rust on state transitions, and stream level events into it.

### Task 11.1: Overlay HTML

**Files:**
- Create: `desktop-rust/src/tabs/whisper/whisper-overlay.html`

- [ ] **Step 1: Write the overlay page**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Whisper</title>
  <style>
    html, body { margin:0; padding:0; height:100%; background:transparent; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#c9d1d9; overflow:hidden; user-select:none; -webkit-app-region:drag; }
    .card { box-sizing:border-box; width:100%; height:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.4); padding:12px; display:flex; flex-direction:column; gap:8px; }
    .row { display:flex; align-items:center; gap:8px; }
    .dot { width:8px; height:8px; border-radius:50%; background:#8b949e; }
    .dot.rec { background:#f85149; animation:pulse 1s infinite; }
    @keyframes pulse { 0% { opacity:1 } 50% { opacity:.4 } 100% { opacity:1 } }
    .title { font-weight:600; font-size:13px; }
    .timer { margin-left:auto; font-family:ui-monospace,monospace; font-size:12px; color:#8b949e; }
    .bars { display:flex; gap:2px; align-items:end; height:24px; }
    .bars span { width:3px; background:#3fb950; transition:height 80ms linear; height:10%; }
    .btnrow { display:flex; gap:6px; -webkit-app-region:no-drag; }
    button { background:#21262d; border:1px solid #30363d; color:#c9d1d9; padding:6px 10px; border-radius:4px; font-size:11px; cursor:pointer; flex:1; }
    button.x { flex:0 0 auto; padding:6px 10px; }
    .progress { height:3px; background:#30363d; border-radius:2px; overflow:hidden; }
    .progress > span { display:block; height:100%; width:0%; background:#58a6ff; transition:width 200ms linear; }
    .sub { font-size:11px; color:#8b949e; margin-top:-2px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="row">
      <span id="dot" class="dot"></span>
      <span id="title" class="title">Whisper</span>
      <span id="timer" class="timer"></span>
    </div>
    <div id="body">
      <div id="bars" class="bars" style="display:none">
        ${Array.from({ length: 24 }).map(() => '<span></span>').join('')}
      </div>
      <div id="progress" class="progress" style="display:none"><span></span></div>
      <div id="sub" class="sub"></div>
    </div>
    <div class="btnrow">
      <button id="stop">Stop ⏎</button>
      <button id="cancel" class="x">✕</button>
    </div>
  </div>
  <script type="module" src="khapp://localhost/tabs/whisper/whisper-overlay.js"></script>
</body>
</html>
```

Note: the Array.from template inside `<div id="bars">` is only a visual hint for the exec — inline 24 literal `<span></span>` elements instead, since the HTML file is static:

```html
<div id="bars" class="bars" style="display:none">
  <span></span><span></span><span></span><span></span><span></span><span></span>
  <span></span><span></span><span></span><span></span><span></span><span></span>
  <span></span><span></span><span></span><span></span><span></span><span></span>
  <span></span><span></span><span></span><span></span><span></span><span></span>
</div>
```

### Task 11.2: Overlay JS

**Files:**
- Create: `desktop-rust/src/tabs/whisper/whisper-overlay.js`

- [ ] **Step 1: Wire the overlay**

```javascript
import { whisperApi, onWhisperEvent } from './whisper-api.js';

const dot = document.getElementById('dot');
const titleEl = document.getElementById('title');
const timer = document.getElementById('timer');
const bars = document.getElementById('bars');
const progress = document.getElementById('progress');
const progressBar = progress.querySelector('span');
const sub = document.getElementById('sub');
const stopBtn = document.getElementById('stop');
const cancelBtn = document.getElementById('cancel');

let startedAt = 0;
let timerIv = null;

function setMode(state) {
  bars.style.display = 'none';
  progress.style.display = 'none';
  sub.textContent = '';
  dot.classList.remove('rec');
  if (state === 'warming') {
    titleEl.textContent = 'Loading model…';
    progress.style.display = 'block';
    progressBar.style.width = '40%';
  } else if (state === 'recording') {
    titleEl.textContent = 'Recording';
    bars.style.display = 'flex';
    dot.classList.add('rec');
    startedAt = performance.now();
    if (timerIv) clearInterval(timerIv);
    timerIv = setInterval(updateTimer, 200);
    updateTimer();
  } else if (state === 'transcribing') {
    titleEl.textContent = 'Transcribing…';
    progress.style.display = 'block';
    progressBar.style.width = '70%';
    if (timerIv) { clearInterval(timerIv); timerIv = null; }
    timer.textContent = '';
  } else {
    titleEl.textContent = 'Whisper';
    timer.textContent = '';
    if (timerIv) { clearInterval(timerIv); timerIv = null; }
  }
}

function updateTimer() {
  const sec = Math.floor((performance.now() - startedAt) / 1000);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  timer.textContent = `${mm}:${ss}`;
}

// RMS bar animation
let barArr = Array.from(bars.querySelectorAll('span'));
let barIdx = 0;
async function initEvents() {
  await onWhisperEvent('stateChanged', (p) => setMode(p.state));
  await onWhisperEvent('level', (p) => {
    const h = Math.max(10, Math.min(100, p.rms * 140));
    barArr[barIdx % barArr.length].style.height = h + '%';
    barIdx++;
  });
  await onWhisperEvent('transcribed', (p) => {
    titleEl.textContent = 'Inserted';
    dot.classList.remove('rec');
    const words = (p.text || '').trim().split(/\s+/).filter(Boolean).length;
    sub.textContent = `"${(p.text || '').slice(0, 40)}${p.text.length > 40 ? '…' : ''}" · ${words} words`;
    // auto-close after 1s handled by Rust hiding the window
  });
}

stopBtn.onclick = async () => {
  try { await whisperApi.stopRecording(); } catch (e) { console.error(e); }
};
cancelBtn.onclick = async () => {
  try { await whisperApi.cancelRecording(); } catch (e) { console.error(e); }
};

initEvents();
setMode('idle');
```

### Task 11.3: Rust — show/hide/position the overlay on state transitions

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/service.rs` — add overlay show/hide calls

- [ ] **Step 1: Add a helper for overlay window control**

Inside `service.rs`, add at the bottom (outside tests):

```rust
fn overlay_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("whisper-overlay")
}

fn show_overlay(app: &AppHandle) {
    if let Some(w) = overlay_window(app) {
        let _ = w.show();
    }
}

fn hide_overlay(app: &AppHandle) {
    if let Some(w) = overlay_window(app) {
        let _ = w.hide();
    }
}
```

Call `show_overlay(&app)` at the top of `start_recording` (both from idle and from ready branches), and `hide_overlay(&app)` inside the idle-timeout task after the final state transition to Idle, AND at the end of `cancel_recording` when state returns to Idle/Ready. Also hide 1 second after a successful `stop_recording` returns — the simplest way is inside `stop_recording`, spawn a `tokio::spawn` with a 1-second sleep that calls `hide_overlay`.

- [ ] **Step 2: Move overlay window to the configured corner**

Inside `service.rs`, before showing:

```rust
fn position_overlay(app: &AppHandle, corner: &str) {
    let Some(w) = overlay_window(app) else { return; };
    let Ok(monitor) = w.current_monitor() else { return; };
    let Some(mon) = monitor else { return; };
    let size = mon.size();
    let scale = mon.scale_factor();
    let w_size = w.outer_size().unwrap_or(tauri::PhysicalSize { width: (260.0 * scale) as u32, height: (90.0 * scale) as u32 });
    let margin = (16.0 * scale) as i32;
    let (x, y) = match corner {
        "bottom-left"  => (margin, (size.height as i32) - (w_size.height as i32) - margin),
        "top-right"    => ((size.width as i32) - (w_size.width as i32) - margin, margin),
        "top-left"     => (margin, margin),
        _              => ((size.width as i32) - (w_size.width as i32) - margin, (size.height as i32) - (w_size.height as i32) - margin), // bottom-right
    };
    let _ = w.set_position(tauri::PhysicalPosition { x, y });
}
```

Call `position_overlay(&app, corner)` from `start_recording` after reading the setting; the corner string is fetched in the Tauri command layer (Chunk 6's `whisper_start_recording` — add it to the `db.0.lock()` block and pass through; alternatively, read from settings inside the service).

- [ ] **Step 3: cargo check**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo check 2>&1 | tail -15
```

Expected: compiles.

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/src/tabs/whisper/whisper-overlay.html \
        desktop-rust/src/tabs/whisper/whisper-overlay.js \
        desktop-rust/src-tauri/src/whisper/service.rs
git commit -m "whisper: floating overlay (HTML, JS, Rust show/hide/position)"
```

---

## Chunk 12: CI integration — whisper.cpp binaries + RELEASES.md

### Task 12.1: `WHISPER_CPP_VERSION` pin file

**Files:**
- Create: `desktop-rust/WHISPER_CPP_VERSION`

- [ ] **Step 1: Pick the latest stable release from `github.com/ggml-org/whisper.cpp/releases`**

Browse the releases page, pick the latest stable (e.g. `v1.7.3`). Write that string (no leading `v` if the release tag in the GH API doesn't have it, but the visible tag usually does — use whatever curl returns for the filename):

```bash
echo 'v1.7.3' > /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/WHISPER_CPP_VERSION
```

- [ ] **Step 2: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/WHISPER_CPP_VERSION
git commit -m "whisper: pin whisper.cpp release version"
```

### Task 12.2: CI step — fetch + extract + rename

**Files:**
- Modify: `.github/workflows/release-desktop.yml`

- [ ] **Step 1: Read the existing workflow**

```bash
cat /home/aster/dev/snippets_helper-feat-whisper/.github/workflows/release-desktop.yml
```

Understand the structure — which jobs, which run on which runner, where `tauri build` lives for macOS vs Windows vs Linux.

- [ ] **Step 2: Add a `prepare-whisper-bin` step BEFORE `tauri build`**

For each job that runs `tauri build` (likely there's a `macos-latest` job and a `windows-latest` job for native builds, triggered on `v-*` tags only), insert a step that:

1. Reads `desktop-rust/WHISPER_CPP_VERSION`
2. Downloads the matching release asset for the platform
3. Unzips it
4. Renames the whisper-server binary to `whisper-server-<target-triple>(.exe)`
5. Moves it to `desktop-rust/src-tauri/binaries/`

Asset names (verify on the actual releases page before committing):
- macOS: the release posts a zip like `whisper-bin-macos.zip` or similar; pick the one containing a server binary for Apple Silicon.
- Windows: `whisper-bin-x64.zip` or `whisper-cublas-*-bin-x64.zip` for CUDA; use the CPU one.

Example for macOS job:

```yaml
      - name: Fetch whisper.cpp binary (macOS)
        if: runner.os == 'macOS'
        run: |
          VERSION=$(cat desktop-rust/WHISPER_CPP_VERSION)
          mkdir -p desktop-rust/src-tauri/binaries
          curl -sL "https://github.com/ggml-org/whisper.cpp/releases/download/${VERSION}/whisper-bin-macos.zip" -o /tmp/wbin.zip
          unzip -q /tmp/wbin.zip -d /tmp/wbin
          # Find the server binary inside
          SRV=$(find /tmp/wbin -name 'whisper-server' -type f | head -1)
          if [ -z "$SRV" ]; then echo "whisper-server not found in release zip"; exit 1; fi
          cp "$SRV" desktop-rust/src-tauri/binaries/whisper-server-aarch64-apple-darwin
          chmod +x desktop-rust/src-tauri/binaries/whisper-server-aarch64-apple-darwin
```

And for Windows:

```yaml
      - name: Fetch whisper.cpp binary (Windows)
        if: runner.os == 'Windows'
        shell: bash
        run: |
          VERSION=$(cat desktop-rust/WHISPER_CPP_VERSION)
          mkdir -p desktop-rust/src-tauri/binaries
          curl -sL "https://github.com/ggml-org/whisper.cpp/releases/download/${VERSION}/whisper-bin-x64.zip" -o /tmp/wbin.zip
          unzip -q /tmp/wbin.zip -d /tmp/wbin
          SRV=$(find /tmp/wbin -name 'whisper-server.exe' | head -1)
          if [ -z "$SRV" ]; then echo "whisper-server.exe not found in release zip"; exit 1; fi
          cp "$SRV" desktop-rust/src-tauri/binaries/whisper-server-x86_64-pc-windows-msvc.exe
```

**Important:** the actual asset names on the upstream release might differ. Before committing, do a dry run:

```bash
curl -sL https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/$(cat desktop-rust/WHISPER_CPP_VERSION) | jq -r '.assets[].name'
```

and adjust the asset URL in the workflow accordingly.

If the release doesn't include a prebuilt `whisper-server` on macOS at all (whisper.cpp's macOS releases sometimes ship only `main`/`whisper-cli`), fall back to building from source in CI:

```yaml
      - name: Build whisper-server from source (macOS)
        if: runner.os == 'macOS'
        run: |
          VERSION=$(cat desktop-rust/WHISPER_CPP_VERSION)
          git clone --depth 1 --branch "${VERSION}" https://github.com/ggml-org/whisper.cpp /tmp/wcpp
          cd /tmp/wcpp
          make server -j
          mkdir -p ${{ github.workspace }}/desktop-rust/src-tauri/binaries
          cp server ${{ github.workspace }}/desktop-rust/src-tauri/binaries/whisper-server-aarch64-apple-darwin
```

Pick one approach per platform and document it clearly in a comment in the workflow file.

- [ ] **Step 3: Skip the step for `f-*` tags**

If the workflow has separate jobs for `v-*` vs `f-*`, make sure only the `v-*` jobs include this step. If jobs are shared with a conditional, gate the step:

```yaml
        if: startsWith(github.ref, 'refs/tags/v')
```

- [ ] **Step 4: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add .github/workflows/release-desktop.yml
git commit -m "whisper: CI fetch/build whisper-server binaries before tauri build"
```

### Task 12.3: `.gitignore` + local binaries policy

**Files:**
- Modify: `.gitignore`
- Create: `desktop-rust/src-tauri/binaries/.gitkeep`

- [ ] **Step 1: Ignore the binaries directory content (except the .gitkeep)**

Append to root `.gitignore`:

```
desktop-rust/src-tauri/binaries/*
!desktop-rust/src-tauri/binaries/.gitkeep
```

- [ ] **Step 2: Create placeholder**

```bash
mkdir -p /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri/binaries
touch /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri/binaries/.gitkeep
```

- [ ] **Step 3: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add .gitignore desktop-rust/src-tauri/binaries/.gitkeep
git commit -m "whisper: gitignore binaries dir (populated by CI), keep placeholder"
```

### Task 12.4: Developer script — fetch whisper-server locally

**Files:**
- Create: `desktop-rust/scripts/fetch-whisper-bin.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Fetch the whisper-server binary for local development (matching
# WHISPER_CPP_VERSION). Mirrors what CI does.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
VERSION=$(cat "$REPO_ROOT/desktop-rust/WHISPER_CPP_VERSION")
OUT="$REPO_ROOT/desktop-rust/src-tauri/binaries"
mkdir -p "$OUT"

case "$(uname -s)" in
  Darwin)
    TARGET=aarch64-apple-darwin
    URL="https://github.com/ggml-org/whisper.cpp/releases/download/${VERSION}/whisper-bin-macos.zip"
    ;;
  Linux)
    TARGET=x86_64-unknown-linux-gnu
    # No official Linux prebuild — build from source
    TMP=$(mktemp -d)
    git clone --depth 1 --branch "${VERSION}" https://github.com/ggml-org/whisper.cpp "$TMP/wcpp"
    make -C "$TMP/wcpp" server -j
    cp "$TMP/wcpp/server" "$OUT/whisper-server-$TARGET"
    chmod +x "$OUT/whisper-server-$TARGET"
    rm -rf "$TMP"
    exit 0
    ;;
  *)
    echo "unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac

curl -sL "$URL" -o /tmp/wbin.zip
rm -rf /tmp/wbin && mkdir /tmp/wbin
unzip -q /tmp/wbin.zip -d /tmp/wbin
SRV=$(find /tmp/wbin -name 'whisper-server' -type f | head -1)
if [ -z "$SRV" ]; then
  echo "whisper-server not found in release zip for $TARGET — check upstream asset layout" >&2
  exit 1
fi
cp "$SRV" "$OUT/whisper-server-$TARGET"
chmod +x "$OUT/whisper-server-$TARGET"
echo "Installed $OUT/whisper-server-$TARGET"
```

- [ ] **Step 2: Make executable + commit**

```bash
chmod +x /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/scripts/fetch-whisper-bin.sh
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/scripts/fetch-whisper-bin.sh
git commit -m "whisper: dev script to fetch whisper-server locally"
```

### Task 12.5: Update `RELEASES.md`

**Files:**
- Modify: `desktop-rust/RELEASES.md` — append new sections

- [ ] **Step 1: Add a new section**

Append at the end (the exact heading style should match the existing sections in `RELEASES.md`):

```markdown

## Whisper voice input

### Updating the whisper.cpp version

1. Check `github.com/ggml-org/whisper.cpp/releases` for the latest stable tag
2. Update `desktop-rust/WHISPER_CPP_VERSION` (e.g. `v1.7.4`)
3. Locally: `./desktop-rust/scripts/fetch-whisper-bin.sh` — verifies the upstream asset naming didn't change
4. Update model SHA256 values in `desktop-rust/src-tauri/src/whisper/catalog.rs` only if upstream re-uploaded the ggml models (the whisper.cpp release version is independent of ggml model hashes — those live on HuggingFace and change rarely)
5. Commit both files, tag a new `v-*` release

### Known gotchas

- **macOS Accessibility permission** is required for Cmd+V simulation. On the first auto-paste, macOS will prompt the user; if denied, the app falls back to copy-only silently (a toast informs the user).
- **Microphone permission (macOS TCC)** is requested on the first `whisper_start_recording`. If the user denies, `cpal` will report "no input device" — handled with a clear error toast that deep-links to System Settings.
- **whisper-server asset layout** occasionally changes between upstream releases. If CI fails at the fetch step, run `curl -sL https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/$VERSION | jq -r '.assets[].name'` and update the asset name in `.github/workflows/release-desktop.yml`.
- **Models are NOT bundled.** On the first Whisper tab visit, the user must install a model via onboarding (~500MB for `small`). Without a model, `whisper_start_recording` returns an error.
- **Idle unload** happens 5 min after the last transcript (configurable). If the user has only 8GB of RAM, the `large` model may OOM while loaded — the lifecycle unload protects against this.

### Manual integration checklist (run before every `v-*` tag)

See Chunk 13 of the plan for the complete list. Re-stated here for quick reference:

- [ ] macOS: fresh install → mic permission prompt on first Record
- [ ] macOS: Accessibility permission prompt on first auto-paste
- [ ] Cold launch → click Record → overlay shows "Loading model" then "Recording"
- [ ] Speak, Stop → transcript pastes into the previously-focused window
- [ ] Wait 5 min → `ps | grep whisper-server` shows no process
- [ ] Hotkey (Ctrl+Alt+Space) from another window → overlay + inject
- [ ] Click "Unload now" in settings → whisper-server SIGTERM'd immediately
- [ ] Delete a model → file removed from `app_data/whisper-models/`
- [ ] Postprocess rules on/off reflects in history `text_raw` column
- [ ] LLM-postprocess with a bogus endpoint → falls back to raw text silently
```

- [ ] **Step 2: Commit**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git add desktop-rust/RELEASES.md
git commit -m "RELEASES: whisper section (update process, gotchas, checklist)"
```

---

## Chunk 13: Manual integration checklist + end-to-end validation

This is the last chunk — no code, just the validation dance before merge.

### Task 13.1: Run existing `dev-test.py` smoke

**Files:** none

- [ ] **Step 1: Run 7-test smoke**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src
python3 dev-test.py 2>&1 | tail -20
```

Expected: 7/7 PASS. If any fail, investigate — adding the Whisper tab should not break unrelated tests.

### Task 13.2: UI iteration via dev-mock

**Files:** none (verification only)

- [ ] **Step 1: Exercise the full flow in-browser**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src
python3 -m http.server 8000 &
```

Open `http://localhost:8000/dev.html`.

Walk through:
- [ ] Click Whisper tab → onboarding with 6 cards + system hint visible
- [ ] Install `small` → progress bar animates, reaches 100%, turns into two-pane tab
- [ ] Record → state chip turns red + timer, history empty hint goes away, wait ~2s, Stop → transcript in left list + right pane
- [ ] Click Copy/Paste/Type buttons → toast shows, no errors in console
- [ ] Delete the entry → list empty
- [ ] ⚙ settings modal → all fields render, change a value, Save closes modal

Kill the server:

```bash
pkill -f 'http.server 8000' 2>/dev/null
```

### Task 13.3: Native smoke via Docker

**Files:** none

- [ ] **Step 1: Run native Tauri in Docker**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust
./dev-docker.sh dev
```

(This uses the existing Docker setup described in `RELEASES.md`. Expected: a real Tauri + WebKit window opens inside Docker. Limited utility — Docker has no mic — but it catches basic packaging/config issues before full-native testing.)

### Task 13.4: Full native smoke on real macOS or Windows

**Files:** none — physical or VM host with mic required

- [ ] **Step 1: Fetch whisper-server binary locally**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
./desktop-rust/scripts/fetch-whisper-bin.sh
ls -la desktop-rust/src-tauri/binaries/
```

Expected: one `whisper-server-<target>` file present.

- [ ] **Step 2: Build and run Tauri in debug mode**

```bash
cd desktop-rust/src-tauri
cargo tauri dev  # or `npm run tauri dev` if the existing dev script differs
```

A window opens. Approach the checklist below.

- [ ] **Step 3: Manual integration checklist**

Execute each bullet from Task 12.5's "Manual integration checklist" section, checking them off as they pass. If any fails:
- Stop
- Diagnose
- Fix the underlying issue (not the checklist)
- Re-verify the entire section

### Task 13.5: Final merge prep

**Files:** none

- [ ] **Step 1: All Rust tests pass**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src-tauri
cargo test 2>&1 | tail -5
```

- [ ] **Step 2: All smoke tests pass**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper/desktop-rust/src
python3 dev-test.py 2>&1 | tail -10
```

- [ ] **Step 3: Commit any last-minute fixes**

- [ ] **Step 4: Push branch + open PR**

```bash
cd /home/aster/dev/snippets_helper-feat-whisper
git push -u origin feat/whisper
```

(Don't auto-create the PR; the human decides when to open and with what body. Refer them to the spec + plan files in the description.)

- [ ] **Step 5: Hand-off**

Report to the human: "Implementation complete on `feat/whisper`. Pushed. Awaiting PR creation and review."


