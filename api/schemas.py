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


# ==================== Media ====================

class MediaUploadResponse(BaseModel):
    job_id: str
    status: str


class MediaVariantResponse(BaseModel):
    variant: str
    public_token: str
    preview_url: str
    mime_type: str
    size_bytes: int
    width: int
    height: int
    sha256: str


class MediaJobResponse(BaseModel):
    job_id: str
    status: str
    progress_current: int = 0
    progress_total: int = 0
    asset_uuid: Optional[str] = None
    variants: list[MediaVariantResponse] = []
    error: Optional[str] = None


class MediaSelectRequest(BaseModel):
    variant: str


class MediaSelectResponse(BaseModel):
    asset_uuid: str
    variant: str
    markdown: str
    url: str
    width: int
    height: int
    size_bytes: int


class MediaDeleteResponse(BaseModel):
    status: str = "ok"


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
