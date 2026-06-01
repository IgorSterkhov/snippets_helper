# Desktop Yandex SpeechKit Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Yandex SpeechKit as a selectable desktop live dictation provider.

**Architecture:** Keep local Whisper as the non-live recorder, and generalize the live dictation path so `whisper_live_*` commands route to either Deepgram or Yandex SpeechKit based on a local setting. Implement SpeechKit as a separate Rust module that owns gRPC streaming, protobuf message parsing, event emission, text injection, and history persistence.

**Tech Stack:** Tauri 2, Rust, tokio, cpal, tonic/prost for SpeechKit gRPC, vanilla JS desktop frontend, existing `app_settings` local storage.

---

## Files

- Create: `desktop-rust/src-tauri/src/whisper/speechkit_proto.rs`
  - Generated or generated-equivalent prost message definitions and Recognizer
    gRPC client for SpeechKit v3 streaming. Prefer generated code when local
    tooling permits; if handwritten, field numbers, oneof tags, package path,
    and service path must be copied from the official Yandex v3 proto and
    covered by compile/runtime smoke tests.
- Create: `desktop-rust/src-tauri/src/whisper/yandex.rs`
  - SpeechKit live service, config, response parsing, stream loop, event emission.
- Modify: `desktop-rust/src-tauri/Cargo.toml`
  - Add `tonic`, `prost`, and `tokio-stream`.
- Modify: `desktop-rust/src-tauri/src/whisper/mod.rs`
  - Export new modules.
- Modify: `desktop-rust/src-tauri/src/lib.rs`
  - Manage `YandexSpeechKitLiveService`.
- Modify: `desktop-rust/src-tauri/src/commands/whisper.rs`
  - Add live provider selection, route start/stop/cancel/status through selected active service.
- Modify: `desktop-rust/src/tabs/whisper/whisper-settings.js`
  - Add Yandex SpeechKit settings block and load/save keys.
- Modify: `desktop-rust/src/tabs/whisper/whisper-tab.js`
  - Add provider selector, status/meta labels, setting persistence.
- Modify: `desktop-rust/src/tabs/whisper/whisper-overlay.js`
  - Render provider name from live events instead of hardcoded Deepgram.
- Modify: `desktop-rust/src/dev-mock.js`
  - Mock live provider settings and events for Deepgram/Yandex.
- Modify: `desktop-rust/src/tabs/help.js`, `desktop-rust/src/release-history.md`, `desktop-rust/CHANGELOG.md`
  - Document the new provider for release.

## Tasks

### Task 1: Rust SpeechKit protobuf and parser tests

- [ ] Add `tonic`, `prost`, and `tokio-stream` dependencies.
- [ ] Ensure Tonic TLS/root features are enabled so
  `https://stt.api.cloud.yandex.net:443` can connect.
- [ ] Create `speechkit_proto.rs` with minimal prost structs for:
  - `StreamingRequest`
  - `StreamingOptions`
  - `RecognitionModelOptions`
  - `AudioFormatOptions`
  - `RawAudio`
  - `TextNormalizationOptions`
  - `LanguageRestrictionOptions`
  - `AudioChunk`
  - `StreamingResponse`
  - `AlternativeUpdate`
  - `Alternative`
  - `FinalRefinement`
  - `StatusCode`
  - manual `RecognizerClient::recognize_streaming`.
- [ ] Write unit tests in `yandex.rs` before implementation:
  - `build_speechkit_options_defaults_to_ru_realtime_linear16`
  - `parse_partial_response_returns_interim`
  - `parse_final_refinement_preferred_when_normalization_enabled`
  - `build_paste_chunk_handles_russian_spacing`
- [ ] Run `cargo test whisper::yandex --lib` and confirm tests fail because implementation is missing.
- [ ] Implement the config builder and parser.
- [ ] Run the same test command and confirm tests pass.

### Task 2: SpeechKit live service

