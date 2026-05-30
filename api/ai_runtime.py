from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import Note, Shortcut, Task, TaskCheckbox, User
from api.schemas import AiCommandCall, AiCommandResult, AiContext


class AiRepository(Protocol):
    async def search_tasks(self, query: str, limit: int = 5) -> list[dict[str, Any]]: ...
    async def search_notes(self, query: str, limit: int = 5) -> list[dict[str, Any]]: ...
    async def search_snippets(self, query: str, limit: int = 5) -> list[dict[str, Any]]: ...
    async def create_task(self, title: str) -> dict[str, Any]: ...
    async def create_task_checkbox(self, task_uuid: str, text: str, parent_uuid: str | None = None) -> dict[str, Any]: ...
    async def complete_task_checkbox(
        self,
        task_uuid: str,
        checkbox_uuid: str | None = None,
        query: str | None = None,
    ) -> dict[str, Any]: ...


class SqlAlchemyAiRepository:
    def __init__(self, db: AsyncSession, user: User):
        self.db = db
        self.user = user

    async def search_tasks(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        stmt = (
            select(Task)
            .where(
                Task.user_id == self.user.id,
                Task.is_deleted == False,  # noqa: E712
                Task.title.ilike(f"%{query}%"),
            )
            .order_by(Task.updated_at.desc())
            .limit(limit)
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return [{"uuid": str(row.uuid), "title": row.title} for row in rows]

    async def search_notes(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        pattern = f"%{query}%"
        stmt = (
            select(Note)
            .where(
                Note.user_id == self.user.id,
                Note.is_deleted == False,  # noqa: E712
                or_(Note.title.ilike(pattern), Note.content.ilike(pattern)),
            )
            .order_by(Note.updated_at.desc())
            .limit(limit)
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return [{"uuid": str(row.uuid), "title": row.title} for row in rows]

    async def search_snippets(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        pattern = f"%{query}%"
        stmt = (
            select(Shortcut)
            .where(
                Shortcut.user_id == self.user.id,
                Shortcut.is_deleted == False,  # noqa: E712
                or_(
                    Shortcut.name.ilike(pattern),
                    Shortcut.value.ilike(pattern),
                    Shortcut.description.ilike(pattern),
                ),
            )
            .order_by(Shortcut.updated_at.desc())
            .limit(limit)
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return [{"uuid": str(row.uuid), "name": row.name} for row in rows]

    async def create_task(self, title: str) -> dict[str, Any]:
        now = datetime.utcnow()
        max_order_stmt = select(func.coalesce(func.max(Task.sort_order), -1)).where(
            Task.user_id == self.user.id,
            Task.is_deleted == False,  # noqa: E712
        )
        sort_order = int((await self.db.execute(max_order_stmt)).scalar_one() or -1) + 1
        row = Task(
            uuid=uuid.uuid4(),
            user_id=self.user.id,
            title=title,
            category_id=None,
            category_uuid=None,
            status_id=None,
            status_uuid=None,
            is_pinned=0,
            bg_color=None,
            tracker_url=None,
            notes_md="",
            sort_order=sort_order,
            created_at=now,
            updated_at=now,
            is_deleted=False,
        )
        self.db.add(row)
        await self.db.flush()
        return {"uuid": str(row.uuid), "title": row.title}

    async def create_task_checkbox(self, task_uuid: str, text: str, parent_uuid: str | None = None) -> dict[str, Any]:
        now = datetime.utcnow()
        task_id = uuid.UUID(task_uuid)
        parent_id = uuid.UUID(parent_uuid) if parent_uuid else None
        max_order_stmt = select(func.coalesce(func.max(TaskCheckbox.sort_order), -1)).where(
            TaskCheckbox.user_id == self.user.id,
            TaskCheckbox.task_uuid == task_id,
            TaskCheckbox.parent_uuid == parent_id,
            TaskCheckbox.is_deleted == False,  # noqa: E712
        )
        sort_order = int((await self.db.execute(max_order_stmt)).scalar_one() or -1) + 1
        row = TaskCheckbox(
            uuid=uuid.uuid4(),
            user_id=self.user.id,
            task_id=None,
            task_uuid=task_id,
            parent_id=None,
            parent_uuid=parent_id,
            text=text,
            is_checked=0,
            sort_order=sort_order,
            created_at=now,
            updated_at=now,
            is_deleted=False,
        )
        self.db.add(row)
        await self.db.flush()
        return {
            "uuid": str(row.uuid),
            "task_uuid": str(row.task_uuid),
            "parent_uuid": str(row.parent_uuid) if row.parent_uuid else None,
            "text": row.text,
        }

    async def complete_task_checkbox(
        self,
        task_uuid: str,
        checkbox_uuid: str | None = None,
        query: str | None = None,
    ) -> dict[str, Any]:
        task_id = uuid.UUID(task_uuid)
        stmt = select(TaskCheckbox).where(
            TaskCheckbox.user_id == self.user.id,
            TaskCheckbox.task_uuid == task_id,
            TaskCheckbox.is_deleted == False,  # noqa: E712
        )
        if checkbox_uuid:
            stmt = stmt.where(TaskCheckbox.uuid == uuid.UUID(checkbox_uuid))
        elif query:
            stmt = stmt.where(TaskCheckbox.text.ilike(f"%{query}%")).order_by(TaskCheckbox.sort_order).limit(2)
        else:
            raise ValueError("Missing checkbox target")

        rows = (await self.db.execute(stmt)).scalars().all()
        if not rows:
            raise ValueError("Checkbox not found")
        if len(rows) > 1:
            raise ValueError("Multiple checkboxes match")

        row = rows[0]
        row.is_checked = 1
        row.updated_at = datetime.utcnow()
        await self.db.flush()
        return {"uuid": str(row.uuid), "task_uuid": str(row.task_uuid), "text": row.text, "is_checked": row.is_checked}


def _choice(row: dict[str, Any], label_key: str) -> dict[str, str]:
    return {
        "uuid": str(row.get("uuid") or ""),
        "label": str(row.get(label_key) or row.get("title") or row.get("name") or ""),
    }


def _result(
    command: AiCommandCall,
    status: str,
    message: str,
    *,
    item_type: str | None = None,
    item_uuid: str | None = None,
    choices: list[dict] | None = None,
) -> AiCommandResult:
    return AiCommandResult(
        name=command.name,
        args=command.args,
        status=status,
        message=message,
        item_type=item_type,
        item_uuid=item_uuid,
        choices=choices or [],
    )


async def _resolve_task_uuid(repo: AiRepository, command: AiCommandCall, context: AiContext) -> tuple[str | None, AiCommandResult | None]:
    args = command.args
    task_uuid = args.get("task_uuid")
    if task_uuid:
        return str(task_uuid), None
    if args.get("task_ref") == "current":
        ctx_uuid = context.current_task_uuid or context.recent_task_uuid
        if ctx_uuid:
            return ctx_uuid, None
        return None, _result(command, "failed", "Missing current task target.")

    query = args.get("task_query") or args.get("title") or args.get("query")
    if not query:
        return None, _result(command, "failed", "Missing task target.")

    candidates = await repo.search_tasks(str(query), limit=5)
    if not candidates:
        return None, _result(command, "failed", f"Task not found: {query}")
    if len(candidates) > 1:
        return None, _result(
            command,
            "needs_clarification",
            f"Multiple tasks match: {query}",
            choices=[_choice(row, "title") for row in candidates],
        )
    return str(candidates[0]["uuid"]), None


async def _open_by_search(repo_method, command: AiCommandCall, uuid_arg: str, item_type: str, label_key: str) -> AiCommandResult:
    direct_uuid = command.args.get(uuid_arg)
    if direct_uuid:
        return _result(command, "executed", f"Open {item_type}.", item_type=item_type, item_uuid=str(direct_uuid))

    query = command.args.get("query")
    if not query:
        return _result(command, "failed", f"Missing {item_type} target.")

    candidates = await repo_method(str(query), limit=5)
    if not candidates:
        return _result(command, "failed", f"{item_type.title()} not found: {query}")
    if len(candidates) > 1:
        return _result(
            command,
            "needs_clarification",
            f"Multiple {item_type}s match: {query}",
            choices=[_choice(row, label_key) for row in candidates],
        )
    row = candidates[0]
    return _result(
        command,
        "executed",
        f"Open {item_type}: {row.get(label_key) or row.get('title') or row.get('name')}",
        item_type=item_type,
        item_uuid=str(row["uuid"]),
    )


async def execute_command(repo: AiRepository, command: AiCommandCall, context: AiContext) -> AiCommandResult:
    if command.name == "search_tasks":
        query = str(command.args.get("query") or "")
        rows = await repo.search_tasks(query, limit=5)
        return _result(
            command,
            "executed",
            f"Found {len(rows)} task(s).",
            item_type="task",
            choices=[_choice(row, "title") for row in rows],
        )

    if command.name == "open_task":
        return await _open_by_search(repo.search_tasks, command, "task_uuid", "task", "title")

    if command.name == "add_task_checkbox":
        text = str(command.args.get("text") or "").strip()
        if not text:
            return _result(command, "failed", "Missing checkbox text.")
        task_uuid, error = await _resolve_task_uuid(repo, command, context)
        if error:
            return error
        checkbox = await repo.create_task_checkbox(task_uuid, text)
        return _result(
            command,
            "executed",
            f"Added checkbox: {text}",
            item_type="task_checkbox",
            item_uuid=str(checkbox["uuid"]),
        )

    if command.name == "complete_task_checkbox":
        task_uuid, error = await _resolve_task_uuid(repo, command, context)
        if error:
            return error
        checkbox_query = command.args.get("checkbox_query") or command.args.get("text") or command.args.get("query")
        checkbox = await repo.complete_task_checkbox(
            task_uuid,
            checkbox_uuid=command.args.get("checkbox_uuid"),
            query=checkbox_query,
        )
        return _result(
            command,
            "executed",
            "Marked checkbox completed.",
            item_type="task_checkbox",
            item_uuid=str(checkbox["uuid"]),
        )

    if command.name == "create_task":
        title = str(command.args.get("title") or "").strip()
        if not title:
            return _result(command, "failed", "Missing task title.")
        task = await repo.create_task(title)
        task_uuid = str(task["uuid"])
        for text in command.args.get("checkboxes") or []:
            clean = str(text).strip()
            if clean:
                await repo.create_task_checkbox(task_uuid, clean)
        return _result(
            command,
            "executed",
            f"Created task: {title}",
            item_type="task",
            item_uuid=task_uuid,
        )

    if command.name == "search_notes":
        query = str(command.args.get("query") or "")
        rows = await repo.search_notes(query, limit=5)
        return _result(command, "executed", f"Found {len(rows)} note(s).", item_type="note", choices=[_choice(row, "title") for row in rows])

    if command.name == "open_note":
        return await _open_by_search(repo.search_notes, command, "note_uuid", "note", "title")

    if command.name == "search_snippets":
        query = str(command.args.get("query") or "")
        rows = await repo.search_snippets(query, limit=5)
        return _result(command, "executed", f"Found {len(rows)} snippet(s).", item_type="snippet", choices=[_choice(row, "name") for row in rows])

    if command.name == "open_snippet":
        return await _open_by_search(repo.search_snippets, command, "snippet_uuid", "snippet", "name")

    return _result(command, "failed", f"Unsupported command: {command.name}")
