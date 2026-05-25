from datetime import datetime
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.auth import get_current_admin, should_touch_last_seen


def test_should_touch_last_seen_when_missing():
    assert should_touch_last_seen(None, now=datetime(2026, 5, 25, 12, 0, 0))


def test_should_not_touch_last_seen_inside_throttle_window():
    last = datetime(2026, 5, 25, 11, 56, 0)
    assert not should_touch_last_seen(last, now=datetime(2026, 5, 25, 12, 0, 0))


def test_should_touch_last_seen_after_throttle_window():
    last = datetime(2026, 5, 25, 11, 49, 0)
    assert should_touch_last_seen(last, now=datetime(2026, 5, 25, 12, 0, 0))


def test_get_current_admin_rejects_non_admin():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_current_admin(SimpleNamespace(is_admin=False)))
    assert exc.value.status_code == 403


def test_get_current_admin_returns_admin():
    user = SimpleNamespace(is_admin=True)
    assert asyncio.run(get_current_admin(user)) is user
