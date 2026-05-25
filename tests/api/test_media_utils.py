from pathlib import Path

import pytest

from api.media_utils import generate_media_token, safe_media_path, validate_quota


def test_generate_media_token_is_url_safe():
    token = generate_media_token()
    assert len(token) >= 32
    assert all(ch.isalnum() or ch in "_-" for ch in token)


def test_safe_media_path_stays_under_root(tmp_path):
    token = "abc_DEF-123"
    path = safe_media_path(tmp_path, token)
    assert path == (tmp_path / f"{token}.webp").resolve()


def test_safe_media_path_rejects_unsafe_token(tmp_path):
    with pytest.raises(ValueError):
        safe_media_path(tmp_path, "../secret")


def test_validate_quota_rejects_over_max_upload():
    with pytest.raises(ValueError, match="max upload"):
        validate_quota(max_upload=10, quota=100, used=0, incoming_bytes=11)


def test_validate_quota_rejects_over_quota():
    with pytest.raises(ValueError, match="quota"):
        validate_quota(max_upload=100, quota=100, used=90, incoming_bytes=20)
