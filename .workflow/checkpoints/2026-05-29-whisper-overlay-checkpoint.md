# Checkpoint: Whisper Overlay Fix Before Compact

Date: 2026-05-29
Repo: `/home/aster/Dev/snippets_helper`
Branch: `main`
Current HEAD: `70d52e4 reload whisper overlay after ota (v1.3.45)`
Current release state: full native desktop release `v1.3.45`, frontend `1.3.45-f70d52e4`
Worktree at checkpoint start: clean

## 1. Current Goal

Finish and preserve the current desktop Whisper work before context compact.

The active feature area is Whisper dictation, especially Deepgram live dictate,
global hotkey behavior, and the floating overlay window shown near the bottom
right of the screen.

The last user-facing issue was: after pressing the global hotkey, the overlay
appeared and visually reacted to clicks, but `Stop`, `X`, drag, and status
updates did not work. The overlay also stayed on stale `Ready` text while the
main app showed the real recording/stopping state.

## 2. What We Already Solved

Whisper and Deepgram improvements shipped across the latest releases:

- `v1.3.41` (`58e3f2d`): fixed global hotkey live mode behavior.
- `v1.3.42` (`802b93a`): improved Whisper live overlay and Deepgram punctuation/capitalization.
- `v1.3.43` (`9aaf037`): fixed lazy Tauri invoke/event bridge for overlay and targeted events to `main` plus `whisper-overlay`.
- `v1.3.44` (`d135528`): fixed native overlay hit testing and placement:
  - explicit focusable overlay config;
  - `acceptFirstMouse`;
  - `set_ignore_cursor_events(false)`;
  - safer positioning above taskbar.
- `f-20260528-1` (`37f6de9`): fixed overlay boot path:
  - `whisper-overlay.html` switched away from absolute module script loading;
  - `whisper-overlay.js` became standalone and embedded its own Tauri bridge helpers;
  - static fallback changed from `Ready` to `Overlay booting`;
  - added `window.__WHISPER_OVERLAY_READY__ = true`.
- `v1.3.45` (`70d52e4`): fixed stale hidden overlay after frontend OTA:
  - frontend OTA now reloads both `main` and `whisper-overlay`;
  - `show_overlay()` reloads the overlay document before showing it;
  - added dev-test coverage for the overlay OTA reload contract;
  - updated Help, release history, and changelog as required by the desktop release gate.

Root cause of the final overlay bug: frontend OTA reloaded the `main` window,
but the hidden `whisper-overlay` WebView was created at app startup and kept old
HTML/JS in memory. This made the overlay visually present but behaviorally stale.

Verification for `v1.3.45`:

- `cargo check`: passed with existing warnings.
- `cd desktop-rust/src && python3 dev-test.py`: `51/51 passed`.
- `node --check desktop-rust/src/tabs/whisper/whisper-overlay.js`: passed.
- `node --check desktop-rust/src/tabs/help.js`: passed.
- `cargo test overlay --lib`: 3 tests passed.
- GitHub Actions release run `26600483693`: completed successfully.
- Release assets: 8.
- Published `frontend-version.json`: `1.3.45-f70d52e4`.
- Published `latest.json`: native `1.3.45`.

The user installed/tested the latest result and confirmed: "Excellent".

## 3. Main Plan

This task is considered resolved unless the user reports another overlay
regression.

If work resumes here, first confirm the installed desktop state:

```bash
git status --short
git log --oneline -8
wget -qO- https://github.com/IgorSterkhov/snippets_helper/releases/download/v1.3.45/frontend-version.json
cd desktop-rust/src && python3 dev-test.py
```

If the user reports another overlay issue, collect these facts before changing
code:

- native version shown in the app;
- frontend version shown in the app;
- exact overlay text shown before/after hotkey use;
- whether the overlay shows `Overlay booting`, `Overlay JS ready`, or stale `Ready`;
- whether buttons visibly click, whether drag moves the window, and whether the
  main app status changes.

Likely files to inspect first:

- `desktop-rust/src-tauri/src/commands/ota.rs`
- `desktop-rust/src-tauri/src/whisper/service.rs`
- `desktop-rust/src/whisper-overlay.html`
- `desktop-rust/src/tabs/whisper/whisper-overlay.js`
- `desktop-rust/src/tabs/whisper/whisper-api.js`
- `desktop-rust/src/tauri-api.js`
- `desktop-rust/src/dev-test.py`

## 4. Open Questions

- Does reloading the overlay document immediately before showing it cause any
  visible flicker on slower machines?
- Should the overlay display a tiny diagnostic footer with frontend/build
  version while Whisper is actively being debugged?
- Should we add a fuller automated smoke around multi-window overlay behavior?
  Current coverage is mostly static contract/dev-test plus Rust tests; true
  click/drag validation is still mostly manual.
- Follow-up from earlier Whisper planning remains open: aggressive live typing
  with interim Deepgram text and corrections directly in target apps.

## 5. Constraints To Remember

- Do not modify the legacy Python desktop application unless explicitly asked.
- Desktop native changes under `desktop-rust/src-tauri/` require a full `v*`
  native release, not only a frontend `f-*` OTA release.
- Every desktop release with user-facing changes must update:
  - `desktop-rust/src/tabs/help.js`
  - `desktop-rust/src/release-history.md`
  - `desktop-rust/CHANGELOG.md`
- Preserve unrelated user/Claude changes; do not revert dirty files that are
  not part of the active task.
- Subagents/MCP tools may hang in this repo. If that happens, continue inline
  with local shell/file inspection.
- `rg` may be unavailable in this environment; use `grep`/`find` without fuss.
- GitHub API/release inspection has been done with `wget` when `gh` is not
  available or not preferred.

## 6. Next Step If Returning To This Branch

If the user returns with no new bug report, continue with the next product task.
The Whisper overlay fix is already released and user-verified.

If the user returns with a Whisper overlay regression, do not start from the old
clickability hypothesis. First verify whether the installed app is actually on
native `1.3.45` and frontend `1.3.45-f70d52e4`, then check whether the hidden
overlay WebView is still stale or whether a new runtime issue is present.

## Prompt Compliance

This checkpoint intentionally records:

1. Current goal.
2. What has already been solved.
3. The main plan now.
4. Open questions.
5. Constraints that must not be forgotten.
6. The next step if returning to this branch after compact.
