import json
from datetime import date, datetime, timedelta
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from api.database import get_db
from api.models import (
    FinanceItem,
    FinanceMappingRule,
    FinancePayment,
    FinancePlan,
    FinanceTransaction,
    FinanceTransactionAllocation,
    User,
    TABLE_MODELS,
)
from api.schemas import (
    PushRequest, PushResponse, ConflictInfo,
    PullRequest, PullResponse,
)
from api.auth import get_current_user

router = APIRouter(prefix="/sync", tags=["sync"])

SYNC_PULL_CURSOR_SAFETY_SECONDS = 30


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
    if table_name == "finance_payments":
        return bool(row.get("plan_uuid")) and bool(row.get("item_uuid"))
    if table_name == "finance_transactions":
        return True
    if table_name == "finance_mapping_rules":
        return bool(row.get("target_plan_uuid"))
    if table_name == "finance_transaction_allocations":
        return bool(row.get("transaction_uuid")) and bool(row.get("plan_uuid"))
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


def _accepted_updated_at(client_updated: datetime | None, accepted_at: datetime) -> datetime:
    """Use one timestamp both as conflict marker and pull cursor.

    Existing clients send local edit timestamps, but pull cursors advance using
    server_time. Promoting accepted rows to at least server accept time prevents
    rows from being permanently skipped when another device already advanced its
    cursor past the editing device's local timestamp before the push arrived.
    """
    if client_updated is None or client_updated < accepted_at:
        return accepted_at
    return client_updated


def _finance_allocation_conflict_resolution(
    existing_active: FinanceTransactionAllocation | None,
    incoming_uuid,
    incoming_updated_at: datetime,
) -> str:
    if existing_active is None:
        return "no_conflict"
    if str(existing_active.uuid) == str(incoming_uuid):
        return "same_row"
    if existing_active.updated_at and incoming_updated_at < existing_active.updated_at:
        return "server_wins"
    return "incoming_wins"


def _pull_server_time(now: datetime | None = None) -> datetime:
    """Return a conservative cursor watermark for pull responses.

    Clients use server_time as their next `last_sync_at`. A small lookback keeps
    the cursor behind in-flight pushes whose rows may not be visible to the
    current SELECT yet. Duplicate rows in that window are safe because clients
    upsert by UUID.
    """
    return (now or datetime.utcnow()) - timedelta(seconds=SYNC_PULL_CURSOR_SAFETY_SECONDS)


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


def _valid_finance_payment_values(extra: dict) -> bool:
    try:
        amount = int(extra.get("paid_amount_cents") or 0)
    except (TypeError, ValueError):
        return False
    if amount < 0:
        return False

    month_key = str(extra.get("month_key") or "").strip()
    if len(month_key) != 7 or month_key[4] != "-":
        return False
    try:
        date.fromisoformat(f"{month_key}-01")
    except ValueError:
        return False
    extra["month_key"] = month_key
    return True


def _valid_iso_date_text(value: str, *, with_time: bool) -> bool:
    try:
        if with_time:
            datetime.fromisoformat(value)
        else:
            date.fromisoformat(value)
    except (TypeError, ValueError):
        return False
    return True


def _valid_finance_transaction_values(extra: dict) -> bool:
    source = str(extra.get("source") or "").strip()
    fingerprint = str(extra.get("source_fingerprint") or "").strip()
    if not source or not fingerprint:
        return False
    if not _valid_iso_date_text(str(extra.get("operation_at") or ""), with_time=True):
        return False
    if not _valid_iso_date_text(str(extra.get("payment_date") or ""), with_time=False):
        return False
    for key in (
        "amount_cents",
        "operation_amount_cents",
        "payment_amount_cents",
        "cashback_cents",
        "bonuses_cents",
        "invest_rounding_cents",
        "rounded_amount_cents",
    ):
        value = extra.get(key)
        if value in (None, ""):
            continue
        try:
            int(value)
        except (TypeError, ValueError):
            return False
    if not isinstance(extra.get("rules_locked", False), bool):
        extra["rules_locked"] = bool(extra.get("rules_locked"))
    return True