- [ ] Add `YandexSpeechKitConfig` and `YandexSpeechKitLiveService` in `yandex.rs`.
- [ ] Reuse `LiveRecorder::start_with_level_event` and `pcm_i16_to_le_bytes`.
- [ ] Implement start/stop/cancel/status behavior matching Deepgram:
  - start shows overlay and emits `whisper:live-state-changed`.
  - audio queue is bounded.
  - stop drops recorder, waits for stream drain, persists history.
  - cancel aborts task, clears committed text, hides overlay.
- [ ] Use `authorization: Api-Key <key>` metadata.
- [ ] Convert final and normalized final responses into pasted chunks through
  existing `inject::paste_chunk`, but only one of them per utterance:
  - when text normalization is enabled, ignore raw `final` and paste
    `final_refinement.normalized_text`;
  - when text normalization is disabled, paste raw `final`.
- [ ] Add a duplicate-prevention unit test for `final` followed by
  `final_refinement` with normalization enabled.
- [ ] Guard a single Yandex stream with a conservative max duration below the
  documented five-minute service limit and report a provider-specific live
  error/status if SpeechKit closes the stream.
- [ ] Persist history with provider `yandex`.
- [ ] Add unit tests for provider-independent helpers and state decision logic where practical.
- [ ] Run `cargo test whisper::yandex commands::whisper --lib`.

### Task 3: Route live provider commands

- [ ] In `commands/whisper.rs`, add `LiveProvider` enum with values `deepgram` and `yandex`.
- [ ] Read `whisper.live_provider`, defaulting to `deepgram`.
- [ ] Add authoritative active-provider arbitration:
  - if Deepgram is active, stop/cancel/status target Deepgram;
  - if Yandex is active, stop/cancel/status target Yandex;
  - only when no provider is active should start use the selected
    `whisper.live_provider` setting.
- [ ] Build Yandex config from local settings:
  - `whisper.yandex_api_key`
  - `whisper.yandex_model`
  - `whisper.yandex_language`
  - `whisper.yandex_text_normalization`
  - existing mic and clipboard delay settings.
- [ ] Update `hotkey_toggle`, `whisper_live_start`, `whisper_live_stop`,
  `whisper_live_cancel`, `whisper_live_status`, `whisper_stop_active`, and
  `whisper_cancel_active` to route based on active/selected provider.
- [ ] Keep the old command names unchanged.
- [ ] Add unit tests for:
  - live provider default is Deepgram.
  - selected provider starts Yandex.
  - active Yandex stream is stopped before local recording.
  - changing selected provider during an active stream does not route stop to
    the wrong service.
- [ ] Run `cargo test commands::whisper --lib`.

### Task 4: Desktop UI and mock

- [ ] Write frontend/dev-mock tests or extend browser smoke expectations for provider selector if practical.
- [ ] Add `whisper.live_provider` loading/saving in `whisper-tab.js`.
- [ ] Add a compact select next to `Live dictate`.
- [ ] Replace hardcoded Deepgram live labels/meta with provider display labels.
- [ ] Include `provider` in mock live state/interim/final/error payloads.
- [ ] Add Yandex settings block to `whisper-settings.js`.
- [ ] Extend `loadAllSettings()` with Yandex keys.
- [ ] Update `dev-mock.js` so `whisper_live_start` validates the selected provider key and emits provider-aware live events.
- [ ] Run `node --check` on changed JS files.
- [ ] Run `cd desktop-rust/src && python3 dev-test.py`.

### Task 5: Help, release notes, verification, review

- [ ] Update Help in both English and Russian.
- [ ] Update `desktop-rust/src/release-history.md`.
- [ ] Update `desktop-rust/CHANGELOG.md`.
- [ ] Run `cd desktop-rust/src-tauri && cargo check`.
- [ ] Run relevant Rust tests.
- [ ] Run JS checks and browser mock tests.
- [ ] Run reviewer agent against the full diff.
- [ ] Fix blocking and important review findings.
- [ ] Commit with a one-line message.
- [ ] Because this changes Rust/Tauri native code and adds a provider integration,
  prepare a minor `v*` desktop release according to `desktop-rust/RELEASES.md`.
