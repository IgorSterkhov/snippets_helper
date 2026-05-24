# Desktop Sync Datetime Normalization Spec

## Requirement

Fix desktop handling of synced datetime strings so snippets sorted by modified
date use the real `updated_at` values pulled from the API.

## Root Cause

The desktop database stores local timestamps as `YYYY-MM-DD HH:MM:SS...`, while
API pull responses can contain ISO timestamps such as `YYYY-MM-DDTHH:MM:SS`.
Rust `parse_dt()` only accepts the local format, so UI-facing query models can
turn valid synced datetimes into `NaiveDateTime::default()`.

## Behavior

- Keep the existing canonical desktop storage format.
- Accept local, ISO, and RFC3339 timestamp strings when reading datetimes.
- Normalize `updated_at` and `created_at` from server pulls before writing to
  SQLite.
- Normalize existing synced datetime strings during native startup migrations.
- Preserve sync conflict semantics: Last Write Wins by `updated_at`.
- No new Tauri command is added.

## Release

This changes Rust/native code, so release as the next full desktop `v*`
release.
