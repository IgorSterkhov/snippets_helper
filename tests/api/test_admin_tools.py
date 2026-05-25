from types import SimpleNamespace

import pytest

from api.admin_tools import find_unique_user_by_prefix


def test_find_unique_user_by_prefix_requires_one_match():
    user = SimpleNamespace(api_key="abcdef123", name="u")
    assert find_unique_user_by_prefix([user], "abcdef") is user


def test_find_unique_user_by_prefix_fails_zero_matches():
    with pytest.raises(ValueError, match="No users"):
        find_unique_user_by_prefix([], "abcdef")


def test_find_unique_user_by_prefix_fails_multiple_matches():
    users = [
        SimpleNamespace(api_key="abcdef123"),
        SimpleNamespace(api_key="abcdef999"),
    ]
    with pytest.raises(ValueError, match="Multiple users"):
        find_unique_user_by_prefix(users, "abcdef")
