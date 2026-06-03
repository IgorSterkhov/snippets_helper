# Whisper Recognition Engine and Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate Whisper recognition engine selection from Live dictate mode and support cloud batch transcription for Deepgram/Yandex.

**Architecture:** Add an engine-aware native recording pipeline. Local engines keep using `WhisperService` + `whisper-server`; cloud batch engines use recorder/WAV capture only, then send the WAV directly to the provider. Update the desktop Whisper header to present one Recognition engine selector and keep Live dictate as a mode toggle disabled for local engines.

**Tech Stack:** Rust/Tauri commands, reqwest, existing Whisper audio/service pipeline, vanilla JavaScript frontend, CDP smoke tests.

---

### Task 1: Native Engine Model and RED Tests

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/whisper.rs`
- Modify: `desktop-rust/src-tauri/src/whisper/deepgram.rs`
- Modify: `desktop-rust/src-tauri/src/whisper/yandex.rs`

- [ ] Add Rust unit tests for parsing/formatting the new engine setting:
  - `local:<model_name>` resolves to local batch.
  - `deepgram` resolves to Deepgram.
  - `yandex` resolves to Yandex SpeechKit.
  - invalid/empty values fall back to current local default.
- [ ] Add Rust unit tests for compatibility defaults:
  - missing `whisper.recognition_engine` + `whisper.live_dictate=true` infers
    the old `whisper.live_provider`;
  - missing `whisper.recognition_engine` + `whisper.live_dictate=false` infers
    the current local default model;
  - deleted `local:<model_name>` falls back to a valid local default when one
    exists.
- [ ] Add hotkey decision tests:
  - cloud engine + Live off starts/stops cloud batch, not local Whisper;
  - cloud engine + Live on starts/stops existing live provider;
  - active local/cloud recording still stops before a new start.
- [ ] Add unit tests for Deepgram prerecorded response parsing from the
  documented `results.channels[0].alternatives[0].transcript` structure.
- [ ] Add unit tests for Yandex async batch request/result parsing:
  - request JSON uses `recognizeFileAsync` with base64 WAV `content`,
    `containerAudioType=WAV`, model, language restriction, and text
    normalization settings;
  - operation polling treats `done=false` as pending and `done=true` as ready;
  - `getRecognition` uses `operationId`;
  - result parser combines final alternatives/words from one or more streamed
    JSON result objects into transcript text and prefers
    `finalRefinement.normalizedText` when present.
- [ ] Run:

```bash
cd desktop-rust/src-tauri && cargo test whisper --lib
```

Expected: new tests fail before implementation.

### Task 2: Cloud Batch Transcription

**Files:**
- Modify: `desktop-rust/src-tauri/src/whisper/deepgram.rs`
- Modify: `desktop-rust/src-tauri/src/whisper/yandex.rs`
- Modify: `desktop-rust/src-tauri/src/commands/whisper.rs`
- Modify: `desktop-rust/src-tauri/src/whisper/service.rs`

- [ ] Add `transcribe_file` or equivalent batch helpers:
  - Deepgram: `POST https://api.deepgram.com/v1/listen?...` with existing
    model/language/punctuation/smart_format settings, `Content-Type: audio/wav`,
    `Authorization: Token ...`, and recorded WAV bytes.
  - Yandex: use SpeechKit REST async v3 exactly:
    `POST https://stt.api.cloud.yandex.net/stt/v3/recognizeFileAsync`, poll
    `https://operation.api.cloud.yandex.net/operations/<operation_id>` until
    terminal or timeout, then fetch
    `https://stt.api.cloud.yandex.net/stt/v3/getRecognition?operationId=...`.
    Use `Authorization: Api-Key ...`; require and validate
    `whisper.yandex_folder_id` for batch before capture starts, and send it as
    `x-folder-id`.
- [ ] Refactor recording start/stop:
  - local path resolves the selected `local:<model_name>`, starts
    `WhisperService`, warms `whisper-server`, then runs local inference;
  - cloud batch path starts recorder-only capture, sets visible state to
    recording/transcribing, and never resolves the local default model or spawns
    `whisper-server`;
  - global hotkey and overlay Stop/X use the same active recording decision.
