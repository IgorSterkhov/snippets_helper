import os
import secrets
from pathlib import Path


DEFAULT_MEDIA_ROOT = "/opt/isterapp/uploads/snippets-media"
DEFAULT_PUBLIC_MEDIA_BASE_URL = "https://ister-app.ru/snippets-media"


def media_root() -> Path:
    return Path(os.environ.get("MEDIA_STORAGE_ROOT", DEFAULT_MEDIA_ROOT)).resolve()


def public_media_base_url() -> str:
    return os.environ.get("PUBLIC_MEDIA_BASE_URL", DEFAULT_PUBLIC_MEDIA_BASE_URL).rstrip("/")


def generate_media_token() -> str:
    return secrets.token_urlsafe(32)


def safe_media_path(root: str | Path, variant_public_token: str, extension: str = "webp") -> Path:
    if not variant_public_token:
        raise ValueError("media token is required")
    if not all(ch.isalnum() or ch in "_-" for ch in variant_public_token):
        raise ValueError("media token contains unsafe characters")
    clean_extension = extension.lstrip(".").lower()
    if clean_extension != "webp":
        raise ValueError("only webp media paths are supported")
    base = Path(root).resolve()
    path = (base / f"{variant_public_token}.{clean_extension}").resolve()
    if base not in path.parents:
        raise ValueError("media path escapes storage root")
    return path


def public_media_url(variant_public_token: str) -> str:
    return f"{public_media_base_url()}/{variant_public_token}.webp"


def validate_quota(max_upload: int, quota: int, used: int, incoming_bytes: int) -> None:
    if incoming_bytes <= 0:
        raise ValueError("upload is empty")
    if incoming_bytes > max_upload:
        raise ValueError("upload exceeds max upload limit")
    if used + incoming_bytes > quota:
        raise ValueError("upload exceeds media quota")
