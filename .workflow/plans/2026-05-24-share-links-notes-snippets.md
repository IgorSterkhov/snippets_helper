# Share Links For Notes And Snippets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live public secret-token share links for Notes and Snippets, with create/copy/preview/revoke management in desktop and mobile.

**Architecture:** Store access-control metadata in a dedicated server table `share_links`; keep note/snippet content in the existing synced tables. Desktop and mobile call dedicated authenticated share-link API endpoints directly, while public readers use token-only HTML/JSON endpoints that live-read the current server row.

**Tech Stack:** FastAPI, SQLAlchemy/Alembic/Postgres, Tauri/Rust `reqwest`, vanilla desktop JS, React Native, Jest, desktop CDP smoke tests, post-release pytest smoke.

## Follow-Up Tasks

- [x] Public note share pages should render `notes.content` as safe Markdown,
  matching the rendered Markdown behavior used for snippet text blocks,
  including fenced code blocks and Markdown image Figure Cards where supported.
- [x] Public snippet share pages should render Markdown-like `value` and
  `description` content as safe Markdown, including reference links, while
  preserving plain code-only values in the existing copyable preformatted block.

---

## Required Context

- Spec: `.workflow/specs/2026-05-24-share-links-notes-snippets.md`
- Release rules: `CLAUDE.md`, `desktop-rust/RELEASES.md`, `mobile/RELEASES.md`
- UI patterns: `FRONTEND_PATTERNS.md`

Do not add `share_links` to generic sync schemas. This feature uses dedicated API calls.

## File Map

API:

- Create `api/share_utils.py`: pure helpers for token generation, public URL building, payload filtering, link parsing, and safe HTML rendering.
- Create `api/routes/share_links.py`: authenticated CRUD plus public HTML/JSON endpoints.
- Modify `api/models.py`: add `ShareLink` ORM model only.
- Modify `api/schemas.py`: add Pydantic request/response/public schemas.
- Modify `api/main.py`: include `/v1/share-links`, `/v1/public/share/{token}`, and `/share/{token}` routes.
- Create `api/alembic/versions/008_add_share_links.py`: create table and indexes.
- Create `tests/api/test_share_utils.py`: local pure-helper tests.
- Create `tests/post_release/test_share_links_contract.py`: production smoke for create/live/revoke.

Desktop native:

- Create `desktop-rust/src-tauri/src/commands/share_links.rs`: authenticated HTTP bridge to API using saved sync settings.
- Modify `desktop-rust/src-tauri/src/commands/mod.rs`: export the new module.
- Modify `desktop-rust/src-tauri/src/lib.rs`: register `get_share_link`, `create_share_link`, `revoke_share_link`.

Desktop frontend:

- Create `desktop-rust/src/components/share-link-modal.js`: reusable compact modal for Notes/Snippets.
- Modify `desktop-rust/src/tabs/shortcuts.js`: toolbar order, icon-only pin/share, pinned chip icon, share modal.
- Modify `desktop-rust/src/tabs/notes.js`: toolbar order, note copy action, icon-only pin/share, share modal.
- Modify `desktop-rust/src/dev-mock.js`: mock share-link commands.
- Modify `desktop-rust/src/dev-test.py`: add smoke tests for toolbar order, snippet chip icon, share modal create/revoke.
- Modify `desktop-rust/src/tabs/help.js`, `desktop-rust/CHANGELOG.md`, `desktop-rust/src/release-history.md`: release help/history.

Mobile:

- Modify `mobile/src/api/client.js`: add `delete`.
- Modify `mobile/src/api/endpoints.js`: add share-link functions.
- Create `mobile/src/components/ShareLinkSheet.js`: reusable mobile share management sheet.
- Modify `mobile/src/screens/Snippets/SnippetDetailScreen.js`: replace content-only share with public-link management.
- Modify `mobile/src/screens/Notes/NoteEditorScreen.js`: add share actions for current note.
- Create/modify `mobile/__tests__/api/client.test.js`: cover DELETE.
- Create `mobile/__tests__/api/shareLinks.test.js`: cover endpoint paths/payloads.
- Bump `mobile/package.json` and `mobile/package-lock.json` OTA version.

Release/deploy:

- Bump desktop native version.
- Deploy API migration and server.
- Cut desktop `v*` release.
- Publish mobile OTA.
- Run post-release smoke.
- Verify public `/share/{token}` route on `ister-app.ru`; if nginx does not proxy `/share/` to the API container, add that server route during deploy.

---

### Task 1: API Share Utilities

**Files:**

- Create: `api/share_utils.py`
- Create: `tests/api/test_share_utils.py`

- [ ] **Step 1: Write failing helper tests**

Create `tests/api/test_share_utils.py`:

```python
from api.share_utils import (
    build_public_url,
    generate_share_token,
    public_note_payload,
    public_shortcut_payload,
    render_share_html,
)


class Row:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def test_generate_share_token_is_url_safe_and_long():
    token = generate_share_token()
    assert len(token) >= 32
    assert all(ch.isalnum() or ch in "_-" for ch in token)


def test_build_public_url_uses_root_share_path():
    assert build_public_url("https://ister-app.ru/snippets-api/v1/share-links", "abc") == "https://ister-app.ru/share/abc"


def test_public_note_payload_exposes_only_title_and_content():
    row = Row(title="T", content="<b>secret</b>", folder_uuid="hidden", is_pinned=1)
    payload = public_note_payload(row)
    assert payload == {"type": "note", "title": "T", "content": "<b>secret</b>"}


def test_public_shortcut_payload_exposes_only_allowed_fields():
    row = Row(
        name="Deploy",
        value="kubectl apply",
        description="desc",
        links='[{"label":"Docs","url":"https://example.com"}, {"url":"javascript:bad"}]',
        obsidian_note="hidden",
        is_pinned=1,
    )
    payload = public_shortcut_payload(row)
    assert payload["type"] == "shortcut"
    assert payload["name"] == "Deploy"
    assert payload["value"] == "kubectl apply"
    assert payload["description"] == "desc"
    assert payload["links"] == [{"label": "Docs", "url": "https://example.com"}]
    assert "obsidian_note" not in payload


def test_render_share_html_escapes_user_content():
    html = render_share_html({"type": "note", "title": "<script>x</script>", "content": "<b>hi</b>"})
    assert "<script>" not in html
    assert "&lt;script&gt;x&lt;/script&gt;" in html
    assert "&lt;b&gt;hi&lt;/b&gt;" in html
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
bash tests/post_release/run.sh tests/api/test_share_utils.py -q
```

