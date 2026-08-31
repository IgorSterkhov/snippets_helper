import asyncio
import logging
import uuid
from dataclasses import dataclass

import httpx
import pytest
from sqlalchemy import UniqueConstraint
from sqlalchemy.exc import IntegrityError, MissingGreenlet

from api.telegram_bot import (
    SqlAlchemyTelegramRepository,
    TelegramBotApi,
    TelegramBotError,
    format_telegram_ai_response,
    process_telegram_text_update,
    run_telegram_ai,
    sanitize_telegram_error_text,
)
from api.models import TelegramChatBinding, TelegramProcessedMessage
from api.schemas import AiChatResponse, AiCommandResult


@dataclass
class FakeUser:
    id: str = "user-1"
    deepseek_api_key: str | None = None
    telegram_bot_token: str | None = "123456:telegram-token"


class FakeTelegramRepo:
    def __init__(self, bound_user=None):
        self.bound_user = bound_user
        self.processed = set()
        self.bound_chats = []

    async def get_bound_user(self, chat_id):
        return self.bound_user

    async def try_mark_processed(self, chat_id, message_id, update_id):
        key = (chat_id, message_id)
        if key in self.processed:
            return False
        self.processed.add(key)
        return True

    async def bind_chat(self, chat_id):
        self.bound_chats.append(chat_id)
        self.bound_user = FakeUser()


def update(chat_id=123, message_id=7, update_id=99, text="создай задачу"):
    return {
        "update_id": update_id,
        "message": {
            "message_id": message_id,
            "chat": {"id": chat_id},
            "text": text,
        },
    }


def test_telegram_models_have_auth_and_idempotency_columns():
    binding = TelegramChatBinding.__table__.columns
    processed = TelegramProcessedMessage.__table__.columns

    assert "chat_id" in binding
    assert "user_id" in binding
    assert {column.name for column in TelegramChatBinding.__table__.primary_key.columns} == {
        "chat_id",
        "user_id",
    }
    assert "is_active" in binding
    assert "chat_id" in processed
    assert "user_id" in processed
    assert "message_id" in processed
    assert "update_id" in processed

    unique_constraints = [
        constraint
        for constraint in TelegramProcessedMessage.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    ]
    assert any(
        constraint.name == "uq_telegram_processed_user_chat_message"
        and [column.name for column in constraint.columns] == ["user_id", "chat_id", "message_id"]
        for constraint in unique_constraints
    )


def test_unknown_telegram_chat_is_denied_before_ai_call():
    repo = FakeTelegramRepo(bound_user=None)
    calls = []

    async def ai_runner(user, text):
        calls.append((user, text))
        return "should not be called"

    result = asyncio.run(process_telegram_text_update(update(), repo, ai_runner))

    assert result["status"] == "denied"
    assert calls == []
    assert repo.bound_chats == []


def test_pairing_code_binds_unknown_chat_without_ai_call():
    repo = FakeTelegramRepo(bound_user=None)
    calls = []
    sent = []

    async def ai_runner(user, text):
        calls.append((user, text))
        return "should not be called"

    async def send_message(chat_id, text):
        sent.append((chat_id, text))

    result = asyncio.run(process_telegram_text_update(
        update(chat_id=12345, text="/start pair-abc123"),
        repo,
        ai_runner,
        send_message=send_message,
        pairing_code="pair-abc123",
    ))

    assert result["status"] == "bound"
    assert result["chat_id"] == 12345
    assert repo.bound_chats == [12345]
    assert calls == []
    assert "bound" in sent[0][1].lower()


def test_pairing_code_keeps_binding_when_confirmation_send_fails():
    repo = FakeTelegramRepo(bound_user=None)
    calls = []

    async def ai_runner(user, text):
        calls.append((user, text))
        return "should not be called"

    async def send_message(chat_id, text):
        raise RuntimeError("telegram send timeout")

    result = asyncio.run(process_telegram_text_update(
        update(chat_id=12345, text="/start pair-abc123"),
        repo,
        ai_runner,
        send_message=send_message,
        pairing_code="pair-abc123",
    ))

    assert result["status"] == "bound"
    assert result["chat_id"] == 12345
    assert result["send_status"] == "failed"
    assert repo.bound_chats == [12345]
    assert calls == []


