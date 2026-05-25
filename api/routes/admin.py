from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_admin, get_current_user
from api.database import get_db
from api.models import User
from api.schemas import AdminMeResponse, AdminUserLimitsRequest, AdminUserSummary

router = APIRouter(prefix="/admin", tags=["admin"])


async def media_used_bytes(db: AsyncSession, user_id) -> int:
    return 0


async def user_summary(db: AsyncSession, user: User) -> AdminUserSummary:
    return AdminUserSummary(
        user_id=str(user.id),
        name=user.name,
        created_at=user.created_at,
        last_seen_at=user.last_seen_at,
        is_admin=user.is_admin,
        media_quota_bytes=user.media_quota_bytes,
        media_max_upload_bytes=user.media_max_upload_bytes,
        media_used_bytes=await media_used_bytes(db, user.id),
    )


@router.get("/me", response_model=AdminMeResponse)
async def admin_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return AdminMeResponse(
        user_id=str(user.id),
        name=user.name,
        is_admin=user.is_admin,
        media_quota_bytes=user.media_quota_bytes,
        media_max_upload_bytes=user.media_max_upload_bytes,
        media_used_bytes=await media_used_bytes(db, user.id),
    )


@router.get("/users", response_model=list[AdminUserSummary])
async def list_users(
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).order_by(User.last_seen_at.desc().nulls_last(), User.created_at.desc())
    )
    return [await user_summary(db, u) for u in result.scalars().all()]


@router.patch("/users/{user_id}/limits", response_model=AdminUserSummary)
async def update_user_limits(
    user_id: str,
    req: AdminUserLimitsRequest,
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if req.media_quota_bytes <= 0 or req.media_max_upload_bytes <= 0:
        raise HTTPException(status_code=400, detail="limits must be positive")
    if req.media_max_upload_bytes > req.media_quota_bytes:
        raise HTTPException(status_code=400, detail="max upload cannot exceed quota")
    user = await db.get(User, UUID(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="user not found")
    user.media_quota_bytes = req.media_quota_bytes
    user.media_max_upload_bytes = req.media_max_upload_bytes
    await db.commit()
    await db.refresh(user)
    return await user_summary(db, user)
