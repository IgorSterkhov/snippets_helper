# Whisper Recognition Engine and Mode Spec

Date: 2026-06-03

## Goal

Make Whisper provider selection understandable by separating the speech
recognition engine from the recording mode.

## Current Problem

Today the desktop Whisper tab has:

- a local Whisper model selector;
- a `Live dictate` checkbox;
- a live provider selector for Deepgram/Yandex.

This makes it unclear which model is active: local models are used only when
`Live dictate` is off, while cloud providers are used only when it is on.

## Target Mental Model

The user chooses two independent things:

1. **Recognition engine**: what performs speech recognition.
2. **Live dictate**: whether recognition is batch-after-stop or real-time
   streaming into the active app.

## Engines

The main engine selector should list:

- installed local Whisper models;
- Deepgram;
- Yandex SpeechKit.

Local engine entries use the installed local model names. Cloud engine entries
use each provider's current model setting from Whisper Settings, but the header
selector selects the provider, not the exact cloud model text field.

## Mode Rules

- Local Whisper + Live off:
  - record audio locally;
  - transcribe after Stop using the selected local model.
- Local Whisper + Live on:
  - not supported;
  - `Live dictate` is disabled with a tooltip explaining that live mode requires
    Deepgram or Yandex SpeechKit.
- Deepgram + Live off:
  - record audio locally;
  - after Stop, send the full audio to Deepgram prerecorded transcription;
  - show/persist/inject the final transcript like local Whisper.
- Deepgram + Live on:
  - use existing Deepgram streaming logic.
- Yandex SpeechKit + Live off:
  - record audio locally;
  - after Stop, send the full audio to Yandex SpeechKit file recognition;
  - show/persist/inject the final transcript like local Whisper.
- Yandex SpeechKit + Live on:
  - use existing Yandex streaming logic.

If the user switches from a cloud engine with Live enabled to a local engine,
the app automatically turns Live off and persists that setting.

Cloud batch mode must not require an installed local Whisper model. It records
WAV audio locally, but it must not resolve a local default model or warm
`whisper-server`.

## Existing Settings Compatibility

- New setting: `whisper.recognition_engine`.
- Values:
  - `local:<model_name>` for local Whisper models;
  - `deepgram`;
  - `yandex`.
- If `whisper.recognition_engine` is absent:
  - when `whisper.live_dictate=true`, infer the cloud engine from
    `whisper.live_provider` and persist that inferred cloud engine into
    `whisper.recognition_engine` before `Live dictate` can be turned off;
  - otherwise infer `local:<current default Whisper model>`.
- If a saved `local:<model_name>` no longer exists, fall back to the current
  local default when available. If no local model exists, the UI should still
  allow choosing Deepgram/Yandex.
- For compatibility with existing code and settings, choosing a cloud engine
  also updates `whisper.live_provider` to the same provider.

## UI Requirements

- Replace the separate local Whisper model selector plus live provider selector
  with a clearer **Recognition engine** selector.
- Keep the Gemma selector separate.
- Keep `Live dictate` as a checkbox/toggle.
- Disable `Live dictate` when the selected engine is local.
- Record button labels should make the mode obvious:
  - `Record` for local batch;
  - `Record cloud` or equivalent for cloud batch;
  - `Start live` for cloud live.
- Status/history metadata should distinguish Local, Deepgram, and Yandex.

## Native/API Requirements

- Add native support for cloud batch transcription.
- Use an engine-aware recording pipeline:
  - local engine may keep using `WhisperService` and `whisper-server`;
  - cloud batch uses recorder/WAV capture only and does not spawn
    `whisper-server`.
- Do not upload audio to the sync API; cloud audio goes directly from desktop
  to the chosen provider.
- Store cloud API keys locally, as today.
- Use existing mic selection and injection/postprocessing settings where
  practical.
- Deepgram batch uses the official prerecorded REST endpoint
  `POST https://api.deepgram.com/v1/listen` with `Content-Type: audio/wav`,
  `Authorization: Token ...`, and existing model/language/punctuation/
  smart-format settings.
- Yandex SpeechKit batch uses the official async v3 flow:
  `POST https://stt.api.cloud.yandex.net/stt/v3/recognizeFileAsync`, poll
  `https://operation.api.cloud.yandex.net/operations/<operation_id>`, then read
  `https://stt.api.cloud.yandex.net/stt/v3/getRecognition?operationId=...`.
  Auth uses `Authorization: Api-Key ...`; Yandex batch requires
  `whisper.yandex_folder_id`, sent as `x-folder-id`, and the app must validate
  it before starting local capture. The result parser must handle streamed or
  concatenated JSON result objects, concatenate multiple final segments, and
  prefer `finalRefinement.normalizedText` when present.
- Persist history rows with exact provider metadata:
  - local: `provider=local`, `model_name=<local model>`,
    `provider_model=<local model>`, CPU/GPU/VRAM from local metrics;
  - Deepgram: `provider=deepgram`, `model_name=<deepgram model>`,
    `provider_model=<deepgram model>`, cloud CPU/GPU/VRAM as zero values;
  - Yandex: `provider=yandex`, `model_name=<yandex model>`,
    `provider_model=<yandex model>`, cloud CPU/GPU/VRAM as zero values;
  - `text_raw` stores the provider transcript before rules/LLM cleanup when
    cleanup changes the text.
- Use `DbState::lock_recover()` for DB access in new Tauri commands.
- Because this adds native command/provider behavior, release as a full `v*`
  desktop release.

## Out of Scope

- Mobile app changes.
- Adding local real-time streaming.
- Adding OpenAI/Google/Sber/T-Bank providers.
- Syncing provider settings between devices.