Expected: fails with `ModuleNotFoundError: No module named 'api.share_utils'`.

- [ ] **Step 3: Implement helpers**

Create `api/share_utils.py`:

```python
import html
import json
import secrets
from urllib.parse import urlparse


def generate_share_token() -> str:
    return secrets.token_urlsafe(32)


def build_public_url(request_url: str, token: str) -> str:
    parsed = urlparse(str(request_url))
    return f"{parsed.scheme}://{parsed.netloc}/share/{token}"


def _safe_links(raw: str | None) -> list[dict[str, str]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []
    out = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        label = str(item.get("label") or url).strip()
        scheme = urlparse(url).scheme.lower()
        if scheme not in {"http", "https"}:
            continue
        out.append({"label": label or url, "url": url})
    return out


def public_note_payload(row) -> dict:
    return {
        "type": "note",
        "title": row.title or "",
        "content": row.content or "",
    }


def public_shortcut_payload(row) -> dict:
    return {
        "type": "shortcut",
        "name": row.name or "",
        "value": row.value or "",
        "description": row.description or "",
        "links": _safe_links(row.links),
    }


def _paragraphs(text: str) -> str:
    return "<br>".join(html.escape(text or "").splitlines())


def render_share_html(payload: dict) -> str:
    title = payload.get("title") or payload.get("name") or "Shared item"
    safe_title = html.escape(title)
    if payload.get("type") == "shortcut":
        body = (
            f"<p class='desc'>{_paragraphs(payload.get('description', ''))}</p>"
            f"<pre><code id='share-code'>{html.escape(payload.get('value', ''))}</code></pre>"
            "<button onclick='navigator.clipboard.writeText(document.getElementById(\"share-code\").innerText)'>Copy</button>"
        )
        links = payload.get("links") or []
        if links:
            body += "<ul>" + "".join(
                f"<li><a rel='noopener noreferrer' target='_blank' href='{html.escape(link['url'], quote=True)}'>{html.escape(link['label'])}</a></li>"
                for link in links
            ) + "</ul>"
    else:
        body = f"<article>{_paragraphs(payload.get('content', ''))}</article>"

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{safe_title}</title>
  <style>
    body {{ margin:0; background:#0d1117; color:#c9d1d9; font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif; }}
    main {{ max-width:860px; margin:0 auto; padding:32px 18px; }}
    h1 {{ color:#f0f6fc; font-size:28px; line-height:1.2; }}
    pre {{ background:#161b22; border:1px solid #30363d; border-radius:8px; padding:14px; overflow:auto; }}
    button {{ background:#238636; color:white; border:0; border-radius:6px; padding:8px 12px; font-weight:600; }}
    a {{ color:#58a6ff; }}
    .desc {{ color:#8b949e; }}
  </style>
</head>
<body><main><h1>{safe_title}</h1>{body}</main></body>
</html>"""
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
bash tests/post_release/run.sh tests/api/test_share_utils.py -q
```

Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add api/share_utils.py tests/api/test_share_utils.py
git commit -m "add share link helpers"
```

---

### Task 2: API Model, Migration, Schemas, And Routes

**Files:**

- Modify: `api/models.py`
- Modify: `api/schemas.py`
- Modify: `api/main.py`
- Create: `api/routes/share_links.py`
- Create: `api/alembic/versions/008_add_share_links.py`

- [ ] **Step 1: Add API schemas**

Append to `api/schemas.py`:

```python
# ==================== Share Links ====================

class ShareLinkRequest(BaseModel):
    item_type: str
    item_uuid: str


class ShareLinkResponse(BaseModel):
    token: str
    public_url: str
    item_type: str
    item_uuid: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    revoked_at: Optional[datetime] = None


class ShareLinkStatusResponse(BaseModel):
    link: Optional[ShareLinkResponse] = None
```

- [ ] **Step 2: Add ORM model**

Add `ShareLink` to `api/models.py` and do not add it to `TABLE_MODELS`:

```python
class ShareLink(Base):
    __tablename__ = "share_links"

    token: Mapped[str] = mapped_column(String(96), primary_key=True)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    item_type: Mapped[str] = mapped_column(String(20), nullable=False)
    item_uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)

    __table_args__ = (
        Index("idx_share_links_token", "token"),
        Index("idx_share_links_owner_item", "user_id", "item_type", "item_uuid"),
    )
```

- [ ] **Step 3: Add Alembic migration**

Create `api/alembic/versions/008_add_share_links.py`:

```python
"""add share links

Revision ID: 008
Revises: 007
Create Date: 2026-05-24
"""

from alembic import op
import sqlalchemy as sa


revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "share_links",
        sa.Column("token", sa.String(length=96), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("item_type", sa.String(length=20), nullable=False),
        sa.Column("item_uuid", sa.Uuid(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("item_type IN ('note', 'shortcut')", name="ck_share_links_item_type"),
    )
    op.create_index("idx_share_links_token", "share_links", ["token"])
    op.create_index("idx_share_links_owner_item", "share_links", ["user_id", "item_type", "item_uuid"])
    op.create_index(
        "uq_share_links_active_owner_item",
        "share_links",
        ["user_id", "item_type", "item_uuid"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )


def downgrade():
    op.drop_index("uq_share_links_active_owner_item", table_name="share_links")
    op.drop_index("idx_share_links_owner_item", table_name="share_links")
    op.drop_index("idx_share_links_token", table_name="share_links")
    op.drop_table("share_links")
```

- [ ] **Step 4: Add route module**

Create `api/routes/share_links.py` with these public function names and route names:

```python
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from api.database import get_db
from api.models import Note, ShareLink, Shortcut, User
from api.schemas import ShareLinkRequest, ShareLinkResponse, ShareLinkStatusResponse
from api.share_utils import (
    build_public_url,
    generate_share_token,
    public_note_payload,
    public_shortcut_payload,
    render_share_html,
)


router = APIRouter(prefix="/share-links", tags=["share-links"])
public_router = APIRouter(tags=["public-share"])


def _validate_item_type(item_type: str) -> str:
    if item_type not in {"note", "shortcut"}:
        raise ValueError("item_type must be note or shortcut")
    return item_type


def _response(link: ShareLink, request: Request) -> ShareLinkResponse:
    return ShareLinkResponse(
        token=link.token,
        public_url=build_public_url(str(request.url), link.token),
        item_type=link.item_type,
        item_uuid=str(link.item_uuid),
        is_active=link.is_active,
        created_at=link.created_at,
        updated_at=link.updated_at,
        revoked_at=link.revoked_at,
    )


async def _load_owned_item(db: AsyncSession, user_id, item_type: str, item_uuid: UUID):
    model = Note if item_type == "note" else Shortcut
    result = await db.execute(
        select(model).where(model.uuid == item_uuid, model.user_id == user_id, model.is_deleted == False)  # noqa: E712
    )
    return result.scalar_one_or_none()


@router.get("", response_model=ShareLinkStatusResponse)
async def get_share_link(item_type: str, item_uuid: str, request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    item_type = _validate_item_type(item_type)
    uuid_value = UUID(item_uuid)
    result = await db.execute(
        select(ShareLink).where(
            ShareLink.user_id == user.id,
            ShareLink.item_type == item_type,
            ShareLink.item_uuid == uuid_value,
            ShareLink.is_active == True,  # noqa: E712
        )
    )
    link = result.scalar_one_or_none()
    return ShareLinkStatusResponse(link=_response(link, request) if link else None)


@router.post("", response_model=ShareLinkResponse)
async def create_share_link(req: ShareLinkRequest, request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    item_type = _validate_item_type(req.item_type)
    uuid_value = UUID(req.item_uuid)
    item = await _load_owned_item(db, user.id, item_type, uuid_value)
    if item is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="item not found")

    result = await db.execute(
        select(ShareLink).where(
            ShareLink.user_id == user.id,
            ShareLink.item_type == item_type,
            ShareLink.item_uuid == uuid_value,
            ShareLink.is_active == True,  # noqa: E712
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return _response(existing, request)

    for _ in range(5):
        token = generate_share_token()
        exists = await db.get(ShareLink, token)
        if exists is None:
            now = datetime.utcnow()
            link = ShareLink(token=token, user_id=user.id, item_type=item_type, item_uuid=uuid_value, is_active=True, created_at=now, updated_at=now)
            db.add(link)
            await db.commit()
            await db.refresh(link)
            return _response(link, request)
    from fastapi import HTTPException
    raise HTTPException(status_code=500, detail="could not allocate token")


@router.delete("/{token}", response_model=ShareLinkStatusResponse)
async def revoke_share_link(token: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ShareLink).where(ShareLink.token == token, ShareLink.user_id == user.id))
    link = result.scalar_one_or_none()
    if link and link.is_active:
        now = datetime.utcnow()
        link.is_active = False
        link.revoked_at = now
        link.updated_at = now
        await db.commit()
    return ShareLinkStatusResponse(link=None)


async def _public_payload(token: str, db: AsyncSession):
    from fastapi import HTTPException
    result = await db.execute(select(ShareLink).where(ShareLink.token == token, ShareLink.is_active == True))  # noqa: E712
    link = result.scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=404, detail="not found")
    row = await _load_owned_item(db, link.user_id, link.item_type, link.item_uuid)
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return public_note_payload(row) if link.item_type == "note" else public_shortcut_payload(row)


@public_router.get("/v1/public/share/{token}")
async def public_share_json(token: str, db: AsyncSession = Depends(get_db)):
    return await _public_payload(token, db)


@public_router.get("/share/{token}", response_class=HTMLResponse)
async def public_share_html(token: str, db: AsyncSession = Depends(get_db)):
    return HTMLResponse(render_share_html(await _public_payload(token, db)))
```

- [ ] **Step 5: Register routes**

Modify `api/main.py`:

```python
from api.routes import auth, share_links, sync

app.include_router(auth.router, prefix="/v1")
app.include_router(sync.router, prefix="/v1")
app.include_router(share_links.router, prefix="/v1")
app.include_router(share_links.public_router)
```

- [ ] **Step 6: Run syntax and helper tests**

Run:

```bash
python3 -m py_compile api/models.py api/schemas.py api/share_utils.py api/routes/share_links.py api/alembic/versions/008_add_share_links.py
bash tests/post_release/run.sh tests/api/test_share_utils.py -q
```

Expected: py_compile exits 0; helper tests pass.

- [ ] **Step 7: Commit**

```bash
git add api/models.py api/schemas.py api/main.py api/routes/share_links.py api/share_utils.py api/alembic/versions/008_add_share_links.py tests/api/test_share_utils.py
git commit -m "add share link api"
```

---

### Task 3: Desktop Native Share-Link Commands

**Files:**

- Create: `desktop-rust/src-tauri/src/commands/share_links.rs`
- Modify: `desktop-rust/src-tauri/src/commands/mod.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`

- [ ] **Step 1: Add command module skeleton**

Create `desktop-rust/src-tauri/src/commands/share_links.rs` with:

```rust
use crate::db::{queries, DbState};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct ShareLink {
    pub token: String,
    pub public_url: String,
    pub item_type: String,
    pub item_uuid: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ShareStatusResponse {
    link: Option<ShareLink>,
}

#[derive(Debug, Serialize)]
struct CreateShareRequest<'a> {
    item_type: &'a str,
    item_uuid: &'a str,
}
```

- [ ] **Step 2: Implement settings and HTTP helpers**

Append in the same file:

```rust
fn sync_settings(state: &State<'_, DbState>) -> Result<(String, String, Option<String>), String> {
    let computer_id = hostname::get().unwrap_or_default().to_string_lossy().to_string();
    let conn = state.lock_recover();
    let url = queries::get_setting(&conn, &computer_id, "sync_api_url")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "sync_api_url not configured".to_string())?;
    let key = queries::get_setting(&conn, &computer_id, "sync_api_key")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "sync_api_key not configured".to_string())?;
    let cert = queries::get_setting(&conn, &computer_id, "sync_ca_cert")
        .map_err(|e| e.to_string())?;
    Ok((url.trim_end_matches('/').to_string(), key, cert))
}

fn http_client(api_url: &str, ca_cert: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20));
    if let Some(path) = ca_cert {
        if std::path::Path::new(path).is_file() {
            let pem = std::fs::read(path).map_err(|e| format!("read CA cert: {e}"))?;
            let cert = reqwest::Certificate::from_pem(&pem).map_err(|e| format!("parse CA cert: {e}"))?;
            builder = builder.add_root_certificate(cert);
        } else if api_url.starts_with("https://") {
            builder = builder.danger_accept_invalid_certs(true);
        }
    } else if api_url.starts_with("https://") {
        builder = builder.danger_accept_invalid_certs(true);
    }
    builder.build().map_err(|e| format!("build http client: {e}"))
}

