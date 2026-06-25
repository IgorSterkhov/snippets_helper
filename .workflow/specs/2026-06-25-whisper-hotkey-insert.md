# Whisper Hotkey Default

## Goal

Make Whisper voice recording use `Ctrl+Alt+Insert` as the default global
hotkey instead of a letter-based shortcut, while preserving Launchpad on
`Ctrl+Alt+Space`.

## Requirements

- Default Whisper hotkey is `Ctrl+Alt+Insert`.
- Existing local settings that still have `whisper.hotkey = Ctrl+Alt+Space`
  should be treated as the new default when Launchpad also uses
  `Ctrl+Alt+Space`, so Whisper is not silently disabled by the conflict.
- User-customized non-conflicting Whisper hotkeys must remain respected.
- Whisper settings UI and Help hotkey list must show `Ctrl+Alt+Insert`.
- Because this touches `desktop-rust/src-tauri/`, ship as a native `v*`
  release.

## Testing

- Rust unit tests cover default hotkey selection and migration of the old
  conflicting value.
- Browser smoke tests cover the settings/help display strings.
- Run `cargo check` and `python3 dev-test.py` before release.
