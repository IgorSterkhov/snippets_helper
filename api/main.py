from fastapi import FastAPI
from api.routes import admin, ai, auth, media, share_links, sync

app = FastAPI(title="Snippets Helper Sync API", version="1.0.0")

app.include_router(auth.router, prefix="/v1")
app.include_router(ai.router, prefix="/v1")
app.include_router(sync.router, prefix="/v1")
app.include_router(share_links.router, prefix="/v1")
app.include_router(admin.router, prefix="/v1")
app.include_router(media.router, prefix="/v1")
app.include_router(share_links.public_router)


@app.get("/v1/health")
async def health():
    return {"status": "ok"}