def test_telegram_bot_api_wraps_network_errors_as_typed_safe_error():
    class TimeoutClient:
        async def post(self, *args, **kwargs):
            raise httpx.ConnectTimeout(
                "POST https://api.telegram.org/bot123456789:"
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef/getUpdates connect timed out"
            )

    api = TelegramBotApi(token="123456:telegram-token", http_client=TimeoutClient())

    with pytest.raises(TelegramBotError) as raised:
        asyncio.run(api.get_updates())

    assert "Telegram request failed" in str(raised.value)
    assert "ConnectTimeout" in str(raised.value)
    assert "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef" not in str(raised.value)


class FakeTelegramResponse:
    def __init__(self, *, status_code=200, text="", data=None):
        self.status_code = status_code
        self.text = text
        self.data = data if data is not None else {"ok": True, "result": []}

    def json(self):
        return self.data


@pytest.mark.parametrize(
    "response",
    [
        FakeTelegramResponse(
            status_code=429,
            text="password=rate-limit-secret",
        ),
        FakeTelegramResponse(
            data={"ok": False, "description": "API_KEY=provider-secret"},
        ),
    ],
)
def test_telegram_bot_api_wraps_http_and_provider_errors_as_typed_safe_errors(response):
    class ResponseClient:
        async def post(self, *args, **kwargs):
            return response

    api = TelegramBotApi(token="123456:telegram-token", http_client=ResponseClient())

    with pytest.raises(TelegramBotError) as raised:
        asyncio.run(api.get_updates())

    assert "secret" not in str(raised.value)


def test_telegram_error_sanitizer_removes_credentials_and_bounds_output():
    raw = (
        "POST https://api.telegram.org/bot123456789:"
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef/getUpdates\n"
        "Authorization: Bearer bearer-secret API_KEY=api-secret "
        "postgresql://dbuser:db-secret@db.internal/app password=pwd-secret "
        + "x" * 600
    )

    safe = sanitize_telegram_error_text(raw)

    for secret in (
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        "bearer-secret",
        "api-secret",
        "db-secret",
        "pwd-secret",
    ):
        assert secret not in safe
    assert "\n" not in safe
    assert "dbuser:" not in safe
    assert "[REDACTED]" in safe
    assert len(safe) <= 300


@pytest.mark.parametrize(
    "raw,secret",
    [
        ("passwd=passwd-secret", "passwd-secret"),
        ("pwd=pwd-secret", "pwd-secret"),
        ("api-key: hyphen-secret", "hyphen-secret"),
    ],
)
def test_telegram_error_sanitizer_redacts_credential_aliases(raw, secret):
    safe = sanitize_telegram_error_text(raw)

    assert secret not in safe
    assert "[REDACTED]" in safe


@pytest.mark.parametrize("max_length", [0, -1])
def test_telegram_error_sanitizer_rejects_invalid_max_length(max_length):
    with pytest.raises(ValueError):
        sanitize_telegram_error_text("safe", max_length=max_length)


def test_safe_exception_frames_are_bounded_and_never_render_source_lines():
    from api.telegram_poller import format_safe_exception_frames

    def raise_nested(depth):
        if depth:
            return raise_nested(depth - 1)
        raise RuntimeError("password=source-line-secret")

    try:
        raise_nested(20)
    except RuntimeError as exc:
        frames = format_safe_exception_frames(exc)
    else:
        raise AssertionError("test helper did not raise")

    assert "test_telegram_bot.py:" in frames
    assert ":raise_nested" in frames
    assert "source-line-secret" not in frames
    assert "raise RuntimeError" not in frames
    assert len(frames.split(" | ")) <= 12
    assert len(frames) <= 2000


def test_telegram_polling_backoff_uses_literal_sequence_and_normalizes_uuid_keys():
    from api.telegram_poller import TelegramPollingBackoff

    user_id = uuid.uuid4()
    backoff = TelegramPollingBackoff()

    assert backoff.record_failure(user_id, 0) == 5
    assert backoff.is_ready(str(user_id), 4.9) is False
    assert backoff.is_ready(user_id, 5) is True
    assert [backoff.record_failure(user_id, 5) for _ in range(4)] == [15, 30, 60, 60]

    backoff.record_success(str(user_id))

    assert backoff.record_failure(user_id, 100) == 5


