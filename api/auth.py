from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from api.database import get_db
from api.models import User

security = HTTPBearer()
LAST_SEEN_TOUCH_INTERVAL = timedelta(minutes=5)


def should_touch_last_seen(
    last_seen_at: datetime | None,
    now: datetime | None = None,
) -> bool:
    now = now or datetime.utcnow()
    if last_seen_at is None:
        return True
    return now - last_seen_at >= LAST_SEEN_TOUCH_INTERVAL


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Validate API key and return the user."""
    api_key = credentials.credentials
    result = await db.execute(select(User).where(User.api_key == api_key))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if should_touch_last_seen(user.last_seen_at):
        user.last_seen_at = datetime.utcnow()
        await db.commit()
        await db.refresh(user)
    return user


async def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="admin required")
    return user