- [ ] Persist history with provider metadata:
  - local: `provider=local`, `model_name=<local model>`,
    `provider_model=<local model>`, real local CPU/GPU/VRAM metrics;
  - Deepgram: `provider=deepgram`, `model_name=<deepgram model>`,
    `provider_model=<deepgram model>`, cloud CPU/GPU/VRAM as `0`/`0.0`;
  - Yandex: `provider=yandex`, `model_name=<yandex model>`,
    `provider_model=<yandex model>`, cloud CPU/GPU/VRAM as `0`/`0.0`;
  - `text_raw` stores the provider transcript before rules/LLM cleanup when
    cleanup changes the text.
- [ ] Reuse existing injection and postprocessing settings after cloud batch
  transcript is returned.
- [ ] Ensure cloud API key errors use persistent diagnostics on the frontend.

### Task 3: Frontend Engine Selector UX

**Files:**
- Modify: `desktop-rust/src/tabs/whisper/whisper-tab.js`
- Modify: `desktop-rust/src/tabs/whisper/whisper-settings.js`
- Modify: `desktop-rust/src/tabs/whisper/help-content.js`
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`
- Modify: `FRONTEND_PATTERNS.md`

- [ ] Replace header controls:
  - label `Recognition:`;
  - one `#engine-select`;
  - keep `Gemma:`;
  - keep `Live dictate`;
  - remove always-visible live provider selector.
- [ ] Populate engine selector with installed local models and cloud provider
  entries `Deepgram` / `Yandex SpeechKit`.
- [ ] Save engine selection in a new setting, for example
  `whisper.recognition_engine`.
- [ ] Keep old settings compatible:
  - on first load, infer engine from `whisper.live_dictate` +
    `whisper.live_provider` when the new setting is absent;
  - persist an inferred cloud engine immediately, so turning Live off keeps
    cloud batch selected instead of falling back to local Whisper;
  - when selecting Deepgram/Yandex, also save `whisper.live_provider` for old
    native code and live-status compatibility.
- [ ] If engine is local:
  - disable `Live dictate`;
  - show tooltip `Live dictate requires Deepgram or Yandex SpeechKit`;
  - if Live was enabled, turn it off and persist `whisper.live_dictate=false`.
- [ ] If engine is cloud:
  - enable `Live dictate`;
  - use cloud batch when Live is off;
  - use existing live start/stop when Live is on.
- [ ] Update CDP smoke tests:
  - local engine disables Live;
  - selecting Deepgram/Yandex enables Live;
  - cloud engine with Live off uses the new batch command path in the mock;
  - cloud engine with Live on still uses live path.
  - legacy `live_dictate=true` + `live_provider=deepgram/yandex` without
    `whisper.recognition_engine` migrates to the cloud engine before Live is
    turned off.

### Task 4: Help, Release Metadata, and Full Release

**Files:**
- Modify: `desktop-rust/src/tabs/whisper/help-content.js`
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock`

- [ ] Update help to explain Recognition engine vs Live dictate mode.
- [ ] Add release history/changelog section for a minor `v1.6.0` release,
  because this adds provider workflow/native behavior.
- [ ] Bump native version to `1.6.0`.
- [ ] Run:

```bash
node --check desktop-rust/src/tabs/whisper/whisper-tab.js
node --check desktop-rust/src/tabs/whisper/whisper-settings.js
node --check desktop-rust/src/tabs/whisper/help-content.js
node --check desktop-rust/src/tabs/help.js
node --check desktop-rust/src/dev-mock.js
cd desktop-rust/src-tauri && cargo check
cd ../src && python3 dev-test.py
```

Expected: Rust check passes and frontend smoke tests pass.

- [ ] Commit:

```bash
git add .workflow/specs/2026-06-03-whisper-recognition-engine-mode.md
git add .workflow/plans/2026-06-03-whisper-recognition-engine-mode.md
git add desktop-rust/src-tauri desktop-rust/src FRONTEND_PATTERNS.md desktop-rust/CHANGELOG.md
git commit -m "Clarify Whisper recognition engines (v1.6.0)"
```

- [ ] Tag and push `v1.6.0`, then monitor GitHub Actions until native and
  frontend assets are published.
