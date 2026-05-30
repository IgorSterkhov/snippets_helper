import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api import schemas
from api.routes import ai as ai_routes
from api.routes.ai import ai_chat
from api.routes.ai import build_ai_response
from api.schemas import AiChatRequest, AiCommandCall, AiContext


class FakeDb:
    def __init__(self):
        self.commits = 0
        self.refreshes = []

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        self.refreshes.append(obj)


class CountingRepo:
    def __init__(self):
        self.created = 0

    async def search_tasks(self, query, limit=5):
        return []

    async def search_notes(self, query, limit=5):
        return []

    async def search_snippets(self, query, limit=5):
        return []

    async def create_task(self, title):
        self.created += 1
        return {"uuid": "server-task", "title": title}

    async def create_task_checkbox(self, task_uuid, text, parent_uuid=None):
        raise AssertionError("unexpected checkbox write")

    async def complete_task_checkbox(self, task_uuid, checkbox_uuid=None, query=None):
        raise AssertionError("unexpected checkbox write")


def test_client_channel_returns_commands_without_server_write():
    repo = CountingRepo()

    response = asyncio.run(build_ai_response(
        AiChatRequest(channel="client", message="создай задачу", context=AiContext()),
        "Создам задачу.",
        [AiCommandCall(name="create_task", args={"title": "Аптека"})],
        repo,
    ))

    assert repo.created == 0
    assert response.commands[0].name == "create_task"
    assert response.results == []


def test_telegram_channel_executes_server_side():
    repo = CountingRepo()

    response = asyncio.run(build_ai_response(
        AiChatRequest(channel="telegram", message="создай задачу", context=AiContext()),
        "Создам задачу.",
        [AiCommandCall(name="create_task", args={"title": "Аптека"})],
        repo,
    ))

    assert repo.created == 1
    assert response.results[0].status == "executed"
    assert response.results[0].item_uuid == "server-task"


def test_public_ai_route_rejects_telegram_channel_before_provider_call():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(ai_chat(
            AiChatRequest(channel="telegram", message="создай задачу", context=AiContext()),
            user=SimpleNamespace(id="user-1"),
            db=None,
        ))

    assert exc.value.status_code == 400
    assert "client channel" in exc.value.detail


def test_ai_provider_settings_status_never_exposes_secret():
    user = SimpleNamespace(
        id="user-1",
        deepseek_api_key="sk-user-secret",
        deepseek_updated_at=None,
        telegram_bot_token="123456:telegram-secret",
        telegram_bot_updated_at=None,
    )

    response = asyncio.run(ai_routes.get_ai_provider_settings(user=user))

    assert response.deepseek_configured is True
    assert response.deepseek_updated_at is None
    assert response.telegram_bot_configured is True
    assert response.telegram_bot_updated_at is None
    assert not hasattr(response, "deepseek_api_key")
    assert not hasattr(response, "telegram_bot_token")


def test_ai_provider_settings_save_trims_key_and_clear_removes_it():
    user = SimpleNamespace(
        id="user-1",
        deepseek_api_key=None,
        deepseek_updated_at=None,
    )
    db = FakeDb()

    saved = asyncio.run(ai_routes.update_ai_provider_settings(
        schemas.AiProviderSettingsRequest(deepseek_api_key="  sk-user-key  "),
        user=user,
        db=db,
    ))

    assert saved.deepseek_configured is True
    assert user.deepseek_api_key == "sk-user-key"
    assert user.deepseek_updated_at is not None
    assert db.commits == 1

    cleared = asyncio.run(ai_routes.clear_ai_provider_settings(user=user, db=db))

    assert cleared.deepseek_configured is False
    assert user.deepseek_api_key is None
    assert user.deepseek_updated_at is not None
    assert db.commits == 2


def test_ai_provider_settings_save_and_clear_telegram_bot_token():
    user = SimpleNamespace(
        id="user-1",
        deepseek_api_key=None,
        deepseek_updated_at=None,
        telegram_bot_token=None,
        telegram_bot_updated_at=None,
    )
    db = FakeDb()

    saved = asyncio.run(ai_routes.update_ai_telegram_bot_settings(
        schemas.AiTelegramBotSettingsRequest(telegram_bot_token="  123456:telegram-token  "),
        user=user,
        db=db,
    ))

    assert saved.telegram_bot_configured is True
    assert user.telegram_bot_token == "123456:telegram-token"
    assert user.telegram_bot_updated_at is not None
    assert db.commits == 1
    assert not hasattr(saved, "telegram_bot_token")

    cleared = asyncio.run(ai_routes.clear_ai_telegram_bot_settings(user=user, db=db))

    assert cleared.telegram_bot_configured is False
    assert user.telegram_bot_token is None
    assert user.telegram_bot_updated_at is not None
    assert db.commits == 2


def test_ai_provider_balance_uses_current_users_deepseek_key(monkeypatch):
    seen = {}

    class FakeDeepSeekClient:
        def __init__(self, *, api_key=None, **kwargs):
            seen["api_key"] = api_key

        async def balance(self):
            return {
                "is_available": True,
                "balance_infos": [
                    {
                        "currency": "USD",
                        "total_balance": "5.00",
                        "granted_balance": "1.25",
                        "topped_up_balance": "3.75",
                    }
                ],
            }

    monkeypatch.setattr(ai_routes, "DeepSeekClient", FakeDeepSeekClient)

    response = asyncio.run(ai_routes.get_ai_provider_balance(
        user=SimpleNamespace(id="user-1", deepseek_api_key="sk-current-user"),
    ))

    assert seen["api_key"] == "sk-current-user"
    assert response.is_available is True
    assert response.balance_infos[0].currency == "USD"


def test_ai_provider_balance_requires_deepseek_key():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(ai_routes.get_ai_provider_balance(
            user=SimpleNamespace(id="user-1", deepseek_api_key=None),
        ))

    assert exc.value.status_code == 400
    assert "DeepSeek API key" in exc.value.detail


def test_public_ai_route_requires_current_user_deepseek_key_before_provider_call():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(ai_chat(
            AiChatRequest(channel="client", message="найди задачу", context=AiContext()),
            user=SimpleNamespace(id="user-1", deepseek_api_key=None),
            db=None,
        ))

    assert exc.value.status_code == 400
    assert "DeepSeek API key" in exc.value.detail
