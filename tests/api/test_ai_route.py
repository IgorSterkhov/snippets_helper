import asyncio

from api.routes.ai import build_ai_response
from api.schemas import AiChatRequest, AiCommandCall, AiContext


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
