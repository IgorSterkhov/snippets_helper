# Finance Mobile Sync And Color Hotfix Plan

## Steps

1. Add a small server timestamp helper in `api/routes/sync.py` and use it when
   accepting sync push rows:
   - keep conflict detection against `client_updated`;
   - set accepted `updated_at` to at least the per-row server accept timestamp
     for inserts, updates, and deletes;
   - return a conservative pull `server_time` watermark with a small lookback
     to avoid skipping in-flight pushes.
2. Add API unit tests covering old client timestamps being promoted to server
   accept time, newer client timestamps being preserved, and the pull cursor
   safety lookback.
3. Add a mobile Finance helper that computes max tree depth from all active
   items, not from visible flattened rows.
4. Use the full max depth in `mobile/src/screens/Finance/FinanceScreen.js`.
5. Extend mobile Finance repo tests for collapsed rows retaining level band
   slots.
6. Add a new mobile one-time Finance cursor repair backfill key that resets
   `last_sync_at`, so rows already accepted by the old server are pulled once.
7. Add a post-release API contract test for the real `/push` + `/pull` race.
8. Run targeted Python and Jest checks, bump mobile package version to `1.0.28`,
   then prepare/upload the mobile OTA bundle if the checks pass.

## Verification

- `python3 -m pytest tests/api/test_sync_route.py` or equivalent targeted API
  test.
- `cd mobile && npm test -- --runTestsByPath __tests__/db/financeRepo.test.js`.
- `cd mobile && npm test -- --runTestsByPath __tests__/sync/syncService.test.js`
  if sync behavior is touched on mobile.
- `python3 -m py_compile api/routes/sync.py`.
- `tests/post_release/test_finance_sync_contract.py` after server deployment.
