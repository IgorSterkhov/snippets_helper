from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any, Awaitable, Callable, Protocol

import httpx
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.ai_commands import deepseek_tools
from api.ai_runtime import SqlAlchemyAiRepository
from api.deepseek_client import DeepSeekClient
from api.models import TelegramChatBinding, TelegramProcessedMessage, User
from api.routes.ai import build_ai_response, build_messages_for_user, user_deepseek_api_key, user_telegram_bot_token
from api.schemas import AiChatRequest, AiContext


class TelegramRepository(Protocol):
    async def get_bound_user(self, chat_id: int) -> Any | None:
        ...

    async def try_mark_processed(self, chat_id: int, message_id: int, update_id: int | None) -> bool:
        ...

    async def bind_chat(self, chat_id: int) -> None:
        ...


class SqlAlchemyTelegramRepository:
    def __init__(self, db: AsyncSession, owner_user: User | None = None):
        self.db = db
        self.owner_user = owner_user

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
        if self.owner_user is not None:
            stmt = stmt.where(User.id == self.owner_user.id)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def try_mark_processed(self, chat_id: int, message_id: int, update_id: int | None) -> bool:
        owner_user_id = getattr(self.owner_user, "id", None)
        stmt = select(TelegramProcessedMessage.id).where(
            TelegramProcessedMessage.chat_id == chat_id,
            TelegramProcessedMessage.message_id == message_id,
        )
        if owner_user_id is None:
            stmt = stmt.where(TelegramProcessedMessage.user_id.is_(None))
        else:
            stmt = stmt.where(TelegramProcessedMessage.user_id == owner_user_id)
        exists = await self.db.execute(stmt)
        if exists.scalar_one_or_none() is not None:
            return False
        self.db.add(TelegramProcessedMessage(
            user_id=owner_user_id,
            chat_id=chat_id,
            message_id=message_id,
            update_id=update_id,
        ))
        try:
            await self.db.flush()
        except IntegrityError:
            await self.db.rollback()
            return False
        return True

    async def bind_chat(self, chat_id: int) -> None:
        if self.owner_user is None:
            raise RuntimeError("telegram chat binding requires an owner user")
        stmt = select(TelegramChatBinding).where(
            TelegramChatBinding.user_id == self.owner_user.id,
            TelegramChatBinding.chat_id == chat_id,
        )
        binding = (await self.db.execute(stmt)).scalar_one_or_none()
        now = datetime.utcnow()
        if binding is None:
            binding = TelegramChatBinding(
                chat_id=chat_id,
                user_id=self.owner_user.id,
                is_active=True,
                updated_at=now,
            )
            self.db.add(binding)
        else:
            binding.is_active = True
            binding.updated_at = now
        await self.db.flush()


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
        self.token = token or ""
        self.http_client = http_client
        self.timeout = timeout

    @property
    def base_url(self) -> str:
        if not self.token:
            raise RuntimeError("Telegram bot token is not configured")
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
        timeout = httpx.Timeout(self.timeout, connect=min(8.0, self.timeout))
        if self.http_client is not None:
            try:
                response = await self.http_client.post(
                    f"{self.base_url}/{method}",
                    json=payload,
                    timeout=timeout,
                )
            except httpx.RequestError as exc:
                raise RuntimeError(
                    f"Telegram request failed ({type(exc).__name__}): {exc}"
                ) from exc
        else:
            async with httpx.AsyncClient() as client:
                try:
                    response = await client.post(
                        f"{self.base_url}/{method}",
                        json=payload,
                        timeout=timeout,
                    )
                except httpx.RequestError as exc:
                    raise RuntimeError(
                        f"Telegram request failed ({type(exc).__name__}): {exc}"
                    ) from exc
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


def telegram_pairing_code(user: User) -> str:
    seed = f"{getattr(user, 'id', '')}:{getattr(user, 'api_key', '')}:telegram-pairing-v1"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]


def telegram_pairing_command(user: User) -> str:
    return f"/start {telegram_pairing_code(user)}"


def text_has_pairing_code(text: str | None, pairing_code: str | None) -> bool:
    if not text or not pairing_code:
        return False
    return pairing_code in {part.strip() for part in text.strip().split()}


async def run_telegram_ai(db: AsyncSession, user: User, text: str):
    api_key = user_deepseek_api_key(user)
    if not api_key:
        raise RuntimeError("DeepSeek API key is not configured for this user")
    req = AiChatRequest(
        mode="command",
        channel="telegram",
        message=text,
        context=AiContext(module="telegram", locale="ru"),
    )
    reply, commands = await DeepSeekClient(api_key=api_key).chat(
        messages=build_messages_for_user(req.message, req.context, user=user, channel="telegram"),
        tools=deepseek_tools(),
    )
    return await build_ai_response(req, reply, commands, SqlAlchemyAiRepository(db, user))