def test_telegram_polling_backoff_retain_normalizes_uuid_keys_and_prunes_stale_state():
    from api.telegram_poller import TelegramPollingBackoff

    retained_id = uuid.uuid4()
    stale_id = uuid.uuid4()
    backoff = TelegramPollingBackoff()
    backoff.record_failure(str(retained_id), 0)
    backoff.record_failure(stale_id, 0)

    backoff.retain({retained_id})

    assert backoff.record_failure(retained_id, 100) == 15
    assert backoff.record_failure(str(stale_id), 100) == 5


@pytest.mark.parametrize(
    "delays",
    [
        (),
        (0,),
        (-1,),
        (True,),
        (float("nan"),),
        (float("inf"),),
    ],
)
def test_telegram_polling_backoff_rejects_invalid_delays(delays):
    from api.telegram_poller import TelegramPollingBackoff

    with pytest.raises(ValueError):
        TelegramPollingBackoff(delays=delays)


def test_telegram_polling_backoff_accepts_positive_integer_and_float_delays():
    from api.telegram_poller import TelegramPollingBackoff

    backoff = TelegramPollingBackoff(delays=(1, 2.5))

    assert backoff.record_failure("user", 0) == 1.0
    assert backoff.record_failure("user", 1) == 2.5


def test_duplicate_telegram_message_does_not_execute_twice():
    repo = FakeTelegramRepo(bound_user=FakeUser())
    calls = []

    async def ai_runner(user, text):
        calls.append((user, text))
        return "ok"

    first = asyncio.run(process_telegram_text_update(update(), repo, ai_runner))
    second = asyncio.run(process_telegram_text_update(update(), repo, ai_runner))

    assert first["status"] == "processed"
    assert second["status"] == "duplicate"
    assert len(calls) == 1


class FakeIntegrityDb:
    def __init__(self):
        self.added = []
        self.rollbacks = 0

    async def execute(self, _stmt):
        return FakeResult(None)

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        raise IntegrityError("insert telegram_processed_messages", {}, RuntimeError("duplicate"))

    async def rollback(self):
        self.rollbacks += 1


def test_sqlalchemy_telegram_repo_treats_processed_insert_race_as_duplicate():
    db = FakeIntegrityDb()
    repo = SqlAlchemyTelegramRepository(db, FakeUser(id="user-race"))

    result = asyncio.run(repo.try_mark_processed(chat_id=123, message_id=7, update_id=99))

    assert result is False
    assert db.rollbacks == 1
    assert len(db.added) == 1


def test_run_telegram_ai_uses_bound_user_deepseek_key(monkeypatch):
    seen = {}

    class FakeDeepSeekClient:
        def __init__(self, *, api_key=None, **kwargs):
            seen["api_key"] = api_key

        async def chat(self, *, messages, tools):
            return "Готово.", []

    monkeypatch.setattr("api.telegram_bot.DeepSeekClient", FakeDeepSeekClient)

    response = asyncio.run(run_telegram_ai(
        db=None,
        user=FakeUser(deepseek_api_key="sk-bound-user"),
        text="покажи задачу Аптека",
    ))

    assert seen["api_key"] == "sk-bound-user"
    assert response.reply == "Готово."


def test_telegram_bot_api_never_falls_back_to_global_config(monkeypatch):
    monkeypatch.setattr("api.config.TELEGRAM_BOT_TOKEN", "global-token-that-must-not-be-used", raising=False)

    api = TelegramBotApi(token=None)

    try:
        _ = api.base_url
    except RuntimeError as exc:
        assert "not configured" in str(exc)
    else:
        raise AssertionError("TelegramBotApi used global TELEGRAM_BOT_TOKEN fallback")


class FakeResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class FakeDb:
    def __init__(self):
        self.statements = []

    async def execute(self, stmt):
        self.statements.append(str(stmt))
        return FakeResult(42)


class FakeBotApi:
    def __init__(self):
        self.offsets = []

    async def get_updates(self, *, offset=None, limit=20):
        self.offsets.append(offset)
        return []


