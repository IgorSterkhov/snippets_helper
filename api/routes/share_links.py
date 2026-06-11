from datetime import datetime
from urllib.parse import urlparse
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from api.database import get_db
from api.media_utils import public_html_base_url
from api.models import FinanceItem, FinancePlan, Note, ShareLink, Shortcut, TelegraphPage, User
from api.schemas import (
    ShareLinkRequest,
    ShareLinkResponse,
    ShareLinkStatusResponse,
    TelegraphPageResponse,
    TelegraphPublishRequest,
    TelegraphStatusResponse,
)
from api.share_utils import (
    build_public_url,
    generate_share_token,
    public_note_payload,
    public_finance_plan_payload,
    public_shortcut_payload,
    render_share_html,
)
from api.telegraph import (
    TELEGRAPH_AUTHOR_NAME,
    TelegraphClient,
    TelegraphError,
    content_hash,
    markdown_to_telegraph_nodes,
    telegraph_short_name,
)


router = APIRouter(prefix="/share-links", tags=["share-links"])
public_router = APIRouter(tags=["public-share"])

VALID_ITEM_TYPES = {"note", "shortcut", "finance_plan"}
TELEGRAPH_ITEM_TYPES = {"note", "shortcut"}


def _public_html_frame_source() -> str:
    parsed = urlparse(public_html_base_url())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    port = f":{parsed.port}" if parsed.port else ""
    return f" {parsed.scheme}://{parsed.hostname}{port}"


def _public_share_csp() -> str:
    return (
        "default-src 'none'; "
        "script-src 'unsafe-inline'; "
        "style-src 'unsafe-inline'; "
        "img-src 'self' https: data: blob:; "
        f"frame-src 'self'{_public_html_frame_source()}; "
        "connect-src 'none'; "
        "object-src 'none'; "
        "base-uri 'none'; "
        "form-action 'none'"
    )


