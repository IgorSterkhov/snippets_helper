# Launchpad Hotkey Settings

## Requirement

Micro Launchpad should use `Ctrl+Alt+Space` as the default global hotkey.
The main Settings window must expose the current Launchpad hotkey so it can be
changed without another code release.

## Behavior

- Native default: `Ctrl+Alt+Space`.
- Existing saved `launchpad.hotkey` continues to override the default.
- Settings -> Shortcuts shows a `Micro Launchpad hotkey` text input.
- Changing the input saves `launchpad.hotkey`.
- A Reset button restores `Ctrl+Alt+Space`.
- The UI explains that global hotkey registration is applied after app restart,
  because registration currently happens during Tauri setup.
- Whisper no longer uses `Ctrl+Alt+Space` as the empty-setting fallback. Its
  fallback becomes `Ctrl+Alt+W` so a clean profile does not collide with
  Launchpad.
- If a user explicitly saves the same value for `whisper.hotkey` and
  `launchpad.hotkey`, Launchpad takes priority and Whisper logs that its
  duplicate shortcut was skipped.

## Root Cause

`v1.20.0` introduced Launchpad with a hard-coded default `Ctrl+Alt+L` fallback
and no UI for inspecting or changing `launchpad.hotkey`. If that shortcut is
unavailable or unexpected on a user's machine, registration only logs a startup
message and the user has no in-app recovery path.

## Release

This touches native hotkey defaults in `desktop-rust/src-tauri`, so it requires
a full desktop patch release.
