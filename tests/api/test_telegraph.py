import asyncio
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from api.routes import share_links
from api.telegraph import (
    TelegraphClient,
    TelegraphError,
    content_hash,
    markdown_to_telegraph_nodes,
    telegraph_short_name,
)


class FakeDb:
    def __init__(self):
        self.added = []
        self.commits = 0
        self.refreshed = []

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        self.refreshed.append(obj)


class FakeTelegraphClient:
    async def create_page(self, **kwargs):
        assert kwargs["access_token"] == "server-only-token"
        assert kwargs["title"] == "Deploy"
        assert isinstance(kwargs["content"], list)
        return SimpleNamespace(
            path="Deploy-06-09",
            url="https://telegra.ph/Deploy-06-09",
            title="Deploy",
            views=1,
        )


class TimeoutHttpClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        raise httpx.ConnectTimeout("connect timed out")


def test_telegraph_short_name_uses_api_key_prefix_and_limit():
    assert telegraph_short_name("abcdef1234567890") == "ister_abcdef12"
    assert len(telegraph_short_name("a" * 80)) <= 32


def test_telegraph_converter_sanitizes_links_and_raw_html():
    nodes = markdown_to_telegraph_nodes(
        "T",
        '<script>alert(1)</script>\n\n[bad](javascript:alert(1)) [ok](https://example.com)',
    )

    serialized = str(nodes)
    assert "script" not in serialized
    assert "javascript:" not in serialized
    assert "https://example.com" in serialized


def test_telegraph_converter_degrades_html_cards_to_links():
    nodes = markdown_to_telegraph_nodes(
        "Deck",
        "![html:Architecture](https://ister-app.ru/snippets-api/v1/media/html/html_TOKEN_123456)",
    )

    assert nodes[0]["tag"] == "p"
    assert "Interactive HTML: Architecture" in nodes[0]["children"]
    assert nodes[0]["children"][-1]["attrs"]["href"].endswith("html_TOKEN_123456")


def test_telegraph_converter_rejects_external_html_card_links():
    nodes = markdown_to_telegraph_nodes(
        "Deck",
        "![html:Architecture](https://example.com/deck.html)",
    )

    assert nodes[0]["tag"] == "p"
    assert "Interactive HTML: Architecture" in nodes[0]["children"]
    assert "example.com" not in str(nodes)


def test_telegraph_converter_keeps_markdown_tables_readable():
    nodes = markdown_to_telegraph_nodes(
        "Ports",
        "| Name | Port |\n|---|---:|\n| SSH | 22 |",
    )

    assert nodes[0]["tag"] == "pre"
    assert "| Name | Port |" in nodes[0]["children"][0]
    assert "| SSH | 22 |" in nodes[0]["children"][0]


def test_telegraph_converter_truncates_utf8_safely():
    nodes = markdown_to_telegraph_nodes("Big", "Привет 😀 " * 20000)

    assert content_hash(nodes)
    assert "truncated" in str(nodes)
    assert "�" not in str(nodes)


def test_telegraph_client_translates_connection_timeout(monkeypatch):
    monkeypatch.setattr("api.telegraph.httpx.AsyncClient", TimeoutHttpClient)

    with pytest.raises(TelegraphError) as exc:
        asyncio.run(TelegraphClient().create_account(short_name="ister_timeout"))

    message = str(exc.value)
    assert "Telegra.ph API timeout" in message or "Telegra.ph API connection failed" in message
    assert "TELEGRAPH_API_BASE_URL" in message


def test_publish_telegraph_rejects_item_not_owned(monkeypatch):
    async def missing_item(*args, **kwargs):
        return None

    monkeypatch.setattr(share_links, "_load_owned_item", missing_item)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(share_links.publish_telegraph_page(
            share_links.TelegraphPublishRequest(item_type="shortcut", item_uuid=str(uuid4())),
            user=SimpleNamespace(id=uuid4()),
            db=FakeDb(),
        ))

    assert exc.value.status_code == 404
    assert "item not found" in exc.value.detail


def test_publish_telegraph_response_never_exposes_access_token(monkeypatch):
    item_uuid = uuid4()

    async def owned_item(*args, **kwargs):
        return SimpleNamespace(
            name="Deploy",
            value="run deploy",
            description="",
            links="[]",
        )

    async def no_page(*args, **kwargs):
        return None

    monkeypatch.setattr(share_links, "_load_owned_item", owned_item)
    monkeypatch.setattr(share_links, "_load_telegraph_page", no_page)
    monkeypatch.setattr(share_links, "TelegraphClient", lambda: FakeTelegraphClient())

    response = asyncio.run(share_links.publish_telegraph_page(
        share_links.TelegraphPublishRequest(item_type="shortcut", item_uuid=str(item_uuid)),
        user=SimpleNamespace(
            id=uuid4(),
            telegraph_access_token="server-only-token",
            telegraph_author_name=None,
            telegraph_author_url=None,
        ),
        db=FakeDb(),
    ))

    assert response.url == "https://telegra.ph/Deploy-06-09"
    assert response.item_uuid == str(item_uuid)
    assert not hasattr(response, "access_token")
