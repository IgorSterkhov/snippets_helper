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


# ==================== Admin ====================

class AdminMeResponse(BaseModel):
    user_id: str
    name: Optional[str]
    is_admin: bool
    media_quota_bytes: int
    media_max_upload_bytes: int
    media_used_bytes: int = 0


class AdminUserSummary(BaseModel):
    user_id: str
    name: Optional[str]
    created_at: datetime
    last_seen_at: Optional[datetime] = None
    is_admin: bool
    media_quota_bytes: int
    media_max_upload_bytes: int
    media_used_bytes: int = 0


class AdminUserLimitsRequest(BaseModel):
    media_quota_bytes: int
    media_max_upload_bytes: int


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