async fn parse_json<T: for<'de> Deserialize<'de>>(resp: reqwest::Response) -> Result<T, String> {
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {body}"));
    }
    resp.json::<T>().await.map_err(|e| format!("parse response: {e}"))
}
```

- [ ] **Step 3: Implement Tauri commands**

Append:

```rust
#[tauri::command]
pub async fn get_share_link(state: State<'_, DbState>, item_type: String, item_uuid: String) -> Result<Option<ShareLink>, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .get(format!("{api_url}/v1/share-links"))
        .bearer_auth(api_key)
        .query(&[("item_type", item_type), ("item_uuid", item_uuid)])
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status: ShareStatusResponse = parse_json(resp).await?;
    Ok(status.link)
}

#[tauri::command]
pub async fn create_share_link(state: State<'_, DbState>, item_type: String, item_uuid: String) -> Result<ShareLink, String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .post(format!("{api_url}/v1/share-links"))
        .bearer_auth(api_key)
        .json(&CreateShareRequest { item_type: &item_type, item_uuid: &item_uuid })
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    parse_json(resp).await
}

#[tauri::command]
pub async fn revoke_share_link(state: State<'_, DbState>, token: String) -> Result<(), String> {
    let (api_url, api_key, ca_cert) = sync_settings(&state)?;
    let client = http_client(&api_url, ca_cert.as_deref())?;
    let resp = client
        .delete(format!("{api_url}/v1/share-links/{token}"))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let _: ShareStatusResponse = parse_json(resp).await?;
    Ok(())
}
```

- [ ] **Step 4: Register commands**

Modify `desktop-rust/src-tauri/src/commands/mod.rs`:

```rust
pub mod share_links;
```

Modify `desktop-rust/src-tauri/src/lib.rs` inside `tauri::generate_handler!`:

```rust
commands::share_links::get_share_link,
commands::share_links::create_share_link,
commands::share_links::revoke_share_link,
```

- [ ] **Step 5: Verify Rust compile**

Run:

```bash
cd desktop-rust/src-tauri && /home/aster/.cargo/bin/cargo check
```

Expected: exits 0; existing warnings are acceptable.

- [ ] **Step 6: Commit**

```bash
git add desktop-rust/src-tauri/src/commands/share_links.rs desktop-rust/src-tauri/src/commands/mod.rs desktop-rust/src-tauri/src/lib.rs
git commit -m "add desktop share link commands"
```

---

### Task 4: Desktop Share Modal And Snippets UI

**Files:**

- Create: `desktop-rust/src/components/share-link-modal.js`
- Modify: `desktop-rust/src/tabs/shortcuts.js`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`
- Modify: `desktop-rust/src/styles.css` for shared share-link modal styles.

- [ ] **Step 1: Add dev mock commands first**

In `desktop-rust/src/dev-mock.js`, add an in-memory share store and command handlers:

```js
const shareLinks = new Map();

function shareKey(itemType, itemUuid) {
  return `${itemType}:${itemUuid}`;
}

function mockShareLink(itemType, itemUuid) {
  const token = `mock-${itemType}-${itemUuid}`;
  return {
    token,
    public_url: `https://ister-app.ru/share/${token}`,
    item_type: itemType,
    item_uuid: itemUuid,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    revoked_at: null,
  };
}
```

Add command handlers:

```js
async get_share_link({ itemType, itemUuid }) {
  return shareLinks.get(shareKey(itemType, itemUuid)) || null;
},
async create_share_link({ itemType, itemUuid }) {
  const key = shareKey(itemType, itemUuid);
  if (!shareLinks.has(key)) shareLinks.set(key, mockShareLink(itemType, itemUuid));
  return shareLinks.get(key);
},
async revoke_share_link({ token }) {
  for (const [key, value] of shareLinks.entries()) {
    if (value.token === token) shareLinks.delete(key);
  }
},
```

- [ ] **Step 2: Create reusable desktop modal**

Create `desktop-rust/src/components/share-link-modal.js`:

```js
import { call } from '../tauri-api.js';
import { showToast } from './toast.js';