def test_poll_telegram_once_for_user_uses_user_scoped_processed_offset():
    from api.telegram_bot import poll_telegram_once_for_user

    db = FakeDb()
    bot = FakeBotApi()

    result = asyncio.run(poll_telegram_once_for_user(db, FakeUser(id="user-42"), bot_api=bot))

    assert bot.offsets == [43]
    assert result["updates"] == 0
    assert "telegram_processed_messages.user_id" in db.statements[0]


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


class FakePollingSession:
    def __init__(self, result, *, owned_user=None):
        self.result = result
        self.owned_user = owned_user
        self.statements = []
        self.rollbacks = 0
        self.entered = 0
        self.exited = 0

    async def __aenter__(self):
        self.entered += 1
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        self.exited += 1

    async def execute(self, stmt):
        self.statements.append(str(stmt))
        return self.result

    async def rollback(self):
        self.rollbacks += 1
        if self.owned_user is not None:
            self.owned_user.expired = True


class FailingExecutePollingSession(FakePollingSession):
    def __init__(self, exc):
        super().__init__(None)
        self.exc = exc

    async def execute(self, stmt):
        self.statements.append(str(stmt))
        raise self.exc


class FakePollingSessionFactory:
    def __init__(self, sessions):
        self.sessions = sessions
        self.calls = 0

    def __call__(self):
        session = self.sessions[self.calls]
        self.calls += 1
        return session


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


def test_background_poller_never_reads_expired_user_after_rollback():
    from api.telegram_poller import poll_configured_telegram_users

    user_ids = [uuid.uuid4(), uuid.uuid4()]
    bad_user = RollbackSensitiveUser(user_ids[0], "111:token")
    good_user = RollbackSensitiveUser(user_ids[1], "222:token")
    discovery_session = FakePollingSession(FakeScalarListResult(user_ids))
    bad_session = FakePollingSession(FakeScalarOneResult(bad_user), owned_user=bad_user)
    good_session = FakePollingSession(FakeScalarOneResult(good_user), owned_user=good_user)
    session_factory = FakePollingSessionFactory(
        [discovery_session, bad_session, good_session]
    )
    calls = []

    async def fake_poll(db, user, **_kwargs):
        user_id = user.id
        calls.append((db, user_id))
        if user_id == user_ids[0]:
            raise RuntimeError("Telegram timeout")
        return {"updates": 1}

    result = asyncio.run(
        poll_configured_telegram_users(session_factory, poll_func=fake_poll)
    )

    assert calls == [(bad_session, user_ids[0]), (good_session, user_ids[1])]
    assert bad_session is not good_session
    assert bad_session.rollbacks == 1
    assert good_session.rollbacks == 0
    assert bad_user.expired is True
    assert good_user.expired is False
    assert result["polled"] == 1
    assert result["errors"] == [
        {
            "user_id": str(user_ids[0]),
            "error": "RuntimeError: Telegram timeout",
            "retry_in_seconds": 5.0,
        }
    ]


def test_background_telegram_poller_polls_configured_users_with_pairing_enabled():
    from api.telegram_poller import poll_configured_telegram_users

    user_ids = [uuid.uuid4(), uuid.uuid4()]
    users = [
        FakeUser(id=user_ids[0], telegram_bot_token="111:token"),
        FakeUser(id=user_ids[1], telegram_bot_token="222:token"),
    ]
    discovery_session = FakePollingSession(FakeScalarListResult(user_ids))
    user_sessions = [
        FakePollingSession(FakeScalarOneResult(user)) for user in users
    ]
    session_factory = FakePollingSessionFactory([discovery_session, *user_sessions])
    calls = []

    async def fake_poll(db_arg, user, **kwargs):
        calls.append((db_arg, user.id, kwargs))
        return {"updates": 1, "results": [{"status": "processed"}]}

    result = asyncio.run(
        poll_configured_telegram_users(session_factory, poll_func=fake_poll)
    )

    assert result["users"] == 2
    assert result["polled"] == 2
    assert result["updates"] == 2
    assert result["errors"] == []
    assert result["skipped"] == 0
    assert [call[0] for call in calls] == user_sessions
    assert [call[1] for call in calls] == user_ids
    assert all(call[2]["allow_pairing"] is True for call in calls)
    assert all(call[2]["limit"] == 100 for call in calls)