async def process_telegram_update_with_db(
    update: dict[str, Any],
    db: AsyncSession,
    bot_api: TelegramBotApi,
    owner_user: User | None = None,
    pairing_code: str | None = None,
) -> dict[str, Any]:
    repo = SqlAlchemyTelegramRepository(db, owner_user)

    async def ai_runner(user: User, text: str):
        return await run_telegram_ai(db, user, text)

    async def send_message(chat_id: int, text: str):
        return await bot_api.send_message(chat_id, text)

    try:
        result = await process_telegram_text_update(
            update,
            repo,
            ai_runner,
            send_message,
            pairing_code=pairing_code,
        )
        await db.commit()
        return result
    except Exception:
        await db.rollback()
        raise


async def poll_telegram_once(
    db: AsyncSession,
    *,
    bot_api: TelegramBotApi,
    offset: int | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    api = bot_api
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


async def poll_telegram_once_for_user(
    db: AsyncSession,
    user: User,
    *,
    bot_api: TelegramBotApi | None = None,
    offset: int | None = None,
    limit: int = 20,
    allow_pairing: bool = False,
) -> dict[str, Any]:
    token = user_telegram_bot_token(user)
    if not token:
        raise RuntimeError("Telegram bot token is not configured for this user")
    api = bot_api or TelegramBotApi(token=token)
    if offset is None:
        latest = await db.execute(
            select(func.max(TelegramProcessedMessage.update_id)).where(
                TelegramProcessedMessage.user_id == user.id,
            )
        )
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
        results.append(await process_telegram_update_with_db(
            update,
            db,
            api,
            owner_user=user,
            pairing_code=telegram_pairing_code(user) if allow_pairing else None,
        ))
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
    pairing_code: str | None = None,
) -> dict[str, Any]:
    chat_id, message_id, update_id, text = telegram_message_fields(update)
    if chat_id is None or message_id is None or not text:
        return {"status": "ignored", "reason": "no text message"}

    if not await repo.try_mark_processed(int(chat_id), int(message_id), update_id):
        return {"status": "duplicate", "chat_id": int(chat_id), "message_id": int(message_id)}

    user = await repo.get_bound_user(int(chat_id))
    if user is None:
        if text_has_pairing_code(text, pairing_code):
            await repo.bind_chat(int(chat_id))
            send_error = None
            if send_message is not None:
                send_error = await try_send_telegram_message(
                    send_message,
                    int(chat_id),
                    "Telegram chat bound to this app account.",
                )
            result = {"status": "bound", "chat_id": int(chat_id)}
            if send_error:
                result["send_status"] = "failed"
                result["send_error"] = send_error
            return result
        if send_message is not None:
            await try_send_telegram_message(
                send_message,
                int(chat_id),
                "Telegram chat is not authorized for this app account.",
            )
        return {"status": "denied", "chat_id": int(chat_id)}

    response = await ai_runner(user, text)
    send_error = None
    if send_message is not None:
        send_error = await try_send_telegram_message(
            send_message,
            int(chat_id),
            format_telegram_ai_response(response),
        )
    result = {"status": "processed", "chat_id": int(chat_id), "response": response}
    if send_error:
        result["send_status"] = "failed"
        result["send_error"] = send_error
    return result


async def try_send_telegram_message(
    send_message: SendMessage,
    chat_id: int,
    text: str,
) -> str | None:
    try:
        await send_message(chat_id, text)
        return None
    except Exception as exc:
        return f"{type(exc).__name__}: {exc}"


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
            item_type = item.get("item_type") or ""
            choices = item.get("choices") or []
        else:
            name = getattr(item, "name", "command")
            status = getattr(item, "status", "")
            message = getattr(item, "message", "")
            item_type = getattr(item, "item_type", "") or ""
            choices = getattr(item, "choices", []) or []
        lines.append(f"{name}: {status} {message}".strip())
        rendered_choices = _format_telegram_choices(item_type, choices)
        if rendered_choices:
            lines.extend(rendered_choices)
    return "\n".join(lines)


def _format_telegram_choices(item_type: str, choices: list[Any]) -> list[str]:
    if not choices:
        return []
    title = {
        "note": "Notes",
        "snippet": "Snippets",
        "shortcut": "Snippets",
        "task": "Tasks",
        "task_checkbox": "Checkboxes",
    }.get(item_type, "Results")
    lines = [f"{title}:"]
    for index, choice in enumerate(choices[:10], start=1):
        if isinstance(choice, dict):
            label = choice.get("label") or choice.get("title") or choice.get("name") or choice.get("uuid") or choice.get("item_uuid")
        else:
            label = (
                getattr(choice, "label", None)
                or getattr(choice, "title", None)
                or getattr(choice, "name", None)
                or getattr(choice, "uuid", None)
                or getattr(choice, "item_uuid", None)
            )
        lines.append(f"{index}. {label or '(untitled)'}")
    return lines
