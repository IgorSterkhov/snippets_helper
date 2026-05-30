from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.ai_commands import deepseek_tools
from api.ai_prompt import (
    CONTEXT_FIELD_DESCRIPTIONS,
    CORE_INSTRUCTIONS,
    SAFETY_RULES,
    TELEGRAM_NOTES,
    build_messages,
    normalize_custom_instructions,
)
from api.ai_runtime import AiRepository, SqlAlchemyAiRepository, execute_command
from api.auth import get_current_user
from api.database import get_db
from api.deepseek_client import DeepSeekClient, DeepSeekError
from api.models import User
from api.schemas import (
    AiChatRequest,
    AiChatResponse,
    AiAgentSettingsRequest,
    AiAgentSettingsResponse,
    AiCapabilitiesResponse,
    AiCapabilityField,
    AiCapabilityTool,
    AiProviderBalanceResponse,
    AiProviderSettingsRequest,
    AiProviderSettingsResponse,
    AiPreviewRequest,
    AiCommandCall,
    AiTelegramBotSettingsRequest,
)

router = APIRouter(prefix="/ai", tags=["ai"])


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def user_deepseek_api_key(user: User) -> str:
    return (getattr(user, "deepseek_api_key", None) or "").strip()


def user_telegram_bot_token(user: User) -> str:
    return (getattr(user, "telegram_bot_token", None) or "").strip()


def user_custom_instructions(user: User) -> str:
    return normalize_custom_instructions(getattr(user, "ai_custom_instructions", None))


def build_messages_for_user(
    message: str,
    context,
    *,
    user: User,
    channel: str = "client",
) -> list[dict[str, str]]:
    return build_messages(
        message,
        context,
        custom_instructions=user_custom_instructions(user),
        channel=channel,
    )


def provider_settings_response(user: User) -> AiProviderSettingsResponse:
    return AiProviderSettingsResponse(
        deepseek_configured=bool(user_deepseek_api_key(user)),
        deepseek_updated_at=getattr(user, "deepseek_updated_at", None),
        telegram_bot_configured=bool(user_telegram_bot_token(user)),
        telegram_bot_updated_at=getattr(user, "telegram_bot_updated_at", None),
    )


def agent_settings_response(user: User) -> AiAgentSettingsResponse:
    return AiAgentSettingsResponse(
        custom_instructions=user_custom_instructions(user),
        updated_at=getattr(user, "ai_custom_instructions_updated_at", None),
        core_instructions=CORE_INSTRUCTIONS,
    )


def capability_tools() -> list[AiCapabilityTool]:
    result: list[AiCapabilityTool] = []
    for tool in deepseek_tools():
        fn = tool.get("function") or {}
        params = (fn.get("parameters") or {}).get("properties") or {}
        required = set((fn.get("parameters") or {}).get("required") or [])
        result.append(AiCapabilityTool(
            name=str(fn.get("name") or ""),
            description=str(fn.get("description") or ""),
            parameters=[
                {
                    "name": name,
                    "schema": schema,
                    "required": name in required,
                }
                for name, schema in params.items()
            ],
        ))
    return result


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


@router.get("/provider-balance", response_model=AiProviderBalanceResponse)
async def get_ai_provider_balance(
    user: User = Depends(get_current_user),
):
    api_key = user_deepseek_api_key(user)
    if not api_key:
        raise HTTPException(status_code=400, detail="DeepSeek API key is not configured for this user")
    try:
        return AiProviderBalanceResponse.model_validate(
            await DeepSeekClient(api_key=api_key).balance()
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.put("/provider-settings/telegram-bot", response_model=AiProviderSettingsResponse)
async def update_ai_telegram_bot_settings(
    req: AiTelegramBotSettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    token = req.telegram_bot_token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Telegram bot token is empty")
    user.telegram_bot_token = token
    user.telegram_bot_updated_at = utc_now()
    await db.commit()
    await db.refresh(user)
    return provider_settings_response(user)


@router.delete("/provider-settings/telegram-bot", response_model=AiProviderSettingsResponse)
async def clear_ai_telegram_bot_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user.telegram_bot_token = None
    user.telegram_bot_updated_at = utc_now()
    await db.commit()
    await db.refresh(user)
    return provider_settings_response(user)


@router.get("/agent-settings", response_model=AiAgentSettingsResponse)
async def get_ai_agent_settings(
    user: User = Depends(get_current_user),
):
    return agent_settings_response(user)


@router.put("/agent-settings", response_model=AiAgentSettingsResponse)
async def update_ai_agent_settings(
    req: AiAgentSettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    custom = normalize_custom_instructions(req.custom_instructions)
    user.ai_custom_instructions = custom or None
    user.ai_custom_instructions_updated_at = utc_now()
    await db.commit()
    await db.refresh(user)
    return agent_settings_response(user)


@router.get("/capabilities", response_model=AiCapabilitiesResponse)
def get_ai_capabilities(
    user: User = Depends(get_current_user),
):
    return AiCapabilitiesResponse(
        tools=capability_tools(),
        context_fields=[
            AiCapabilityField(name=name, description=description)
            for name, description in CONTEXT_FIELD_DESCRIPTIONS.items()
        ],
        safety_rules=SAFETY_RULES,
        telegram_notes=TELEGRAM_NOTES,
    )


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
        commands = [
            AiCommandCall(name="show_task", args=command.args)
            if command.name == "open_task"
            else command
            for command in commands
        ]
        for command in commands:
            results.append(await execute_command(repo, command, req.context))

    return AiChatResponse(
        mode=req.mode,
        reply=reply,
        commands=commands,
        results=results,
    )


@router.post("/preview", response_model=AiChatResponse)
async def preview_ai_prompt(
    req: AiPreviewRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    api_key = user_deepseek_api_key(user)
    if not api_key:
        raise HTTPException(status_code=400, detail="DeepSeek API key is not configured for this user")

    try:
        reply, commands = await DeepSeekClient(api_key=api_key).chat(
            messages=build_messages_for_user(req.message, req.context, user=user, channel=req.channel),
            tools=deepseek_tools(),
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return AiChatResponse(
        mode=req.mode,
        reply=reply,
        commands=commands,
        results=[],
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
            messages=build_messages_for_user(req.message, req.context, user=user, channel=req.channel),
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
