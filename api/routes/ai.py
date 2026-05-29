from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.ai_commands import deepseek_tools
from api.ai_prompt import build_messages
from api.ai_runtime import AiRepository, SqlAlchemyAiRepository, execute_command
from api.auth import get_current_user
from api.database import get_db
from api.deepseek_client import DeepSeekClient, DeepSeekError
from api.models import User
from api.schemas import AiChatRequest, AiChatResponse, AiProviderSettingsRequest, AiProviderSettingsResponse

router = APIRouter(prefix="/ai", tags=["ai"])


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def user_deepseek_api_key(user: User) -> str:
    return (getattr(user, "deepseek_api_key", None) or "").strip()


def provider_settings_response(user: User) -> AiProviderSettingsResponse:
    return AiProviderSettingsResponse(
        deepseek_configured=bool(user_deepseek_api_key(user)),
        deepseek_updated_at=getattr(user, "deepseek_updated_at", None),
    )


@router.get("/provider-settings", response_model=AiProviderSettingsResponse)
async def get_ai_provider_settings(
    user: User = Depends(get_current_user),
):
    return provider_settings_response(user)


@router.put("/provider-settings", response_model=AiProviderSettingsResponse)
async def update_ai_provider_settings(
    req: AiProviderSettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    key = req.deepseek_api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="DeepSeek API key is empty")
    user.deepseek_api_key = key
    user.deepseek_updated_at = utc_now()
    await db.commit()
    await db.refresh(user)
    return provider_settings_response(user)


@router.delete("/provider-settings", response_model=AiProviderSettingsResponse)
async def clear_ai_provider_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user.deepseek_api_key = None
    user.deepseek_updated_at = utc_now()
    await db.commit()
    await db.refresh(user)
    return provider_settings_response(user)


async def build_ai_response(
    req: AiChatRequest,
    reply: str,
    commands,
    repo: AiRepository | None = None,
):
    results = []
    if req.channel == "telegram":
        if repo is None:
            raise ValueError("telegram channel requires server-side repository")
        for command in commands:
            results.append(await execute_command(repo, command, req.context))

    return AiChatResponse(
        mode=req.mode,
        reply=reply,
        commands=commands,
        results=results,
    )


@router.post("/chat", response_model=AiChatResponse)
async def ai_chat(
    req: AiChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if req.channel != "client":
        raise HTTPException(status_code=400, detail="public ai route accepts client channel only")

    api_key = user_deepseek_api_key(user)
    if not api_key:
        raise HTTPException(status_code=400, detail="DeepSeek API key is not configured for this user")

    try:
        reply, commands = await DeepSeekClient(api_key=api_key).chat(
            messages=build_messages(req.message, req.context),
            tools=deepseek_tools(),
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    repo = None
    if req.channel == "telegram":
        repo = SqlAlchemyAiRepository(db, user)
    response = await build_ai_response(req, reply, commands, repo)
    if req.channel == "telegram":
        await db.commit()
    return response
