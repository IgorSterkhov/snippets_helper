from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import config
from api.auth import get_current_admin
from api.database import get_db
from api.models import TelegramProcessedMessage, User
from api.telegram_bot import poll_telegram_once

router = APIRouter(prefix="/telegram", tags=["telegram"])


@router.get("/status")
async def telegram_status(
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    latest = await db.execute(select(func.max(TelegramProcessedMessage.update_id)))
    latest_update_id = latest.scalar_one_or_none()
    return {
        "configured": bool(config.TELEGRAM_BOT_TOKEN),
        "allowed_chat_ids": sorted(config.TELEGRAM_ALLOWED_CHAT_IDS),
        "polling_enabled": False,
        "last_update_id": int(latest_update_id) if latest_update_id is not None else None,
        "last_error": None,
    }


@router.post("/poll-once")
async def telegram_poll_once(
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if not config.TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=400, detail="TELEGRAM_BOT_TOKEN is not configured")
    try:
        return await poll_telegram_once(db)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