export async function openShareLinkModal({ itemType, itemUuid, title, onChange }) {
  let link = null;
  try {
    link = await call('get_share_link', { itemType, itemUuid });
  } catch (err) {
    showToast('Failed to load share link: ' + err, 'error');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal share-link-dialog';
  overlay.appendChild(modal);

  const heading = document.createElement('h3');
  heading.textContent = 'Share link';
  modal.appendChild(heading);

  const body = document.createElement('div');
  body.className = 'share-link-modal';
  modal.appendChild(body);

  const status = document.createElement('div');
  status.className = 'share-link-status';
  status.textContent = link ? 'Public live link is active' : 'No public link';
  body.appendChild(status);

  if (link) {
    const input = document.createElement('input');
    input.className = 'share-link-input';
    input.value = link.public_url;
    input.readOnly = true;
    body.appendChild(input);
  }

  const actions = document.createElement('div');
  actions.className = 'share-link-actions';
  body.appendChild(actions);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  function addButton(text, className, handler) {
    const btn = document.createElement('button');
    btn.textContent = text;
    if (className) btn.className = className;
    btn.addEventListener('click', handler);
    actions.appendChild(btn);
    return btn;
  }

  if (!link) {
    addButton('Create link', '', async () => {
      try {
        link = await call('create_share_link', { itemType, itemUuid });
        await navigator.clipboard.writeText(link.public_url);
        showToast('Public link created and copied', 'success');
        if (onChange) onChange(link);
        close();
      } catch (err) {
        showToast('Failed to create link: ' + err, 'error');
      }
    });
  } else {
    addButton('Copy link', '', async () => {
      await navigator.clipboard.writeText(link.public_url);
      showToast('Link copied', 'success');
    });
    addButton('Open preview', 'btn-secondary', async () => {
      await call('open_link_window', { url: link.public_url, title: title || 'Shared item' });
    });
    addButton('Revoke', 'btn-danger', async () => {
      try {
        await call('revoke_share_link', { token: link.token });
        showToast('Link revoked', 'success');
        if (onChange) onChange(null);
        close();
      } catch (err) {
        showToast('Failed to revoke link: ' + err, 'error');
      }
    });
  }

  addButton('Close', 'btn-secondary', close);
  document.addEventListener('keydown', onKeydown);
  document.body.appendChild(overlay);
}
```

- [ ] **Step 3: Add modal styles**

Add styles to `desktop-rust/src/styles.css`:

```css
.share-link-modal {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: min(440px, 80vw);
}
.share-link-dialog {
  max-width: min(520px, 92vw);
}
.share-link-status {
  font-size: 13px;
  color: var(--text-muted);
}
.share-link-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text);
}
.share-link-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
```

- [ ] **Step 4: Update Snippets toolbar and chips**

In `desktop-rust/src/tabs/shortcuts.js`:

1. Import modal:

```js
import { openShareLinkModal } from '../components/share-link-modal.js';
```

2. Change detail action order to:

```js
actions.appendChild(pinBtn);
actions.appendChild(shareBtn);
actions.appendChild(copyBtn);
actions.appendChild(editBtn);
actions.appendChild(delBtn);
```

3. Make pin icon-only:

```js
pinBtn.textContent = '📌';
pinBtn.title = shortcut.is_pinned ? 'Unpin snippet' : 'Pin snippet';
pinBtn.className = 'snippet-icon-action';
pinBtn.dataset.active = shortcut.is_pinned ? '1' : '0';
```

4. Add share icon:

```js
const shareBtn = document.createElement('button');
shareBtn.type = 'button';
shareBtn.className = 'snippet-icon-action';
shareBtn.textContent = '🔗';
shareBtn.title = 'Share public link';
shareBtn.addEventListener('click', () => openShareLinkModal({
  itemType: 'shortcut',
  itemUuid: shortcut.uuid,
  title: shortcut.name || 'Shared snippet',
}));
```

5. Ensure pinned chips append the same icon text:

```js
const icon = document.createElement('span');
icon.className = 'snippet-pinned-chip-icon';
icon.textContent = '📌';
chip.appendChild(icon);
```

- [ ] **Step 5: Add browser smoke**

In `desktop-rust/src/dev-test.py`, add a test that:

```python
async def t_share_snippet_modal():
    await activate_tab(cdp, 'shortcuts')
    await wait_until(cdp, "!!document.querySelector('.snippet-icon-action')")
    toolbar_text = await cdp.eval("[...document.querySelectorAll('.snippet-detail-actions button')].map(b => b.textContent.trim()).join('|')")
    assert toolbar_text.startswith('📌|🔗|Copy|Edit|Del'), toolbar_text
    await cdp.eval("[...document.querySelectorAll('.snippet-icon-action')].find(b => b.textContent.trim() === '🔗').click()")
    await wait_until(cdp, "document.body.innerText.includes('Share link')")
    await cdp.eval("[...document.querySelectorAll('button')].find(b => b.textContent === 'Create link').click()")
    await wait_until(cdp, "!document.body.innerText.includes('Share link')")
```

Register it with:

```python
await check('TXX Snippets share link modal', t_share_snippet_modal)
```

- [ ] **Step 6: Verify desktop frontend**

Run:

```bash
node --check desktop-rust/src/components/share-link-modal.js
node --check desktop-rust/src/tabs/shortcuts.js
node --check desktop-rust/src/dev-mock.js
cd desktop-rust/src && python3 dev-test.py
```

Expected: syntax exits 0; dev-test reports all tests passed.

- [ ] **Step 7: Commit**

```bash
git add desktop-rust/src/components/share-link-modal.js desktop-rust/src/tabs/shortcuts.js desktop-rust/src/styles.css desktop-rust/src/dev-mock.js desktop-rust/src/dev-test.py
git commit -m "add desktop snippet share links"
```

---

### Task 5: Desktop Notes Share UI

**Files:**

- Modify: `desktop-rust/src/tabs/notes.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] **Step 1: Import modal**

In `desktop-rust/src/tabs/notes.js`:

```js
import { openShareLinkModal } from '../components/share-link-modal.js';
```

- [ ] **Step 2: Reorder note editor toolbar**

In the note editor toolbar, render buttons in this order:

```js
toolbar.appendChild(pinBtn);
toolbar.appendChild(shareBtn);
toolbar.appendChild(copyBtn);
toolbar.appendChild(previewBtn);
```

Use this share button:

```js
const shareBtn = el('button', {
  text: '🔗',
  class: 'btn-icon',
  title: editingNote.uuid ? 'Share public link' : 'Save note before sharing',
});
shareBtn.disabled = !editingNote.uuid;
shareBtn.addEventListener('click', () => openShareLinkModal({
  itemType: 'note',
  itemUuid: editingNote.uuid,
  title: editingNote.title || 'Shared note',
}));
```

Use this note content copy button:

```js
const copyBtn = el('button', { text: 'Copy', class: 'btn-secondary' });
copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(editingNote.content || '');
  showToast('Copied to clipboard', 'success');
});
```

Keep existing `Save`, `Cancel`, and `Delete` controls below the editor. The
top note editor toolbar order is `Pin`, `Share`, `Copy`, `Preview`; the
bottom destructive action remains the existing `Delete` button.

- [ ] **Step 3: Add note smoke test**

In `desktop-rust/src/dev-test.py`, add:

```python
async def t_notes_share_link_modal():
    await activate_tab(cdp, 'notes')
    await wait_until(cdp, "document.body.innerText.includes('New Note')", timeout=3)
    await cdp.eval("[...document.querySelectorAll('button')].find(b => b.textContent.includes('New Note')).click()")
    await wait_until(cdp, "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '🔗')")
    await cdp.eval("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '🔗').click()")
    await wait_until(cdp, "document.body.innerText.includes('Share link')")
```

Register it with:

```python
await check('TXX Notes share link modal', t_notes_share_link_modal)
```

- [ ] **Step 4: Verify**

Run:

```bash
node --check desktop-rust/src/tabs/notes.js
cd desktop-rust/src && python3 dev-test.py
```

Expected: syntax exits 0; dev-test reports all tests passed.

- [ ] **Step 5: Commit**

```bash
git add desktop-rust/src/tabs/notes.js desktop-rust/src/dev-test.py
git commit -m "add desktop note share links"
```

---

### Task 6: Mobile Share-Link API And Component