def test_background_telegram_poller_continues_after_user_error():
    from api.telegram_poller import poll_configured_telegram_users

    user_ids = [uuid.uuid4(), uuid.uuid4()]
    users = [
        FakeUser(id=user_ids[0], telegram_bot_token="111:token"),
        FakeUser(id=user_ids[1], telegram_bot_token="222:token"),
    ]
    discovery_session = FakePollingSession(FakeScalarListResult(user_ids))
    user_sessions = [
        FakePollingSession(FakeScalarOneResult(user)) for user in users
    ]
    session_factory = FakePollingSessionFactory([discovery_session, *user_sessions])
    calls = []

    async def fake_poll(_db, user, **_kwargs):
        calls.append(user.id)
        if user.id == user_ids[0]:
            raise RuntimeError("telegram timeout")
        return {"updates": 1, "results": [{"status": "processed"}]}

    result = asyncio.run(
        poll_configured_telegram_users(session_factory, poll_func=fake_poll)
    )

    assert calls == user_ids
    assert user_sessions[0].rollbacks == 1
    assert result["users"] == 2
    assert result["polled"] == 1
    assert result["updates"] == 1
    assert result["skipped"] == 0
    assert result["errors"] == [
        {
            "user_id": str(user_ids[0]),
            "error": "RuntimeError: telegram timeout",
            "retry_in_seconds": 5.0,
        }
    ]


def test_background_telegram_poller_isolates_user_reload_database_error(caplog):
    from api.telegram_poller import poll_configured_telegram_users

    user_ids = [uuid.uuid4(), uuid.uuid4()]
    good_user = FakeUser(id=user_ids[1], telegram_bot_token="222:token")
    failed_session = FailingExecutePollingSession(
        RuntimeError(
            "postgresql://dbuser:reload-secret@db.internal/app "
            "password=reload-password"
        )
    )
    good_session = FakePollingSession(FakeScalarOneResult(good_user))
    session_factory = FakePollingSessionFactory([
        FakePollingSession(FakeScalarListResult(user_ids)),
        failed_session,
        good_session,
    ])
    calls = []

    async def fake_poll(db, user, **_kwargs):
        calls.append((db, user.id))
        return {"updates": 1}

    with caplog.at_level(logging.ERROR, logger="api.telegram_poller"):
        result = asyncio.run(poll_configured_telegram_users(
            session_factory,
            poll_func=fake_poll,
            now_func=lambda: 0,
        ))

    assert calls == [(good_session, user_ids[1])]
    assert failed_session.rollbacks == 1
    assert result["users"] == 2
    assert result["polled"] == 1
    assert result["updates"] == 1
    assert result["skipped"] == 0
    assert result["errors"] == [{
        "user_id": str(user_ids[0]),
        "error": "RuntimeError: postgresql://[REDACTED]@db.internal/app "
        "password=[REDACTED]",
        "retry_in_seconds": 5.0,
    }]
    records = [record for record in caplog.records if record.name == "api.telegram_poller"]
    assert len(records) == 1
    assert records[0].levelno == logging.ERROR
    assert "reload-secret" not in records[0].getMessage()
    assert "reload-password" not in records[0].getMessage()


def test_background_telegram_poller_applies_backoff_and_zero_update_success_resets_it():
    from api.telegram_poller import TelegramPollingBackoff, poll_configured_telegram_users

    user_id = uuid.uuid4()
    user = FakeUser(id=user_id, telegram_bot_token="111:token")
    backoff = TelegramPollingBackoff()
    outcomes = ["fail", "success", "fail"]
    calls = []

    def session_factory(*, include_user=True):
        sessions = [FakePollingSession(FakeScalarListResult([user_id]))]
        if include_user:
            sessions.append(FakePollingSession(FakeScalarOneResult(user)))
        return FakePollingSessionFactory(sessions)

    async def fake_poll(_db, polled_user, **_kwargs):
        calls.append(polled_user.id)
        outcome = outcomes.pop(0)
        if outcome == "fail":
            raise RuntimeError("telegram timeout")
        return {"updates": 0}

    first = asyncio.run(poll_configured_telegram_users(
        session_factory(),
        poll_func=fake_poll,
        backoff=backoff,
        now_func=lambda: 0,
    ))
    skipped = asyncio.run(poll_configured_telegram_users(
        session_factory(include_user=False),
        poll_func=fake_poll,
        backoff=backoff,
        now_func=lambda: 3,
    ))
    success = asyncio.run(poll_configured_telegram_users(
        session_factory(),
        poll_func=fake_poll,
        backoff=backoff,
        now_func=lambda: 5,
    ))
    after_reset = asyncio.run(poll_configured_telegram_users(
        session_factory(),
        poll_func=fake_poll,
        backoff=backoff,
        now_func=lambda: 6,
    ))

    assert calls == [user_id, user_id, user_id]
    assert first["errors"][0]["retry_in_seconds"] == 5
    assert skipped == {
        "users": 1,
        "polled": 0,
        "updates": 0,
        "errors": [],
        "skipped": 1,
    }
    assert success["polled"] == 1
    assert success["updates"] == 0
    assert after_reset["errors"][0]["retry_in_seconds"] == 5


