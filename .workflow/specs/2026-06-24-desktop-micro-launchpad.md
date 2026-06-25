# Desktop Micro Launchpad

## Goal

Add a global-hotkey micro window that opens a compact Launchpad instead of the
main desktop interface. The Launchpad lets the user quickly open standalone
module windows, open specific objects inside modules, or run an Exec command and
view the command status.

## UX Direction

- Use the selected visual direction **B: Quick grid / Launchpad**.
- The window is frameless, always-on-top, compact, dark themed, and keyboard
  first.
- Mockups and future visual reviews must be arranged vertically, not
  side-by-side.
- The top-right gear opens a small settings menu.
- Gear settings include:
  - `Show search`
  - `Show recent`
- The gear menu also exposes:
  - `Edit Launchpad`
  - `Add item`
- Edit mode can be opened from the gear menu or with `Ctrl+E`.
- `Esc` behavior:
  - in edit mode: leave edit mode;
  - otherwise: close the micro window;
  - when command status is open: close status if the command is done, otherwise
    keep the running status visible.

## Main Window Behavior

- Global hotkey opens the Launchpad window. Default hotkey: `Ctrl+Alt+L`.
- If the Launchpad is already open, the hotkey closes it.
- The Launchpad must not show the native OS title/header controls.
- If search is enabled and the search field is empty, show the user-managed
  Launchpad tiles and optional Recent section.
- If search is disabled, show only the Launchpad grid and optional Recent
  section.
- When the user types into search, show search results for modules, tasks,
  notes, snippets, and Exec commands.
- Keyboard controls:
  - arrow keys move the selected tile/result;
  - `Enter` opens or runs the selected item;
  - `Ctrl+E` toggles edit mode;
  - `Esc` closes or steps out of the current mode.

## Launchpad Items

Supported item types:

- `module`: opens a standalone module window.
- `task`: opens the Tasks standalone window and focuses the task.
- `note`: opens the Notes standalone window and focuses the note.
- `snippet`: opens the Snippets standalone window and focuses the snippet.
- `exec_command`: runs the command directly from the micro window and shows a
  compact status/output view.

Storage is per-machine via app settings. Object references use UUID when
available; Exec command references use id.

## Editing And Filling

- A `+ Add` tile opens a compact Add picker in the Launchpad window.
- The Add picker supports adding modules, tasks, notes, snippets, and Exec
  commands.
- Edit mode supports:
  - removing a tile;
  - reordering tiles with pointer drag;
  - reordering with keyboard movement may be added if simple, but pointer
    reorder is sufficient for the first version.
- A launchpad tile can have a stored label and accent. The first version may use
  a generated label/accent from the target item.

## Recent Section

- Recent items are shown below manual Launchpad tiles when `Show recent` is
  enabled.
- Recent items must not automatically become Launchpad tiles.
- Recent data is persisted per-machine in `launchpad.recent`. The existing
  main-window view history remains runtime-local and is not shared directly with
  the Launchpad window.
- Opening an item from Launchpad records it into `launchpad.recent`.

## Opening Objects

- Opening a module uses the existing standalone module window behavior.
- Opening a task, note, or snippet uses an explicit native command
  `open_module_object_window`, which opens a standalone module window plus a
  target route.
- If the standalone module window already exists, `open_module_object_window`
  focuses it and emits a frontend event to that window with the new target
  details instead of silently keeping the old target.
- The target route must reuse existing object-opening logic where possible:
  `view-history:open` style details with `moduleId`, `objectType`,
  `objectId`, `objectUuid`, and title.
- If the object no longer exists, the standalone module should show the existing
  module-level error/toast behavior, not crash the Launchpad.

## Running Commands

- Selecting an `exec_command` runs the command with the saved shell settings.
- While running, the Launchpad shows a compact status/output view.
- `Esc` closes completed status. Running status remains visible unless Stop is
  supported later.
- Failed commands show the error/output in the same status panel.

## Scope Boundaries

Included:

- Desktop app only.
- New Launchpad micro window and hotkey.
- UI settings, edit mode, Add picker, reorder/remove, object open, command run.
- Help/release history updates.
- Browser smoke tests and Rust tests for native window specs.
- Launchpad boot isolation: Launchpad windows must not run main-window sync,
  status bar, update watcher, or Escape-to-hide behavior.

Not included in the first version:

- Mobile Launchpad.
- Cloud sync for Launchpad layout.
- Rich tile icon editor.
- Full command cancellation from Launchpad.
- Long-click editing behavior.

## Release

This changes native Tauri command/hotkey/window surface. It must be released as
a full `v*` desktop release. Because this is a new visible workflow and native
surface, use a minor version bump.
