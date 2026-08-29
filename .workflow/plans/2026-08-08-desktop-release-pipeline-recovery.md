# Desktop Release Pipeline Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the `v1.24.2` frontend OTA and make desktop release preflight reproducible and blocking.

**Architecture:** Keep release recovery separate from source fixes. Local Rust verification runs in a disposable Docker copy with generated Linux sidecar stubs; GitHub tags run an Ubuntu preflight before release creation or frontend packaging.

**Tech Stack:** Bash, Docker, Rust/Cargo, Tauri 2, Python CDP smoke tests, GitHub Actions.

## Global Constraints

- Preserve the existing `v1.24.2` tag and native artifacts.
- Do not change product behavior, database migrations, native commands, or mobile code.
- Do not push a fallback tag without first adding the exact tag to `desktop-rust/src/release-history.md`.
- Keep main-branch sidecar cache seeding independent from tag-only preflight.
- Keep repository source read-only during Docker verification.

---

### Task 0: Recover and verify `v1.24.2` OTA

**Files:**
- No source changes for the primary recovery path.
- Fallback only: modify `desktop-rust/src/release-history.md` before any Rust or workflow edit.

**Interfaces:**
- Consumes: GitHub Actions run `29016993077`, cancelled job `86117630390`, and existing release `v1.24.2`.
- Produces: signed frontend zip plus `frontend-version.json` on the existing release.

- [ ] **Step 1: Re-run only the cancelled frontend job**

Use the job-level **Re-run jobs** action for `release-frontend` job
`86117630390`, or:

```bash
gh run rerun --job 86117630390
```

Do not use “Re-run all jobs”, re-tag, recreate `v1.24.2`, or repeat the
successful native builds.

- [ ] **Step 2: Verify assets and manifest content**

Confirm the release contains:

```text
frontend-1.24.2-f6363015.zip
frontend-version.json
latest.json
```

Fetch `frontend-version.json`; require HTTP 200, version
`1.24.2-f6363015`, a non-empty signature, and a 64-character SHA-256. Download
the referenced zip, compute its SHA-256, compare it byte-for-byte with the
manifest value, and require the zip URL to return HTTP 200.

- [ ] **Step 3: Use fallback only if re-run is unavailable**

Before any later task changes Rust or workflow files, or from a separate clean
worktree rooted at `v1.24.2` if those edits have already started, choose a
unique `f-YYYYMMDD-N` tag, add the exact tag and recovery note to
`desktop-rust/src/release-history.md`, commit only that release-history change,
run frontend smoke, then stop for explicit confirmation before pushing the
commit and tag. Verify both frontend and carried-forward native manifests
before starting Task 1 or resuming the main worktree.

### Task 1: Add a reproducible Docker Rust test mode

**Files:**
- Modify: `desktop-rust/Dockerfile.dev`
- Modify: `desktop-rust/dev-docker.sh`
- Modify: `desktop-rust/RELEASES.md`

**Interfaces:**
- Consumes: existing `keyboard-helper-dev` image, shared Cargo registry volume,
  and a dedicated stable-path test target volume.
- Produces: `./desktop-rust/dev-docker.sh test`, a source-clean Rust preflight command.

- [ ] **Step 1: Preserve the failing prerequisite evidence**

The audited image without the fix fails `cargo check --locked` at `alsa-sys`
because `alsa.pc` is unavailable. Preserve this failure in the work log; do not
change Rust dependencies to bypass it.

- [ ] **Step 2: Complete Docker native packages**

Add these packages to the first `apt-get install` block in `Dockerfile.dev`:

```dockerfile
libasound2-dev \
patchelf \
```

- [ ] **Step 3: Add `test` mode**

Extend the mode validation/help in `dev-docker.sh` with `test`. The mode must
refresh the image through normal Docker build caching, then run a disposable,
unnamed container with the project mounted at `/source:ro`, copy the source to
`/work/source-copy` while excluding ignored build/cache directories and
downloaded sidecars, and create these files with mode `755`:

```text
/work/source-copy/src-tauri/binaries/whisper-server-x86_64-unknown-linux-gnu
/work/source-copy/src-tauri/binaries/llama-server-x86_64-unknown-linux-gnu
```

Then run from `/work/source-copy/src-tauri`:

```bash
pkg-config --exists alsa
command -v patchelf
cargo check --locked
cargo test --locked
```

Use `/work/target-docker` for `CARGO_TARGET_DIR` so the existing named target
volume remains reusable. Exit immediately after test mode; do not run X11
setup or the normal dev/build container path, and do not reuse the fixed
`keyboard-helper-dev-run` container name.