def test_background_telegram_poller_logs_expected_bot_errors_as_compact_warning(caplog):
    from api.telegram_poller import poll_configured_telegram_users

    user_ids = [uuid.uuid4(), uuid.uuid4()]
    users = [
        FakeUser(id=user_ids[0], telegram_bot_token="111:token"),
        FakeUser(id=user_ids[1], telegram_bot_token="222:token"),
    ]
    sessions = [FakePollingSession(FakeScalarListResult(user_ids))]
    sessions.extend(
        FakePollingSession(FakeScalarOneResult(user)) for user in users
    )
    calls = []

    async def fake_poll(_db, user, **_kwargs):
        calls.append(user.id)
        if user.id == user_ids[0]:
            raise TelegramBotError(
                "POST https://api.telegram.org/bot123456789:"
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef/getUpdates timed out"
            )
        return {"updates": 0}

    with caplog.at_level(logging.WARNING, logger="api.telegram_poller"):
        result = asyncio.run(poll_configured_telegram_users(
            FakePollingSessionFactory(sessions),
            poll_func=fake_poll,
            now_func=lambda: 0,
        ))

    records = [record for record in caplog.records if record.name == "api.telegram_poller"]
    assert calls == user_ids
    assert len(records) == 1
    assert records[0].levelno == logging.WARNING
    assert str(user_ids[0]) in records[0].getMessage()
    assert "retry in 5.0s" in records[0].getMessage()
    assert "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef" not in records[0].getMessage()
    assert "test_telegram_bot.py:" not in records[0].getMessage()
    assert "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef" not in result["errors"][0]["error"]


def test_background_telegram_poller_logs_unexpected_errors_with_safe_frames(caplog):
    from api.telegram_poller import poll_configured_telegram_users

    user_ids = [uuid.uuid4(), uuid.uuid4()]
    users = [
        FakeUser(id=user_ids[0], telegram_bot_token="111:token"),
        FakeUser(id=user_ids[1], telegram_bot_token="222:token"),
    ]
    sessions = [FakePollingSession(FakeScalarListResult(user_ids))]
    sessions.extend(
        FakePollingSession(FakeScalarOneResult(user)) for user in users
    )
    calls = []

    async def fake_poll(_db, user, **_kwargs):
        calls.append(user.id)
        if user.id == user_ids[0]:
            raise RuntimeError("password=unexpected-secret")
        return {"updates": 0}

    with caplog.at_level(logging.ERROR, logger="api.telegram_poller"):
        result = asyncio.run(poll_configured_telegram_users(
            FakePollingSessionFactory(sessions),
            poll_func=fake_poll,
            now_func=lambda: 0,
        ))

    records = [record for record in caplog.records if record.name == "api.telegram_poller"]
    assert calls == user_ids
    assert len(records) == 1
    assert records[0].levelno == logging.ERROR
    assert str(user_ids[0]) in records[0].getMessage()
    assert "retry in 5.0s" in records[0].getMessage()
    assert "test_telegram_bot.py:" in records[0].getMessage()
    assert ":fake_poll" in records[0].getMessage()
    assert "unexpected-secret" not in records[0].getMessage()
    assert "raise RuntimeError" not in records[0].getMessage()
    assert "unexpected-secret" not in result["errors"][0]["error"]


