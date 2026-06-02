# Yandex SpeechKit Settings Spec

## Goal

Expose the user-relevant Yandex SpeechKit text normalization options in
Settings > Whisper instead of hardcoding them in the native client.

## Scope

- Add settings in the existing Yandex SpeechKit block:
  - Text normalization, default on.
  - Literary text / punctuation, default on.
  - Profanity filter, default off.
  - Phone number formatting, default off.
- Keep technical live-streaming options hardcoded:
  - audio format, real-time processing, language restriction type, queue and
    stream timing.
- Persist settings per desktop machine through existing `whisper.*` setting
  keys.
- Update Whisper local help, global Help, changelog, and release history.

## Behavior

- Existing users keep current effective behavior by default:
  - normalization on;
  - literary punctuation on;
  - profanity filter off;
  - phone formatting off.
- Turning text normalization off disables SpeechKit normalized final text
  handling and sends `TEXT_NORMALIZATION_DISABLED`.
- Literary text / punctuation is independent in Settings, but only has useful
  effect when text normalization is on. Help must make that relationship clear.
- Phone formatting maps to SpeechKit `PHONE_FORMATTING_MODE_UNSPECIFIED` when
  enabled and keeps the current disabled mode when off. SpeechKit v3 exposes no
  separate `ENABLED` enum value for this option.

## Release

This changes Rust native SpeechKit config, so it ships as `v1.5.2` patch.
