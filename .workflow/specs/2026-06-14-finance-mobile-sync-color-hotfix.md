# Finance Mobile Sync And Color Hotfix

## Requirement

Fix two Finance issues reported after desktop/mobile testing:

- A recently added Finance item such as `Подписки` in the `Regular monthly`
  list can fail to appear on mobile after sync.
- On mobile, collapsing Finance rows so only top-level rows remain visible
  removes level color bands, making top-level rows look like terminal rows.

## Diagnosis

Finance sync uses `updated_at` as the pull cursor. The API currently stores the
client-provided `updated_at` on accepted push rows, while clients advance their
cursor to API `server_time`. If device A syncs after a row was locally edited on
device B but before B pushes it, A's cursor can become newer than the row's
client timestamp. When B later pushes the row, the server stores that older
timestamp, so A's next pull misses it.

Mobile Finance color bands currently compute max depth from visible rows. When
all branches are collapsed, visible max depth becomes zero even though hidden
children still exist, so band selection returns no fill for top-level rows.

## Expected Behavior

- Any row accepted by `/v1/sync/push` must become visible to clients whose next
  `/v1/sync/pull` cursor is after the row's original client timestamp but
  before/around the push acceptance.
- Existing last-write-wins conflict detection must remain based on the
  client-supplied timestamp compared to the current server row.
- Mobile Finance level bands must be based on the full active tree depth, not
  only the currently visible/collapsed rows.
- The fix must not require a desktop native release because no desktop IPC or
  native code changes are needed.
- Mobile must run a new one-time Finance full-pull backfill after this OTA,
  because rows already accepted by the old server may already have stale
  `updated_at` values.
- Pull cursors should use a small conservative lookback so a pull cannot advance
  past a push that is still being accepted/committed.

## Release Impact

Server code changes require deployment of the API. Mobile JavaScript changes
require a mobile OTA release. The mobile OTA version for this fix is `1.0.28`.
Desktop is not touched unless follow-up evidence shows a desktop-specific
dirty-state problem.
