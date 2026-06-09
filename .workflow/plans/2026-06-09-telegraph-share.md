# Telegra.ph Share Plan

## Steps

1. Add API migration/model fields for per-user Telegraph account data and
   `telegraph_pages` item mappings.
2. Add a small async Telegraph API client for `createAccount`, `createPage`,
   `editPage`, and `getViews`.
3. Add Markdown/share payload to Telegra.ph Node conversion with safe HTML Card
   degradation, strict tag/attribute/URL sanitization, and UTF-8 JSON-size
   truncation below the Telegra.ph 64 KB limit.
4. Add authenticated API routes:
   - `GET /v1/share-links/telegraph?item_type=note|shortcut&item_uuid=...`
   - `POST /v1/share-links/telegraph/publish` with `item_type` and `item_uuid`
5. Add Tauri commands that proxy those routes using the configured sync API key.
6. Extend the desktop Share modal with a Telegra.ph section.
7. Extend dev mock and smoke tests for publishing/updating.
8. Update Help, release history, changelog, and frontend patterns.
9. Run API tests, JS checks, desktop browser smoke, and `cargo check`.
10. Deploy the API first.
11. Smoke-test the new Telegra.ph endpoints and HTML media iframe headers
    against production.
12. Publish a full minor desktop release `v1.9.0`.

## Verification

- `tests/api/.venv/bin/python -m pytest tests/api`
- `node --check` on changed desktop JS files
- `cd desktop-rust/src && python3 dev-test.py`
- `cd desktop-rust/src-tauri && cargo check`
- production checks:
  - `/snippets-api/v1/health`
  - HTML media endpoint no longer sends `X-Frame-Options`
  - Telegra.ph publish route can be called through the desktop command path
  - release workflow and assets succeed for `v1.9.0`
