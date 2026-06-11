from datetime import date, datetime
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from api.database import get_db
from api.models import FinanceItem, FinancePlan, User, TABLE_MODELS
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


def _has_required_uuid_relations(table_name: str, row: dict) -> bool:
    """Rows with portable relationships must carry their UUID foreign keys."""
    if table_name in {"task_checkboxes", "task_links"}:
        return bool(row.get("task_uuid"))
    if table_name == "finance_items":
        return bool(row.get("plan_uuid"))
    return True


def _parse_optional_uuid(value) -> UUID | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return UUID(text)
    except (TypeError, ValueError):
        return None


def _normalize_finance_kind(value) -> str | None:
    kind = str(value or "monthly").strip().lower().replace("-", "_")
    return kind if kind in {"monthly", "project", "one_time", "general"} else None


def _valid_finance_item_values(extra: dict) -> bool:
    try:
        amount = int(extra.get("amount_cents") or 0)
    except (TypeError, ValueError):
        return False
    if amount < 0:
        return False

    due_day = extra.get("due_day")
    if due_day not in (None, ""):
        try:
            day = int(due_day)
        except (TypeError, ValueError):
            return False
        if day < 1 or day > 31:
            return False

    due_date = str(extra.get("due_date") or "").strip()
    if due_date:
        if len(due_date) != 10 or due_date[4] != "-" or due_date[7] != "-":
            return False
        try:
            date.fromisoformat(due_date)
        except ValueError:
            return False
    return True


async def _finance_plan_exists(db: AsyncSession, user_id: UUID, plan_uuid: UUID) -> bool:
    result = await db.execute(
        select(FinancePlan.uuid).where(
            FinancePlan.uuid == plan_uuid,
            FinancePlan.user_id == user_id,
            FinancePlan.is_deleted == False,  # noqa: E712
        )
    )
    return result.scalar_one_or_none() is not None


async def _finance_parent_plan_uuid(
    db: AsyncSession,
    user_id: UUID,
    parent_uuid: UUID,
) -> UUID | None:
    result = await db.execute(
        select(FinanceItem.plan_uuid).where(
            FinanceItem.uuid == parent_uuid,
            FinanceItem.user_id == user_id,
            FinanceItem.is_deleted == False,  # noqa: E712
        )
    )
    return result.scalar_one_or_none()


async def _valid_finance_row(
    db: AsyncSession,
    user_id: UUID,
    table_name: str,
    row_uuid: UUID,
    is_deleted: bool,
    extra: dict,
    batch_plan_uuids: set[UUID],
    batch_item_plans: dict[UUID, UUID],
) -> bool:
    if is_deleted:
        return True

    if table_name == "finance_plans":
        kind = _normalize_finance_kind(extra.get("kind"))
        if not kind:
            return False
        extra["kind"] = kind
        return True

    if table_name != "finance_items":
        return True

    if not _valid_finance_item_values(extra):
        return False

    plan_uuid = _parse_optional_uuid(extra.get("plan_uuid"))
    if not plan_uuid:
        return False
    if plan_uuid not in batch_plan_uuids and not await _finance_plan_exists(db, user_id, plan_uuid):
        return False

    parent_uuid = _parse_optional_uuid(extra.get("parent_uuid"))
    if parent_uuid:
        if parent_uuid == row_uuid:
            return False
        parent_plan_uuid = batch_item_plans.get(parent_uuid)
        if parent_plan_uuid is None:
            parent_plan_uuid = await _finance_parent_plan_uuid(db, user_id, parent_uuid)
        if parent_plan_uuid != plan_uuid:
            return False

    return True


@router.post("/push", response_model=PushResponse)
async def push(
    req: PushRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Receive local changes from client and apply to server."""
    accepted = 0
    conflicts = []
    accepted_uuids: dict[str, list[str]] = {}
    rejected_uuids: dict[str, list[str]] = {}

    batch_plan_uuids: set[UUID] = set()
    for row_data in req.changes.get("finance_plans", []):
        try:
            row_uuid = UUID(row_data.uuid)
        except ValueError:
            continue
        if not row_data.is_deleted and _normalize_finance_kind((row_data.model_extra or {}).get("kind")):
            batch_plan_uuids.add(row_uuid)

    batch_item_plans: dict[UUID, UUID] = {}
    for row_data in req.changes.get("finance_items", []):
        try:
            row_uuid = UUID(row_data.uuid)
        except ValueError:
            continue
        plan_uuid = _parse_optional_uuid((row_data.model_extra or {}).get("plan_uuid"))
        if plan_uuid and not row_data.is_deleted:
            batch_item_plans[row_uuid] = plan_uuid

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

            if not is_deleted and not _has_required_uuid_relations(table_name, extra):
                rejected_uuids.setdefault(table_name, []).append(str(row_uuid))
                continue

            if not await _valid_finance_row(
                db,
                user.id,
                table_name,
                row_uuid,
                is_deleted,
                extra,
                batch_plan_uuids,
                batch_item_plans,
            ):
                rejected_uuids.setdefault(table_name, []).append(str(row_uuid))
                continue

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
                accepted_uuids.setdefault(table_name, []).append(str(row_uuid))
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
                accepted_uuids.setdefault(table_name, []).append(str(row_uuid))

    await db.commit()
    return PushResponse(
        status="ok",
        accepted=accepted,
        accepted_uuids=accepted_uuids,
        rejected_uuids=rejected_uuids,
        conflicts=conflicts,
    )


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
            table_rows = [
                row
                for row in (_row_to_dict(r, data_cols) for r in rows)
                if _has_required_uuid_relations(table_name, row)
            ]
            if table_rows:
                changes[table_name] = table_rows

    return PullResponse(changes=changes, server_time=server_time)
