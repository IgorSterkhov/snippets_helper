# Desktop Release Pipeline Recovery — Requirement Spec

## Status

Approved direction by the user on 2026-08-08 after the release and environment
audit.

## Goal

Restore the missing frontend OTA assets for desktop release `v1.24.2`, make the
local Rust/Tauri Docker verification reproducible, return the existing Rust
suite to green, and prevent a future desktop tag from publishing before the
relevant pre-release checks pass.

## Confirmed Baseline

- Local `main`, `origin/main`, and tag `v1.24.2` point to commit `6363015`.
- Frontend browser smoke passes: `89/89`.
- `cargo check --locked` passes on Linux when `libasound2-dev` and temporary
  Linux sidecar stubs are present.
- `cargo test --locked` currently reports `298 passed; 3 failed`:
  - two datetime/sync fixtures omit the required shortcut pin fields added in
    `v1.3.31`;
  - the expected table list omits four finance tables added in `v1.22.0`.
- GitHub Actions run `29016993077` built the Windows and macOS artifacts for
  `v1.24.2`, but `release-frontend` was cancelled before a runner was assigned.
- The latest frontend OTA manifest currently returns HTTP 404 because the
  `v1.24.2` release has no `frontend-version.json` or frontend zip asset.

## Recovery Decision

Use the least invasive recovery path:

1. Re-run the specific cancelled `release-frontend` job for the existing
   `v1.24.2` run. Do not re-run the successful native jobs.
   This preserves the existing tag, native installers, and expected frontend
   version `1.24.2-f6363015`.
2. Use a new `f-*` frontend-only tag only if GitHub no longer permits the old
   job to be re-run. Because an `f-*` tag cannot include Rust changes, complete
   this fallback before the technical edits below or create it from a separate
   clean worktree at `v1.24.2`; its commit may contain only the matching
   release-history entry.
3. Do not create a new native `v1.24.3` release solely for test and CI
   maintenance.

## Local Docker Verification

`desktop-rust/Dockerfile.dev` must contain all Linux packages documented by the
release guide that are required by the current dependency graph, including
`libasound2-dev` for `cpal` and `patchelf` for Tauri packaging.

`desktop-rust/dev-docker.sh` must expose a non-interactive `test` mode that:

- mounts the repository source read-only;
- copies it into the disposable container filesystem so Tauri build scripts
  can generate permission metadata without touching the worktree, while
  excluding ignored build/cache directories and downloaded sidecars;
- creates executable, empty Linux stubs for both configured external binaries
  only in that disposable copy;
- reuses the existing Cargo registry volume and a dedicated test target volume
  at a stable container path, so absolute build-script paths cannot leak from
  or into the interactive dev cache;
- runs `cargo check --locked` followed by `cargo test --locked`;
- returns the Cargo exit code and leaves no source artifacts in the repository.

The existing `dev`, `build`, `shell`, and `rebuild` modes must keep their current
behavior.

## Rust Test Repair

Repair only the three proven stale expectations:

- Add `is_pinned: 0` and `pinned_sort_order: 0` to the two server shortcut JSON
  fixtures that test timestamp normalization/LWW behavior.
- Add `finance_import_batches`, `finance_mapping_rules`,
  `finance_transaction_allocations`, and `finance_transactions` to the exact
  database table expectation.

Do not change production sync behavior or database migrations as part of this
recovery.

## GitHub Actions Preflight

Extend `.github/workflows/release-desktop.yml` with an Ubuntu `preflight` job
for `v*` and `f-*` tag events:

- all desktop tags run `desktop-rust/src/dev-test.py` after installing its
  pinned Python `websockets==15.0.1` dependency and verifying that
  `google-chrome` is available;
- full `v*` tags also install the documented Linux native packages, set up
  stable Rust, create temporary Linux sidecar stubs, and run
  `cargo check --locked` plus `cargo test --locked`;
- `create-release` must depend on successful preflight for native tags;
- `release-frontend` must depend on successful preflight for both native and
  frontend-only tags;
- main-branch sidecar cache seeding must remain available and must not be
  forced through tag-only preflight work.

Preflight must complete before GitHub creates a new native release. This avoids
another partial release caused by a known red local suite.

## Post-Recovery Verification

The work is complete only when all applicable checks hold:

- `./desktop-rust/dev-docker.sh test` exits 0 with all 301 Rust tests passing;
- `desktop-rust/src/dev-test.py` reports `89/89 passed` or a higher all-green
  count if tests are added concurrently;
- the worktree contains only the intended workflow, Docker, test, spec, and
  plan changes;
- GitHub workflow syntax is valid;
- the recovered release exposes `frontend-version.json` and the referenced
  frontend zip;
- `https://github.com/IgorSterkhov/snippets_helper/releases/latest/download/frontend-version.json`
  returns HTTP 200, the downloaded zip SHA-256 matches the manifest, and the
  signature field is non-empty.

## Non-Goals

- No legacy Python desktop changes.
- No mobile build or mobile release changes.
- No user-facing desktop feature or native command changes.
- No native version bump, Help entry, changelog entry, or tag unless the
  frontend-only fallback release is required.
- No cleanup of the existing Rust warnings outside the three failing tests.
