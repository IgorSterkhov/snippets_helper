# Whisper Yandex Folder ID UX

## Goal

Make the Yandex SpeechKit batch-mode setup failure understandable when the user starts Whisper from the tab or global hotkey with `Recognition = Yandex SpeechKit`, `Live dictate = off`, and no Yandex Folder ID configured.

## Current Behavior

- The hotkey mirrors the Whisper Record button.
- With Live dictate off, a cloud engine uses batch transcription: record WAV locally, stop, then send the file to the selected provider.
- Yandex batch transcription requires a Folder ID.
- If the Folder ID is empty, the app shows a generic Whisper error that does not clearly explain that this is a mode/config mismatch.

## Desired Behavior

- Do not silently switch modes. Starting live dictation instead of batch would change where and when text is inserted.
- Show an inline warning in the Whisper header when Yandex batch mode is selected without Folder ID.
- The warning must say the two valid paths: add Folder ID for batch recognition, or turn on Live dictate for Yandex streaming.
- The Record/hotkey error must be self-contained and actionable.
- The Whisper local help must explain where to find Folder ID in Yandex Cloud.

## Scope

- Desktop Whisper frontend.
- Browser mock/smoke tests.
- Existing native Yandex validation message.
- Whisper local help and general Help/release history copy.

## Out Of Scope

- No automatic mode switching.
- No new Tauri commands.
- No changes to Yandex authentication or transcription APIs.
