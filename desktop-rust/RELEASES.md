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
