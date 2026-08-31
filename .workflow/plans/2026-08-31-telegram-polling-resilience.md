# Telegram Polling Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make background Telegram polling survive provider timeouts without SQLAlchemy `MissingGreenlet`, cross-user interruption, secret leakage, or repeated traceback spam.

**Architecture:** Discover configured users as scalar UUIDs, then poll every ready user in a dedicated `AsyncSession`. Classify expected Bot API failures with a typed exception, sanitize all rendered errors, and keep one normalized monotonic per-user backoff object in the background loop.

**Tech Stack:** Python 3.11+, asyncio, FastAPI lifecycle task, SQLAlchemy async sessions, httpx, pytest.

**Spec:** `.workflow/specs/2026-08-31-telegram-polling-resilience.md`

## Global Constraints

- Work in the current `main`; do not create a worktree.
- Do not change database schema, HTTP contracts, desktop/mobile code, or the production Telegram IP mapping.
- Manual `POST /v1/telegram/my/poll-once` remains immediate and bypasses background backoff.
- Use the literal backoff sequence 5, 15, 30, 60 seconds, capped at 60.
- Normalize every backoff key with `str(user_id)` at the class boundary.
- Never log or return a raw polling exception string without sanitization.
- Write and run each regression test before its production implementation.

---

### Task 1: Reproduce rollback expiry and isolate user sessions

**Files:**
- Modify: `tests/api/test_telegram_bot.py`
- Modify: `api/telegram_poller.py`

**Interfaces:**
- Produces: `get_configured_telegram_user_ids(db: AsyncSession, limit: int = 50) -> list[UUID]`.
- Changes: `poll_configured_telegram_users` consumes a callable async session factory instead of one shared `AsyncSession`.
- Preserves: `PollFunc(db, user, allow_pairing=True, limit=...) -> awaitable dict`.

- [ ] **Step 1: Add a current-signature root-cause regression**

Extend the existing shared `FakePollingDb` with rollback-sensitive ORM-like
users. `rollback()` marks every loaded user expired; reading `id` afterwards
raises `sqlalchemy.exc.MissingGreenlet`:

```python
class RollbackSensitiveUser:
    def __init__(self, user_id, token):
        self._id = user_id
        self.telegram_bot_token = token
        self.expired = False

    @property
    def id(self):
        if self.expired:
            raise MissingGreenlet("expired user accessed after rollback")
        return self._id
```

Call the current `poll_configured_telegram_users(shared_db, poll_func=...)`
with a first user that raises `RuntimeError("Telegram timeout")` and a second
user that would succeed. The desired assertions are a returned error summary
and a successful second poll—not `pytest.raises`. This is an honest RED because
the current code instead raises `MissingGreenlet` at `user.id` after rollback.

- [ ] **Step 2: Run the current-signature regression and verify RED**

```bash
/tmp/snippets-helper-tests-20260831/bin/python -m pytest \
  tests/api/test_telegram_bot.py::test_background_poller_never_reads_expired_user_after_rollback -q
```

Expected: FAIL with `MissingGreenlet: expired user accessed after rollback`,
and the second user is not polled.

- [ ] **Step 3: Add final factory/session-isolation fakes and test**

Create distinct result doubles so discovery uses `scalars().all()` and user
reload uses `scalar_one_or_none()`:

```python
class FakeScalarListResult:
    def __init__(self, values):
        self.values = values

    def scalars(self):
        return self

    def all(self):
        return self.values


class FakeScalarOneResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value
```

The async factory returns one discovery session containing literal UUIDs,
then one session per user. Its rollback expires only the user owned by that
session. Assert that the bad and good users receive different sessions, the
bad session rolls back once, the bad expired instance is never touched again,
and the good user is successfully polled.

- [ ] **Step 4: Run the factory test and verify RED**

Expected: FAIL because the current function expects one shared session and has
no scalar-discovery/per-user-session architecture. Preserve the Step 2 failure
output in the work log, then convert the temporary current-signature test to
the final factory test rather than retaining a deprecated internal interface.

- [ ] **Step 5: Implement scalar discovery and per-user session loading**

In `api/telegram_poller.py`, select `User.id` in a short discovery session.
For each UUID, open a new session and reload with:

