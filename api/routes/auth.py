import secrets
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from api.database import get_db
from api.models import User
from api.schemas import RegisterRequest, RegisterResponse, UserInfo
from api.auth import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=RegisterResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user and return API key."""
    api_key = secrets.token_hex(32)  # 64-char hex string
    user = User(name=req.name, api_key=api_key)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return RegisterResponse(
        user_id=str(user.id),
        api_key=user.api_key,
        name=user.name,
    )


@router.get("/me", response_model=UserInfo)
async def me(user: User = Depends(get_current_user)):
    """Get current user info."""
    return UserInfo(
        user_id=str(user.id),
        name=user.name,
        created_at=user.created_at,
    )
