from fastapi import FastAPI
from api.routes import auth, sync

app = FastAPI(title="Snippets Helper Sync API", version="1.0.0")

app.include_router(auth.router, prefix="/v1")
app.include_router(sync.router, prefix="/v1")


@app.get("/v1/health")
async def health():
    return {"status": "ok"}