**Files:**

- Modify: `mobile/src/api/client.js`
- Modify: `mobile/src/api/endpoints.js`
- Create: `mobile/src/components/ShareLinkSheet.js`
- Modify: `mobile/__tests__/api/client.test.js`
- Create: `mobile/__tests__/api/shareLinks.test.js`

- [ ] **Step 1: Extend API client test**

Append to `mobile/__tests__/api/client.test.js`:

```js
test('delete sends DELETE request', async () => {
  fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ link: null }) });
  const client = createClient('https://example.com', 'test-key-123');
  await client.delete('/v1/share-links/token-1');
  expect(fetch).toHaveBeenCalledWith(
    'https://example.com/v1/share-links/token-1',
    expect.objectContaining({ method: 'DELETE' }),
  );
});
```

- [ ] **Step 2: Add client delete**

Modify `mobile/src/api/client.js` return object:

```js
return {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  delete: (path) => request('DELETE', path),
};
```

- [ ] **Step 3: Add endpoint tests**

Create `mobile/__tests__/api/shareLinks.test.js`:

```js
import { createShareLink, getShareLink, revokeShareLink, initApi } from '../../src/api/endpoints';

global.fetch = jest.fn();

describe('share link endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initApi('https://example.com', 'key');
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ link: null }) });
  });

  test('getShareLink uses query params', async () => {
    await getShareLink('note', 'uuid-1');
    expect(fetch.mock.calls[0][0]).toBe('https://example.com/v1/share-links?item_type=note&item_uuid=uuid-1');
  });

  test('createShareLink posts item payload', async () => {
    await createShareLink('shortcut', 'uuid-2');
    expect(fetch.mock.calls[0][0]).toBe('https://example.com/v1/share-links');
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify({ item_type: 'shortcut', item_uuid: 'uuid-2' }));
  });

  test('revokeShareLink deletes by token', async () => {
    await revokeShareLink('tok');
    expect(fetch.mock.calls[0][0]).toBe('https://example.com/v1/share-links/tok');
    expect(fetch.mock.calls[0][1].method).toBe('DELETE');
  });
});
```

- [ ] **Step 4: Add endpoint functions**

Modify `mobile/src/api/endpoints.js`:

```js
export function getShareLink(itemType, itemUuid) {
  const type = encodeURIComponent(itemType);
  const uuid = encodeURIComponent(itemUuid);
  return client.get(`/v1/share-links?item_type=${type}&item_uuid=${uuid}`);
}

export function createShareLink(itemType, itemUuid) {
  return client.post('/v1/share-links', { item_type: itemType, item_uuid: itemUuid });
}

export function revokeShareLink(token) {
  return client.delete(`/v1/share-links/${encodeURIComponent(token)}`);
}
```

- [ ] **Step 5: Create mobile sheet component**

Create `mobile/src/components/ShareLinkSheet.js`:

```js
import React, { useEffect, useState } from 'react';
import { Alert, Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { createShareLink, getShareLink, revokeShareLink } from '../api/endpoints';
import { useTheme } from '../theme/ThemeContext';

export default function ShareLinkSheet({ visible, itemType, itemUuid, onClose }) {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState(null);

  useEffect(() => {
    if (!visible || !itemUuid) return;
    setLoading(true);
    getShareLink(itemType, itemUuid)
      .then((res) => setLink(res.link || null))
      .catch((e) => Alert.alert('Ошибка', String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [visible, itemType, itemUuid]);

  const create = async () => {
    try {
      setLoading(true);
      const next = await createShareLink(itemType, itemUuid);
      setLink(next);
      Clipboard.setString(next.public_url);
      Alert.alert('Ссылка создана', 'Ссылка скопирована');
    } catch (e) {
      Alert.alert('Ошибка', String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!link?.public_url) return;
    Clipboard.setString(link.public_url);
    Alert.alert('Скопировано', 'Ссылка скопирована');
  };

  const open = () => {
    if (link?.public_url) Linking.openURL(link.public_url);
  };

  const revoke = async () => {
    try {
      setLoading(true);
      await revokeShareLink(link.token);
      setLink(null);
      Alert.alert('Ссылка отозвана');
    } catch (e) {
      Alert.alert('Ошибка', String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.title, { color: colors.text }]}>Публичная ссылка</Text>
          <Text style={[s.status, { color: colors.textSecondary }]}>
            {loading ? 'Загрузка…' : link ? 'Live-ссылка активна' : 'Ссылка не создана'}
          </Text>
          {link ? <Text style={[s.url, { color: colors.text }]} numberOfLines={2}>{link.public_url}</Text> : null}
          <View style={s.actions}>
            {link ? (
              <>
                <Action label="Копировать" onPress={copy} colors={colors} />
                <Action label="Открыть" onPress={open} colors={colors} />
                <Action label="Отозвать" onPress={revoke} colors={colors} danger />
              </>
            ) : (
              <Action label="Создать ссылку" onPress={create} colors={colors} />
            )}
            <Action label="Закрыть" onPress={onClose} colors={colors} secondary />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Action({ label, onPress, colors, danger, secondary }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[s.btn, { backgroundColor: danger ? colors.danger : secondary ? colors.bgTertiary : colors.primary }]}
    >
      <Text style={[s.btnText, { color: secondary ? colors.text : '#fff' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 18 },
  sheet: { borderWidth: 1, borderRadius: 10, padding: 16 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  status: { fontSize: 14, marginBottom: 10 },
  url: { borderWidth: 1, borderColor: '#30363d', borderRadius: 6, padding: 10, marginBottom: 12 },
  actions: { gap: 8 },
  btn: { padding: 12, borderRadius: 8, alignItems: 'center' },
  btnText: { fontWeight: '600' },
});
```

- [ ] **Step 6: Run mobile API tests**

Run:

```bash
cd mobile && npm test -- --runInBand __tests__/api/client.test.js __tests__/api/shareLinks.test.js
```

