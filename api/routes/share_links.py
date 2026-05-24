from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
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

VALID_ITEM_TYPES = {"note", "shortcut"}


def _validate_item_type(item_type: str) -> str:
    if item_type not in VALID_ITEM_TYPES:
        raise HTTPException(status_code=400, detail="item_type must be note or shortcut")
    return item_type


def _parse_uuid(value: str) -> UUID:
    try:
        return UUID(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="item_uuid must be a valid UUID") from exc


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


async def _load_owned_item(
    db: AsyncSession,
    user_id: UUID,
    item_type: str,
    item_uuid: UUID,
):
    model = Note if item_type == "note" else Shortcut
    result = await db.execute(
        select(model).where(
            model.uuid == item_uuid,
            model.user_id == user_id,
            model.is_deleted == False,  # noqa: E712
        )
    )
    return result.scalar_one_or_none()


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
    return public_shortcut_payload(row)


@public_router.get("/v1/public/share/{token}")
async def public_share_json(token: str, db: AsyncSession = Depends(get_db)):
    return await _public_payload(token, db)


@public_router.get("/share/{token}", response_class=HTMLResponse)
async def public_share_html(token: str, db: AsyncSession = Depends(get_db)):
    return HTMLResponse(render_share_html(await _public_payload(token, db)))
