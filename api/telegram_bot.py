from __future__ import annotations

from typing import Any, Awaitable, Callable, Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import TelegramChatBinding, TelegramProcessedMessage, User


class TelegramRepository(Protocol):
    async def get_bound_user(self, chat_id: int) -> Any | None:
        ...

    async def try_mark_processed(self, chat_id: int, message_id: int, update_id: int | None) -> bool:
        ...


class SqlAlchemyTelegramRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_bound_user(self, chat_id: int) -> User | None:
        stmt = (
            select(User)
            .join(TelegramChatBinding, TelegramChatBinding.user_id == User.id)
            .where(
                TelegramChatBinding.chat_id == chat_id,
                TelegramChatBinding.is_active.is_(True),
            )
            .limit(1)
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def try_mark_processed(self, chat_id: int, message_id: int, update_id: int | None) -> bool:
        exists = await self.db.execute(
            select(TelegramProcessedMessage.id).where(
                TelegramProcessedMessage.chat_id == chat_id,
                TelegramProcessedMessage.message_id == message_id,
            )
        )
        if exists.scalar_one_or_none() is not None:
            return False
        self.db.add(TelegramProcessedMessage(
            chat_id=chat_id,
            message_id=message_id,
            update_id=update_id,
        ))
        await self.db.flush()
        return True


AiRunner = Callable[[Any, str], Awaitable[Any]]
SendMessage = Callable[[int, str], Awaitable[Any]]


def telegram_message_fields(update: dict[str, Any]) -> tuple[int | None, int | None, int | None, str | None]:
    message = update.get("message") or update.get("edited_message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    message_id = message.get("message_id")
    update_id = update.get("update_id")
    text = message.get("text")
    return chat_id, message_id, update_id, text


async def process_telegram_text_update(
    update: dict[str, Any],
    repo: TelegramRepository,
    ai_runner: AiRunner,
    send_message: SendMessage | None = None,
) -> dict[str, Any]:
    chat_id, message_id, update_id, text = telegram_message_fields(update)
    if chat_id is None or message_id is None or not text:
        return {"status": "ignored", "reason": "no text message"}

    if not await repo.try_mark_processed(int(chat_id), int(message_id), update_id):
        return {"status": "duplicate", "chat_id": int(chat_id), "message_id": int(message_id)}

    user = await repo.get_bound_user(int(chat_id))
    if user is None:
        if send_message is not None:
            await send_message(int(chat_id), "Telegram chat is not authorized for this app account.")
        return {"status": "denied", "chat_id": int(chat_id)}

    response = await ai_runner(user, text)
    if send_message is not None:
        await send_message(int(chat_id), format_telegram_ai_response(response))
    return {"status": "processed", "chat_id": int(chat_id), "response": response}


def format_telegram_ai_response(response: Any) -> str:
    reply = getattr(response, "reply", None)
    if isinstance(response, dict):
        reply = response.get("reply", reply)
        results = response.get("results") or []
    else:
        results = getattr(response, "results", []) or []

    lines = [str(reply or "Done.")]
    for item in results:
        if isinstance(item, dict):
            name = item.get("name") or "command"
            status = item.get("status") or ""
            message = item.get("message") or ""
        else:
            name = getattr(item, "name", "command")
            status = getattr(item, "status", "")
            message = getattr(item, "message", "")
        lines.append(f"{name}: {status} {message}".strip())
    return "\n".join(lines)