def test_background_telegram_poller_treats_token_cleared_after_discovery_as_skip(caplog):
    from api.telegram_poller import TelegramPollingBackoff, poll_configured_telegram_users

    user_id = uuid.uuid4()
    backoff = TelegramPollingBackoff()
    sessions = [
        FakePollingSession(FakeScalarListResult([user_id])),
        FakePollingSession(FakeScalarOneResult(None)),
    ]
    calls = []

    async def fake_poll(*args, **kwargs):
        calls.append((args, kwargs))
        return {"updates": 0}

    with caplog.at_level(logging.WARNING, logger="api.telegram_poller"):
        result = asyncio.run(poll_configured_telegram_users(
            FakePollingSessionFactory(sessions),
            poll_func=fake_poll,
            backoff=backoff,
            now_func=lambda: 0,
        ))

    assert result == {
        "users": 1,
        "polled": 0,
        "updates": 0,
        "errors": [],
        "skipped": 1,
    }
    assert calls == []
    assert [record for record in caplog.records if record.name == "api.telegram_poller"] == []
    assert backoff.record_failure(str(user_id), 10) == 5


def test_background_telegram_poller_propagates_cancellation_without_side_effects(caplog):
    from api.telegram_poller import TelegramPollingBackoff, poll_configured_telegram_users

    user_ids = [uuid.uuid4(), uuid.uuid4()]
    first_user = FakeUser(id=user_ids[0], telegram_bot_token="111:token")
    second_user = FakeUser(id=user_ids[1], telegram_bot_token="222:token")
    first_session = FakePollingSession(FakeScalarOneResult(first_user))
    second_session = FakePollingSession(FakeScalarOneResult(second_user))
    session_factory = FakePollingSessionFactory([
        FakePollingSession(FakeScalarListResult(user_ids)),
        first_session,
        second_session,
    ])
    backoff = TelegramPollingBackoff()
    calls = []

    async def fake_poll(_db, user, **_kwargs):
        calls.append(user.id)
        raise asyncio.CancelledError

    with caplog.at_level(logging.WARNING, logger="api.telegram_poller"):
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(poll_configured_telegram_users(
                session_factory,
                poll_func=fake_poll,
                backoff=backoff,
                now_func=lambda: 0,
            ))

    assert calls == [user_ids[0]]
    assert session_factory.calls == 2
    assert first_session.rollbacks == 0
    assert first_session.exited == 1
    assert second_session.entered == 0
    assert [record for record in caplog.records if record.name == "api.telegram_poller"] == []
    assert backoff.record_failure(user_ids[0], 10) == 5


def test_background_telegram_poller_summary_accounts_for_every_discovered_user():
    from api.telegram_poller import TelegramPollingBackoff, poll_configured_telegram_users

    user_ids = [uuid.uuid4() for _ in range(4)]
    success_user = FakeUser(id=user_ids[0], telegram_bot_token="111:token")
    failed_user = FakeUser(id=user_ids[1], telegram_bot_token="222:token")
    backoff = TelegramPollingBackoff()
    backoff.record_failure(user_ids[2], 0)
    sessions = [
        FakePollingSession(FakeScalarListResult(user_ids)),
        FakePollingSession(FakeScalarOneResult(success_user)),
        FakePollingSession(FakeScalarOneResult(failed_user)),
        FakePollingSession(FakeScalarOneResult(None)),
    ]

    async def fake_poll(_db, user, **_kwargs):
        if user.id == user_ids[1]:
            raise TelegramBotError("provider timeout")
        return {"updates": 2}

    result = asyncio.run(poll_configured_telegram_users(
        FakePollingSessionFactory(sessions),
        poll_func=fake_poll,
        backoff=backoff,
        now_func=lambda: 1,
    ))

    assert result["users"] == 4
    assert result["polled"] == 1
    assert result["updates"] == 2
    assert len(result["errors"]) == 1
    assert result["skipped"] == 2
    assert result["users"] == result["polled"] + len(result["errors"]) + result["skipped"]


