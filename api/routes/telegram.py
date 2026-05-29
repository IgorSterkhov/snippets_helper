from fastapi import APIRouter, Depends

from api import config
from api.auth import get_current_admin
from api.models import User

router = APIRouter(prefix="/telegram", tags=["telegram"])


@router.get("/status")
async def telegram_status(_admin: User = Depends(get_current_admin)):
    return {
        "configured": bool(config.TELEGRAM_BOT_TOKEN),
        "allowed_chat_ids": sorted(config.TELEGRAM_ALLOWED_CHAT_IDS),
        "polling_enabled": False,
        "last_update_id": None,
        "last_error": None,
    }
