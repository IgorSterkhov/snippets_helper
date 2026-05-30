import asyncio
import uuid
from dataclasses import dataclass

from sqlalchemy import UniqueConstraint

from api.telegram_bot import (
    SqlAlchemyTelegramRepository,
    TelegramBotApi,
    process_telegram_text_update,
    run_telegram_ai,
)
from api.models import TelegramChatBinding, TelegramProcessedMessage


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
