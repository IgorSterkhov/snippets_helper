# Changelog

## v1.3.25 (2026-04-28)

**Exec → Command Groups: redesign + DnD + Run-all.**

- **Rename UI**: "Categories" → "Groups". DB tables and columns
  unchanged.
- **Auto-letter Slack-style icon** on each group (deterministic colour
  from name hash; consistent across sessions). Group rows now also
  show a count of commands.
- **DnD**: drag the ⋮⋮ grip on a command card to another group (drop
  on the left panel) or reorder within the same group (drop on
  another card). Click the grip without dragging opens a "Move to…"
  popover for accessibility / touchpad use.
- **Run-all**: new ▶ Run all button on the group header. Runs every
  command in the group sequentially with a progress bar and
  per-command collapsible sections in the bottom console; fail-fast
  on the first error, single Stop button aborts the whole sequence.
- **Edit modal**: new "Group" dropdown lets you change a command's
  group from the form (alternative to DnD).
- **Visual**: tab now uses a distinct terminal/brutalist look
  (JetBrains Mono throughout, phosphor-green accent on near-black,
  breadcrumb header `exec › <selected group>`, dim "01"-style row
  numbers, sharp 1px borders, spacious per-row borders with 6px
  gaps). Other tabs are unchanged.
- **Backend**: new `move_exec_command`, `reorder_exec_commands`, and
  `list_exec_command_counts` Tauri commands.
- **Bug fix**: `stop_command` now actually kills the running child
  process — previously it only flipped a flag while
  `wait_with_output().await` blocked until the child exited naturally,
  so Stop on a long-running command (e.g. `rsync`, `sleep 60`) was a
  no-op. Run-all's Stop button depends on a real kill, so this bug
  blocked the new feature; pre-1.3.25 single-command Stop was also
  broken in the same way. Uses `SIGTERM` on Unix, `taskkill /T /F`
  on Windows.
- **Bug fix**: Run-all loop now snapshots the command queue at start
  so switching groups (or any other code path that mutates the
  module-level `commands` array) mid-run can't corrupt iteration —
  previously this could TypeError out of the loop and leave the tab
  permanently locked until restart.

## v1.3.24 (2026-04-26)

**Whisper post-process UX + Exec card redesign.**

- **Whisper:** new Gemma-model combobox in the tab header (right of the
  Whisper-model one). Empty state — single `(no models — open Settings)`
  entry that opens the settings modal scrolled to the Gemma block.
- **Whisper:** right-pane split into two tabs — `Whisper output` (raw
  transcript, as before) and `Post-processed` (Gemma-cleaned text).
  History rows now persist `postprocessed_text` in the DB and render a
  small green dot when post-processing has been done.
- **Whisper:** unified status strip between meta and action buttons —
  shows `💭 Transcribing… X.Xs` (elapsed timer) for whisper inference
  and `✨ N% · K/M tok · X.Xs` with a fill bar for Gemma post-processing.
  Gemma backend now streams completions via SSE and emits incremental
  progress events.
- **Exec:** card redesign. Big octagonal Run-button with a green ▶ on
  the left, the command name is now click-to-edit (the standalone
  ✎-button is gone), Delete (✕) stays on the right. Layout flows
  Run | name + WSL badge / description / command-code | delete.
- **DB:** migration adds `whisper_history.postprocessed_text` column
  (nullable, idempotent ALTER).

## v1.3.23 (2026-04-24)

**VPS tab — four fixes.**

- **Stats inline on every card.** Tiles now render CPU / RAM / Disk
  progress bars directly, no need to expand. Height bumped from 48 px
  to ≈ 92 px. A per-tile stats cache (`statsCache` + `ts`) keeps the
  numbers visible between re-renders, with a "3 min ago"-style
  freshness marker.
- **Drag a card between environments.** Pointer-based DnD via the new
  ⋮⋮ grip on the left of each tile. A floating semi-transparent clone
  follows the cursor; env-blocks under the cursor get a dashed-accent
  drop indicator. On release to a different env → `move_vps_server`
  + reload.
- **Fix cmd-window flicker on Windows during SSH calls.** Added
  `CREATE_NO_WINDOW` to `commands::vps::build_ssh_cmd` (every SSH
  invocation was opening and immediately closing a black cmd window).
  Same flag already on repo_search, whisper-server, nvidia-smi polls.
- **Click no longer auto-fetches.** Clicking a tile just
  expands / collapses the detail panel; it renders whatever's in the
  stats cache (or "Stats not loaded — press ↻" placeholder).
  Explicit ↻ button on every tile (and in the expanded detail) is
  the only way to fetch. Per-env "Refresh all" button still works.

## 1.3.22 OTA patches

- **f-20260424-4** — Tasks DnD "snap-back" fix: on drop, the card sometimes
  reverted to its original position even though the insertion line showed
  the right target. Cause: the commit path read the new id order from the
  DOM immediately before `reloadTasks()` wiped and rebuilt the list —
  timing-sensitive. Fixed by deriving the new id order purely from
  `state.tasks` + the dragged-id + the target-before-id (no DOM read).
  `commitCardReorder` signature changed accordingly.

