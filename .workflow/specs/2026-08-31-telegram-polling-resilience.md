# Telegram Polling Resilience Spec

## Goal

Make server-side Telegram polling tolerate intermittent Telegram Bot API
failures without raising SQLAlchemy `MissingGreenlet`, aborting the remaining
configured users, or writing a full traceback on every base polling interval.

## Confirmed Product Direction

- Telegram behavior and commands do not change.
- Polling remains server-side and enabled by the existing configuration.
- A failed Telegram user must not prevent later configured users from being
  polled in the same cycle.
- Transient failures use an in-memory per-user backoff of 5, 15, 30, then 60
  seconds; subsequent failures remain capped at 60 seconds.
- Any successful poll, including one returning zero updates, clears that
  user's backoff.
- Manual `POST /v1/telegram/my/poll-once` remains immediate and does not use
  background backoff state.
- The pinned `api.telegram.org:149.154.167.220` production mapping is not
  changed in this fix. Its long-term stability is a separate infrastructure
  investigation.

## Root Cause

The current background worker loads multiple SQLAlchemy `User` ORM instances
into one `AsyncSession`. When Telegram `getUpdates` raises a connection
timeout, the worker rolls that shared session back and then reads `user.id`.
SQLAlchemy expires ORM state on rollback even though the session uses
`expire_on_commit=False`. Reading an expired attribute tries to perform
implicit database IO outside an awaited SQLAlchemy greenlet and raises
`MissingGreenlet`. The same rollback also expires the remaining users loaded
by that session, so caching only the failed user's ID is insufficient.

## Design

### Discovery and per-user sessions

The worker first opens a short discovery session and selects configured user
IDs as scalar UUID values. The discovery session closes before Telegram
requests start.

For every ready user ID, the worker opens a fresh `AsyncSession`, reloads the
configured `User`, and invokes the existing `poll_telegram_once_for_user`.
Failure rollback and session close therefore affect only that user. The scalar
ID used for logging and retry bookkeeping remains safe after rollback.

If a token is cleared between discovery and reload, the missing/unconfigured
user increments `skipped` without being treated as a polling failure, warning,
or backoff mutation.

### Per-user backoff

One `TelegramPollingBackoff` instance lives for the lifetime of
`telegram_polling_loop`. It uses `time.monotonic()` deadlines and stores only
the failure count and next-attempt deadline for users currently in backoff.
Every public backoff method normalizes its key with `str(user_id)`, including
`retain`, so discovery UUIDs and safe logging strings cannot create separate
states.

- first consecutive failure: retry after 5 seconds;
- second: 15 seconds;
- third: 30 seconds;
- fourth and later: 60 seconds;
- success: remove state immediately;
- process restart: state intentionally resets;
- users no longer returned by discovery: stale state is pruned.

The base loop interval remains controlled by
`TELEGRAM_POLLING_INTERVAL_SECONDS`; backoff only decides whether a particular
user is attempted during a cycle.

### Logging and summaries

`TelegramBotApi` exposes typed `TelegramBotError` failures for expected Bot API
transport, HTTP, rate-limit, and provider responses. These failures emit one
compact warning containing the safe scalar user ID, sanitized exception
type/message, and retry delay. Backoff-skipped cycles do not emit warnings.

Unexpected database, SQLAlchemy, AI-runtime, and programming exceptions still
isolate that user and receive the same bounded backoff, but they are logged as
unexpected with sanitized traceback frames so defects remain diagnosable. The
worker must never pass the raw exception object to `logger.exception`, because
its final traceback line can reproduce a URL containing the bot token.

Safe traceback diagnostics use `traceback.extract_tb()` and render at most the
last 12 frames as sanitized `filename:lineno:function` entries. Source-code
lines are never rendered, and the combined frame string is capped at 2000
characters. This avoids leaking literals from a `raise ...` source line.

One sanitizer is used for both logs and `summary["errors"]`. It redacts
`/bot<TOKEN>/` URL components, Telegram token shapes, Bearer/Authorization and
API-key material, URI userinfo such as `scheme://user:secret@host`, and
`password`/`passwd`/`pwd` assignments. It collapses whitespace/newlines and
caps the resulting message at 300 characters. The original exception object
is not serialized.
Unexpected discovery/session-factory failures remain handled by the outer loop
with the same sanitized exception formatter and safe frame-only traceback. No
polling boundary uses raw `logger.exception` or raw `exc_info`, because database
exceptions can contain DSNs or credentials even before a Telegram user loads.

The internal cycle summary preserves `users`, `polled`, `updates`, and
`errors`, and adds `skipped`. Error entries include `user_id`, `error`, and
`retry_in_seconds`. Each completed cycle maintains `users == polled +
len(errors) + skipped`. No public HTTP response schema changes.

`asyncio.CancelledError` always propagates immediately. Cancellation does not
rollback explicitly, add an error, mutate backoff, log a failure, or start the
next configured user; async session context cleanup remains responsible for
closing the current session.

## Testing Requirements

- A regression test must simulate rollback-expired ORM state and prove the
  current shared-session implementation fails with `MissingGreenlet` before
  the architecture changes; the final test must prove the error handler never
  reads the failed ORM user after rollback.
- A multi-user test must prove the second user is polled in a separate session
  after the first user fails.
- Backoff tests must use actual `uuid.UUID` discovery IDs and verify the literal
  sequence 5, 15, 30, 60, 60 seconds, UUID/string normalization, skipped
  attempts before deadlines, success reset, and stale-state pruning.
- Invalid delay configurations—empty, boolean, zero, negative, NaN, and
  infinity—must be rejected before polling starts.
- Sanitizer tests must include a literal fake bot token in a Telegram URL,
  Authorization/API-key material, a credential-bearing PostgreSQL DSN,
  password/passwd/pwd fields, newlines, and oversized text, then prove no
  secret survives and the result is at most 300 characters.
- Expected typed Telegram failures must use compact warning logging; unexpected
  application/DB failures must retain sanitized traceback frames.
- Worker-level discovery/session-factory failures must use the same sanitizer
  and frame-only traceback formatter.
- A discovered user whose token is cleared before reload must increment
  `skipped` without polling, warning, error, or backoff state.
- A poll function raising `CancelledError` must stop the cycle immediately
  without rollback, logging, error summary, backoff mutation, or a later user
  attempt.
- A loop-level test must prove one persistent backoff instance is reused across
  cycles without sleeping in the test.
- Existing Telegram Bot API, pairing, authorization, and command tests must
  remain green.
- Run the full `tests/api` suite before completion.

## Compatibility and Release Scope

- No database migration.
- No API, desktop IPC, mobile, or frontend changes.
- No desktop version/tag is required because this is a server-only technical
  reliability fix.
- Production deployment, if authorized after implementation, is a fast-forward
  API pull plus Docker Compose rebuild followed by health/log verification.

## Out of Scope

- Telegram webhooks.
- Changing or removing the production `extra_hosts` Telegram IP mapping.
- Persisting retry state in PostgreSQL.
- Retrying inside one polling attempt.
- Changing BotFather setup, pairing commands, AI behavior, or chat bindings.
