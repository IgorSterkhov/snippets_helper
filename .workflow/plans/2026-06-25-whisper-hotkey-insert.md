# Whisper Hotkey Default Plan

1. Add failing tests for the new default and old-conflict migration.
2. Extract Whisper hotkey resolution into a small Rust helper and use it during
   startup registration.
3. Update Whisper settings UI, Help hotkey list, release history, and changelog.
4. Bump native version to `1.20.2`, refresh lockfile, run verification, commit,
   tag, push, and monitor the release.
