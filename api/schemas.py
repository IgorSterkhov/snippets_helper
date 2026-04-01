from datetime import datetime
from typing import Optional
from pydantic import BaseModel


# ==================== Auth ====================

class RegisterRequest(BaseModel):
    name: str


class RegisterResponse(BaseModel):
    user_id: str
    api_key: str
    name: str


class UserInfo(BaseModel):
    user_id: str
    name: Optional[str]
    created_at: datetime


# ==================== Sync ====================

class SyncRow(BaseModel):
    """A single row from any synced table."""
    uuid: str
    updated_at: Optional[datetime] = None
    is_deleted: bool = False
    # All other fields are dynamic — passed via model_extra
    model_config = {"extra": "allow"}


class PushRequest(BaseModel):
    changes: dict[str, list[SyncRow]]


class ConflictInfo(BaseModel):
    table: str
    uuid: str
    server_updated_at: datetime
    resolution: str = "server_wins"


class PushResponse(BaseModel):
    status: str = "ok"
    accepted: int = 0
    conflicts: list[ConflictInfo] = []


class PullRequest(BaseModel):
    last_sync_at: Optional[datetime] = None


class PullResponse(BaseModel):
    changes: dict[str, list[dict]]
    server_time: datetime