```python
select(User).where(
    User.id == user_id,
    User.telegram_bot_token.is_not(None),
    User.telegram_bot_token != "",
)
```

Capture `safe_user_id = str(user_id)` before calling `poll_func`. Rollback and
session close affect only that user. A missing row after discovery increments
`skipped` and does not become an error.

- [ ] **Step 6: Run the focused isolation tests and verify GREEN**

```bash
/tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_telegram_bot.py -q
```

---

### Task 2: Classify and sanitize polling errors

**Files:**
- Modify: `tests/api/test_telegram_bot.py`
- Modify: `api/telegram_bot.py`
- Modify: `api/telegram_poller.py`

**Interfaces:**
- Produces: `TelegramBotError(RuntimeError)` for expected Telegram transport, HTTP, rate-limit, and provider failures.
- Produces: `sanitize_telegram_error_text(value: object, max_length: int = 300) -> str`.
- Produces internally: a bounded safe exception formatter used by summaries and logs.

- [ ] **Step 1: Write failing typed-exception tests**

Update the existing fake `httpx.ConnectTimeout` test to require
`TelegramBotError`, not generic `RuntimeError`. Add HTTP-error and Telegram
`{"ok": false}` cases and assert they also raise the typed class. An arbitrary
exception from DB/AI code must remain untyped so the poller can distinguish it.

- [ ] **Step 2: Write a failing sanitizer test with literal secrets**

Use a hand-written input containing all required hazards:

```python
raw = (
    "POST https://api.telegram.org/bot123456789:"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef/getUpdates\n"
    "Authorization: Bearer bearer-secret API_KEY=api-secret "
    "postgresql://dbuser:db-secret@db.internal/app password=pwd-secret "
    + "x" * 600
)
safe = sanitize_telegram_error_text(raw)
```

Assert the literal Telegram token, `bearer-secret`, `api-secret`, `db-secret`,
and `pwd-secret` are absent; newlines are collapsed; URI userinfo preserves no
password; the output contains redaction markers; and `len(safe) <= 300`. Add
separate literals for `passwd=` and `pwd=` plus max-length validation cases for
zero/negative values.

- [ ] **Step 3: Run typed/sanitizer tests and verify RED**

Expected: import/assertion failures because the typed class and sanitizer do
not exist and current exceptions retain raw text.

- [ ] **Step 4: Implement the typed error and one sanitizer**

In `api/telegram_bot.py`, add compiled regexes that redact:

- `/bot<TOKEN>/` URL segments;
- Telegram token shapes such as `<digits>:<long secret>`;
- Bearer/Authorization material;
- `api_key`, `api-key`, and `API_KEY` assignments;
- URI userinfo in `scheme://user:secret@host` form;
- `password`, `passwd`, and `pwd` assignments.

Collapse whitespace, strip, and truncate to `max_length`. Use the sanitizer
when constructing every `TelegramBotError`, so manual polling also receives a
safe message. Preserve exception chaining for programmatic diagnosis.

- [ ] **Step 5: Write failing safe frame-formatter unit tests**

Raise an untyped exception through two helper functions. Extract diagnostics
through the planned safe formatter and assert it contains bounded
`filename:lineno:function` entries, contains no source-code line or literal
secret, has at most 12 frames, and is at most 2000 characters.

- [ ] **Step 6: Implement safe frame-only traceback formatting**

Use `traceback.extract_tb()` and only the last 12 frames. Build each entry from
sanitized filename, integer line number, and sanitized function name; never use
`FrameSummary.line`, `traceback.format_tb`, raw `logger.exception`, or raw
`exc_info`. Cap the combined result at 2000 characters.

- [ ] **Step 7: Run typed, sanitizer, and frame tests and verify GREEN**

```bash
/tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_telegram_bot.py -q
```

---

### Task 3: Add normalized bounded per-user backoff

**Files:**
- Modify: `tests/api/test_telegram_bot.py`
- Modify: `api/telegram_poller.py`

**Interfaces:**
- Produces: `TelegramPollingBackoff(delays=(5.0, 15.0, 30.0, 60.0))`.
- Produces methods: `is_ready(user_id, now) -> bool`, `record_failure(user_id, now) -> float`, `record_success(user_id) -> None`, and `retain(user_ids) -> None`.
- Extends: `poll_configured_telegram_users(..., backoff=None, now_func=time.monotonic)`.

