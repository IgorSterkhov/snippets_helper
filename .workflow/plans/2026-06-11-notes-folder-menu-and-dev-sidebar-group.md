# Implementation Plan: Notes Folder Menu and DEV Sidebar Group

## Steps

1. Update Notes folder row rendering:
   - remove `.folder-actions` DOM and CSS;
   - add folder-row `contextmenu` handler;
   - render a positioned context menu with `Add sub-folder`, `Rename`, and
     `Delete`;
   - close the menu on outside click, blur, Escape, and after action selection.
2. Update `TabContainer` to support static tab groups:
   - accept a `groups` option with group id, label, icon, and child tab ids;
   - render grouped child buttons inside a collapsible group container;
   - keep `buttons[tabId]` and panel creation unchanged for all real tabs;
   - expose group buttons separately for context-menu setup only where needed.
3. Add `DEV` sidebar group in `main.js`:
   - group SQL, Superset, Commits, and Search;
   - keep grouped modules out of the top-level sidebar order;
   - context menu for detached windows remains attached to real module buttons,
     including grouped children.
4. Update activation behavior:
   - when a grouped child is active, expand its group;
   - when a non-grouped tab is active, collapse groups; manual expansion only
     lasts until the next non-DEV activation;
   - direct clicks and programmatic activation, including Ctrl+Tab, use the same
     `activate(tabId)` path.
5. Update CSS:
   - DEV group button icon and active/expanded states;
   - soft child expansion with max-height/opacity transition;
   - subtle nested guide for child buttons.
6. Update Help, release history, changelog, and frontend pattern notes.
7. Verify:
   - `node --check` on changed JS;
   - `python3 dev-test.py`, comparing to the known unrelated baseline;
   - release history contains the selected `f-*` tag.
8. Commit, tag frontend-only OTA, push, monitor CI, and verify release assets.
