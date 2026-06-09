import asyncio
import hashlib
import os
import uuid as uuid_mod
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from api.database import async_session, get_db
from api.image_processing import ImageProcessingError, generate_variants, validate_image_bytes
from api.media_utils import generate_media_token, media_root, public_html_url, public_media_url, safe_media_path
from api.models import MediaAsset, MediaAssetVariant, User
from api.schemas import (
    HtmlUploadResponse,
    MediaDeleteResponse,
    MediaJobResponse,
    MediaSelectRequest,
    MediaSelectResponse,
    MediaUploadResponse,
    MediaVariantResponse,
)

router = APIRouter(prefix="/media", tags=["media"])

MAX_DECODED_PIXELS = 48_000_000
HTML_EXTENSIONS = {".html", ".htm"}
HTML_MIME_TYPE = "text/html; charset=utf-8"
HTML_RESPONSE_CSP = (
    "sandbox allow-scripts; "
    "default-src 'none'; "
    "script-src 'unsafe-inline'; "
    "style-src 'unsafe-inline'; "
    "img-src data: blob:; "
    "font-src data:; "
    "media-src data: blob:; "
    "connect-src 'none'; "
    "frame-src 'none'; "
    "worker-src 'none'; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'none'"
)
_jobs: dict[str, dict] = {}
_jobs_lock = asyncio.Lock()
_quota_locks: dict[str, asyncio.Lock] = {}


def _quota_lock(user_id) -> asyncio.Lock:
    key = str(user_id)
    lock = _quota_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _quota_locks[key] = lock
    return lock


def _variant_response(row: MediaAssetVariant) -> MediaVariantResponse:
    return MediaVariantResponse(
        variant=row.variant,
        public_token=row.public_token,
        preview_url=public_media_url(row.public_token),
        mime_type=row.mime_type,
        size_bytes=row.size_bytes,
        width=row.width,
        height=row.height,
        sha256=row.sha256,
    )


async def _set_job(job_id: str, **patch) -> None:
    async with _jobs_lock:
        current = _jobs.setdefault(job_id, {"job_id": job_id, "status": "queued"})
        current.update(patch)


async def _media_used_bytes(db: AsyncSession, user_id) -> int:
    result = await db.execute(
        select(func.coalesce(func.sum(MediaAssetVariant.size_bytes), 0))
        .join(MediaAsset, MediaAsset.uuid == MediaAssetVariant.asset_uuid)
        .where(MediaAsset.user_id == user_id, MediaAsset.is_deleted == False)  # noqa: E712
    )
    return int(result.scalar_one() or 0)


def _safe_original_file_name(name: str | None, fallback: str) -> str:
    candidate = Path(name or fallback).name.strip()
    return candidate or fallback


def _html_title_from_filename(name: str | None) -> str:
    candidate = Path(name or "presentation.html").name.strip()
    stem = Path(candidate).stem.strip()
    return stem or "HTML"


def _markdown_html_alt(title: str) -> str:
    cleaned = " ".join((title or "HTML").replace("[", "(").replace("]", ")").split())
    return cleaned or "HTML"


def _validate_html_upload(file_name: str | None, content: bytes) -> tuple[str, bytes]:
    if not content:
        raise HTTPException(status_code=400, detail="upload is empty")
    safe_name = _safe_original_file_name(file_name, "presentation.html")
    if Path(safe_name).suffix.lower() not in HTML_EXTENSIONS:
        raise HTTPException(status_code=400, detail="only .html and .htm files are supported")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="HTML file must be UTF-8 encoded") from exc
    lowered = text[:4096].lower()
    if "<html" not in lowered and "<!doctype html" not in lowered and "<body" not in lowered:
        raise HTTPException(status_code=400, detail="file does not look like an HTML document")
    if "\x00" in text:
        raise HTTPException(status_code=400, detail="HTML file contains invalid NUL bytes")
    return safe_name, text.encode("utf-8")


