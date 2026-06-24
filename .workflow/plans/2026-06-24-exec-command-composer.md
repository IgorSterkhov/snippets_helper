# Exec Command Composer Plan

## Steps

1. Add failing frontend smoke tests for the new source list, multi-file picker
   behavior, and quoted paths with spaces in `desktop-rust/src/dev-test.py`.
2. Add or extend the browser mock for `window.__TAURI__.dialog.open` so tests
   can provide deterministic selected files.
3. Refactor `desktop-rust/src/tabs/exec.js` command form markup and CSS into a
   command-composer layout while preserving existing form IDs and save logic.
4. Refactor `desktop-rust/src/tabs/exec-templates.js` `scp` and `rsync`
   template builders to use a reusable source-list control and native
   multi-select local file picker while preserving host selectors, recursive
   mode, port/key options, rsync flags, and existing local/remote validations.
5. Update Help, release history, and changelog for the user-facing desktop
   change.
6. Verify with JS syntax checks, Python syntax check, desktop smoke tests, and
   diff checks.
7. Commit and publish a frontend release tag if no Rust/Tauri changes were
   needed.