- [ ] **Step 4: Document the command**

Add `./dev-docker.sh test` to `RELEASES.md` section 4.3 and state that it uses a
read-only source mount plus disposable Linux sidecar stubs.

- [ ] **Step 5: Rebuild and verify isolation**

Capture `git status --porcelain=v1 --untracked-files=all` before and after:

```bash
cd desktop-rust
./dev-docker.sh rebuild
./dev-docker.sh test
```

Expected: image rebuild succeeds, ALSA and `patchelf` checks pass, and the two
status snapshots differ only by the intended source edits.

### Task 2: Repair the three stale Rust expectations

**Files:**
- Modify: `desktop-rust/src-tauri/src/db/queries.rs`
- Modify: `desktop-rust/src-tauri/src/db/mod.rs`

**Interfaces:**
- Consumes: existing `upsert_from_server`, migrations, and in-memory database test helpers.
- Produces: an all-green existing 301-test Rust suite without production-code changes.

- [ ] **Step 1: Confirm the RED baseline**

The audited disposable-container baseline already fails exactly:

```text
test_shortcut_server_iso_updated_at_is_readable
test_shortcut_lww_normalizes_existing_iso_before_compare
test_all_tables_exist
```

- [ ] **Step 2: Complete shortcut server fixtures**

In both failing server JSON fixtures in `queries.rs`, add:

```rust
"is_pinned": 0,
"pinned_sort_order": 0,
```

These fields make the fixtures match the current synchronized shortcut schema
without changing the timestamp behavior under test.

- [ ] **Step 3: Complete the table expectation**

Add these exact names to `test_all_tables_exist` in `db/mod.rs`:

```rust
"finance_import_batches",
"finance_mapping_rules",
"finance_transaction_allocations",
"finance_transactions",
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
./desktop-rust/dev-docker.sh test
```

Expected: `cargo check --locked` succeeds and `cargo test --locked` reports
`301 passed; 0 failed`.

### Task 3: Gate GitHub desktop tags with preflight

**Files:**
- Modify: `.github/workflows/release-desktop.yml`

**Interfaces:**
- Consumes: tag type (`v*` or `f-*`), Rust project, and frontend smoke script.
- Produces: a `preflight` job required by release creation and frontend packaging.

- [ ] **Step 1: Add the tag-only Ubuntu job**

Add `jobs.preflight` with:

```yaml
if: startsWith(github.ref, 'refs/tags/v') || startsWith(github.ref, 'refs/tags/f-')
runs-on: ubuntu-latest
```

Its common steps must check out the repository, use `actions/setup-python`,
install `websockets==15.0.1`, assert `google-chrome` exists, and run:

```bash
cd desktop-rust/src
python3 dev-test.py
```

- [ ] **Step 2: Add native-only Rust steps**

For `v*` only, install the Linux prerequisites listed in `RELEASES.md`, set up
stable Rust, create executable stubs in `desktop-rust/src-tauri/binaries`, and
run:

```bash
cd desktop-rust/src-tauri
cargo check --locked
cargo test --locked
```

- [ ] **Step 3: Wire dependencies**

Set `create-release.needs: preflight`. Add `preflight` to
`release-frontend.needs` and require `needs.preflight.result == 'success'` in
its existing `always()` condition. Preserve the main cache-seed behavior of
the `release` job.

- [ ] **Step 4: Validate workflow structure**

Run:

```bash
actionlint .github/workflows/release-desktop.yml
bash -n desktop-rust/dev-docker.sh
```

Then inspect the resulting job keys/dependencies and confirm this truth table:

```text
v*    -> preflight -> create-release -> native release -> release-frontend
f-*   -> preflight -> release-frontend
main  -> native sidecar cache seed only
```

### Task 4: Final verification and handoff

**Files:**
- Verify all modified files and workflow documents.

**Interfaces:**
- Consumes: Tasks 0-3.
- Produces: evidence-backed readiness report and a clean, reviewable diff.

- [ ] **Step 1: Run local gates**

```bash
cd desktop-rust/src
python3 dev-test.py

cd ../..
./desktop-rust/dev-docker.sh test
```

- [ ] **Step 2: Inspect the diff**

Run `git diff --check`, `git status --short`, and a path-scoped diff for the
workflow, Docker, Rust tests, release guide, spec, and plan. No generated
sidecars, Cargo artifacts, or unrelated files may appear.

- [ ] **Step 3: Report without publishing extra state**

Report exact test counts, OTA HTTP status, Actions run conclusion, and remaining
warnings. Do not commit, push source changes, tag, or create a PR unless the
user explicitly requests that next step.