def _valid_finance_mapping_rule_values(extra: dict) -> bool:
    match_mode = str(extra.get("match_mode") or "all").strip().lower()
    if match_mode not in {"all", "any"}:
        return False
    extra["match_mode"] = match_mode
    try:
        priority = int(extra.get("priority") or 0)
    except (TypeError, ValueError):
        return False
    extra["priority"] = priority
    conditions_json = str(extra.get("conditions_json") or "[]")
    if len(conditions_json) > 20000:
        return False
    try:
        parsed_conditions = json.loads(conditions_json)
    except (TypeError, ValueError):
        return False
    if not isinstance(parsed_conditions, list):
        return False
    return True


async def _finance_transaction_exists(
    db: AsyncSession,
    user_id: UUID,
    transaction_uuid: UUID,
) -> bool:
    result = await db.execute(
        select(FinanceTransaction.uuid).where(
            FinanceTransaction.uuid == transaction_uuid,
            FinanceTransaction.user_id == user_id,
            FinanceTransaction.is_deleted == False,  # noqa: E712
        )
    )
    return result.scalar_one_or_none() is not None


async def _finance_mapping_rule_exists(
    db: AsyncSession,
    user_id: UUID,
    rule_uuid: UUID,
) -> bool:
    result = await db.execute(
        select(FinanceMappingRule.uuid).where(
            FinanceMappingRule.uuid == rule_uuid,
            FinanceMappingRule.user_id == user_id,
            FinanceMappingRule.is_deleted == False,  # noqa: E712
        )
    )
    return result.scalar_one_or_none() is not None


async def _prepare_active_finance_allocation(
    db: AsyncSession,
    user_id: UUID,
    row_uuid: UUID,
    extra: dict,
    accepted_updated_at: datetime,
) -> ConflictInfo | None:
    if not bool(extra.get("is_active", True)):
        return None

    transaction_uuid = _parse_optional_uuid(extra.get("transaction_uuid"))
    if not transaction_uuid:
        return None

    with db.no_autoflush:
        active_result = await db.execute(
            select(FinanceTransactionAllocation).where(
                FinanceTransactionAllocation.user_id == user_id,
                FinanceTransactionAllocation.transaction_uuid == transaction_uuid,
                FinanceTransactionAllocation.is_active == True,  # noqa: E712
                FinanceTransactionAllocation.is_deleted == False,  # noqa: E712
                FinanceTransactionAllocation.uuid != row_uuid,
            )
        )
    active_existing = active_result.scalars().first()
    resolution = _finance_allocation_conflict_resolution(
        active_existing,
        row_uuid,
        accepted_updated_at,
    )

    if resolution == "server_wins":
        return ConflictInfo(
            table="finance_transaction_allocations",
            uuid=str(row_uuid),
            server_updated_at=active_existing.updated_at,
            resolution="server_wins",
        )

    if resolution == "incoming_wins":
        await db.execute(
            update(FinanceTransactionAllocation)
            .where(
                FinanceTransactionAllocation.user_id == user_id,
                FinanceTransactionAllocation.transaction_uuid == transaction_uuid,
                FinanceTransactionAllocation.is_active == True,  # noqa: E712
                FinanceTransactionAllocation.is_deleted == False,  # noqa: E712
                FinanceTransactionAllocation.uuid != row_uuid,
            )
            .values(is_active=False, updated_at=accepted_updated_at)
        )

    return None


async def _finance_plan_exists(db: AsyncSession, user_id: UUID, plan_uuid: UUID) -> bool:
    result = await db.execute(
        select(FinancePlan.uuid).where(
            FinancePlan.uuid == plan_uuid,
            FinancePlan.user_id == user_id,
            FinancePlan.is_deleted == False,  # noqa: E712
        )
    )
    return result.scalar_one_or_none() is not None