PUBLIC_SHARE_HEADERS = {
    "Content-Security-Policy": _public_share_csp(),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


def _validate_item_type(item_type: str) -> str:
    if item_type not in VALID_ITEM_TYPES:
        raise HTTPException(status_code=400, detail="item_type must be note, shortcut, or finance_plan")
    return item_type


def _validate_telegraph_item_type(item_type: str) -> str:
    if item_type not in TELEGRAPH_ITEM_TYPES:
        raise HTTPException(status_code=400, detail="Telegra.ph supports only note or shortcut")
    return item_type


def _parse_uuid(value: str) -> UUID:
    try:
        return UUID(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="item_uuid must be a valid UUID") from exc


def _response(link: ShareLink, request: Request) -> ShareLinkResponse:
    return ShareLinkResponse(
        token=link.token,
        public_url=build_public_url(
            str(request.url),
            link.token,
            forwarded_proto=request.headers.get("x-forwarded-proto"),
        ),
        item_type=link.item_type,
        item_uuid=str(link.item_uuid),
        is_active=link.is_active,
        created_at=link.created_at,
        updated_at=link.updated_at,
        revoked_at=link.revoked_at,
    )


def _telegraph_response(page: TelegraphPage) -> TelegraphPageResponse:
    return TelegraphPageResponse(
        item_type=page.item_type,
        item_uuid=str(page.item_uuid),
        url=page.url,
        path=page.path,
        title=page.title,
        content_hash=page.content_hash,
        views=page.views,
        created_at=page.created_at,
        updated_at=page.updated_at,
        published_at=page.published_at,
    )


async def _load_owned_item(
    db: AsyncSession,
    user_id: UUID,
    item_type: str,
    item_uuid: UUID,
):
    model_by_type = {
        "note": Note,
        "shortcut": Shortcut,
        "finance_plan": FinancePlan,
    }
    model = model_by_type[item_type]
    result = await db.execute(
        select(model).where(
            model.uuid == item_uuid,
            model.user_id == user_id,
            model.is_deleted == False,  # noqa: E712
        )
    )
    return result.scalar_one_or_none()


async def _load_telegraph_page(
    db: AsyncSession,
    user_id: UUID,
    item_type: str,
    item_uuid: UUID,
) -> TelegraphPage | None:
    result = await db.execute(
        select(TelegraphPage).where(
            TelegraphPage.user_id == user_id,
            TelegraphPage.item_type == item_type,
            TelegraphPage.item_uuid == item_uuid,
        )
    )
    return result.scalar_one_or_none()


def _item_telegraph_content(item_type: str, item) -> tuple[str, str]:
    if item_type == "note":
        return item.title or "Untitled note", item.content or ""
    parts = [item.value or ""]
    if item.description:
        parts.extend(["", "## Description", item.description])
    for link in public_shortcut_payload(item).get("links", []):
        label = link.get("label") or link.get("url") or "Link"
        url = link.get("url") or ""
        parts.append(f"- [{label}]({url})")
    return item.name or "Untitled snippet", "\n".join(parts)


async def _ensure_telegraph_account(user: User, db: AsyncSession) -> str:
    if user.telegraph_access_token:
        return user.telegraph_access_token
    short_name = telegraph_short_name(user.api_key)
    try:
        account = await TelegraphClient().create_account(
            short_name=short_name,
            author_name=TELEGRAPH_AUTHOR_NAME,
            author_url="",
        )
    except (httpx.HTTPError, TelegraphError) as exc:
        raise HTTPException(status_code=502, detail=f"Telegraph account setup failed: {exc}") from exc
    token = str(account.get("access_token") or "").strip()
    if not token:
        raise HTTPException(status_code=502, detail="Telegraph account setup failed")
    now = datetime.utcnow()
    user.telegraph_access_token = token
    user.telegraph_short_name = short_name
    user.telegraph_author_name = TELEGRAPH_AUTHOR_NAME
    user.telegraph_author_url = ""
    user.telegraph_updated_at = now
    await db.commit()
    await db.refresh(user)
    return token


async def _load_active_link(
    db: AsyncSession,
    user_id: UUID,
    item_type: str,
    item_uuid: UUID,
) -> ShareLink | None:
    result = await db.execute(
        select(ShareLink).where(
            ShareLink.user_id == user_id,
            ShareLink.item_type == item_type,
            ShareLink.item_uuid == item_uuid,
            ShareLink.is_active == True,  # noqa: E712
        )
    )
    return result.scalar_one_or_none()


@router.get("", response_model=ShareLinkStatusResponse)
async def get_share_link(
    item_type: str,
    item_uuid: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    validated_type = _validate_item_type(item_type)
    uuid_value = _parse_uuid(item_uuid)
    link = await _load_active_link(db, user.id, validated_type, uuid_value)
    return ShareLinkStatusResponse(link=_response(link, request) if link else None)


@router.get("/telegraph", response_model=TelegraphStatusResponse)
async def get_telegraph_page(
    item_type: str,
    item_uuid: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    validated_type = _validate_telegraph_item_type(item_type)
    uuid_value = _parse_uuid(item_uuid)
    item = await _load_owned_item(db, user.id, validated_type, uuid_value)
    if item is None:
        raise HTTPException(status_code=404, detail="item not found")
    page = await _load_telegraph_page(db, user.id, validated_type, uuid_value)
    if not page:
        return TelegraphStatusResponse(page=None)
    return TelegraphStatusResponse(page=_telegraph_response(page))


@router.post("/telegraph/publish", response_model=TelegraphPageResponse)
async def publish_telegraph_page(
    req: TelegraphPublishRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item_type = _validate_telegraph_item_type(req.item_type)
    uuid_value = _parse_uuid(req.item_uuid)
    item = await _load_owned_item(db, user.id, item_type, uuid_value)
    if item is None:
        raise HTTPException(status_code=404, detail="item not found")

    access_token = await _ensure_telegraph_account(user, db)
    title, markdown = _item_telegraph_content(item_type, item)
    nodes = markdown_to_telegraph_nodes(title, markdown)
    digest = content_hash(nodes)
    page = await _load_telegraph_page(db, user.id, item_type, uuid_value)
    client = TelegraphClient()
    try:
        if page:
            published = await client.edit_page(
                access_token=access_token,
                path=page.path,
                title=title,
                content=nodes,
                author_name=user.telegraph_author_name or TELEGRAPH_AUTHOR_NAME,
                author_url=user.telegraph_author_url or "",
            )
        else:
            published = await client.create_page(
                access_token=access_token,
                title=title,
                content=nodes,
                author_name=user.telegraph_author_name or TELEGRAPH_AUTHOR_NAME,
                author_url=user.telegraph_author_url or "",
            )
    except (httpx.HTTPError, TelegraphError) as exc:
        raise HTTPException(status_code=502, detail=f"Telegraph publish failed: {exc}") from exc

    now = datetime.utcnow()
    if page:
        page.path = published.path
        page.url = published.url
        page.title = published.title
        page.content_hash = digest
        page.views = published.views if published.views is not None else page.views
        page.updated_at = now
        page.published_at = now
    else:
        page = TelegraphPage(
            user_id=user.id,
            item_type=item_type,
            item_uuid=uuid_value,
            path=published.path,
            url=published.url,
            title=published.title,
            content_hash=digest,
            views=published.views,
            created_at=now,
            updated_at=now,
            published_at=now,
        )
        db.add(page)
    await db.commit()
    await db.refresh(page)
    return _telegraph_response(page)


@router.post("", response_model=ShareLinkResponse)
async def create_share_link(
    req: ShareLinkRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item_type = _validate_item_type(req.item_type)
    uuid_value = _parse_uuid(req.item_uuid)
    item = await _load_owned_item(db, user.id, item_type, uuid_value)
    if item is None:
        raise HTTPException(status_code=404, detail="item not found")

    existing = await _load_active_link(db, user.id, item_type, uuid_value)
    if existing:
        return _response(existing, request)

    for _ in range(5):
        token = generate_share_token()
        if await db.get(ShareLink, token) is not None:
            continue

        now = datetime.utcnow()
        link = ShareLink(
            token=token,
            user_id=user.id,
            item_type=item_type,
            item_uuid=uuid_value,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        db.add(link)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            existing = await _load_active_link(db, user.id, item_type, uuid_value)
            if existing:
                return _response(existing, request)
            continue
        await db.refresh(link)
        return _response(link, request)

    raise HTTPException(status_code=500, detail="could not allocate token")


@router.delete("/{token}", response_model=ShareLinkStatusResponse)
async def revoke_share_link(
    token: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ShareLink).where(ShareLink.token == token, ShareLink.user_id == user.id)
    )
    link = result.scalar_one_or_none()
    if link and link.is_active:
        now = datetime.utcnow()
        link.is_active = False
        link.revoked_at = now
        link.updated_at = now
        await db.commit()
    return ShareLinkStatusResponse(link=None)


async def _public_payload(token: str, db: AsyncSession) -> dict:
    result = await db.execute(
        select(ShareLink).where(
            ShareLink.token == token,
            ShareLink.is_active == True,  # noqa: E712
        )
    )
    link = result.scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=404, detail="not found")

    row = await _load_owned_item(db, link.user_id, link.item_type, link.item_uuid)
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    if link.item_type == "note":
        return public_note_payload(row)
    if link.item_type == "finance_plan":
        result = await db.execute(
            select(FinanceItem).where(
                FinanceItem.user_id == link.user_id,
                FinanceItem.plan_uuid == link.item_uuid,
                FinanceItem.is_deleted == False,  # noqa: E712
            )
        )
        items = result.scalars().all()
        return public_finance_plan_payload(row, items)
    return public_shortcut_payload(row)


@public_router.get("/v1/public/share/{token}")
async def public_share_json(token: str, db: AsyncSession = Depends(get_db)):
    return await _public_payload(token, db)


@public_router.get("/share/{token}", response_class=HTMLResponse)
async def public_share_html(token: str, db: AsyncSession = Depends(get_db)):
    return HTMLResponse(
        render_share_html(await _public_payload(token, db)),
        headers=PUBLIC_SHARE_HEADERS,
    )