Expected: API tests pass.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/api/client.js mobile/src/api/endpoints.js mobile/src/components/ShareLinkSheet.js mobile/__tests__/api/client.test.js mobile/__tests__/api/shareLinks.test.js
git commit -m "add mobile share link api"
```

---

### Task 7: Mobile Notes And Snippets UI

**Files:**

- Modify: `mobile/src/screens/Snippets/SnippetDetailScreen.js`
- Modify: `mobile/src/screens/Notes/NoteEditorScreen.js`

- [ ] **Step 1: Update snippet detail**

In `mobile/src/screens/Snippets/SnippetDetailScreen.js`:

1. Import `ShareLinkSheet`.
2. Add state:

```js
const [shareVisible, setShareVisible] = useState(false);
```

3. Replace content-only `Share.share(...)` usage with:

```jsx
<TouchableOpacity style={[s.iconBtn, { backgroundColor: colors.bgTertiary }]} onPress={() => setShareVisible(true)}>
  <Text style={[s.iconText, { color: colors.text }]}>🔗</Text>
</TouchableOpacity>
```

4. Render:

```jsx
<ShareLinkSheet
  visible={shareVisible}
  itemType="shortcut"
  itemUuid={snippet.uuid}
  onClose={() => setShareVisible(false)}
/>
```

Keep content copy as the primary text button.

- [ ] **Step 2: Update note editor**

In `mobile/src/screens/Notes/NoteEditorScreen.js`:

1. Import `ShareLinkSheet` and `Clipboard`.
2. Add state:

```js
const [shareVisible, setShareVisible] = useState(false);
```

3. In `navigation.setOptions`, render header actions:

```jsx
<View style={s.headerActions}>
  <TouchableOpacity onPress={() => setShareVisible(true)} style={s.headerIconBtn}>
    <Text style={{ color: colors.primary, fontSize: 18 }}>🔗</Text>
  </TouchableOpacity>
  <TouchableOpacity onPress={save} disabled={saving} style={s.headerBtn}>
    <Text style={[s.headerBtnText, { color: saving ? colors.textMuted : colors.primary }]}>
      {saving ? 'Сохр…' : 'Сохранить'}
    </Text>
  </TouchableOpacity>
</View>
```

4. Add a compact copy action near the segmented control:

```jsx
<TouchableOpacity
  style={[s.copyBtn, { borderColor: colors.border }]}
  onPress={() => {
    Clipboard.setString(content || '');
    Alert.alert('Скопировано', 'Текст заметки скопирован');
  }}
>
  <Text style={{ color: colors.primary }}>Copy</Text>
</TouchableOpacity>
```

5. Render:

```jsx
<ShareLinkSheet
  visible={shareVisible}
  itemType="note"
  itemUuid={note.uuid}
  onClose={() => setShareVisible(false)}
/>
```

- [ ] **Step 3: Run mobile syntax/tests**

Run:

```bash
cd mobile && npm test -- --runInBand
```

Expected: all Jest suites pass.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/screens/Snippets/SnippetDetailScreen.js mobile/src/screens/Notes/NoteEditorScreen.js
git commit -m "add mobile share link ui"
```

---

### Task 8: Post-Release Smoke Contract

**Files:**

- Create: `tests/post_release/test_share_links_contract.py`

- [ ] **Step 1: Add smoke test**

Create `tests/post_release/test_share_links_contract.py`:

```python
def _push(api_client, changes):
    status, data = api_client.request_json("POST", "/v1/sync/push", {"changes": changes})
    assert status == 200, data
    return data


def test_share_links_live_note_and_shortcut(smoke_config, api_client, public_http, iso_timestamp, unique_prefix, uuid_factory):
    note_uuid = uuid_factory()
    shortcut_uuid = uuid_factory()

    _push(api_client, {
        "notes": [{
            "uuid": note_uuid,
            "title": f"{unique_prefix}_note_v1",
            "content": "note content v1",
            "updated_at": iso_timestamp(),
            "is_deleted": False,
        }],
        "shortcuts": [{
            "uuid": shortcut_uuid,
            "name": f"{unique_prefix}_snippet_v1",
            "value": "snippet value v1",
            "description": "snippet description",
            "links": '[{"label":"Docs","url":"https://example.com"}]',
            "obsidian_note": "must not leak",
            "updated_at": iso_timestamp(),
            "is_deleted": False,
        }],
    })

    status, note_link = api_client.request_json("POST", "/v1/share-links", {"item_type": "note", "item_uuid": note_uuid})
    assert status == 200, note_link
    status, snippet_link = api_client.request_json("POST", "/v1/share-links", {"item_type": "shortcut", "item_uuid": shortcut_uuid})
    assert status == 200, snippet_link

    status, public_note = public_http.request_json("GET", f"{smoke_config.api_base_url}/v1/public/share/{note_link['token']}", timeout=30)
    assert status == 200, public_note
    assert public_note == {"type": "note", "title": f"{unique_prefix}_note_v1", "content": "note content v1"}

    status, public_snippet = public_http.request_json("GET", f"{smoke_config.api_base_url}/v1/public/share/{snippet_link['token']}", timeout=30)
    assert status == 200, public_snippet
    assert public_snippet["name"] == f"{unique_prefix}_snippet_v1"
    assert public_snippet["value"] == "snippet value v1"
    assert "obsidian_note" not in public_snippet

    _push(api_client, {
        "notes": [{
            "uuid": note_uuid,
            "title": f"{unique_prefix}_note_v2",
            "content": "note content v2",
            "updated_at": iso_timestamp(20),
            "is_deleted": False,
        }],
    })
    status, public_note_v2 = public_http.request_json("GET", f"{smoke_config.api_base_url}/v1/public/share/{note_link['token']}")
    assert status == 200, public_note_v2
    assert public_note_v2["title"] == f"{unique_prefix}_note_v2"
    assert public_note_v2["content"] == "note content v2"

    status, _ = api_client.request_json("DELETE", f"/v1/share-links/{note_link['token']}")
    assert status == 200
    status, revoked = public_http.request_json("GET", f"{smoke_config.api_base_url}/v1/public/share/{note_link['token']}")
    assert status == 404, revoked
```

- [ ] **Step 2: Run against local code only where possible**

Run:

```bash
python3 -m py_compile tests/post_release/test_share_links_contract.py
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add tests/post_release/test_share_links_contract.py
git commit -m "add share link smoke"
```

---

### Task 9: Release Docs, Versions, And Full Verification

**Files:**

- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock`
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`

- [ ] **Step 1: Update help/release history**

Add a new top section for the release:

```markdown
## v1.3.32 (2026-05-24)

- Added public live share links for Notes and Snippets.
- Desktop and mobile can create, copy, preview, and revoke share links.
- Snippet pinned chips now show the same pin icon as Tasks pinned chips.
```