async def _finance_plan_kind(
    db: AsyncSession,
    user_id: UUID,
    plan_uuid: UUID,
) -> str | None:
    result = await db.execute(
        select(FinancePlan.kind).where(
            FinancePlan.uuid == plan_uuid,
            FinancePlan.user_id == user_id,
            FinancePlan.is_deleted == False,  # noqa: E712
        )
    )
    return result.scalar_one_or_none()


async def _finance_item_plan_uuid(
    db: AsyncSession,
    user_id: UUID,
    item_uuid: UUID,
) -> UUID | None:
    result = await db.execute(
        select(FinanceItem.plan_uuid).where(
            FinanceItem.uuid == item_uuid,
            FinanceItem.user_id == user_id,
            FinanceItem.is_deleted == False,  # noqa: E712
        )
    )
    return result.scalar_one_or_none()


async def _finance_parent_plan_uuid(
    db: AsyncSession,
    user_id: UUID,
    parent_uuid: UUID,
) -> UUID | None:
    return await _finance_item_plan_uuid(db, user_id, parent_uuid)


async def _valid_finance_row(
    db: AsyncSession,
    user_id: UUID,
    table_name: str,
    row_uuid: UUID,
    is_deleted: bool,
    extra: dict,
    batch_plan_kinds: dict[UUID, str],
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
        if table_name == "finance_transactions":
            if not _valid_finance_transaction_values(extra):
                return False
            import_batch_uuid = _parse_optional_uuid(extra.get("import_batch_uuid"))
            if import_batch_uuid:
                # Import batch is useful metadata, not required for a valid fact.
                extra["import_batch_uuid"] = import_batch_uuid
            return True

        if table_name == "finance_mapping_rules":
            if not _valid_finance_mapping_rule_values(extra):
                return False
            plan_uuid = _parse_optional_uuid(extra.get("target_plan_uuid"))
            if not plan_uuid:
                return False
            if plan_uuid not in batch_plan_kinds and not await _finance_plan_exists(db, user_id, plan_uuid):
                return False
            item_uuid = _parse_optional_uuid(extra.get("target_item_uuid"))
            if item_uuid:
                item_plan_uuid = batch_item_plans.get(item_uuid)
                if item_plan_uuid is None:
                    item_plan_uuid = await _finance_item_plan_uuid(db, user_id, item_uuid)
                if item_plan_uuid != plan_uuid:
                    return False
            return True

        if table_name == "finance_transaction_allocations":
            transaction_uuid = _parse_optional_uuid(extra.get("transaction_uuid"))
            plan_uuid = _parse_optional_uuid(extra.get("plan_uuid"))
            if not transaction_uuid or not plan_uuid:
                return False
            if not await _finance_transaction_exists(db, user_id, transaction_uuid):
                return False
            if plan_uuid not in batch_plan_kinds and not await _finance_plan_exists(db, user_id, plan_uuid):
                return False
            item_uuid = _parse_optional_uuid(extra.get("item_uuid"))
            if item_uuid:
                item_plan_uuid = batch_item_plans.get(item_uuid)
                if item_plan_uuid is None:
                    item_plan_uuid = await _finance_item_plan_uuid(db, user_id, item_uuid)
                if item_plan_uuid != plan_uuid:
                    return False
            rule_uuid = _parse_optional_uuid(extra.get("rule_uuid"))
            if rule_uuid and not await _finance_mapping_rule_exists(db, user_id, rule_uuid):
                return False
            assigned_by = str(extra.get("assigned_by") or "manual").strip()
            if assigned_by not in {"manual", "rule"}:
                return False
            extra["assigned_by"] = assigned_by
            extra["is_active"] = bool(extra.get("is_active", True))
            return True

        if table_name != "finance_payments":
            return True

        if not _valid_finance_payment_values(extra):
            return False

        plan_uuid = _parse_optional_uuid(extra.get("plan_uuid"))
        item_uuid = _parse_optional_uuid(extra.get("item_uuid"))
        if not plan_uuid or not item_uuid:
            return False

        plan_kind = batch_plan_kinds.get(plan_uuid)
        if plan_kind is None:
            plan_kind = await _finance_plan_kind(db, user_id, plan_uuid)
        if plan_kind != "monthly":
            return False

        item_plan_uuid = batch_item_plans.get(item_uuid)
        if item_plan_uuid is None:
            item_plan_uuid = await _finance_item_plan_uuid(db, user_id, item_uuid)
        return item_plan_uuid == plan_uuid

    if not _valid_finance_item_values(extra):
        return False

    plan_uuid = _parse_optional_uuid(extra.get("plan_uuid"))
    if not plan_uuid:
        return False
    if plan_uuid not in batch_plan_kinds and not await _finance_plan_exists(db, user_id, plan_uuid):
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

    batch_plan_kinds: dict[UUID, str] = {}
    for row_data in req.changes.get("finance_plans", []):
        try:
            row_uuid = UUID(row_data.uuid)
        except ValueError:
            continue
        kind = _normalize_finance_kind((row_data.model_extra or {}).get("kind"))
        if not row_data.is_deleted and kind:
            batch_plan_kinds[row_uuid] = kind

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
                batch_plan_kinds,
                batch_item_plans,
            ):
                rejected_uuids.setdefault(table_name, []).append(str(row_uuid))
                continue

            if table_name == "finance_payments" and not existing and not is_deleted:
                item_uuid = _parse_optional_uuid(extra.get("item_uuid"))
                month_key = str(extra.get("month_key") or "").strip()
                if item_uuid and month_key:
                    natural_result = await db.execute(
                        select(FinancePayment.uuid).where(
                            FinancePayment.user_id == user.id,
                            FinancePayment.item_uuid == item_uuid,
                            FinancePayment.month_key == month_key,
                        )
                    )
                    natural_uuid = natural_result.scalar_one_or_none()
                    if natural_uuid and natural_uuid != row_uuid:
                        rejected_uuids.setdefault(table_name, []).append(str(row_uuid))
                        continue

            if table_name == "finance_transactions" and not existing and not is_deleted:
                source = str(extra.get("source") or "").strip()
                source_fingerprint = str(extra.get("source_fingerprint") or "").strip()
                if source and source_fingerprint:
                    natural_result = await db.execute(
                        select(FinanceTransaction.uuid).where(
                            FinanceTransaction.user_id == user.id,
                            FinanceTransaction.source == source,
                            FinanceTransaction.source_fingerprint == source_fingerprint,
                        )
                    )
                    natural_uuid = natural_result.scalar_one_or_none()
                    if natural_uuid and natural_uuid != row_uuid:
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
                accepted_updated_at = _accepted_updated_at(client_updated, datetime.utcnow())
                if table_name == "finance_transaction_allocations" and not is_deleted:
                    allocation_conflict = await _prepare_active_finance_allocation(
                        db,
                        user.id,
                        row_uuid,
                        extra,
                        accepted_updated_at,
                    )
                    if allocation_conflict:
                        conflicts.append(allocation_conflict)
                        continue

                if is_deleted:
                    existing.is_deleted = True
                    existing.updated_at = accepted_updated_at
                else:
                    for key, val in extra.items():
                        if hasattr(existing, key) and key not in ("uuid", "user_id"):
                            setattr(existing, key, val)
                    existing.updated_at = accepted_updated_at
                    existing.is_deleted = False
                accepted += 1
                accepted_uuids.setdefault(table_name, []).append(str(row_uuid))
            else:
                accepted_updated_at = _accepted_updated_at(client_updated, datetime.utcnow())
                if table_name == "finance_transaction_allocations" and not is_deleted:
                    allocation_conflict = await _prepare_active_finance_allocation(
                        db,
                        user.id,
                        row_uuid,
                        extra,
                        accepted_updated_at,
                    )
                    if allocation_conflict:
                        conflicts.append(allocation_conflict)
                        continue

                # Insert new row
                new_row = model(uuid=row_uuid, user_id=user.id)
                for key, val in extra.items():
                    if hasattr(new_row, key) and key not in ("uuid", "user_id"):
                        setattr(new_row, key, val)
                new_row.updated_at = accepted_updated_at
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
    server_time = _pull_server_time()
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
