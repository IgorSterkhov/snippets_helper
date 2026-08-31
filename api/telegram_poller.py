from __future__ import annotations

import asyncio
import logging
import math
import time
import traceback
from contextlib import suppress
from dataclasses import dataclass
from numbers import Real
from typing import Any, AsyncContextManager, Awaitable, Callable, Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from api.models import User
from api.telegram_bot import (
    TelegramBotError,
    poll_telegram_once_for_user,
    sanitize_telegram_error_text,
)

logger = logging.getLogger(__name__)

PollFunc = Callable[..., Awaitable[dict[str, Any]]]
SessionFactory = Callable[[], AsyncContextManager[AsyncSession]]


@dataclass
class _RetryState:
    failures: int
    next_attempt_at: float


class TelegramPollingBackoff:
    def __init__(self, delays: tuple[float, ...] = (5.0, 15.0, 30.0, 60.0)):
        if not delays:
            raise ValueError("delays must contain at least one value")
        normalized: list[float] = []
        for delay in delays:
            if (
                isinstance(delay, bool)
                or not isinstance(delay, Real)
                or not math.isfinite(float(delay))
                or float(delay) <= 0
            ):
                raise ValueError("delays must contain finite positive numbers")
            normalized.append(float(delay))
        self.delays = tuple(normalized)
        self._states: dict[str, _RetryState] = {}

    @staticmethod
    def _key(user_id: object) -> str:
        return str(user_id)

    def is_ready(self, user_id: object, now: float) -> bool:
        state = self._states.get(self._key(user_id))
        return state is None or float(now) >= state.next_attempt_at

    def record_failure(self, user_id: object, now: float) -> float:
        key = self._key(user_id)
        previous = self._states.get(key)
        failures = previous.failures if previous is not None else 0
        delay = self.delays[min(failures, len(self.delays) - 1)]
        self._states[key] = _RetryState(
            failures=failures + 1,
            next_attempt_at=float(now) + delay,
        )
        return delay

    def record_success(self, user_id: object) -> None:
        self._states.pop(self._key(user_id), None)

    def retain(self, user_ids: Iterable[object]) -> None:
        retained = {self._key(user_id) for user_id in user_ids}
        self._states = {
            key: state for key, state in self._states.items() if key in retained
        }


def format_safe_exception_frames(exc: BaseException) -> str:
    frames = traceback.extract_tb(exc.__traceback__)[-12:]
    rendered = [
        (
            f"{sanitize_telegram_error_text(frame.filename, max_length=500)}:"
            f"{int(frame.lineno)}:"
            f"{sanitize_telegram_error_text(frame.name, max_length=200)}"
        )
        for frame in frames
    ]
    return " | ".join(rendered)[:2000]


def format_safe_poll_error(exc: BaseException) -> str:
    return sanitize_telegram_error_text(f"{type(exc).__name__}: {exc}")


async def get_configured_telegram_user_ids(
    db: AsyncSession,
    limit: int = 50,
) -> list[UUID]:
    stmt = (
        select(User.id)
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
    session_factory: SessionFactory,
    *,
    user_limit: int = 50,
    update_limit: int = 100,
    poll_func: PollFunc = poll_telegram_once_for_user,
    backoff: TelegramPollingBackoff | None = None,
    now_func: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    active_backoff = backoff if backoff is not None else TelegramPollingBackoff()
    async with session_factory() as discovery_db:
        user_ids = await get_configured_telegram_user_ids(
            discovery_db,
            limit=user_limit,
        )
    active_backoff.retain(user_ids)
    summary: dict[str, Any] = {
        "users": len(user_ids),
        "polled": 0,
        "updates": 0,
        "errors": [],
        "skipped": 0,
    }
    for user_id in user_ids:
        safe_user_id = str(user_id)
        if not active_backoff.is_ready(safe_user_id, now_func()):
            summary["skipped"] += 1
            continue
        user_missing = False
        completed_updates = 0
        try:
            async with session_factory() as db:
                try:
                    result = await db.execute(
                        select(User).where(
                            User.id == user_id,
                            User.telegram_bot_token.is_not(None),
                            User.telegram_bot_token != "",
                        )
                    )
                    user = result.scalar_one_or_none()
                    if user is None:
                        user_missing = True
                    else:
                        poll_result = await poll_func(
                            db,
                            user,
                            allow_pairing=True,
                            limit=update_limit,
                        )
                        completed_updates = int(poll_result.get("updates") or 0)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    with suppress(Exception):
                        await db.rollback()
                    raise
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            retry_delay = active_backoff.record_failure(
                safe_user_id,
                now_func(),
            )
            error = format_safe_poll_error(exc)
            summary["errors"].append({
                "user_id": safe_user_id,
                "error": error,
                "retry_in_seconds": retry_delay,
            })
            if isinstance(exc, TelegramBotError):
                logger.warning(
                    "Telegram polling failed for user %s; retry in %ss: %s",
                    safe_user_id,
                    retry_delay,
                    error,
                )
            else:
                logger.error(
                    "Unexpected Telegram polling failure for user %s; "
                    "retry in %ss: %s; frames: %s",
                    safe_user_id,
                    retry_delay,
                    error,
                    format_safe_exception_frames(exc),
                )
            continue
        if user_missing:
            summary["skipped"] += 1
            continue
        summary["polled"] += 1
        summary["updates"] += completed_updates
        active_backoff.record_success(safe_user_id)
    return summary


async def telegram_polling_loop(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    interval_seconds: float = 3,
    user_limit: int = 50,
    update_limit: int = 100,
) -> None:
    interval = max(1.0, float(interval_seconds))
    backoff = TelegramPollingBackoff()
    while True:
        try:
            await poll_configured_telegram_users(
                session_factory,
                user_limit=user_limit,
                update_limit=update_limit,
                backoff=backoff,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(
                "Unexpected Telegram polling loop failure: %s; frames: %s",
                format_safe_poll_error(exc),
                format_safe_exception_frames(exc),
            )
        await asyncio.sleep(interval)