- [ ] **Step 1: Write failing literal sequence and UUID-normalization tests**

Use `user_id = uuid.uuid4()` and mix UUID/string calls deliberately:

```python
backoff = TelegramPollingBackoff()
assert backoff.record_failure(user_id, 0) == 5
assert backoff.is_ready(str(user_id), 4.9) is False
assert backoff.is_ready(user_id, 5) is True
assert [backoff.record_failure(user_id, 5) for _ in range(4)] == [15, 30, 60, 60]
backoff.record_success(str(user_id))
assert backoff.record_failure(user_id, 100) == 5
backoff.retain({user_id})
```

Add a stale UUID stored through one representation and prune through the other;
its next failure must return 5 seconds.

- [ ] **Step 2: Write failing constructor validation tests**

Parameterize `()`, `(0,)`, `(-1,)`, `(True,)`, `(float("nan"),)`, and
`(float("inf"),)` and require `ValueError`. Valid finite positive integers and
floats are normalized to floats.

- [ ] **Step 3: Run backoff unit tests and verify RED**

Expected: import failure because `TelegramPollingBackoff` does not exist.

- [ ] **Step 4: Implement minimal normalized monotonic state**

Use a private dataclass containing consecutive failure count and
`next_attempt_at`. Every public method first runs one `_key(user_id) -> str`.
Validate delays as finite positive real numbers while explicitly rejecting
booleans. `record_failure` uses index
`min(failures, len(delays) - 1)`, stores `now + delay`, increments failures,
and returns the chosen delay.

- [ ] **Step 5: Write a failing integration test with discovered UUIDs**

Call `poll_configured_telegram_users` repeatedly with the same backoff and a
controlled clock. Discovery returns an actual `uuid.UUID`, while logging uses
its string form:

- cycle at `0`: attempt fails and returns `retry_in_seconds == 5`;
- cycle at `3`: `skipped == 1`, no poll call, no new warning;
- cycle at `5`: attempt returns `{"updates": 0}` and clears state;
- the following failure returns to 5 seconds, proving zero-update success reset;
- pruning with the UUID keeps current state and removes a stale string state.

- [ ] **Step 6: Run the integration test and verify RED**

Expected: FAIL because cycles currently do not consult backoff.

- [ ] **Step 7: Integrate backoff state transitions**

After discovery, call `retain` with UUIDs. Before opening a user session, skip
IDs whose deadline is not ready. On failure, rollback, call `record_failure`,
and append the safe error payload. On every success, including zero updates,
call `record_success`.

- [ ] **Step 8: Write failing expected-vs-unexpected logging tests**

For a typed `TelegramBotError`, assert one WARNING contains safe user ID and
retry delay, has no traceback frame text, and stores the same bounded safe
error in the summary. For an untyped `RuntimeError` raised inside a real test
function, assert one ERROR includes safe `filename:lineno:function` frames but
no source line or raw secret. Both branches must receive backoff and allow the
next user to run.

- [ ] **Step 9: Implement safe logging branches with retry details**

Expected Telegram errors use `logger.warning` without `exc_info`. Unexpected
errors use the Task 2 frame-only formatter and `logger.error`, never raw
`logger.exception` or `exc_info`. Both log only actual attempts and include the
delay returned by `record_failure`.

- [ ] **Step 10: Run focused tests and verify GREEN**

```bash
/tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_telegram_bot.py -q
```

---

### Task 4: Cover cleared tokens, cancellation, and loop ownership

**Files:**
- Modify: `tests/api/test_telegram_bot.py`
- Modify: `api/telegram_poller.py`

**Interfaces:**
- Preserves: `telegram_polling_loop(session_factory, interval_seconds=3, user_limit=50, update_limit=100) -> None`.
- Changes internally: one `TelegramPollingBackoff` instance is constructed before the infinite loop and passed to every cycle.

- [ ] **Step 1: Write a failing cleared-token race test**

Discovery returns one UUID, but the per-user reload returns `None` to represent
a cleared token. Assert `users == 1`, `skipped == 1`, `polled == 0`, no errors,
no warning, and no poll call. A later first failure for that UUID must still
return 5 seconds, proving no hidden backoff mutation.

- [ ] **Step 2: Write a cancellation characterization/regression test**