- **f-20260424-3** — Tasks module — four fixes:
  - **DnD rewritten.** Old ghost-only mode gave no spatial feedback and
    the commit handler silently no-op'd in some cases. New model: source
    stays in place dimmed, a floating semi-transparent clone follows
    the cursor, a blue **insertion line** is inserted into the list at
    the drop target position. On drop the DOM is reordered and the
    backend `reorder_tasks` is called with the full new id order.
    Same model for checkbox reorder inside a card (drag > 30 px
    rightward nests under the row above; depth ≤ 3 enforced).
  - **Checkbox text wraps in expanded mode.** Replaced `<input
    type=text>` with a `contenteditable` div + `white-space: pre-wrap`.
    Long labels now wrap instead of scrolling horizontally. Keyboard
    shortcuts (Enter = new row, Tab = nest, Shift+Tab = outdent,
    Backspace-on-empty = delete) preserved.
  - **Collapsed cards are editable too.** `editable: false` removed on
    the collapsed render path — you can now add / rename / reorder
    checkboxes without first expanding the card. Hover shows the 🗑
    and the + Add row is always present.
  - **Checkbox font size** is now a setting. Settings → Tasks →
    "Checkbox font size" (10-20 px). Takes effect immediately via a
    CSS variable, no reload needed. Same block also exposes
    "Max visible checkboxes per card" and Layout mode.

## v1.3.22 (2026-04-24)

**CI: cache sidecar binaries between releases.**

- `.github/workflows/release-desktop.yml` now has an `actions/cache` step
  scoped to the pinned `WHISPER_CPP_VERSION` + `LLAMA_CPP_VERSION`.
  First v-release with a given version still builds from scratch
  (~5 min whisper + ~25 min llama+Metal on macOS); all subsequent
  v-releases skip both build steps and restore the binaries in ~5 sec.
- Cache key drop-in happens automatically when either pinned version
  changes. No manual cache invalidation.
- No runtime change — this is a CI-only optimisation. Payload (the
  shipped .exe / .dmg / OTA zip) is byte-identical.

## v1.3.21 (2026-04-24)

**Hotfix: WSL `rsync`/`ssh` broken by over-eager quote escaping.**

- `commands::exec::bash_single_quote_escape` mangled any command with `'`
  into `'\''` because I was mentally modelling the call as if we
  interpolate into `bash -lc '<cmd>'`. In reality we pass the command
  as a **single argv element** to `bash -lc`, and bash reads argv[2]
  as shell source verbatim — no wrapping quotes, no escape needed.
- `rsync -av '…' user@host:/dst` → bash saw `rsync -av '\''…'\'' ...`
  → `unexpected EOF while looking for matching '` → exit 2.
- Fixed: push `cmd` verbatim as last argv element. Added regression
  test `wsl_argv_passes_user_command_verbatim`.

## v1.3.20 (2026-04-24)

**Exec: per-command Shell selector — run inside WSL natively.**

