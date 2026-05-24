# Plan: Desktop Tasks Checkbox Collapse Persistence

## Goal

Keep checkbox collapse/expand state stable across frontend OTA reloads.

## Steps

- [x] Add a browser mock regression test for collapse state surviving page
      reload.
- [x] Verify the regression fails before implementation.
- [x] Load collapsed checkbox IDs from settings before Tasks render.
- [x] Persist collapsed checkbox IDs after arrow toggle and recursive
      collapse/expand.
- [x] Run `node --check` on changed JS files.
- [x] Run `cd desktop-rust/src && python3 dev-test.py`.
- [x] Run `cd desktop-rust/src-tauri && cargo check`.
- [ ] Update help/release notes, commit, tag, push, and verify OTA assets.
