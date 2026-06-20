# VPS SSH Config Import — Design Spec

**Date:** 2026-06-20
**Status:** approved direction: one-time import, duplicate by `Host` alias
**Scope:** desktop VPS module only

## Goal

Add a machine-local VPS import workflow that reads one or more SSH config files
for Windows and WSL, then adds only new `Host` aliases as normal editable VPS
servers.

## User Flow

1. User opens the VPS module.
2. User opens VPS settings from the module toolbar.
3. User enters SSH config file paths in two multiline fields:
   - Windows SSH config files
   - WSL SSH config files
4. User saves settings.
5. User clicks `Import SSH configs` in the VPS toolbar.
6. The app reads all configured files, parses concrete `Host` entries, skips
   aliases already present in VPS by server name, and creates normal VPS
   servers for the rest.
7. The app reloads the VPS list and shows a compact summary with imported,
   skipped existing, ignored pattern, and failed file counts.

## Import Semantics

- This is a one-time import, not live sync.
- Imported entries become ordinary `VpsServer` records in `vps_servers`.
- Re-running import must not duplicate existing servers when a server name
  already equals the SSH `Host` alias.
- Imported records are not linked to the SSH config file after import.
- Duplicate detection is by normalized server name: trim leading/trailing
  whitespace and compare case-insensitively against the SSH `Host` alias.
- If multiple config files define the same alias during one import run, the
  first concrete alias wins and later duplicates are skipped.

## Parsed SSH Config Fields

For each concrete `Host` alias:

- `name`: SSH alias.
- `host`: `HostName` value, or alias if `HostName` is absent.
- `user`: `User` value, or `root` if absent.
- `port`: `Port` value, or `22` if absent or invalid.
- `key_file`: first `IdentityFile` value, or empty string if absent.
- `environment`: `Default`.
- `color`: deterministic color from a small palette based on alias.
- `auto_refresh`: `true`.
- `refresh_interval`: `30`.

## Ignored SSH Config Entries

The parser skips:

- wildcard aliases such as `*`, `github-*`, `*.local`, `prod?`;
- negated aliases such as `!bastion`;
- empty host patterns;
- host blocks without any concrete alias.

`Include`, `ProxyJump`, and other advanced OpenSSH directives are not expanded
in this first version. `Match` starts a non-host block, so directives after it
are ignored until the next `Host`. The importer is intentionally conservative:
it reads explicit `Host` blocks from the configured files only.

## Storage

SSH config path settings are machine-local, stored with the same `computer_id`
settings mechanism already used by VPS:

- `vps_ssh_config_windows_paths`
- `vps_ssh_config_wsl_paths`

Values are newline-separated path strings. This keeps the UX simple and avoids
introducing a new table or synced data surface.

WSL paths are read by the desktop app process as normal OS-readable paths. On
Windows, users should enter Windows-accessible WSL paths such as
`\\wsl$\Ubuntu\home\user\.ssh\config` or
`\\wsl.localhost\Ubuntu\home\user\.ssh\config`. Raw Linux paths such as
`/home/user/.ssh/config` are not translated through `wsl.exe` in this version.

## Error Handling

- Empty path lists are allowed; import returns a summary with zero imported.
- Missing/unreadable files are counted in `failed_files` with path and message.
- Parse failures in one file do not block other files.
- Invalid ports fall back to `22` and do not fail import.
- If existing `vps_servers` JSON cannot be parsed, import fails without saving
  so a corrupted setting cannot wipe existing VPS data.
- The command reads SSH config files outside the DB mutex, then reacquires the
  DB lock for a strict duplicate check and one save.

## Release Notes

This adds native file-reading/import commands, so it must ship as a full
desktop `v*` release, not frontend-only OTA.