async def _process_upload_job(
    job_id: str,
    user_id: uuid_mod.UUID,
    original_file_name: str,
    content: bytes,
) -> None:
    written_paths: list[Path] = []
    try:
        await _set_job(job_id, status="processing", progress_current=1, progress_total=4)
        variants = generate_variants(content, include_original=True)
        await _set_job(job_id, progress_current=2, progress_total=4)

        root = media_root()
        root.mkdir(parents=True, exist_ok=True)
        asset_uuid = uuid_mod.uuid4()
        now = datetime.utcnow()
        variant_rows: list[MediaAssetVariant] = []

        for variant in variants:
            public_token = generate_media_token()
            path = safe_media_path(root, public_token, "webp")
            path.write_bytes(variant.content)
            written_paths.append(path)
            variant_rows.append(
                MediaAssetVariant(
                    asset_uuid=asset_uuid,
                    variant=variant.variant,
                    public_token=public_token,
                    storage_path=str(path),
                    mime_type=variant.mime_type,
                    size_bytes=len(variant.content),
                    width=variant.width,
                    height=variant.height,
                    sha256=variant.sha256,
                    created_at=now,
                )
            )

        await _set_job(job_id, progress_current=3, progress_total=4)
        total_bytes = sum(v.size_bytes for v in variant_rows)

        async with _quota_lock(user_id):
            async with async_session() as db:
                result = await db.execute(select(User).where(User.id == user_id).with_for_update())
                user = result.scalar_one_or_none()
                if not user:
                    raise ValueError("user not found")
                used = await _media_used_bytes(db, user.id)
                if used + total_bytes > user.media_quota_bytes:
                    raise ValueError("upload exceeds media quota")
                asset = MediaAsset(
                    uuid=asset_uuid,
                    user_id=user.id,
                    original_file_name=original_file_name or "image",
                    selected_variant="balanced",
                    created_at=now,
                    updated_at=now,
                    is_deleted=False,
                )
                db.add(asset)
                for row in variant_rows:
                    db.add(row)
                await db.commit()

        await _set_job(
            job_id,
            status="ready",
            progress_current=4,
            progress_total=4,
            asset_uuid=str(asset_uuid),
            variants=[_variant_response(v).model_dump() for v in variant_rows],
        )
    except Exception as exc:
        for path in written_paths:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        await _set_job(job_id, status="failed", error=str(exc))


@router.post("/uploads", response_model=MediaUploadResponse)
async def upload_media(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="upload is empty")
    if len(content) > user.media_max_upload_bytes:
        raise HTTPException(status_code=413, detail="upload exceeds max upload limit")
    try:
        width, height = validate_image_bytes(content)
    except ImageProcessingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if width * height > MAX_DECODED_PIXELS:
        raise HTTPException(status_code=413, detail="image dimensions are too large")

    job_id = generate_media_token()
    await _set_job(
        job_id,
        status="queued",
        progress_current=0,
        progress_total=4,
        user_id=str(user.id),
    )
    background_tasks.add_task(
        _process_upload_job,
        job_id,
        user.id,
        file.filename or "image",
        content,
    )
    return MediaUploadResponse(job_id=job_id, status="queued")


