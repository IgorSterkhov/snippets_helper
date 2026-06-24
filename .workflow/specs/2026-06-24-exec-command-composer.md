# Exec Command Composer

## Goal

Improve the desktop Commands module command editor so creating a command feels
like a focused composer instead of a plain form, and extend `Use template` for
copy commands so `scp` and `rsync` can select multiple local files at once.

## Product Direction

- Keep the Commands module compact and utilitarian, matching the current dark
  terminal-oriented UI.
- Redesign `New Command` and `Edit Command` as a structured command composer:
  name/group first, command body as the primary surface, runtime options below,
  and description/visibility as secondary metadata.
- Keep existing command data shape unchanged.
- Use the existing Tauri dialog plugin from the frontend for native file
  picking. Do not add a new Rust command unless the existing plugin is
  insufficient.

## Template Behavior

- `Use template` still opens the existing template chooser.
- `SCP` and `rsync` templates support a source file list instead of a single
  source path.
- Users can add source paths manually, remove rows, or choose multiple local
  files through the native file picker.
- The native file picker is only for local source files. If the source host is
  remote, the picker action should fail inside the modal with a clear message
  telling the user to switch Source host to Local or type remote paths manually.
- Multiple selected sources generate one command:
  - `scp [options] src1 src2 ... destination`
  - `rsync [options] src1 src2 ... destination`
- When multiple sources are used, the destination is treated as a directory by
  convention. The UI should say this clearly.
- Single-source behavior remains compatible with the old template output.
- Source and destination paths must keep the existing shell quoting behavior,
  especially for paths containing spaces.

## UI Notes

- Use a deliberate command-console visual language: framed command panel,
  monospace textarea, quiet field labels, and thin separators.
- Avoid large decorative cards. The modal is a tool surface.
- Keep keyboard and mouse workflows simple: fields are still normal inputs,
  template actions are explicit buttons.

## Release Scope

Frontend-only if implemented through `window.__TAURI__.dialog.open`. Use an
`f-*` release tag. If Rust/Tauri command changes become necessary, switch to a
native semver release.
