# Release & Build Process — Keyboard Helper (Desktop)

Source of truth for how releases are cut, how OTA works, and what to verify
before tagging. Read this before making any release-related change.

Repo: `github.com/IgorSterkhov/snippets_helper`. Desktop app lives in
`desktop-rust/`.

---

## 1. Release channels

Two tag prefixes. Pick the right one based on what changed.

### `v<semver>` — full release
Triggers both the native build (.dmg / .exe / .nsis) **and** the frontend OTA
zip. Use when:
- Anything in `desktop-rust/src-tauri/` changed (Rust code, deps, tauri.conf).
- First release of a new semver (even if content is unchanged).
- You want a native installer for users to download fresh.

### `f-<YYYYMMDD-N>` — frontend-only OTA
Skips the native build entirely. Use when:
- Only files under `desktop-rust/src/` changed (JS / CSS / HTML / assets).
- Rust + deps are untouched.
- You want users' running apps to update in ~2 seconds without reinstall.

Tag convention: `f-YYYYMMDD-N` where `N` is a sequence counter for the day
(e.g. `f-20260421-1`, `f-20260421-2`).

**What users see:**
- A `v*` release goes to the native updater (`tauri-plugin-updater`) → shows
  "Download & Install" for a new .dmg/.exe.
- Every release (either flavour) publishes a frontend manifest → shows
  "Apply" in the sync indicator, reloads WebView with the new bundle.
- For `f-*` releases the `latest.json` from the last `v*` release is
  carried forward, so the native updater never 404s.

---

## 2. Cutting a release — step by step

### 2.1 Sanity checks before tagging
```bash
# Rust compiles?
cd desktop-rust/src-tauri && cargo check
# Frontend tests pass?
cd ../src && python3 dev-test.py        # expects 7/7 PASS
```
If either fails, fix before tagging.

### 2.2 For a `v*` release
```bash
# 1. Bump version in BOTH files to the same value
#    desktop-rust/src-tauri/Cargo.toml       -> version = "X.Y.Z"
#    desktop-rust/src-tauri/tauri.conf.json  -> "version": "X.Y.Z"
# 2. Refresh Cargo.lock
cd desktop-rust/src-tauri && cargo check
# 3. Update desktop-rust/CHANGELOG.md (add a section at the top)
# 4. Commit + tag + push
cd /repo/root
git add desktop-rust/src-tauri/Cargo.toml \
        desktop-rust/src-tauri/tauri.conf.json \
        desktop-rust/src-tauri/Cargo.lock \
        desktop-rust/CHANGELOG.md \
        <other changed files>
git commit -m "<one-line subject> (vX.Y.Z)"
git tag vX.Y.Z
git push
git push origin vX.Y.Z
```

### 2.3 For a `f-*` release
No version bump needed. The bundled native `.dmg` stays pinned to whichever
`v*` release is latest; the `f-*` release only produces a new frontend bundle.
```bash
git add desktop-rust/src/<changed files>
git commit -m "<one-line subject>"
TAG="f-$(date +%Y%m%d)-1"     # bump -1 → -2 if releasing multiple on the same day
git tag "$TAG"
git push
git push origin "$TAG"
```

### 2.4 Verifying the release landed
- GitHub Actions: `https://github.com/IgorSterkhov/snippets_helper/actions`
- Full release: the tag page should have 5–7 assets (.dmg, .exe, frontend
  zip, `frontend-version.json`, `latest.json`, etc.).
- Frontend-only: three assets (`frontend-*.zip`, `frontend-version.json`,
  `latest.json`).
- Quick smoke test from the shell:
  ```bash
  curl -sL https://github.com/IgorSterkhov/snippets_helper/releases/latest/download/frontend-version.json | python3 -m json.tool
  # must return JSON with a version matching the new tag
  ```

---

## 3. What CI does (`.github/workflows/release-desktop.yml`)

```
v* tag:   release (macos + windows) ──► release-frontend ──► upload all
f-* tag:  release SKIPPED             ──► release-frontend ──► upload frontend+latest.json
```

Key steps in `release-frontend`:
1. Compute version = `<NATIVE>-f<sha>`. For `f-*` tags, `<NATIVE>` is read
   from the most recent `v*` tag so the two stay in sync.
2. Overwrite `desktop-rust/src/frontend-version.json` with that value, then
   zip the `src/` tree (minus dev-only files `dev.html`, `dev-mock.js`,
   `dev-test.py`, `__pycache__/`).
3. Sign the zip with `rsign2` using `secrets.TAURI_SIGNING_PRIVATE_KEY`
   (same key as native updater).
