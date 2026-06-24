# Exec Local Copy Templates

## Goal

Extend the Commands module templates so copy workflows cover both remote copy
and local host copy:

- `SCP` and `rsync` destination paths can be chosen with a native folder picker
  when the destination host is local.
- A new `Local copy` template can generate commands for copying multiple local
  files into a local folder.

## Behavior

- `SCP` and `rsync` keep their existing source multi-file picker and manual
  source path rows.
- Each `Destination path` field gets a `Choose folder...` button.
- The destination folder picker only works for local destinations. If the
  destination host is remote, the template modal shows an inline message telling
  the user to type the remote destination manually. The host is checked at click
  time, after any user changes in the modal.
- `Local copy` has:
  - a source file list with native multi-file selection and manual path rows;
  - a destination folder field with native folder selection;
  - a target shell selector with `Windows PowerShell` and `POSIX cp`.
- `Windows PowerShell` generates a `powershell -EncodedCommand ...` command
  so the script does not depend on nested `cmd /c` quoting.
- `POSIX cp` generates:
  `cp -- src1 src2 destination`
- Paths with spaces or quotes must remain correctly quoted.
- POSIX commands use the existing POSIX shell quoting. PowerShell commands use a
  separate PowerShell single-quoted literal escape; POSIX quoting must not be
  reused inside `powershell -Command`.
- PowerShell copy uses `$ErrorActionPreference = 'Stop'` and
  `Copy-Item -ErrorAction Stop`, so failed copies do not report a misleading
  `exit code: 0`.

## Release Scope

Frontend-only. This uses the already-registered Tauri dialog plugin from
frontend JavaScript and does not add or change Rust IPC commands.
