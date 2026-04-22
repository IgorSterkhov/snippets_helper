from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from api.database import get_db
from api.models import User, TABLE_MODELS
from api.schemas import (
    PushRequest, PushResponse, ConflictInfo,
    PullRequest, PullResponse,
)
from api.auth import get_current_user

router = APIRouter(prefix="/sync", tags=["sync"])


def _get_data_columns(model):
    """Get all column names except uuid, user_id, is_deleted."""
    skip = {"uuid", "user_id", "is_deleted"}
    return [c.key for c in model.__table__.columns if c.key not in skip]


def _row_to_dict(row, columns: list[str]) -> dict:
    """Convert an ORM row to a dict with specified columns."""
    d = {"uuid": str(row.uuid), "is_deleted": row.is_deleted}
    for col in columns:
        val = getattr(row, col, None)
        if isinstance(val, datetime):
            d[col] = val.isoformat()
        elif isinstance(val, UUID):
            d[col] = str(val)
        else:
            d[col] = val
    return d


@router.post("/push", response_model=PushResponse)
async def push(
    req: PushRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Receive local changes from client and apply to server."""
    accepted = 0
    conflicts = []

    for table_name, rows in req.changes.items():
        model = TABLE_MODELS.get(table_name)
        if not model:
            continue

        for row_data in rows:
            try:
                row_uuid = UUID(row_data.uuid)
            except ValueError:
                continue

            # Check if row exists on server
            result = await db.execute(
                select(model).where(model.uuid == row_uuid, model.user_id == user.id)
            )
            existing = result.scalar_one_or_none()

            # Strip timezone info: DB uses TIMESTAMP WITHOUT TIME ZONE
            client_updated = row_data.updated_at.replace(tzinfo=None) if row_data.updated_at else None
            is_deleted = row_data.is_deleted

            # Parse string dates in extra fields to datetime and strip timezone info
            # (DB uses TIMESTAMP WITHOUT TIME ZONE — can't mix aware/naive).
            extra = row_data.model_extra or {}
            for key in list(extra.keys()):
                val = extra[key]
                if isinstance(val, str) and key in ("created_at", "updated_at"):
                    try:
                        val = datetime.fromisoformat(val.replace("Z", "+00:00"))
                    except (ValueError, TypeError):
                        continue
                    extra[key] = val
                if isinstance(extra.get(key), datetime) and extra[key].tzinfo is not None:
                    extra[key] = extra[key].replace(tzinfo=None)

            if existing:
                # Conflict check: last-write-wins
                if client_updated and existing.updated_at and client_updated < existing.updated_at:
                    conflicts.append(ConflictInfo(
                        table=table_name,
                        uuid=str(row_uuid),
                        server_updated_at=existing.updated_at,
                        resolution="server_wins",
                    ))
                    continue

                # Update existing row
                if is_deleted:
                    existing.is_deleted = True
                    existing.updated_at = client_updated or datetime.utcnow()
                else:
                    for key, val in extra.items():
                        if hasattr(existing, key) and key not in ("uuid", "user_id"):
                            setattr(existing, key, val)
                    existing.updated_at = client_updated or datetime.utcnow()
                    existing.is_deleted = False
                accepted += 1
            else:
                # Insert new row
                new_row = model(uuid=row_uuid, user_id=user.id)
                for key, val in extra.items():
                    if hasattr(new_row, key) and key not in ("uuid", "user_id"):
                        setattr(new_row, key, val)
                new_row.updated_at = client_updated or datetime.utcnow()
                new_row.is_deleted = is_deleted
                db.add(new_row)
                accepted += 1

    await db.commit()
    return PushResponse(status="ok", accepted=accepted, conflicts=conflicts)


@router.post("/pull", response_model=PullResponse)
async def pull(
    req: PullRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return changes since client's last sync timestamp."""
    server_time = datetime.utcnow()
    changes: dict[str, list[dict]] = {}

    # Strip timezone info: DB uses TIMESTAMP WITHOUT TIME ZONE
    last_sync = req.last_sync_at.replace(tzinfo=None) if req.last_sync_at else None

    for table_name, model in TABLE_MODELS.items():
        query = select(model).where(model.user_id == user.id)
        if last_sync:
            query = query.where(model.updated_at > last_sync)
        query = query.order_by(model.updated_at)

        result = await db.execute(query)
        rows = result.scalars().all()

        if rows:
            data_cols = _get_data_columns(model)
            changes[table_name] = [_row_to_dict(r, data_cols) for r in rows]

    return PullResponse(changes=changes, server_time=server_time)
