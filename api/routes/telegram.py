from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from api.database import get_db
from api.models import TelegramProcessedMessage, User
from api.telegram_bot import poll_telegram_once_for_user
from api.routes.ai import user_telegram_bot_token

router = APIRouter(prefix="/telegram", tags=["telegram"])


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
    return {
        "configured": bool(user_telegram_bot_token(user)),
        "polling_enabled": False,
        "last_update_id": int(latest_update_id) if latest_update_id is not None else None,
        "last_error": None,
    }


@router.post("/my/poll-once")
async def telegram_my_poll_once(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user_telegram_bot_token(user):
        raise HTTPException(status_code=400, detail="Telegram bot token is not configured for this user")
    try:
        return await poll_telegram_once_for_user(db, user)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
