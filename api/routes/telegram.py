from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from api.database import get_db
from api.models import TelegramChatBinding, TelegramProcessedMessage, User
from api.telegram_bot import (
    poll_telegram_once_for_user,
    telegram_pairing_code,
    telegram_pairing_command,
)
from api.routes.ai import user_telegram_bot_token

router = APIRouter(prefix="/telegram", tags=["telegram"])


def binding_row(binding: TelegramChatBinding) -> dict:
    return {
        "chat_id": binding.chat_id,
        "created_at": binding.created_at,
        "updated_at": binding.updated_at,
        "is_active": binding.is_active,
    }


@router.get("/my/status")
async def telegram_my_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    latest = await db.execute(
        select(func.max(TelegramProcessedMessage.update_id)).where(
            TelegramProcessedMessage.user_id == user.id,
        )
    )
    latest_update_id = latest.scalar_one_or_none()
    bindings = await db.execute(
        select(TelegramChatBinding)
        .where(
            TelegramChatBinding.user_id == user.id,
            TelegramChatBinding.is_active.is_(True),
        )
        .order_by(TelegramChatBinding.updated_at.desc())
    )
    active_bindings = bindings.scalars().all()
    return {
        "configured": bool(user_telegram_bot_token(user)),
        "polling_enabled": False,
        "last_update_id": int(latest_update_id) if latest_update_id is not None else None,
        "last_error": None,
        "pairing_code": telegram_pairing_code(user),
        "pairing_command": telegram_pairing_command(user),
        "bound_chats": [binding_row(binding) for binding in active_bindings],
    }


@router.post("/my/poll-once")
async def telegram_my_poll_once(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user_telegram_bot_token(user):
        raise HTTPException(status_code=400, detail="Telegram bot token is not configured for this user")
    try:
        return await poll_telegram_once_for_user(db, user, allow_pairing=True, limit=100)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/my/chats/{chat_id}")
async def telegram_my_unbind_chat(
    chat_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TelegramChatBinding).where(
            TelegramChatBinding.user_id == user.id,
            TelegramChatBinding.chat_id == chat_id,
            TelegramChatBinding.is_active.is_(True),
        )
    )
    binding = result.scalar_one_or_none()
    if binding is None:
        raise HTTPException(status_code=404, detail="telegram chat binding not found")
    binding.is_active = False
    binding.updated_at = datetime.utcnow()
    await db.commit()
    return {"status": "ok", "chat_id": chat_id}
