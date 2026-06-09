# HTML Sandbox Cards Plan

## Steps

1. Add API support for single-file HTML uploads under `/v1/media/html/uploads`.
2. Add a public HTML asset endpoint under `/v1/media/html/{public_token}`.
3. Extend share Markdown rendering to turn `![html:Title](url)` into a
   sandbox iframe card only for the HTML media URL allowlist.
4. Extend desktop media Tauri commands with HTML file picking and upload.
5. Add a desktop HTML upload modal and toolbar button.
6. Extend desktop Markdown preview enhancement to render HTML Card tokens.
7. Update CSP to allow sandbox iframe display in the desktop app.
8. Add unit/smoke tests for API rendering, desktop toolbar insertion, and CSP.
9. Update Help, `desktop-rust/src/release-history.md`, and
   `desktop-rust/CHANGELOG.md`.
10. Deploy and smoke-test the API first.
11. Run API, frontend, and Rust checks; then publish a full minor `v*` release
   because new Tauri commands and CSP changes are native surface changes.

## Verification

- `tests/api/.venv/bin/python -m pytest tests/api`
- `node --check` on changed desktop JS files
- `cd desktop-rust/src && python3 dev-test.py`
- `cd desktop-rust/src-tauri && cargo check`
- after deploy/release, verify:
  - API health;
  - HTML upload and public HTML endpoint;
  - public share page contains sandbox iframe cards;
  - desktop release assets and manifests exist.
