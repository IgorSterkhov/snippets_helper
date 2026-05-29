import asyncio
from dataclasses import dataclass

from api.telegram_bot import process_telegram_text_update
from api.models import TelegramChatBinding, TelegramProcessedMessage


@dataclass
class FakeUser:
    id: str = "user-1"


class FakeTelegramRepo:
    def __init__(self, bound_user=None):
        self.bound_user = bound_user
        self.processed = set()

    async def get_bound_user(self, chat_id):
        return self.bound_user

    async def try_mark_processed(self, chat_id, message_id, update_id):
        key = (chat_id, message_id)
        if key in self.processed:
            return False
        self.processed.add(key)
        return True


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
    assert "is_active" in binding
    assert "chat_id" in processed
    assert "message_id" in processed
    assert "update_id" in processed


def test_unknown_telegram_chat_is_denied_before_ai_call():
    repo = FakeTelegramRepo(bound_user=None)
    calls = []

    async def ai_runner(user, text):
        calls.append((user, text))
        return "should not be called"

    result = asyncio.run(process_telegram_text_update(update(), repo, ai_runner))

    assert result["status"] == "denied"
    assert calls == []


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