4. Write `frontend-version.json` manifest with version / url / signature
   (base64 of the `.sig` file contents) / sha256.
5. For `f-*` tags, copy the most recent `v*` release's `latest.json` into
   this release so the native updater endpoint keeps resolving.
6. Upload everything to the tag's GitHub release.

**Never edit the pubkey, endpoints, or sign command without reading §7.**

---

## 4. Local development & testing

### 4.1 Browser mock (fast UI iteration, no Rust)
```bash
cd desktop-rust/src && python3 -m http.server 8000
# Visit http://localhost:8000/dev.html
```
- `dev-mock.js` stubs ~95 Tauri commands against `localStorage` with
  pre-populated fixtures.
- Reset state: DevTools → `localStorage.clear(); location.reload()`.
- When adding a new Tauri command, mirror it in `dev-mock.js` or the browser
  dev page will log `[mock] Unhandled command: <name>`.

### 4.2 CDP smoke tests
```bash
cd desktop-rust/src && python3 dev-test.py
```
Launches headless Chrome against the browser mock and runs 7 tests covering
the modal fix, Exec tab, and SCP template flow. Must stay green before any
tag.

### 4.3 Docker (real Tauri / WebKit build)
```bash
cd desktop-rust
./dev-docker.sh dev            # cargo tauri dev with X11 forwarding
./dev-docker.sh build          # AppImage production build
./dev-docker.sh shell          # interactive shell in the container
./dev-docker.sh rebuild        # rebuild the image from scratch
```
Image is based on Debian bookworm + webkit2gtk-4.1 + Rust + `cargo-tauri`
+ xvfb/imagemagick/python3-pil for headless screenshot tests.

### 4.4 `KH_FORCE_SHOW` env var
The main window is hidden by default (user reveals with Alt+Space). Set
`KH_FORCE_SHOW=1` when launching the binary to force it visible on startup
— handy for headless CI tests, or when debugging "why isn't my window
showing up".

---

## 5. OTA architecture in one page

### 5.1 Custom URI scheme `khapp://`
The main window loads `khapp://localhost/index.html`. The scheme handler
(in `desktop-rust/src-tauri/src/lib.rs`) checks the override directory
first and falls back to bundled assets via `app.asset_resolver()`.

### 5.2 State files (under `app_data_dir/`)
| File | Purpose |
| --- | --- |
| `frontend-current.txt` | Pointer — version string currently applied |
| `frontend-<version>/` | Extracted zip for each known version |
| `frontend-prev.txt` | Version to roll back to on failure |
| `frontend-tentative.txt` | Marker: last apply not yet confirmed |

### 5.3 Install / update lifecycle
1. `check_frontend_update` fetches `frontend-version.json` from the latest
   GitHub release.
2. If the version differs, UI shows a toast + click-to-apply button.
3. `download_frontend_update` pulls the zip, verifies the minisign
   signature (`PublicKey::from_base64(PUBKEY)` — *not* `::decode`), verifies
   sha256, extracts to `frontend-<version>/`.
4. `apply_frontend_update` saves the current pointer as `prev`, writes the
   new pointer + a `tentative` marker, then reloads the WebView.
5. Frontend JS calls `confirm_frontend_boot` ~5s after DOMContentLoaded.
   The Rust command removes the tentative marker — boot considered healthy.
6. If the app launches and `tentative` is still present after 30s (the
   watchdog in `spawn_boot_watchdog`), Rust reverts to `prev` and reloads.
   If `prev` is missing, it drops the override entirely and falls back to
   the bundled frontend.

### 5.4 Manual controls
- **Status bar** — sync indicator (bottom-right) click runs the check +
  apply; also shows combined version label.
- **Settings → Updates → Frontend (hot update)** — "Check frontend update",
  "Apply", "Revert to previous".

---

## 6. Important files

| Path | Purpose |
| --- | --- |
| `src-tauri/src/commands/ota.rs` | OTA commands (check / download / apply / revert / watchdog) |
| `src-tauri/src/lib.rs` | Registers `khapp://` scheme, wires setup hooks |
| `src-tauri/tauri.conf.json` | Window URL, CSP, updater endpoint, native version |
| `src-tauri/Cargo.toml` | Native version, dependencies |
| `src/frontend-version.json` | Bundled frontend version — CI overwrites at build time |
| `src/components/status-bar.js` | Version label + update checks + apply flow |
| `src/main.js` | DOMContentLoaded wiring, `confirm_frontend_boot` call |
| `CHANGELOG.md` | Human-readable release notes |
| `.github/workflows/release-desktop.yml` | CI pipeline (both tag prefixes) |

