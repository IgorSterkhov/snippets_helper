# Whisper Deepgram Live Dictation Spec

## Requirement

Extend the desktop Whisper feature so speech recognition can use a cloud
provider in addition to the existing local Whisper model. The first cloud
provider is Deepgram. The first release must support live dictation into the
active application, such as Telegram, while keeping the existing local Whisper
batch flow available.

## Decisions

- Scope: hybrid mode.
  - Local Whisper remains the offline/batch recognition path.
  - Deepgram is added as a live streaming recognition path.
- Deepgram API key is stored locally in desktop settings and is not synced.
- Desktop connects directly to Deepgram; the project API server is not a proxy
  for this first release.
- UI adds a visible `Live dictate` checkbox in the Whisper header.
  - Unchecked: the existing Record button/hotkey uses local Whisper batch.
  - Checked: the same Record button/hotkey uses Deepgram live streaming.
  - Tooltip: explain that `Live dictate` streams through Deepgram and inserts
    finalized chunks into the active application.
- Live transcript behavior:
  - Interim Deepgram results are shown live in the overlay and Whisper tab.
  - Only finalized chunks are inserted into the active application.
  - Finalized chunks are inserted with clipboard + Ctrl/Cmd+V.
- The aggressive mode that types interim text directly into Telegram and later
  rewrites it with backspace/retype is a follow-up, not part of this release.

## Why Parallel Live Service

Use a separate Deepgram live service beside the existing local Whisper service.
Do not refactor the current working Whisper batch path into a generic provider
abstraction in the first release.

Why:

- The current local Whisper batch path already works and has a different
  lifecycle: record audio, stop, build WAV, run local inference, then inject
  one final result.
- Deepgram live streaming has a different lifecycle: connect WebSocket, stream
  raw PCM frames, receive interim and final transcript events, inject multiple
  finalized chunks, and handle network failures.
- Separate services keep the implementation and tests focused: the Deepgram
  state machine can be developed without destabilizing local Whisper.
- Later, if more cloud providers are added, we can carefully extract a common
  provider abstraction from two working implementations instead of designing it
  too early.
- A server proxy is intentionally not used in the first release because local
  API-key storage is enough for the current desktop-only MVP, while proxying
  live audio would add long-lived server WebSockets, central rate limiting, and
  more failure modes.

## Deepgram Protocol Notes

Use Deepgram live speech-to-text WebSocket, not Deepgram Whisper Cloud, for live
dictation. Deepgram Whisper Cloud supports hosted Whisper models for
pre-recorded audio, but its documentation says live streaming is not available
for Whisper Cloud and recommends Nova-3 for live streamed audio.

Initial live connection parameters:

- URL: `wss://api.deepgram.com/v1/listen`
- Auth: `Authorization: Token <local_api_key>`
- Model: default `nova-3`
- Audio: raw 16 kHz mono signed PCM frames
- Query parameters:
  - `model=nova-3`
  - `encoding=linear16`
  - `sample_rate=16000`
  - `channels=1`
  - `interim_results=true`
  - `endpointing=300`
  - language:
    - if UI language is `ru`, use a Russian language code supported by
      Deepgram;
    - if UI language is `en`, use an English language code;
    - if UI language is `auto`, use Deepgram's compatible auto/language
      detection option if available for the chosen live model, otherwise omit
      explicit language and let model defaults apply.

Response handling:

- `is_final=false`: update live interim text in overlay/tab only.
- `is_final=true`: append transcript to the committed transcript buffer and
  paste that finalized delta into the active application.
- `speech_final=true`: mark an utterance boundary in UI/history, but do not
  require it before inserting finalized text.
- On user Stop, send Deepgram finalization/close signal, drain remaining final
  results, then close the stream.

## UX

Whisper header:

- Keep existing state chip and model dropdowns.
- Add `Live dictate` checkbox near the model controls.
- Disable the checkbox while local recording/transcribing or live streaming is
  active.
- Record button label:
  - local mode: existing `Record` / `Stop` labels;
  - live mode: `Start live` / `Stop live`.
- Global hotkey keeps one behavior: it triggers whichever mode is currently
  selected by `Live dictate`.

Overlay:

- Local mode keeps the existing warming/recording/transcribing/done states.
- Live mode adds:
  - `connecting`
  - `streaming`
  - `stopping`
  - `error`
- While streaming, overlay shows:
  - microphone level;
  - live interim text;
  - a subtle indication of committed/final text count.

Whisper tab:

- Show live interim text in the current detail panel while streaming.
- Add the completed live transcript to history after Stop.
- History row should show provider/model metadata so local and Deepgram
  transcripts can be distinguished.

Settings:

- Add a Deepgram section:
  - API key input with masked value and clear button;
  - model input/dropdown, default `nova-3`;
  - endpointing milliseconds, default `300`, advanced/collapsed if the UI has
    an advanced area;
  - optional language behavior, reusing the current Whisper language setting
    where practical.
- Settings text must make clear that the key is stored locally and not synced.

## Architecture

Backend modules:

- Add `desktop-rust/src-tauri/src/whisper/deepgram.rs` for Deepgram client and
  live state machine.
- Reuse the existing `cpal` capture/resampling logic conceptually, but expose a
  live frame stream instead of only a final WAV buffer.
- Add a live paste helper in `whisper/inject.rs` that reuses the existing
  clipboard + paste behavior but accepts smaller finalized chunks.