@router.post("/html/uploads", response_model=HtmlUploadResponse)
async def upload_html_media(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    content = await file.read()
    if len(content) > user.media_max_upload_bytes:
        raise HTTPException(status_code=413, detail="upload exceeds max upload limit")
    original_file_name, normalized = _validate_html_upload(file.filename, content)
    total_bytes = len(normalized)
    root = media_root()
    root.mkdir(parents=True, exist_ok=True)
    asset_uuid = uuid_mod.uuid4()
    public_token = generate_media_token()
    path = safe_media_path(root, public_token, "html")
    now = datetime.utcnow()
    path.write_bytes(normalized)
    try:
        async with _quota_lock(user.id):
            async with async_session() as db:
                result = await db.execute(select(User).where(User.id == user.id).with_for_update())
                locked_user = result.scalar_one_or_none()
                if not locked_user:
                    raise ValueError("user not found")
                used = await _media_used_bytes(db, locked_user.id)
                if used + total_bytes > locked_user.media_quota_bytes:
                    raise ValueError("upload exceeds media quota")
                asset = MediaAsset(
                    uuid=asset_uuid,
                    user_id=locked_user.id,
                    original_file_name=original_file_name,
                    selected_variant="html",
                    created_at=now,
                    updated_at=now,
                    is_deleted=False,
                )
                variant = MediaAssetVariant(
                    asset_uuid=asset_uuid,
                    variant="html",
                    public_token=public_token,
                    storage_path=str(path),
                    mime_type=HTML_MIME_TYPE,
                    size_bytes=total_bytes,
                    width=0,
                    height=0,
                    sha256=hashlib.sha256(normalized).hexdigest(),
                    created_at=now,
                )
                db.add(asset)
                db.add(variant)
                await db.commit()
    except Exception as exc:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        if isinstance(exc, ValueError):
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        raise

    title = _html_title_from_filename(original_file_name)
    url = public_html_url(public_token)
    return HtmlUploadResponse(
        asset_uuid=str(asset_uuid),
        markdown=f"![html:{_markdown_html_alt(title)}]({url})",
        url=url,
        title=title,
        size_bytes=total_bytes,
    )


@router.get("/html/{public_token}")
async def get_public_html_media(public_token: str, db: AsyncSession = Depends(get_db)):
    if not public_token or not all(ch.isalnum() or ch in "_-" for ch in public_token):
        raise HTTPException(status_code=404, detail="asset not found")
    result = await db.execute(
        select(MediaAssetVariant, MediaAsset)
        .join(MediaAsset, MediaAsset.uuid == MediaAssetVariant.asset_uuid)
        .where(
            MediaAssetVariant.public_token == public_token,
            MediaAssetVariant.variant == "html",
            MediaAsset.is_deleted == False,  # noqa: E712
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="asset not found")
    variant, _asset = row
    try:
        content = Path(variant.storage_path).read_bytes()
    except OSError as exc:
        raise HTTPException(status_code=404, detail="asset file not found") from exc
    return Response(
        content=content,
        media_type=HTML_MIME_TYPE,
        headers={
            "Content-Security-Policy": HTML_RESPONSE_CSP,
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    )


@router.get("/jobs/{job_id}", response_model=MediaJobResponse)
async def get_media_job(job_id: str, user: User = Depends(get_current_user)):
    async with _jobs_lock:
        job = dict(_jobs.get(job_id) or {})
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    if job.get("user_id") != str(user.id) and not user.is_admin:
        raise HTTPException(status_code=403, detail="forbidden")
    return MediaJobResponse(
        job_id=job_id,
        status=job.get("status", "queued"),
        progress_current=job.get("progress_current", 0),
        progress_total=job.get("progress_total", 0),
        asset_uuid=job.get("asset_uuid"),
        variants=job.get("variants") or [],
        error=job.get("error"),
    )


async def _load_owned_asset(db: AsyncSession, user: User, asset_uuid: uuid_mod.UUID) -> MediaAsset:
    result = await db.execute(
        select(MediaAsset).where(
            MediaAsset.uuid == asset_uuid,
            MediaAsset.is_deleted == False,  # noqa: E712
        )
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="asset not found")
    if asset.user_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="forbidden")
    return asset


@router.post("/assets/{asset_uuid}/select", response_model=MediaSelectResponse)
async def select_media_variant(
    asset_uuid: str,
    req: MediaSelectRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        asset_id = uuid_mod.UUID(asset_uuid)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="asset_uuid must be a UUID") from exc
    asset = await _load_owned_asset(db, user, asset_id)
    result = await db.execute(
        select(MediaAssetVariant).where(
            MediaAssetVariant.asset_uuid == asset.uuid,
            MediaAssetVariant.variant == req.variant,
        )
    )
    variant = result.scalar_one_or_none()
    if not variant:
        raise HTTPException(status_code=404, detail="variant not found")
    asset.selected_variant = req.variant
    asset.updated_at = datetime.utcnow()
    await db.commit()
    caption = os.path.splitext(asset.original_file_name or "image")[0] or "image"
    url = public_media_url(variant.public_token)
    return MediaSelectResponse(
        asset_uuid=str(asset.uuid),
        variant=variant.variant,
        markdown=f"![{caption}]({url})",
        url=url,
        width=variant.width,
        height=variant.height,
        size_bytes=variant.size_bytes,
    )


@router.delete("/assets/{asset_uuid}", response_model=MediaDeleteResponse)
async def delete_media_asset(
    asset_uuid: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        asset_id = uuid_mod.UUID(asset_uuid)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="asset_uuid must be a UUID") from exc
    asset = await _load_owned_asset(db, user, asset_id)
    result = await db.execute(
        select(MediaAssetVariant).where(MediaAssetVariant.asset_uuid == asset.uuid)
    )
    variants = result.scalars().all()
    asset.is_deleted = True
    asset.updated_at = datetime.utcnow()
    await db.commit()
    for variant in variants:
        try:
            Path(variant.storage_path).unlink(missing_ok=True)
        except OSError:
            pass
    return MediaDeleteResponse()