---

## 7. Known gotchas (lessons from prior releases)

- **`PublicKey::decode` vs `PublicKey::from_base64`** — the hard-coded
  pubkey is a bare base64 string, not a minisign key-file. `decode`
  fails with "Bad pubkey: Invalid encoding in minisign data". Use
  `from_base64`. Bug shipped in v0.9.6 and fixed in v0.9.7.
- **Manifest `signature` field is base64-encoded** raw `.sig` content.
  The Rust side must `base64::decode` before calling
  `Signature::decode(&sig_text)`.
- **Minisign `verify(..., prehashed=true)`** — `rsign2` signs with the
  prehashed flag, so verification must pass `true` as the third arg.
- **CI must stamp `src/frontend-version.json` before `tauri-action`** in
  the native job; otherwise the bundled version lies about itself. This
  was broken in v0.9.6 and fixed in v0.9.8.
- **`release-frontend` must always publish the manifest.** Skipping
  it (old "no src change → skip" logic) breaks the
  `/latest/download/frontend-version.json` endpoint. Fixed in v0.9.8.
- **`latest.json` must live in the latest release.** `f-*` releases
  carry it forward from the previous `v*` release (see step 5 in §3).
- **Don't amend the v-release commit after tagging.** The tag points
  at a specific SHA; amending detaches it.
- **Matching `v` and `src-tauri/tauri.conf.json version`** — both must be
  the same string as the tag suffix. Mismatch breaks tauri-action.
- **Windows: always spawn subprocesses with `CREATE_NO_WINDOW`.** Any
  `std::process::Command::new("git"|"rg"|"grep"|"cmd"|"node"|…)` spawned
  from the Tauri GUI on Windows pops a black console window for the
  lifetime of the subprocess. For a repeated call (search, status
  refresh) this shows as a flickering window and blocks input. Use the
  `spawn()` helper in `commands/repo_search.rs`:

  ```rust
  fn spawn(program: &str) -> std::process::Command {
      let mut c = std::process::Command::new(program);
      #[cfg(windows)]
      {
          use std::os::windows::process::CommandExt;
          const CREATE_NO_WINDOW: u32 = 0x0800_0000;
          c.creation_flags(CREATE_NO_WINDOW);
      }
      c
  }
  ```

  **Rule:** in any new Rust code that shells out, call `spawn(program)`
  — never `Command::new(program)` directly. If the spawn lives in a
  different module, duplicate the helper there with the same name. Unix
  doesn't need this (GUI apps don't get a console attached), the
  `#[cfg(windows)]` guard covers that. Bug shipped as flickering cmd
  windows in v1.2.0 for search, partially fixed in v1.2.4 for the
  Manage tab, fully fixed in v1.2.6.
- **`spawn_blocking` is lazy inside an iterator.** `repos.iter().map(|r|
  task::spawn_blocking(move || …))` returns an iterator where the
  closures only run when polled. If you then `for h in handles { h.await
  }`, you're forcing serial execution — each spawn doesn't start until
  the previous awaits. Always `.collect::<Vec<_>>()` the handles first,
  then loop-await, so all tasks run in parallel. Shipped as the slow
  Manage-tab refresh in v1.2.0, fixed in v1.2.4.
- **`open_in_editor` and shell PATH.** On Windows, `code` is often
  `code.cmd`, which `Command::new("code")` can't find (Rust doesn't
  consult PATHEXT). On macOS, GUI-launched apps inherit launchd's
  minimal PATH, not the user's `.zprofile`. Spawn through the shell:
  `cmd /C "…"` on Windows, `$SHELL -lc "…"` on Unix. See
  `commands/repo_search.rs::open_in_editor`.
- **`tokio::task::spawn_blocking` is required around blocking Rust
  calls** inside `async` Tauri commands — otherwise the Tauri async
  runtime deadlocks when another invoke arrives while a slow
  filesystem/git call is in flight.
- **Camel-case vs snake-case params.** Tauri v2 auto-translates Rust
  snake_case param names to camelCase on the JS side. Rust fn
  `update_repo(old_name, group_id)` is called from JS as
  `invoke('update_repo', { oldName, groupId })` — **not**
  `old_name/group_id`. The mismatch fails silently at best, at worst
  with "missing required key `oldName`". Same applies to the browser
  mock: destructure camelCase. Bug shipped in v1.1.0 group-edit flow,
  fixed in v1.1.x OTA.
