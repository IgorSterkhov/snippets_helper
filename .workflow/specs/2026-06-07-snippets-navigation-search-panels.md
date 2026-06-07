# Snippets Navigation, Search, and Panels

## Goal

Improve the Snippets desktop tab so navigation from Related snippets is reversible, search is explicit and predictable, and tag/pinned panels can be shown together without overloading the header.

## Requirements

1. Related navigation uses browser-like history:
   - Back and Forward buttons appear in the snippet detail header.
   - A compact History button with a clock icon sits between Back and Forward.
   - The History popover shows the current navigation branch, limited to 10 visible entries.
   - Opening a new snippet after going Back clears the Forward branch.
   - History entries restore the snippet and the previously active detail tab when possible.

2. Search scope is explicit:
   - Add a compact square button to the right of the search field.
   - Name-only mode searches snippet names only.
   - Full mode searches name, value, and description.
   - The button uses different icon states and a tooltip for each mode.
   - The selected mode is persisted.

3. Search matching is literal and token-based:
   - No fuzzy matching, stemming, or punctuation normalization.
   - Whitespace splits the query into tokens.
   - All tokens must match, in any order, inside the selected search scope.
   - Example: `bash setup` matches both `bash_obsidian_setup` and `setup_bash_chrome_keenetic`.
   - Example: `route_` must not match `routes` unless `route_` exists in another searched field in full mode.

4. Tags and pinned snippets are independent panels:
   - Replace the Tags/Pinned dropdown with two square icon toggle buttons.
   - Tags and Pinned panels can be independently shown or hidden.
   - If both are enabled, Tags renders above Pinned.
   - Existing users with old `snippets_panel_mode=pinned` see Pinned enabled; otherwise Tags remains enabled by default.
   - Tag selected state must be visually obvious.

5. Tag chips can be reordered:
   - Use the existing wrapped chip DnD pattern.
   - Persist tag order by updating existing tag `sort_order` values through the existing `update_snippet_tag` command.
   - Editing an existing tag must preserve its current `sort_order`.
   - Do not add a new Tauri command for this pass.

## Non-Goals

- No global cross-module Ctrl+Tab changes in this task.
- No full recent-snippets journal separate from the current branch.
- No mobile changes.
- No backend IPC signature changes unless verification shows frontend-only filtering is insufficient.
- No changes to native/mock `search_shortcuts` command semantics in this pass; Snippets tab UI performs its own deterministic filtering over the loaded list.

## Verification

- Browser smoke tests cover:
  - Related navigation Back/Forward/History branch behavior.
  - Search mode button and tokenized literal matching.
  - Independent tag/pinned panel toggles.
  - Tag DnD persists `sort_order`.
- Run `node --check` for changed JavaScript.
- Run `python3 dev-test.py` from `desktop-rust/src`.
