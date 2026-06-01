# Desktop Yandex SpeechKit Provider

## Goal

Add Yandex SpeechKit as a desktop speech recognition engine for live dictation,
alongside local Whisper and Deepgram.

## Product Direction

- Use option A: store the Yandex SpeechKit API key locally in desktop Whisper
  settings, matching the existing Deepgram key behavior.
- Do not route microphone audio through the app API server.
- Keep the existing local Whisper recording flow unchanged.
- Keep Deepgram live dictation working unchanged.
- Use SpeechKit for live dictation: microphone audio streams directly from the
  desktop app to Yandex SpeechKit, final chunks are pasted into the active app.

## User-Facing Behavior

- Whisper settings gains a Yandex SpeechKit block:
  - API key.
  - Model, default `general`.
  - Language, default `ru-RU`.
  - Text normalization toggle, default on.
- The main Whisper tab gets a live provider selector near the `Live dictate`
  checkbox:
  - `Deepgram`
  - `Yandex SpeechKit`
- When `Live dictate` is enabled, Record starts the selected provider.
- Global Whisper hotkey uses the same selected provider.
- The overlay and main tab status should show the active provider name.
- History rows for Yandex live dictation are saved with provider `yandex` and
  provider model equal to the selected SpeechKit model.

## SpeechKit Integration

- Use Yandex SpeechKit API v3 streaming recognition over gRPC.
- Authorization uses the metadata header `authorization: Api-Key <key>`.
- Endpoint: `https://stt.api.cloud.yandex.net:443`.
- First streaming request sends `session_options`.
- Audio chunks are raw linear PCM, 16 kHz, mono, 16-bit little-endian.
- Recognition model:
  - `model`: configured value, default `general`.
  - `audio_processing_type`: real-time.
  - `language_restriction`: whitelist selected language when not `auto`.
  - `text_normalization`: enabled by default.
- Handle response events:
  - `partial`: emit live interim text.
  - `final`: store/paste final text only when normalization is disabled.
  - `final_refinement.normalized_text`: store/paste normalized text when
    normalization is enabled.
  - Never paste both `final` and `final_refinement` for the same utterance.
  - `status_code`: emit non-empty warning/error details as live error context.
- `whisper:live-*` event payloads must include `provider` so the main tab and
  overlay can show the active provider without hardcoded Deepgram labels.
- Stop/cancel/status must target the provider that is currently active, not the
  provider currently selected in settings. Changing the selected provider while
  a live stream is running must not orphan a recorder or network stream.
- Yandex streaming sessions have practical service limits. The desktop app must
  end a single Yandex live stream before the documented five-minute/10 MB limit
  and surface a clear error/status if the service closes the stream.

## Constraints

- Any change in `desktop-rust/src-tauri/` requires a full desktop `v*` release.
- Do not add server-side storage or API dependencies for this task.
- Do not break the existing `whisper_live_*` IPC names; old frontend calls must
  continue to work through the selected live provider.
- Follow UTF-8 safety rules for user-visible text handling.
- Use `lock_recover()` for DB access.
- Update Help, `desktop-rust/src/release-history.md`, and
  `desktop-rust/CHANGELOG.md` before releasing.

## Verification

- Rust unit tests for SpeechKit URL/config/protobuf parsing and provider
  selection.
- Regression test that a `final` followed by `final_refinement` does not paste
  duplicate text when normalization is enabled.
- JS syntax checks for changed frontend files.
- Desktop browser mock smoke tests where practical.
- `cargo check` for Tauri backend.
- Manual configuration path:
  - add Yandex API key in Whisper settings;
  - enable `Live dictate`;
  - select `Yandex SpeechKit`;
  - start/stop live dictation from button and hotkey.

## References

- Yandex SpeechKit streaming recognition:
  https://yandex.cloud/en/docs/speechkit/stt/streaming
- Yandex SpeechKit API v3 streaming examples:
  https://aistudio.yandex.ru/docs/en/speechkit/stt/api/streaming-examples-v3
- Yandex SpeechKit Recognizer.RecognizeStreaming:
  https://yandex.cloud/ru/docs/speechkit/stt-v3/api-ref/grpc/Recognizer/recognizeStreaming
