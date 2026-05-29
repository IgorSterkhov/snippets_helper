from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.ai_commands import deepseek_tools
from api.ai_prompt import build_messages
from api.ai_runtime import AiRepository, SqlAlchemyAiRepository, execute_command
from api.auth import get_current_user
from api.database import get_db
from api.deepseek_client import DeepSeekClient, DeepSeekError
from api.models import User
from api.schemas import AiChatRequest, AiChatResponse

router = APIRouter(prefix="/ai", tags=["ai"])


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
    if req.channel not in {"client", "telegram"}:
        raise HTTPException(status_code=400, detail="unsupported ai channel")

    try:
        reply, commands = await DeepSeekClient().chat(
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