def test_telegram_polling_loop_reuses_one_backoff_across_cycles(monkeypatch):
    import api.telegram_poller as telegram_poller

    seen_backoffs = []
    sleep_calls = 0

    async def fake_poll_cycle(_session_factory, **kwargs):
        seen_backoffs.append(kwargs.get("backoff"))
        return {"users": 0, "polled": 0, "updates": 0, "errors": [], "skipped": 0}

    async def fake_sleep(_interval):
        nonlocal sleep_calls
        sleep_calls += 1
        if sleep_calls == 2:
            raise asyncio.CancelledError

    monkeypatch.setattr(telegram_poller, "poll_configured_telegram_users", fake_poll_cycle)
    monkeypatch.setattr(telegram_poller.asyncio, "sleep", fake_sleep)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(telegram_poller.telegram_polling_loop(lambda: None))

    assert len(seen_backoffs) == 2
    assert seen_backoffs[0] is not None
    assert seen_backoffs[0] is seen_backoffs[1]


def test_telegram_polling_loop_sanitizes_worker_level_failures(monkeypatch, caplog):
    import api.telegram_poller as telegram_poller

    async def failing_poll_cycle(_session_factory, **_kwargs):
        raise RuntimeError(
            "postgresql://dbuser:worker-secret@db.internal/app\n"
            "password=worker-password "
            + "oversized-suffix-" * 100
            + "terminal-truncation-marker"
        )

    async def cancel_sleep(_interval):
        raise asyncio.CancelledError

    monkeypatch.setattr(telegram_poller, "poll_configured_telegram_users", failing_poll_cycle)
    monkeypatch.setattr(telegram_poller.asyncio, "sleep", cancel_sleep)

    with caplog.at_level(logging.ERROR, logger="api.telegram_poller"):
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(telegram_poller.telegram_polling_loop(lambda: None))

    records = [record for record in caplog.records if record.name == "api.telegram_poller"]
    assert len(records) == 1
    message = records[0].getMessage()
    assert records[0].levelno == logging.ERROR
    assert records[0].exc_info is None
    assert "test_telegram_bot.py:" in message
    assert ":failing_poll_cycle" in message
    assert "worker-secret" not in message
    assert "worker-password" not in message
    assert "dbuser:" not in message
    assert "raise RuntimeError" not in message
    assert "terminal-truncation-marker" not in message
    assert len(message) <= 700


class FakeInsertDb:
    def __init__(self):
        self.statements = []
        self.added = []

    async def execute(self, stmt):
        self.statements.append(str(stmt))
        return FakeResult(None)

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        pass


def test_try_mark_processed_is_scoped_by_owner_user():
    user_id = uuid.uuid4()
    db = FakeInsertDb()
    repo = SqlAlchemyTelegramRepository(db, FakeUser(id=user_id))

    inserted = asyncio.run(repo.try_mark_processed(chat_id=123, message_id=7, update_id=99))

    assert inserted is True
    assert "telegram_processed_messages.user_id" in db.statements[0]
    assert db.added[0].user_id == user_id


def test_telegram_response_renders_show_task_details_as_message_body():
    response = AiChatResponse(
        mode="command",
        reply="Вот задача.",
        commands=[],
        results=[
            AiCommandResult(
                name="show_task",
                args={"query": "Аптека"},
                status="executed",
                message="Task: Аптека\nStatus: Open\n- [ ] Купить аспирин",
                item_type="task",
                item_uuid="task-apteka",
            )
        ],
    )

    text = format_telegram_ai_response(response)

    assert text.startswith("Вот задача.")
    assert "Task: Аптека" in text
    assert "- [ ] Купить аспирин" in text


def test_telegram_response_renders_search_choices_as_lists():
    response = AiChatResponse(
        mode="command",
        reply='Давай найдём заметки и сниппеты по запросу "kylin".',
        commands=[],
        results=[
            AiCommandResult(
                name="search_notes",
                args={"query": "kylin"},
                status="executed",
                message="Found 1 note(s).",
                item_type="note",
                choices=[{"uuid": "note-1", "label": "Kylin deployment notes"}],
            ),
            AiCommandResult(
                name="search_snippets",
                args={"query": "kylin"},
                status="executed",
                message="Found 2 snippet(s).",
                item_type="snippet",
                choices=[
                    {"uuid": "snippet-1", "label": "kylin_start"},
                    {"uuid": "snippet-2", "label": "kylin_restart"},
                ],
            ),
        ],
    )

    text = format_telegram_ai_response(response)

    assert "Notes:" in text
    assert "1. Kylin deployment notes" in text
    assert "Snippets:" in text
    assert "1. kylin_start" in text
    assert "2. kylin_restart" in text