The first user's `poll_func` raises `asyncio.CancelledError`; a second user is
available. Assert cancellation propagates, the second user is not started, no
explicit rollback occurs, no log/error is recorded, and a later first failure
for the cancelled UUID still receives 5 seconds. On Python 3.11 this may be
GREEN immediately because `CancelledError` inherits `BaseException`; retain it
as a regression test and still make the production branch explicit.

- [ ] **Step 3: Write a failing cycle-summary invariant test**

Use one success, one expected failure, one backoff skip, and one cleared token.
Assert `users == polled + len(errors) + skipped` with literal expected counts.

- [ ] **Step 4: Run edge-case tests and verify RED**

Expected: failures for missing `skipped` behavior and/or backoff integration.
The cancellation characterization may already pass; verify that it exercises
the real cancellation path rather than requiring an artificial failure.

- [ ] **Step 5: Implement explicit cancellation and skip behavior**

Add `except asyncio.CancelledError: raise` before all polling error branches.
Increment `skipped` for both backoff and missing/cleared-user cases. Keep async
context cleanup responsible for cancellation session close; do not explicitly
rollback cancellation.

- [ ] **Step 6: Write a failing loop ownership test**

Monkeypatch the cycle boundary to record its `backoff` argument and patch
`asyncio.sleep` to allow two cycles then raise `CancelledError`. Assert both
cycles receive the same non-`None` object. The boundary fake is necessary to
test infinite-loop orchestration without PostgreSQL or Telegram.

- [ ] **Step 7: Write a failing worker-level safe diagnostic test**

Make the cycle boundary raise an untyped exception whose message contains a
fake PostgreSQL DSN, password, newline, and oversized text. Let the next sleep
cancel the loop. Assert the ERROR log contains the sanitized bounded message
and frame-only location, but none of the password, DSN credentials, source
line, raw exception traceback, or oversized suffix.

- [ ] **Step 8: Move backoff construction outside the loop and sanitize outer errors**

Create `backoff = TelegramPollingBackoff()` once after normalizing the base
interval, then pass it into each cycle. Keep worker-level discovery/session
factory diagnostics, but replace raw `logger.exception`/`exc_info` with the
same bounded sanitizer and `filename:lineno:function` frame-only formatter used
for unexpected per-user errors.

- [ ] **Step 9: Run the entire Telegram test file and verify GREEN**

```bash
/tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_telegram_bot.py -q
```

---

### Task 5: Verification, review, and delivery

**Files:**
- Verify: `api/telegram_bot.py`
- Verify: `api/telegram_poller.py`
- Verify: `tests/api/test_telegram_bot.py`
- Verify: `.workflow/specs/2026-08-31-telegram-polling-resilience.md`
- Verify: `.workflow/plans/2026-08-31-telegram-polling-resilience.md`

**Interfaces:** No new public HTTP, DB, desktop, or mobile interfaces.

- [ ] **Step 1: Run syntax and diff checks**

```bash
/tmp/snippets-helper-tests-20260831/bin/python -m py_compile \
  api/telegram_bot.py api/telegram_poller.py
git diff --check
```

- [ ] **Step 2: Run the full API test suite**

```bash
/tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api -q
```

Expected: all tests pass; only already-known `datetime.utcnow()` deprecation
warnings may remain.

- [ ] **Step 3: Request independent code review**

Review against the spec with emphasis on honest red-green evidence, rollback
expiry, separate session lifecycle, UUID/string normalization, monotonic
deadlines, typed provider errors, secret-safe logging, unexpected stack-frame
diagnostics, cancellation, cleared-token races, and absence of API/schema
changes. Apply every Critical or Important finding and rerun focused plus full
tests.

- [ ] **Step 4: Inspect the final scoped diff and commit**

```bash
git diff --check
git status --short
git add -- api/telegram_bot.py api/telegram_poller.py \
  tests/api/test_telegram_bot.py \
  .workflow/specs/2026-08-31-telegram-polling-resilience.md \
  .workflow/plans/2026-08-31-telegram-polling-resilience.md
git commit -m "Fix Telegram polling recovery"
```

- [ ] **Step 5: Stop before production deployment**

This is a server-only technical fix. Report the commit and verification
evidence, then request explicit authorization before push/deploy because
automatic desktop release rules do not apply.