- Keep local `WhisperService` unchanged except for the command layer choosing
  between local and live mode.

Deepgram service state:

- `idle`
- `connecting`
- `streaming`
- `stopping`
- `error`

Tauri commands:

- `whisper_start_recording` continues to exist for local mode.
- Add explicit live commands rather than changing the existing command
  semantics invisibly:
  - `whisper_live_start`
  - `whisper_live_stop`
  - `whisper_live_cancel`
  - `whisper_live_status`
- Frontend chooses which command to call based on `Live dictate`.
- Register new commands only in a full `v*` release because this changes the
  Tauri IPC surface.

Events:

- Keep existing local Whisper events.
- Add live events:
  - `whisper:live-state-changed`
  - `whisper:live-level`
  - `whisper:live-interim`
  - `whisper:live-final`
  - `whisper:live-error`

History:

- Extend `whisper_history` with provider metadata:
  - `provider TEXT NOT NULL DEFAULT 'local'`
  - `provider_model TEXT`
- Local rows keep `provider='local'`.
- Deepgram rows use `provider='deepgram'` and `provider_model='nova-3'` or the
  configured model.
- The full transcript saved for a Deepgram session is the concatenation of
  finalized chunks, not interim text.

## Injection Behavior

MVP injection uses clipboard + paste for finalized chunks:

1. Deepgram emits a final transcript segment.
2. Backend computes the new finalized delta.
3. Backend copies the delta plus needed spacing to clipboard.
4. Backend simulates Ctrl+V on Windows/Linux or Cmd+V on macOS.
5. Backend waits the existing clipboard restore delay.
6. Backend restores previous clipboard text if available.

Rules:

- Never inject interim results in the first release.
- Do not attempt backspace/retype correction in the first release.
- Ignore empty final segments.
- Normalize spacing between chunks so Telegram receives readable text.
- If focus changes while live dictation is running, this first release still
  pastes to the current active application. A later follow-up may add target
  window capture/lock.

## Error Handling

- Missing API key: show a persistent modal or clear inline error; do not start
  streaming.
- Network/WebSocket failure: stop streaming, keep already inserted finalized
  chunks, save any committed transcript in history, and show an actionable
  error.
- Deepgram auth failure: show an error that points the user to Settings.
- Mic error: reuse existing Whisper mic error handling where possible.
- Stop timeout: attempt finalization, then close the connection and preserve
  committed final chunks.
- Local Whisper errors must remain isolated from Deepgram live errors.

## Privacy And Data

- Local mode remains offline except for optional existing post-processing
  settings.
- Live dictate sends microphone audio directly from the desktop app to
  Deepgram.
- Deepgram API key is local-only and should not be synced through the API.
- Do not log API keys.
- Do not persist interim transcripts separately; save only the final assembled
  transcript in history.

## Follow-Up Tasks

- Aggressive interim typing into Telegram with correction/backspace/retype.
- Server-managed Deepgram keys and a streaming proxy, if user-level limits or
  centralized billing become necessary.
- Provider abstraction after at least two cloud providers exist.
- Optional target-window lock so live dictation can refuse to paste if focus
  moved away from the originally selected application.
- Optional cloud batch provider mode for Deepgram Whisper Cloud on recorded
  audio.

## Release Scope

This is a full desktop release:

- Rust/Tauri code changes.
- New Tauri commands.
- New dependency likely required for WebSocket streaming.
- SQLite schema extension for Whisper history provider metadata.
- Help and release history must be updated before tagging.

No mobile or server release is required for the MVP because the key is local and
the desktop connects directly to Deepgram.

## Testing

Backend tests:

- Deepgram response parser:
  - extracts transcript text;
  - distinguishes interim vs final;
  - ignores empty transcripts;
  - handles `speech_final`.
- Spacing/delta builder for finalized chunks, including Russian text.
- Live state machine transitions: idle, connecting, streaming, stopping, error.
- Settings validation: missing API key prevents start.
- SQLite migration adds provider fields without breaking old history rows.
- Injection helper preserves existing clipboard restore behavior.

Frontend tests:

- Whisper header shows `Live dictate`.
- Checkbox toggles Record behavior in the browser mock.
- Checkbox is disabled during active local or live recording states.
- Live interim event updates overlay/tab without inserting into mock target.
- Live final event updates committed transcript and history preview.
- Settings modal includes Deepgram local-key section.

Manual verification:

- Desktop can still run local Whisper batch after the change.
- Deepgram live dictation streams interim text in the overlay.
- Telegram receives finalized chunks in readable order.
- Stop drains final results and saves a history row.
- Missing/invalid API key produces a clear error and does not start streaming.

## References

- Deepgram Live Audio WebSocket reference:
  https://developers.deepgram.com/reference/listen-live
- Deepgram Interim Results:
  https://developers.deepgram.com/docs/interim-results
- Deepgram endpointing with interim results:
  https://developers.deepgram.com/docs/understand-endpointing-interim-results
- Deepgram Finalize:
  https://developers.deepgram.com/docs/finalize
- Deepgram Whisper Cloud note that live streaming is unavailable:
  https://developers.deepgram.com/docs/deepgram-whisper-cloud
- Deepgram raw audio encoding and sample-rate requirements:
  https://developers.deepgram.com/docs/encoding
  https://developers.deepgram.com/docs/sample-rate
