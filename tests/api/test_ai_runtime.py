import asyncio

from api.ai_runtime import execute_command
from api.schemas import AiCommandCall, AiContext


class FakeAiRepo:
    def __init__(self):
        self.tasks = []
        self.notes = []
        self.snippets = []
        self.created_tasks = []
        self.created_checkboxes = []
        self.completed_checkboxes = []

    async def search_tasks(self, query, limit=5):
        return [t for t in self.tasks if query.lower() in t["title"].lower()][:limit]

    async def search_notes(self, query, limit=5):
        return [n for n in self.notes if query.lower() in n["title"].lower()][:limit]

    async def search_snippets(self, query, limit=5):
        return [s for s in self.snippets if query.lower() in s["name"].lower()][:limit]

    async def create_task(self, title):
        task = {"uuid": f"task-{len(self.created_tasks) + 1}", "title": title}
        self.created_tasks.append(task)
        return task

    async def create_task_checkbox(self, task_uuid, text, parent_uuid=None):
        checkbox = {
            "uuid": f"checkbox-{len(self.created_checkboxes) + 1}",
            "task_uuid": task_uuid,
            "parent_uuid": parent_uuid,
            "text": text,
        }
        self.created_checkboxes.append(checkbox)
        return checkbox

    async def complete_task_checkbox(self, task_uuid, checkbox_uuid=None, query=None):
        checkbox = {
            "uuid": checkbox_uuid or "matched-checkbox",
            "task_uuid": task_uuid,
            "text": query or "",
            "is_checked": 1,
        }
        self.completed_checkboxes.append(checkbox)
        return checkbox


def run(coro):
    return asyncio.run(coro)


def test_open_task_ambiguous_result_needs_clarification():
    repo = FakeAiRepo()
    repo.tasks = [
        {"uuid": "task-1", "title": "Аптека"},
        {"uuid": "task-2", "title": "Аптека дом"},
    ]

    result = run(execute_command(
        repo,
        AiCommandCall(name="open_task", args={"query": "Аптека"}),
        AiContext(),
    ))

    assert result.status == "needs_clarification"
    assert result.item_uuid is None
    assert [c["uuid"] for c in result.choices] == ["task-1", "task-2"]
    assert repo.created_checkboxes == []


def test_create_task_with_checkboxes_uses_task_uuid_relation():
    repo = FakeAiRepo()

    result = run(execute_command(
        repo,
        AiCommandCall(
            name="create_task",
            args={"title": "Аптека", "checkboxes": ["купить аспирин", "проверить рецепт"]},
        ),
        AiContext(),
    ))

    assert result.status == "executed"
    assert result.item_type == "task"
    assert result.item_uuid == "task-1"
    assert repo.created_tasks == [{"uuid": "task-1", "title": "Аптека"}]
    assert repo.created_checkboxes == [
        {
            "uuid": "checkbox-1",
            "task_uuid": "task-1",
            "parent_uuid": None,
            "text": "купить аспирин",
        },
        {
            "uuid": "checkbox-2",
            "task_uuid": "task-1",
            "parent_uuid": None,
            "text": "проверить рецепт",
        },
    ]


def test_add_task_checkbox_resolves_current_task_from_context():
    repo = FakeAiRepo()

    result = run(execute_command(
        repo,
        AiCommandCall(
            name="add_task_checkbox",
            args={"task_ref": "current", "text": "купить аспирин"},
        ),
        AiContext(current_task_uuid="task-current"),
    ))

    assert result.status == "executed"
    assert result.item_type == "task_checkbox"
    assert repo.created_checkboxes[0]["task_uuid"] == "task-current"
    assert repo.created_checkboxes[0]["text"] == "купить аспирин"


def test_add_task_checkbox_without_target_fails_without_mutation():
    repo = FakeAiRepo()

    result = run(execute_command(
        repo,
        AiCommandCall(
            name="add_task_checkbox",
            args={"task_ref": "current", "text": "купить аспирин"},
        ),
        AiContext(),
    ))

    assert result.status == "failed"
    assert "task target" in result.message
    assert repo.created_checkboxes == []