- **`check_for_update` must skip `f-*` tags.** `/releases/latest`
  returns the most recent release regardless of tag prefix, which can
  be a frontend-only `f-*` release without native assets. The native
  updater must walk `/releases` and pick the most recent `v*` tag that
  carries the platform installer. Bug shipped in v1.2.2 ("You are up
  to date" pointing at `f-20260422-6`), fixed in v1.2.3.

---

## 8. Signing keys

- **Public key** (pinned in code): `ota.rs` → `PUBKEY`, plus
  `tauri.conf.json` → `plugins.updater.pubkey` (base64-wrapped). Both
  must point at the same key.
- **Private key** (in CI): GitHub secret `TAURI_SIGNING_PRIVATE_KEY`,
  empty password. Used by both `tauri-action` (native `latest.json`
  signing) and the `release-frontend` job (frontend zip signing).
- **If the private key leaks**, every active user's app has the old
  pubkey burnt in → the only recovery is publishing a new native build
  (`v*`) with a rotated key, manually installed by each user. Nothing to
  do about users who don't upgrade. Keep the key safe.

---

## 9. Debugging in production

- The app writes a `crash.log` to `app_data_dir` on Rust panics at startup.
- `KH_FORCE_SHOW=1 /Applications/Keyboard\ Helper.app/Contents/MacOS/keyboard-helper`
  — starts the app with window visible + stdout attached, useful when a
  global-hotkey registration is failing silently.
- To wipe an OTA-ed frontend and fall back to bundled:
  ```bash
  rm -rf "~/Library/Application Support/keyboard-helper/frontend-"*
  rm "~/Library/Application Support/keyboard-helper/frontend-current.txt"
  ```

---

## 10. When not to release

- Staging is out of sync with remote (`git status` shows anything
  unexpected under tracked files).
- `cargo check` or `dev-test.py` is red.
- A previous tag's CI is still running — don't stack releases; wait.
- You're editing signing keys, tauri.conf endpoints, or CI secrets —
  stop and discuss with the user first.

---

## 11. Whisper voice input

### 11.1 Updating whisper.cpp

1. Check `github.com/ggml-org/whisper.cpp/releases` for the latest stable tag.
2. Update `desktop-rust/WHISPER_CPP_VERSION` (e.g. `v1.7.4`).
3. Locally run `./desktop-rust/scripts/fetch-whisper-bin.sh` to verify the build works and produces `whisper-server-<target-triple>` under `desktop-rust/src-tauri/binaries/`.
4. Update model SHA256 values in `desktop-rust/src-tauri/src/whisper/catalog.rs` only if upstream re-uploaded the ggml models on HuggingFace (independent cadence from whisper.cpp releases).
5. Commit both files, tag a new `v-*` release.

### 11.2 Known gotchas

- **macOS Accessibility permission** is required for Cmd+V simulation. On first auto-paste, macOS prompts the user; if denied, the app silently falls back to clipboard-only and shows a toast.
- **Microphone permission (macOS TCC)** is requested on the first `whisper_start_recording` call. If the user denies, `cpal` reports "no input device" — handled with an error toast that deep-links to System Settings.
- **whisper-server is built from source** in CI (cmake) because upstream prebuilt zips do not reliably include a `whisper-server` binary. Build time: ~4-6 min on GitHub runners.
- **Models are NOT bundled.** On first Whisper-tab visit users install a model via onboarding (~500MB for `small`). Without a model, `whisper_start_recording` returns an error.
- **Idle unload** happens 5 minutes (settings-configurable) after the last transcript — prevents long-running RAM/VRAM use. If the app is closed while the server is running, it's killed with the app.
- **Sidecar macOS thread-affinity:** `cpal::Stream` is marked `!Send` conservatively. We wrap it in `SendRecorder(unsafe impl Send)` serialised through `tokio::sync::Mutex`. On macOS this could theoretically violate CoreAudio thread affinity — report any crashes at recording start as a critical bug.

### 11.3 Manual integration checklist (run before every `v-*` tag)

- [ ] macOS: fresh install → mic permission prompt on first Record
- [ ] macOS: Accessibility permission prompt on first auto-paste
- [ ] Cold launch → click Record → overlay shows "Loading model" then "Recording"
- [ ] Speak, Stop → transcript pastes into the previously-focused window
- [ ] Wait 5 min → `ps | grep whisper-server` shows no process
- [ ] Hotkey (Ctrl+Alt+Space) from another window → overlay + inject
- [ ] Click "Unload now" in settings → whisper-server SIGTERM'd immediately
- [ ] Delete a model → file removed from `app_data/whisper-models/`
- [ ] Postprocess rules on/off reflects in history `text_raw` column (populated only when rules change the text)
- [ ] LLM-postprocess with a bogus endpoint → falls back to raw text silently
