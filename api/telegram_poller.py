from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from typing import Any, Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from api.models import User
from api.telegram_bot import poll_telegram_once_for_user

logger = logging.getLogger(__name__)

PollFunc = Callable[..., Awaitable[dict[str, Any]]]


async def get_configured_telegram_users(db: AsyncSession, limit: int = 50) -> list[User]:
    stmt = (
        select(User)
        .where(
            User.telegram_bot_token.is_not(None),
            User.telegram_bot_token != "",
        )
        .order_by(User.telegram_bot_updated_at.desc().nullslast(), User.created_at.desc())
        .limit(max(1, int(limit)))
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def poll_configured_telegram_users(
    db: AsyncSession,
    *,
    user_limit: int = 50,
    update_limit: int = 100,
    poll_func: PollFunc = poll_telegram_once_for_user,
) -> dict[str, Any]:
    users = await get_configured_telegram_users(db, limit=user_limit)
    summary: dict[str, Any] = {
        "users": len(users),
        "polled": 0,
        "updates": 0,
        "errors": [],
    }
    for user in users:
        try:
            result = await poll_func(
                db,
                user,
                allow_pairing=True,
                limit=update_limit,
            )
            summary["polled"] += 1
            summary["updates"] += int(result.get("updates") or 0)
        except Exception as exc:
            with suppress(Exception):
                await db.rollback()
            user_id = str(getattr(user, "id", "unknown"))
            error = f"{type(exc).__name__}: {exc}"
            summary["errors"].append({"user_id": user_id, "error": error})
            logger.warning("Telegram polling failed for user %s: %s", user_id, error)
    return summary


async def telegram_polling_loop(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    interval_seconds: float = 3,
    user_limit: int = 50,
    update_limit: int = 100,
) -> None:
    interval = max(1.0, float(interval_seconds))
    while True:
        try:
            async with session_factory() as db:
                await poll_configured_telegram_users(
                    db,
                    user_limit=user_limit,
                    update_limit=update_limit,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Telegram polling loop failed: %s", exc)
        await asyncio.sleep(interval)