In `desktop-rust/src/tabs/help.js`, update EN/RU feature text for Notes and Snippets to mention public live share links.

- [ ] **Step 2: Bump versions**

Use the next desktop version after current `1.3.31`: `1.3.32`.

Modify:

```text
desktop-rust/src-tauri/Cargo.toml
desktop-rust/src-tauri/tauri.conf.json
```

Bump mobile OTA from `1.0.17` to `1.0.18`:

```text
mobile/package.json
mobile/package-lock.json
```

- [ ] **Step 3: Refresh Cargo.lock**

Run:

```bash
cd desktop-rust/src-tauri && /home/aster/.cargo/bin/cargo check
```

Expected: exits 0 and updates lockfile only if needed.

- [ ] **Step 4: Full local verification**

Run:

```bash
python3 -m py_compile api/models.py api/schemas.py api/share_utils.py api/routes/share_links.py api/alembic/versions/008_add_share_links.py tests/post_release/test_share_links_contract.py
bash tests/post_release/run.sh tests/api/test_share_utils.py -q
node --check desktop-rust/src/components/share-link-modal.js
node --check desktop-rust/src/tabs/shortcuts.js
node --check desktop-rust/src/tabs/notes.js
node --check desktop-rust/src/dev-mock.js
cd desktop-rust/src && python3 dev-test.py
cd ../src-tauri && /home/aster/.cargo/bin/cargo check
cd ../../../mobile && npm test -- --runInBand
```

Expected:

- py_compile exits 0.
- helper tests pass.
- JS syntax exits 0.
- desktop dev-test reports all tests passed.
- cargo check exits 0.
- mobile Jest passes.

- [ ] **Step 5: Commit release prep**

```bash
git add desktop-rust/src/tabs/help.js desktop-rust/CHANGELOG.md desktop-rust/src/release-history.md desktop-rust/src-tauri/Cargo.toml desktop-rust/src-tauri/tauri.conf.json desktop-rust/src-tauri/Cargo.lock mobile/package.json mobile/package-lock.json
git commit -m "prepare share links release (v1.3.32)"
```

---

### Task 10: Deploy And Release

**Files:** no planned source edits unless production nginx lacks `/share/` routing.

- [ ] **Step 1: Push main**

```bash
git push
```

Expected: main pushed with all share-link commits.

- [ ] **Step 2: Deploy API**

Run on server:

```bash
ssh snippets-api 'cd /opt/snippets_helper && git pull --ff-only && docker-compose up --build -d'
```

If docker-compose v1 hits stale `ContainerConfig`, remove only stale `snippets_migrate` / `snippets_api` containers and rerun:

```bash
ssh snippets-api 'ids=$(docker ps -a --filter name=snippets_migrate -q); if [ -n "$ids" ]; then docker rm -f $ids; fi; cd /opt/snippets_helper && docker-compose up --build -d'
ssh snippets-api 'ids=$(docker ps -a --filter name=snippets_api -q); if [ -n "$ids" ]; then docker rm -f $ids; fi; cd /opt/snippets_helper && docker-compose up -d --no-deps api'
```

- [ ] **Step 3: Verify API migration**

```bash
wget -qO- https://ister-app.ru/snippets-api/v1/health
ssh snippets-api 'cd /opt/snippets_helper && docker-compose ps && docker logs --tail 80 snippets_migrate'
```

Expected:

- health returns `{"status":"ok"}`;
- migration logs include `Running upgrade 007 -> 008`.

- [ ] **Step 4: Verify public route proxy**

```bash
wget -S --spider https://ister-app.ru/share/not-a-real-token
```

Expected: HTTP 404 from the API route. If nginx returns a generic site 404 before reaching API, add a production nginx location that proxies `/share/` to `snippets_api:8001`, then reload nginx and rerun this check.

- [ ] **Step 5: Cut desktop release**

```bash
git tag v1.3.32
git push origin v1.3.32
```

Monitor GitHub Actions release workflow until `success`, then verify:

```bash
wget -qO- https://github.com/IgorSterkhov/snippets_helper/releases/download/v1.3.32/frontend-version.json
wget -qO- https://api.github.com/repos/IgorSterkhov/snippets_helper/releases/tags/v1.3.32
```

Expected: frontend manifest returns `1.3.32-f<sha>`; release has frontend assets, `latest.json`, and native installer assets.

- [ ] **Step 6: Publish mobile OTA 1.0.18**

Build:

```bash
rm -rf /tmp/ota-bundle /tmp/bundle-1.0.18.zip
mkdir -p /tmp/ota-bundle/output
cd mobile && npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/ota-bundle/output/index.android.bundle --assets-dest /tmp/ota-bundle/output/assets
cd /tmp/ota-bundle && python3 -m zipfile -c /tmp/bundle-1.0.18.zip output
scp /tmp/bundle-1.0.18.zip snippets-api:/opt/isterapp/releases/snippets-updates/bundle-1.0.18.zip
ssh snippets-api 'cat > /opt/isterapp/releases/snippets-updates/latest.json <<JSON
{"version":"1.0.18","bundle_url":"https://ister-app.ru/snippets-updates/bundle-1.0.18.zip","release_notes":"Public live share links for notes and snippets."}
JSON'
```

Verify:

```bash
wget -qO- https://ister-app.ru/snippets-updates/latest.json
wget -S --spider https://ister-app.ru/snippets-updates/bundle-1.0.18.zip
```

Expected: manifest version `1.0.18`; bundle returns HTTP 200.

- [ ] **Step 7: Run post-release smoke**

```bash
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api POST_RELEASE_REGISTER_USER=1 POST_RELEASE_DESKTOP_TAG=v1.3.32 POST_RELEASE_MOBILE_VERSION=1.0.18 bash tests/post_release/run.sh -q
```

Expected: all post-release tests pass, including share-link live/revoke contract.

- [ ] **Step 8: Final git check**

```bash
git status --short
```

Expected: clean worktree.

---

## Self-Review Checklist

- Spec coverage: API, public page, desktop UI, mobile UI, security, revoke, live behavior, release, and smoke are covered by tasks.
- Sync boundary: `share_links` is excluded from generic sync in every task.
- Type consistency: API and desktop/mobile use `item_type` / `item_uuid`; desktop JS maps to Tauri camelCase args `itemType` / `itemUuid`.
- Release type: desktop is a full `v*` release because native commands are added; mobile is OTA because no native dependency is added.
