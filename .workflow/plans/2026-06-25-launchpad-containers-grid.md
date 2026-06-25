# Launchpad Containers And Grid Plan

1. Add failing browser smoke tests for:
   - no top-level Add tile;
   - top-bar `+` menu;
   - adding container and separator;
   - setting `columns` / `rows`;
   - moving an item into a container;
   - deleting a container unwraps children;
   - window-opening items close Launchpad, commands do not.
   - old flat `launchpad.items` remain active after normalization;
   - search finds container children;
   - overflow keeps the window grid size while body scrolls.
2. Add Rust tests for the grid-to-window-size helper and default `4x3` spec.
3. Implement Rust grid sizing in `commands/launchpad.rs`, register
   `resize_launchpad_window`, and add a dev mock.
4. Refactor `micro-launchpad.js` to normalize old flat items into layout
   entries, render tile/container/separator entries, and persist the new shape.
5. Implement Edit mode controls, top-level reorder, container child moves, and
   container resize.
6. Update CSS with the compact tray design, Help, release history, changelog,
   and a native minor version bump to `v1.21.0`.
7. Run `node --check`, `cargo check`, targeted Rust tests, `python3 dev-test.py`,
   commit, tag a native release, push, and verify CI/assets.
