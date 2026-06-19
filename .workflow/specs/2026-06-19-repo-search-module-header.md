# Repo Search Module Header

## Goal

Make Repo Search follow the standard module pattern: module-level Help and
Settings controls live in the module header, not inside a sub-tab. Fix the
repository settings UI so it is scrollable when the repository list is long.

## Product Direction

Use option A:

1. Add a top module header:
   - left: `Repo Search`;
   - right: `?` help and `⚙` settings.
2. Keep the existing vertical order below the header:
   - group tabs;
   - repository chips;
   - inner tabs: `Search` / `Manage`;
   - selected tab content.
3. Remove the Settings gear from the Search toolbar.
4. Keep the Search toolbar focused on search controls only:
   - query input;
   - Search button;
   - Files / Content / Git mode buttons.
5. Move repository/settings controls from the inline collapsible panel into a
   scrollable modal opened by the header gear.
6. Add a module help button using the same shared Help modal approach used by
   Tasks, SQL, and Whisper.

## Settings Modal

- Shows repository list with existing color/name/path/edit/remove controls.
- Shows `+ Add repository`.
- Shows Search settings such as `Context lines`.
- Body must use bounded height and `overflow:auto`.
- Add/edit repository modal can be opened from inside the settings modal.
- After add/edit/remove, the settings modal refreshes its contents and the main
  group/chip UI is refreshed as before.

## Constraints

- Frontend-only change. Do not add or change Tauri commands.
- Preserve existing repository/group drag-and-drop behavior.
- Preserve Search and Manage inner tab behavior.
- Do not change git reset/pull semantics.
- Update Help, release history, and reusable frontend patterns before release.