- Each Exec command now has a **Shell** field (`host` / `wsl`) and an
  optional **WSL distro** (defaults to the system's default distro).
  Lets you run commands inside WSL using its own `~/.ssh/config`,
  keys and binaries — no more invoking `ssh` from Windows with
  copied keys.
- **Host** mode: `cmd /c` on Windows (was `sh -c`, which required
  git-bash on PATH and was broken out-of-the-box); `sh -c` on Mac/Linux.
- **WSL** mode: `wsl.exe [-d <distro>] -- bash -lc '<cmd>'` — login
  shell so `~/.bashrc` / `~/.profile` / ssh-agent are loaded. Bash
  single-quote escaping protects user input from breaking the wrapper.
- `CREATE_NO_WINDOW` flag on all `run_command` spawns — no flashing
  cmd window on Windows (same pattern as `repo_search.rs`).
- New command `list_wsl_distros()` — parses `wsl.exe -l -q` (which
  outputs UTF-16 LE) into a clean distro list. Returns `[]` on
  Mac/Linux or if WSL isn't installed.
- UI: Shell dropdown + Distro dropdown in the command editor modal.
  Card shows a small `WSL · <distro>` badge next to the command name
  so you can tell at a glance where it runs. `WSL` option is marked
  "not available on this machine" when `list_wsl_distros` returns
  empty (so commands synced from a Windows machine still save but
  the hint is visible).
- Migration: `ALTER TABLE exec_commands ADD COLUMN shell DEFAULT 'host'`
  + `ADD COLUMN wsl_distro`. Existing commands unaffected.

## v1.3.19 (2026-04-24)

**New: Bundled local LLM post-processing for Whisper transcripts (Gemma).**

- Second sidecar — `llama-server` from llama.cpp — built from source in CI
  (static link, CPU-only, no CUDA dep). Lives alongside `whisper-server` in
  Tauri `externalBin`. Pinned at `LLAMA_CPP_VERSION = b8920`.
- New Rust module `src/gemma/` mirroring `src/whisper/`:
  - `catalog.rs` — two models from HuggingFace ggml-org: `gemma-3-1b-it-Q4_K_M`
    (~800 MB, fast) and `gemma-3-4b-it-Q4_K_M` (~2.5 GB, recommended).
  - `models.rs` — download with progress, SHA256 verify.
  - `server.rs` — spawn llama-server, TCP-probe readiness (180 s timeout
    because mmap+load of 4 B weights is slow on cold CPU), `/completion`
    endpoint.
  - `postprocess.rs` — Gemma-3 chat-format prompt ("Исправь пунктуацию и
    опечатки в voice-транскрипте. Не меняй смысл."), output sanitizer
    (char-based, not byte-based — CLAUDE.md §10).
  - `service.rs` — lazy warm, 5-min idle unload, `set_default_model`.
- New commands: `gemma_list_catalog`, `gemma_list_models`,
  `gemma_install_model`, `gemma_delete_model`, `gemma_set_default_model`,
  `gemma_postprocess`, `gemma_unload_now`.
- Shutdown on `RunEvent::Exit` + NSIS pre-install `taskkill /IM
  llama-server.exe` so auto-updater can replace the sidecar on Windows.
- UI:
  - Settings → new "Gemma post-processing" block with installed models,
    per-model Install / Delete / Make default, inline progress.
  - Whisper tab detail view gets **✨ Post-process** button next to Copy /
    Paste / Type / Delete. Click rewrites the textarea in place, first run
    warms the server (~30-60 s on CPU), later runs reuse it.
- Phase 2 (auto-postprocess toggle in header + overlay, model dropdown in
  header, custom prompt in Settings) is a follow-up.

## 1.3.18 OTA patches

- **f-20260424-1** — Whisper tab header: the active-model label is now a
  dropdown you can use to switch models without opening Settings.
  Change flips `is_default` and unloads the warmed server (same two-step
  as Settings save). Disabled while the service is warming / recording /
  transcribing / unloading to avoid killing an in-flight action. Stays in
  sync with the Settings modal via the shared `whisper:settings-changed`
  event.
- **f-20260424-2** — Whisper UX trio:
  - **Overlay was click-dead** on Windows: the body had
    `-webkit-app-region:drag`, which Tauri 2 / WebView2 treats as a
    drag-region that swallows mouse clicks on nested elements. Stop and
    ✕ buttons never received the click. Replaced with
    `data-tauri-drag-region` on the title row only (Tauri 2 recommended
    pattern); the rest of the overlay is now clickable.
  - **Cancel button** in the main-window header next to Record. Appears
    while the service is warming / recording / transcribing / unloading;
    clicking drops the in-flight audio (no transcript saved). Esc works
    as a shortcut for Cancel when the tab is focused.
  - **Inline delete per history row** — 🗑 button on hover in the left
    list. Empty / `[BLANK_AUDIO]` results are shown italic-grey with
    `(empty / no speech)` placeholder so they're easy to spot and
    delete.

## v1.3.18 (2026-04-24)

**Fix: "Model by default" selector in Settings actually switches the model.**

- Settings modal saved the pick into `app_settings.whisper.default_model`
  (key/value), but the backend reads the default from the `whisper_models`
  table's `is_default` column — two different places. Result: user
  changed default to `small`, but whisper-server kept transcribing with
  the previously-warmed `large-v3-q5_0`.
- Save now additionally calls `whisperApi.setDefaultModel(name)`
  (transactional flip of `is_default` for all rows) and
  `whisperApi.unloadNow()` so the next record warms up the newly
  selected model. Header label refreshes via a new
  `whisper:settings-changed` listener.

## v1.3.17 (2026-04-24)

**Fix: cmd window flicker during transcribe on Windows.**

- `metrics.rs` polls `nvidia-smi` every 200ms while transcribing; each
  invocation opened (and immediately closed) a cmd window, producing a
  visible flicker throughout the transcribe phase. Added the
  `CREATE_NO_WINDOW` (0x08000000) flag via `CommandExt::creation_flags`
  on both `metrics.rs` and the one-shot call in `gpu_detect.rs`. Same
  pattern `commands/repo_search.rs:22` already uses for git/ripgrep
  spawns.

## v1.3.16 (2026-04-24)

**Per-transcription performance metrics.**

- New `whisper/metrics.rs` — background sampler that polls sysinfo
  (whisper-server process CPU%) and `nvidia-smi` (GPU% + memory used
  MB) at ~5 Hz during the inference call, tracking peak values.
- Extended schema: `whisper_history` gets `cpu_peak_percent`,
  `gpu_peak_percent`, `vram_peak_mb` columns (idempotent ALTER on
  existing DBs). `TranscribedPayload` + `StopOutcome` carry the same
  three fields end-to-end.
- UI: history detail pane shows `CPU N% · GPU N% · VRAM N MB` next to
  the transcribe duration. Overlay "Inserted" sub-line includes the
  performance summary so you see GPU load immediately after each take.

## v1.3.15 (2026-04-24)

**Whisper global hotkey + install additional models in Settings.**

- **Global hotkey now actually works.** `tauri-plugin-global-shortcut`
  was a dependency but never registered at startup — user's
  `whisper.hotkey` setting was saved to DB and ignored. Added a
  registration pass in `lib.rs::.setup()` that reads
  `whisper.hotkey` (default `Ctrl+Alt+Space`) and binds a toggle
  handler: keypress → start if idle/ready, stop if warming/recording.
  Works when the main window is hidden. Hotkey-change still needs an
  app restart (hot re-register is a follow-up).
- **Install additional models from Settings.** Previously only the
  onboarding screen (shown once when the model list is empty) could
  install; after that there was no UI to add a second model. Settings
  modal now shows an "Установленные модели" block with a list (with
  per-row Delete) and a "+ Установить другую модель…" button that
  opens a mini catalog picker showing only models not yet installed.
  Progress bar inline per-install.

## v1.3.14 (2026-04-24)

**Fix: "Whisper error: buffer still shared" on Stop.**

- `Recorder::finish_wav` used `Arc::try_unwrap` on the PCM buffer, which
  fails if any other `Arc` clone still exists — and the cpal callback
  thread holds one for a few ms even after the stream is dropped,
  causing the error immediately when the user presses Stop.
- Replaced try_unwrap with `drop(stream) + buffer.lock().clone()`:
  extra Vec copy is cheap, no race with callback shutdown.

## v1.3.13 (2026-04-24)

**NSIS installer: taskkill on pre-install to free locked .exe files.**

- When `whisper-server.exe` (or the main app) is still running during
  auto-update, the installer fails with "cannot remove / file in use".
- Added `src-tauri/installer-hooks.nsh` defining
  `NSIS_HOOK_PREINSTALL` + `NSIS_HOOK_PREUNINSTALL` that run
  `taskkill /F /T /IM whisper-server.exe` and
  `taskkill /F /T /IM keyboard-helper.exe` before file ops, followed by
  a 500 ms delay so Windows releases file locks.
- Registered via `bundle.windows.nsis.installerHooks` in
  `tauri.conf.json`. Combined with v1.3.10's RunEvent::Exit handler
  this is belt + braces — graceful close kills the child directly, and
  installer kills both if anything survives.

## v1.3.12 (2026-04-24)

**Fix: Whisper readiness detection via TCP probe (was stdout-parsing).**

- Root cause of `timeout waiting for whisper-server`: whisper-server
  v1.7.x prints its "listening" banner via `printf` to stdout. On
  Windows, stdout piped to a parent process is **full-buffered** (not
  line-buffered), so the banner sits in the C runtime buffer forever —
  our parent never sees it even though the server is healthy and
  already accepting connections. Manual run from a terminal "works"
  only because tty makes stdout line-buffered.
- Replaced stdout/stderr string-match with an async TCP probe: try
  `TcpStream::connect(127.0.0.1:<port>)` every 200ms; succeeds the
  moment server.cpp's `svr.listen_after_bind()` returns, which is right
  after the `printf`. Independent of stdio buffering.
- `stderr`/`stdout` are still drained into `eprintln!` for logs, but no
  longer drive readiness.

## v1.3.11 (2026-04-24)

**Whisper spawn timeout + readable error toasts.**

- whisper-server spawn timeout: 30s → 120s. Large quantized models
  (ggml-large-v3-q5_0 is ~1 GB) can take 30-60s to mmap + init on
  CPU-only builds; previous 30s window killed perfectly healthy servers
  mid-load and reported "timeout waiting for whisper-server to become
  ready".
- Error toasts now stay up **8 seconds** instead of 1.5, show a red
  border, include "click to dismiss" hint, and are clickable. Info
  toasts (Copy/Paste/etc) still fade in 1.5s.

## v1.3.10 (2026-04-24)

**Fix: whisper-server sidecar survived app exit → blocked installer on
auto-update.**

- Tauri's shell sidecar is a plain child process, not in the main exe's
  process group. When the updater killed the main exe it left
  `whisper-server.exe` running, and the installer then failed to replace
  the file on Windows because it was held open.
- Switched `.run(context)` → `.build(context)?.run(|handle, event| ...)`
  and added a `RunEvent::Exit` handler that synchronously calls
  `WhisperService::unload_now()` (SIGTERM on Unix, TerminateProcess on
  Windows). Child is gone before the main exe's process actually exits,
  so the installer sees a released file on the next startup.

## v1.3.9 (2026-04-24)

**Fix: Whisper warm-up stuck at 30s, state bounces back to idle.**

- Root cause: whisper-server v1.7.x prints its "listening" banner to
  **stdout** (`printf` at `examples/server/server.cpp:1030`), while our
  `server.rs` only scanned **stderr** for that marker. Server was fine,
  we just missed the signal → 30-s timeout → we killed the (healthy)
  server → state snapped back to Idle, silently.
- Fix: check the "listening" marker in both stdout and stderr streams.
- Also: the `whisper:error` event was unsubscribed on the UI, so backend
  spawn failures were invisible to the user. Added a toast subscriber
  (with error code + message) and a `console.error` fallback.

## v1.3.8 (2026-04-24)

**Fix: "Whisper error: cannot start from state Warming".**

- Backend `start_recording` is now idempotent: duplicate calls while the
  service is in `Warming` / `Recording` / `Transcribing` / `Unloading`
  return `Ok(())` instead of erroring. Previously a stale button click or
  a duplicate hotkey event that landed between a state-changed event and
  the UI update surfaced as an alert.
- Frontend Record button is now disabled (with a stateful label —
  "⏳ Warming…", "💭 Transcribing…", "… Unloading") whenever a click would
  be invalid. `idle` and `ready` show "🎤 Record"; `recording` shows
  "⏹ Stop". Click handler short-circuits if `disabled`.

## v1.3.7 (2026-04-24)

**Hotfix: statically link whisper-server so it runs on Windows.**

- whisper.cpp CMake on Windows defaults `BUILD_SHARED_LIBS=ON`: `server.exe`
  was linked against `whisper.dll` + `ggml.dll` + `ggml-cpu.dll` sitting next
  to it in the cmake build dir. Tauri's `externalBin` copies only the
  renamed `server.exe` into resources, so at runtime Windows showed
  "не обнаружена whisper.dll" and the server never started.
- Added `-DBUILD_SHARED_LIBS=OFF` to the CI cmake invocation (and the
  local `scripts/fetch-whisper-bin.sh` build) on both macOS and Windows,
  producing a single self-contained binary.

## v1.3.6 (2026-04-24)

**Hotfix: real SHA256 hashes for all 6 Whisper models.**

- `whisper/catalog.rs` shipped with placeholder SHA256 values from the
  implementation plan (40-char SHA-1-looking stubs + one all-zero string).
  Every model install failed at the verification step with
  `Ошибка: sha256 mismatch` after a full multi-hundred-MB download.
- Replaced all 6 with real values pulled from HuggingFace LFS metadata
  (`lfs.oid` field on `/api/models/ggerganov/whisper.cpp/tree/main`).
  Also corrected 4 of 6 `size_bytes` values that were off by 1–256 bytes
  or rounded.
- Refresh command documented inline in `catalog.rs` for future upgrades.

## v1.3.5 (2026-04-24)

**Whisper onboarding: show discrete GPU name + VRAM.**

- `gpu_detect` on Windows now also queries `nvidia-smi` for the GPU name
  (`--query-gpu=name,memory.total`) and surfaces it in the onboarding
  "Система определила…" banner as a separate field. Previously only
  `cpu_model` was shown, which on AMD APUs ("Ryzen 7 5800H with Radeon
  Graphics") misleadingly implied the system had no NVIDIA card even when
  CUDA was detected.
- `HardwareInfo` gains an optional `gpu_name: Option<String>` field (e.g.
  `"NVIDIA GeForce RTX 3060"`). Backward compatible: missing on older
  backends — frontend handles absent gracefully.
- Banner format: `CPU, N GB RAM, [GPU NAME (M GB VRAM), ]CUDA|Metal|CPU доступен`.

## v1.3.4 (2026-04-24)

**Hotfix: CI whisper-server build target name.**

- In whisper.cpp v1.7.x the CMake target is `server` (not `whisper-server`).
  `.github/workflows/release-desktop.yml` and
  `desktop-rust/scripts/fetch-whisper-bin.sh` invoked `--target whisper-server`,
  causing v1.3.3 native release to fail with
  `make: *** No rule to make target 'whisper-server'` (macOS) and
  `MSBUILD error MSB1009: whisper-server.vcxproj` (Windows).
  Fixed: build target is now `server`, binary copied from `build/bin/server`
  (macOS) / `build/bin/Release/server.exe` (Windows) and renamed to
  `whisper-server-<target-triple>` to match Tauri's externalBin convention.
- No code changes, no behavior changes — this is purely a packaging fix
  so v1.3.3's Whisper feature actually ships.

## v1.3.3 (2026-04-23)

**Whisper Voice Input — new left-sidebar tab for local voice dictation.**

- **Local transcription via whisper.cpp** — sidecar `whisper-server`
  binary, CPU by default, GPU (CUDA / Metal) auto-detected and used via
  downloaded variant when available. No network calls to third parties
  for transcription.
- **Onboarding installer** — first tab visit shows a 6-card model picker
  (tiny → small → medium → large-v3 + Q5 quantized). Progress bar with
  speed and ETA, SHA256 verify on download, atomic rename into place.
- **Lazy server lifecycle** — 0 RAM at idle. First record spawns the
  server (1-3s warm-up visible in overlay); subsequent transcripts
  return in ~200ms. Auto-unloads 5 min after last activity
  (configurable 1-30 min); **Unload now** button for instant SIGTERM.
- **Global hotkey** — `Ctrl+Alt+Space` (configurable) toggles recording
  from any focused window. Also `Ctrl+Space` inside the tab.
- **Floating overlay** — always-on-top 260×90 window in the bottom-right
  corner (configurable) shows mic-level bars, timer, state (warming →
  recording → transcribing → inserted). Draggable. Cancel ✕ button.
- **Three inject methods** (per setting): copy to clipboard only,
  clipboard + auto Ctrl+V (with original-clipboard restore after
  200 ms), or typed simulation (Unicode-safe via `enigo`).
- **Optional post-processing** — rule-based (filler removal,
  capitalize, whitespace) + external LLM API for grammar/cleanup
  (OpenAI-compatible). Both off by default, both fail-soft to raw text.
- **Two-pane history** — last 200 transcripts with copy/paste/type/
  delete per row and in-place editing.
- **Microphone selection** in settings. Language auto-detect with
  RU / EN explicit override.
- All new `#[tauri::command]` handlers use `DbState::lock_recover()`
  per CLAUDE.md §11 — no poisoned-lock cascade risk.
- Windows 10+ and macOS 12+ Apple Silicon (M2+). Intel Macs — post-MVP.

Spans `desktop-rust/src-tauri/src/whisper/` (10 Rust submodules),
`desktop-rust/src/tabs/whisper/` (6 JS/HTML files), 15 new Tauri
commands, 2 new SQLite tables, and a CI step that builds
`whisper-server` from source on `v-*` tags.

## v1.3.2 (2026-04-23)

**Root cause of the poisoned-lock wedge in v1.3.0.**

- `SyncClient::extract_display_name` was slicing names/template_text by
  BYTE index (`&val[..37]`), which panics on multibyte UTF-8 chars —
  Cyrillic letters take 2 bytes, so a note titled e.g.
  "Голосовой ввод задач и списков" crashed the sync worker the moment
  it entered the pending queue. Every subsequent app launch kept
  triggering the same panic because that note was still `pending`,
  poisoning the DbState mutex over and over and breaking the auto-
  updater. Replaced with char-based truncation (`val.chars().take(37)`)
  and added a regression test.
- v1.3.1's `lock_recover` helper already unwedged the mutex on restart
  — v1.3.2 removes the actual source of the panic.

## v1.3.1 (2026-04-23)

**Hotfix: poisoned-lock recovery + panic hook.**

- Replace 107 `state.0.lock().map_err(...)?` call sites with a
  `DbState::lock_recover()` helper that unpoisons automatically.
  Rationale: SQLite transactions are atomic, so a prior panic can't
  leave the DB in an inconsistent state — only the Rust-level guard
  flag. Previously one panic inside a command wedged every subsequent
  operation with `"poisoned lock: another task failed inside"`,
  including the `check_for_update` path — which made even the auto-
  updater unable to recover.
- `SyncClient::process_push_response` no longer `.unwrap()`s on the
  per-table rows array (was a potential panic source).
- Global `panic::set_hook` appends panic location + message to
  `<AppData>/keyboard-helper/crash.log` so we can actually see where
  something went wrong next time.

## v1.3.0 (2026-04-23)

**New module — Tasks.**

- New top-level tab **Tasks** (between Notes and SQL, icon ✅). Personal
  task manager with hierarchical checkboxes, categories, statuses,
  tracker links, card colors and full sync.
- **Cards**: collapsed shows title, Category / Status badges, tracker
  button (🎫), checkbox list (scrollable after N items — see
  `tasks_card_max_checkboxes` setting, default 10), pin marker and
  expand ▼. Expanded opens full editor for title, category/status,
  tracker URL, aux links list, background color (palette + custom),
  checkbox tree (editable), Markdown notes with toolbar, delete button.
- **Checkboxes**: max 3 levels deep. Enter = new item, Tab = nest under
  previous sibling, Shift+Tab = outdent, Backspace on empty = delete.
  Last row is a translucent `+ Add item…`.
- **Pinned chip strip** at top — click chip to jump to the task
  (auto-switches layout row if needed and opens expanded view).
- **Filter dropdowns** (Category / Status) — single-select, with `All`
  plus a `None` item that appears only when at least one task has no
  value. Right-click on a dropdown opens a Manage modal to rename,
  reorder, recolor, add or delete categories / statuses. Deleting a
  category / status doesn't delete tasks — it nulls the reference, and
  affected tasks show up under `None`.
- **Drag-and-drop** (pointer-based, works in Tauri WebView2):
  - card ⋮⋮ → dropdown: auto-opens menu after 250ms hover, drop on item
    sets task.category_id / status_id (filter itself doesn't change);
  - card ⋮⋮ → another card: reorder in the list (persisted);
  - checkbox ⋮⋮ → another row in the same task: reorder / nest (drag
    rightward by >30px to nest under the target, honoring the 3-level
    depth limit).
- **Layout toggle** — SVG button in the top-right of the filter row:
  one square = single-column list, split square = two-column row-major
  (zigzag: 1 top-left, 2 top-right, 3 left-row-2, 4 right-row-2, ...).
  Saved in setting `tasks_layout_mode`.
- **Help** — ❓ button in the tab header opens a dedicated help modal;
  sidebar Help tab also gets a new "Tasks" section (en + ru).
- **Sync** — all 5 new tables (`task_categories`, `task_statuses`,
  `tasks`, `task_checkboxes`, `task_links`) are included in the standard
  sync flow.

## 1.2.8 OTA patches

- **f-20260423-18** — Shortcuts: Copy strips Markdown code fences
  (triple-backtick blocks and single-line backtick-wraps) before writing
  to the clipboard, so pasted code doesn't carry stray `\`\`\`` markers.
- **f-20260423-18** — Markdown editor: Link button (🔗) auto-fills the
  URL from the clipboard if it looks like one (http/https/ftp/mailto/www).
  If the clipboard isn't a URL, the caret lands inside the empty `()` so
  you can type immediately — no more modal prompt.
- **f-20260423-19** — Markdown editor: paste-over-selection now creates a
  Markdown link. Select text, press Ctrl+V with a URL in the clipboard →
  get `[selected](url)`. Non-URL clipboard or empty selection paste
  behaves normally.
- **f-20260423-20** — Notes preview: numbered lists (`1. …`) now render as
  decimal `1. 2. 3.` instead of bullet circles. Removed a stray
  `.note-preview li { list-style: disc }` override that beat the
  `.markdown-body ol { list-style-type: decimal }` parent rule.
- **f-20260423-21** — Notes: non-empty notes open in Markdown preview by
  default; double-click the preview to switch to Edit. Empty/new notes
  still open in Edit mode.
- **f-20260423-21** — Notes: pinned chip strip above folders/notes panel
  (same visual style as Repo Search chips). Each chip is a pinned note
  — click to open it directly in the right panel, auto-switching folder
  if needed. Updates on save/delete.

## v1.2.8 (2026-04-23)

- Hotkey: bring main window to front on a single press when it's visible
  but behind another app. Previously the first press hid it (because it
  was still "visible") and you needed a second press to bring it back.
  Now the window is only hidden when it's visible, focused and not
  minimized — otherwise it's unminimized + shown + focused.
- SQL help modals: Ctrl + mouse wheel zooms the text; size persists in
  localStorage across sessions.

## v1.2.2 (2026-04-22)

- Manage tab: per-row **Reset** button on dirty repos — runs
  `git reset --hard HEAD` to discard uncommitted changes, with
  confirmation. Untracked files are preserved.

## v1.2.1 (2026-04-22)

- Fix "Open in editor" on Windows/macOS: spawn the editor command
  through the user's shell so PATHEXT (`code.cmd` / `code.bat`) and
  login-shell PATH are honoured. Previously direct `spawn("code")`
  failed with "program not found" even if `code` worked in a terminal.

## v1.2.0 (2026-04-22)

**Repo Search — editor integration, full-file preview, Manage tab.**

- **Open in editor** — new button on every result card opens the file
  at the match line. Configurable editor command template in
  Settings → General (`code {path}:{line}` by default; supports
  `cursor`, `subl`, `pycharm`, etc.)
- **Full-file preview** — `Expand ▸` button on result cards opens a
  fullscreen view of the file with syntax highlighting (highlight.js
  bundled, ~190 languages). 2 MB cap; ESC or `Collapse ◂` closes.
- **Manage tab** — new inner tab under the group-tab strip showing a
  per-repo git status table (branch, last commit + date, dirty flag).
  Bulk **Pull all to main** action: skips dirty repos (highlighted in
  red), falls back `main → master → origin/HEAD`. **Dry-run** checkbox
  previews the exact `git` commands before executing.
- Search input + type selector + gear now live on the Search inner
  tab; chip strip (with select-all/none) remains shared across both
  inner tabs as the scope selector.

## v1.1.0 (2026-04-21)

- Repo Search: groups — organise repos into named, colored, icon-tagged
  groups. Tab strip above the chip row filters both the visible chips
  and the search scope per-tab.
- Each active tab carries inline ✓ / ⊘ shortcuts for bulk
  select / deselect within its scope.
- Right-click on a group tab to rename, recolour, change icon, or delete
  (repos keep existing, move to Ungrouped).
- Add Repo → multi-folder select in one dialog; each folder becomes a
  new repo with auto-derived name / random color, in the currently
  active tab's group.
- Right-click on a repo chip → Edit (name / color / group) or Remove.

## v1.0.0 (2026-04-20)

**First stable release with frontend-over-the-air (OTA) updates.**

### Highlights
- **Frontend OTA:** small UI/JS/CSS changes now install in ~2 seconds without a
  full reinstall. Click the sync indicator in the status bar → "Apply" → the
  WebView reloads with the new bundle. The installer stays untouched.
- **Signed updates:** every OTA bundle is minisign-signed in CI and verified
  on the client before it touches disk (same key as the existing native
  updater).
- **Auto-rollback:** if an OTA bundle fails to boot within 30 seconds, the
  previous version is restored automatically. No way to brick the app with
  a bad frontend release.
- **Two release flows:**
  - `v*` tags — full release (native .dmg / .exe **and** frontend OTA).
  - `f-*` tags — frontend-only release (fast, skips the native build).
  - Either path is picked up by existing clients; native updater keeps
    working because we carry `latest.json` forward on frontend-only releases.
- **Script templates in Exec tab:** SCP / SSH / rsync forms with VPS
  integration, generate a command in one click.
- **Status bar:** combined `v{native}-f{sha}` label; clicking it now runs a
  sync and the update check.
- **Modal fix:** form modals keep themselves open on validation errors and
  show inline error text instead of silently dismissing.
- **Debug escape hatch:** `KH_FORCE_SHOW=1` forces the main window visible on
  startup — useful for headless testing or recovering if the global hotkey
  is unavailable.

### Infrastructure
- Dockerfile + `dev-docker.sh` for headless Linux builds.
- Browser mock (`dev.html` + `dev-mock.js`) for offline UI development,
  covering ~95 Tauri commands.
- CDP-based smoke tests (`dev-test.py`) — 7 automated checks across the
  Exec modal fix and SCP template flow.

## v0.9.0 (2026-04-15)
- New tab: VPS Management — monitor remote servers via SSH
- Dashboard: CPU, RAM, Disk usage with color-coded progress bars
- Named colored server chips with auto-refresh (configurable per server)
- SSH key file support, custom ports, connection testing

## v0.8.8 (2026-04-15)
- Fixed Commits: history dropdown preserves selection, tag creation works
- Reset button clears history selection

## v0.8.7 (2026-04-15)
- Rewritten Commits tab to match Python logic
- Commit types/categories match Python version
- Task ID auto-parsed from tracker URLs (tracker.wb.ru, etc.)
- Real-time commit and chat message previews
- Conditional fields: reports (test/prod/connect) for отчет, test dag for даг

## v0.8.6 (2026-04-10)
- Fixed sync: LWW (Last Write Wins) by updated_at — prevents pull from overwriting newer local changes
- Added tag clear button (×) to reset snippet tag filter
- Markdown rendering in Description section

## v0.8.5 (2026-04-10)
- Fixed Windows build: removed .cxx build artifacts with too-long paths

## v0.8.3 (2026-04-07)
- Nested folders in Notes: tree view with expand/collapse, sub-folder creation, arbitrary depth
- Expandable note cards: hover handle to preview content without opening editor
- Expandable snippet cards: same pattern in Shortcuts tab
- Redesigned Notes styling: refined tree connectors, pin dots, editor typography
- Auto markdown preview when opening notes with markdown content
- Fixed ordered list rendering in markdown (explicit list-style-type)
- Card expand height configurable in Settings → Shortcuts

## v0.8.0 (2026-04-07)
- Status bar at bottom of window: sync status (left) + update status (right)
- Sync: pulsing dot indicator, click for sync log popup
- Updates: shows current version, available update, click to download or re-check
- Replaced sidebar sync indicator and top update banner
- Smart markdown rendering in snippets (auto-detect markdown content)
- Modal no longer closes on overlay click (only Cancel/X/Escape)

## v0.7.5 (2026-04-07)
- Fixed repo search: sort now preserves card format (content/git cards no longer collapse to single lines)
- Added edit/add repos in settings panel (gear icon)
- Fixed repo chips bar not rendering on first load

## v0.7.3 (2026-04-06)
- Added markdown toolbar for content textareas (Bold, Italic, Code, Link, List, Table, etc.)
- Toolbar appears in Notes editor and Snippet edit modal

## v0.7.2 (2026-04-06)
- Upgraded markdown preview: full parser with tables, code blocks, GFM, task lists
- Custom marked.js bundled locally (headers, bold, italic, strikethrough, nested lists, blockquotes, images)
- Added .markdown-body CSS styles for dark theme

## v0.7.0 (2026-04-06)
- New tab: Repo Search — search across local git repositories
- Search by filename (glob), file content (ripgrep/grep/Rust fallback), git history
- Named colored repos with toggle chips (Design B: bold + color bar)
- Results grouped by file with context on click
- Tab auto-unloads after configurable timeout (default 10 min)

## v0.6.3 (2026-04-05)
- Added sync status indicator in sidebar (syncing/ok/error)
- Sync log popup with detailed push/pull results (click indicator to view)
- Each sync shows what was pushed/pulled with record names

## v0.6.1 (2026-04-05)
- Obsidian integration: create, link, and view notes from snippets
- Main/Web/Note toggle in snippet detail panel
- Markdown rendering for Obsidian notes
- Settings: Obsidian vaults path (per machine)

## v0.5.3 (2026-04-05)
- New app icon: H4 Cyan {K} on purple-blue gradient
- Fixed global font size setting
- Added Always on Top toggle in Settings → General
- Snippet tags sync via API (server migration applied)
- Language setting (English/Russian) for Help

## v0.5.1 (2026-04-05)
- Added Help modal (?) with Features, Hotkeys, and Changelog tabs
- Multi-language support (English/Russian)
- Changelog embedded from CHANGELOG.md at build time

## v0.5.0 (2026-04-03)
- Redesigned links: Main/Web toggle, inline link chips, embedded iframe viewer with fallback
- Links open in Web tab inside the app, with "Open in browser" option

## v0.4.3 (2026-04-03)
- Security cleanup: removed sensitive docs from repository

## v0.4.2 (2026-04-03)
- Fixed tag creation (camelCase parameter naming)

## v0.4.1 (2026-04-03)
- Added snippet links: attach URLs to snippets, view in WebView window
- Tabbed bottom section: Description | Links
- API migration for links field
- Synced links across devices

## v0.4.0 (2026-04-03)
- Added snippet tags: colored filter presets for shortcuts
- Glob pattern matching (e.g. `af_*`)
- Tag management modal with color picker
- Tags synced across devices

## v0.3.3 (2026-04-03)
- Fixed independent scrolling: left panel, value block, and description scroll separately

## v0.3.0 (2026-04-03)
- Redesigned Shortcuts tab: two-panel layout (name list + detail view)
- Collapsible description section with filled/empty badge
- Font size from settings

## v0.2.9 (2026-04-03)
- Fixed sync: proper null handling for last_sync_at
- Fixed user_id population from auth on pull

## v0.2.6 (2026-04-03)
- Added Updates tab in Settings: version check, GitHub token for private repos
- Debug Sync diagnostics
- Update notification banner

## v0.2.5 (2026-04-03)
- Fixed autostart on Windows (registry-based)
- Added update UI and notification banner

## v0.2.4 (2026-04-03)
- Fixed close to tray (X button hides instead of quitting)
- Tray icon click shows window
- Auto-sync on window show

## v0.2.2 (2026-04-02)
- Fixed register and health check via Rust IPC

## v0.2.0 (2026-04-02)
- Added auto-updater plugin
- Optimized CI: macOS ARM + Windows only, thin LTO
- Signing key for update artifacts

## v0.1.3 (2026-04-02)
- Fixed global-shortcut plugin config crash on Windows

## v0.1.0 (2026-04-02)
- Initial release
- 6 tabs: Shortcuts, Notes, SQL Tools (5 sub-tabs), Superset, Commits, Exec
- Global hotkey (Alt+Space native, Double Shift/Ctrl polling)
- System tray with hide/show
- SQLite database with sync to remote API
- Dark theme (GitHub Dark inspired)
- Lazy tab loading
- Settings with 6 sub-tabs
- Autostart support (Windows, macOS, Linux)
