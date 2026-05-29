from __future__ import annotations

from typing import Any, Awaitable, Callable, Protocol

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import config
from api.ai_commands import deepseek_tools
from api.ai_prompt import build_messages
from api.ai_runtime import SqlAlchemyAiRepository
from api.deepseek_client import DeepSeekClient
from api.models import TelegramChatBinding, TelegramProcessedMessage, User
from api.routes.ai import build_ai_response
from api.schemas import AiChatRequest, AiContext


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


class TelegramBotApi:
    def __init__(
        self,
        token: str | None = None,
        *,
        http_client: httpx.AsyncClient | None = None,
        timeout: float = 30,
    ):
        self.token = token if token is not None else config.TELEGRAM_BOT_TOKEN
        self.http_client = http_client
        self.timeout = timeout

    @property
    def base_url(self) -> str:
        if not self.token:
            raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")
        return f"https://api.telegram.org/bot{self.token}"

    async def get_updates(self, offset: int | None = None, limit: int = 20) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "timeout": 0,
            "limit": limit,
            "allowed_updates": ["message", "edited_message"],
        }
        if offset is not None:
            params["offset"] = offset
        data = await self._request("getUpdates", params)
        return data.get("result") or []

    async def send_message(self, chat_id: int, text: str) -> Any:
        return await self._request("sendMessage", {
            "chat_id": chat_id,
            "text": text[:3900],
        })

    async def _request(self, method: str, payload: dict[str, Any]) -> dict[str, Any]:
        if self.http_client is not None:
            response = await self.http_client.post(
                f"{self.base_url}/{method}",
                json=payload,
                timeout=self.timeout,
            )
        else:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/{method}",
                    json=payload,
                    timeout=self.timeout,
                )
        if response.status_code >= 400:
            raise RuntimeError(f"Telegram HTTP {response.status_code}: {response.text[:500]}")
        data = response.json()
        if not data.get("ok", False):
            raise RuntimeError(f"Telegram API error: {data}")
        return data


def telegram_message_fields(update: dict[str, Any]) -> tuple[int | None, int | None, int | None, str | None]:
    message = update.get("message") or update.get("edited_message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    message_id = message.get("message_id")
    update_id = update.get("update_id")
    text = message.get("text")
    return chat_id, message_id, update_id, text


async def run_telegram_ai(db: AsyncSession, user: User, text: str):
    req = AiChatRequest(
        mode="command",
        channel="telegram",
        message=text,
        context=AiContext(module="telegram", locale="ru"),
    )
    reply, commands = await DeepSeekClient().chat(
        messages=build_messages(req.message, req.context),
        tools=deepseek_tools(),
    )
    return await build_ai_response(req, reply, commands, SqlAlchemyAiRepository(db, user))


async def process_telegram_update_with_db(
    update: dict[str, Any],
    db: AsyncSession,
    bot_api: TelegramBotApi,
) -> dict[str, Any]:
    repo = SqlAlchemyTelegramRepository(db)

    async def ai_runner(user: User, text: str):
        return await run_telegram_ai(db, user, text)

    async def send_message(chat_id: int, text: str):
        return await bot_api.send_message(chat_id, text)

    try:
        result = await process_telegram_text_update(update, repo, ai_runner, send_message)
        await db.commit()
        return result
    except Exception:
        await db.rollback()
        raise


async def poll_telegram_once(
    db: AsyncSession,
    *,
    bot_api: TelegramBotApi | None = None,
    offset: int | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    api = bot_api or TelegramBotApi()
    if offset is None:
        latest = await db.execute(select(func.max(TelegramProcessedMessage.update_id)))
        latest_update_id = latest.scalar_one_or_none()
        if latest_update_id is not None:
            offset = int(latest_update_id) + 1
    updates = await api.get_updates(offset=offset, limit=limit)
    results = []
    next_offset = offset
    for update in updates:
        update_id = update.get("update_id")
        if update_id is not None:
            next_offset = max(next_offset or 0, int(update_id) + 1)
        results.append(await process_telegram_update_with_db(update, db, api))
    return {
        "updates": len(updates),
        "next_offset": next_offset,
        "results": results,
    }


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
