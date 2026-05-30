import asyncio
from contextlib import suppress

from fastapi import FastAPI

from api.config import (
    TELEGRAM_POLLING_ENABLED,
    TELEGRAM_POLLING_INTERVAL_SECONDS,
    TELEGRAM_POLLING_USER_LIMIT,
)
from api.database import async_session
from api.routes import admin, ai, auth, media, share_links, sync, telegram
from api.telegram_poller import telegram_polling_loop

app = FastAPI(title="Snippets Helper Sync API", version="1.0.0")

app.include_router(auth.router, prefix="/v1")
app.include_router(ai.router, prefix="/v1")
app.include_router(sync.router, prefix="/v1")
app.include_router(share_links.router, prefix="/v1")
app.include_router(admin.router, prefix="/v1")
app.include_router(media.router, prefix="/v1")
app.include_router(telegram.router, prefix="/v1")
app.include_router(share_links.public_router)


@app.get("/v1/health")
async def health():
    return {"status": "ok"}


@app.on_event("startup")
async def start_telegram_poller():
    if not TELEGRAM_POLLING_ENABLED:
        app.state.telegram_polling_task = None
        return
    app.state.telegram_polling_task = asyncio.create_task(
        telegram_polling_loop(
            async_session,
            interval_seconds=TELEGRAM_POLLING_INTERVAL_SECONDS,
            user_limit=TELEGRAM_POLLING_USER_LIMIT,
        )
    )


@app.on_event("shutdown")
async def stop_telegram_poller():
    task = getattr(app.state, "telegram_polling_task", None)
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
