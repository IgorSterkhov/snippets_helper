import asyncio
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from api.routes import share_links
from api.share_utils import render_share_html
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


def test_telegraph_converter_formats_markdown_tables_as_aligned_pre():
    nodes = markdown_to_telegraph_nodes(
        "Ports",
        (
            "| Назначение | Внешний порт | Внутренний адрес |\n"
            "|:---|---:|:---|\n"
            "| MTProxy | 7443 | 192.168.1.96 |\n"
            "| SSH | 5555 | 192.168.1.96 |"
        ),
    )

    assert nodes[0]["tag"] == "pre"
    assert nodes[0]["children"][0] == (
        "Назначение  Внешний порт  Внутренний адрес\n"
        "──────────  ────────────  ────────────────\n"
        "MTProxy             7443  192.168.1.96\n"
        "SSH                 5555  192.168.1.96"
    )


def test_telegraph_converter_normalizes_cells_and_preserves_table_alignment():
    nodes = markdown_to_telegraph_nodes(
        "Values",
        (
            "Key | Center | Data\n"
            "--- | :---: | ---:\n"
            "escaped \\| pipe | mid | 9\n"
            "`a|b` | x |\n"
            "extra | y | 10 | ignored"
        ),
    )

    assert nodes[0]["tag"] == "pre"
    assert nodes[0]["children"][0] == (
        "Key             Center  Data\n"
        "──────────────  ──────  ────\n"
        "escaped | pipe   mid       9\n"
        "`a|b`             x\n"
        "extra             y       10"
    )


def test_telegraph_converter_sanitizes_cells_before_unicode_width_measurement():
    nodes = markdown_to_telegraph_nodes(
        "Unicode",
        (
            "| Label | Value |\n"
            "|---|---|\n"
            "| <b>猫</b> | A&amp;B |\n"
            "| é | 😀 |"
        ),
    )

    assert nodes[0]["children"][0] == (
        "Label  Value\n"
        "─────  ─────\n"
        "猫     A&B\n"
        "é      😀"
    )


def test_telegraph_and_public_share_recognize_the_same_pipe_table():
    markdown = (
        "Name | Value\n"
        "--- | ---:\n"
        "escaped \\| name | 10\n"
        "`a|b` | 2"
    )

    telegraph_nodes = markdown_to_telegraph_nodes("Parity", markdown)
    public_html = render_share_html({
        "type": "note",
        "title": "Parity",
        "content": markdown,
    })

    assert telegraph_nodes[0]["tag"] == "pre"
    assert telegraph_nodes[0]["children"][0] == (
        "Name            Value\n"
        "──────────────  ─────\n"
        "escaped | name     10\n"
        "`a|b`               2"
    )
    assert "<table>" in public_html
    assert "escaped | name" in public_html
    assert "<code>a|b</code>" in public_html


def test_telegraph_converter_does_not_treat_pipe_prose_as_table():
    nodes = markdown_to_telegraph_nodes("Prose", "Use A | B in prose")

    assert nodes == [{"tag": "p", "children": ["Use A | B in prose"]}]


def test_telegraph_converter_keeps_table_like_fenced_code_unchanged():
    nodes = markdown_to_telegraph_nodes(
        "Code",
        "```text\n| Name | Port |\n|---|---:|\n| SSH | 22 |\n```",
    )

    assert nodes == [{
        "tag": "pre",
        "children": ["| Name | Port |\n|---|---:|\n| SSH | 22 |"],
    }]


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


def test_prepare_telegraph_returns_desktop_publish_payload(monkeypatch):
    user_id = uuid4()
    item_uuid = uuid4()
    now = datetime.utcnow()

    async def owned_item(*args, **kwargs):
        return SimpleNamespace(
            name="Deploy",
            value="run deploy",
            description="ship safely",
            links="[]",
        )

    async def existing_page(*args, **kwargs):
        return SimpleNamespace(
            item_type="shortcut",
            item_uuid=item_uuid,
            url="https://telegra.ph/Deploy-06-09",
            path="Deploy-06-09",
            title="Deploy",
            content_hash="old-hash",
            views=7,
            created_at=now,
            updated_at=now,
            published_at=now,
        )

    monkeypatch.setattr(share_links, "_load_owned_item", owned_item)
    monkeypatch.setattr(share_links, "_load_telegraph_page", existing_page)

    response = asyncio.run(share_links.prepare_telegraph_page(
        share_links.TelegraphPublishRequest(item_type="shortcut", item_uuid=str(item_uuid)),
        user=SimpleNamespace(
            id=user_id,
            api_key="abcdef123456",
            telegraph_access_token="server-only-token",
            telegraph_short_name="ister_abcdef12",
            telegraph_author_name=None,
            telegraph_author_url=None,
        ),
        db=FakeDb(),
    ))

    assert response.item_type == "shortcut"
    assert response.item_uuid == str(item_uuid)
    assert response.short_name == "ister_abcdef12"
    assert response.access_token == "server-only-token"
    assert response.title == "Deploy"
    assert isinstance(response.content, list)
    assert response.content_hash == content_hash(response.content)
    assert response.page.url == "https://telegra.ph/Deploy-06-09"


def test_complete_telegraph_stores_published_snapshot_hash(monkeypatch):
    item_uuid = uuid4()

    async def owned_item(*args, **kwargs):
        return SimpleNamespace(
            name="Deploy",
            value="changed content",
            description="",
            links="[]",
        )

    async def no_page(*args, **kwargs):
        return None

    monkeypatch.setattr(share_links, "_load_owned_item", owned_item)
    monkeypatch.setattr(share_links, "_load_telegraph_page", no_page)

    db = FakeDb()
    user = SimpleNamespace(
        id=uuid4(),
        api_key="abcdef123456",
        telegraph_access_token=None,
        telegraph_short_name=None,
        telegraph_author_name=None,
        telegraph_author_url=None,
        telegraph_updated_at=None,
    )
    response = asyncio.run(share_links.complete_telegraph_page(
        share_links.TelegraphCompleteRequest(
            item_type="shortcut",
            item_uuid=str(item_uuid),
            path="Deploy-06-09",
            url="https://telegra.ph/Deploy-06-09",
            title="Deploy",
            content_hash="published-hash",
            views=1,
            access_token="new-token",
            short_name="ister_abcdef12",
            author_name="Ister App",
            author_url="",
        ),
        user=user,
        db=db,
    ))

    assert response.content_hash == "published-hash"
    assert db.added[0].content_hash == "published-hash"
    assert user.telegraph_access_token == "new-token"
    assert user.telegraph_short_name == "ister_abcdef12"


def test_complete_telegraph_rejects_non_telegraph_url(monkeypatch):
    item_uuid = uuid4()

    async def owned_item(*args, **kwargs):
        return SimpleNamespace(name="Deploy", value="run deploy", description="", links="[]")

    async def no_page(*args, **kwargs):
        return None

    monkeypatch.setattr(share_links, "_load_owned_item", owned_item)
    monkeypatch.setattr(share_links, "_load_telegraph_page", no_page)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(share_links.complete_telegraph_page(
            share_links.TelegraphCompleteRequest(
                item_type="shortcut",
                item_uuid=str(item_uuid),
                path="Deploy-06-09",
                url="https://example.com/Deploy-06-09",
                title="Deploy",
                content_hash="published-hash",
                access_token="new-token",
            ),
            user=SimpleNamespace(
                id=uuid4(),
                api_key="abcdef123456",
                telegraph_access_token=None,
                telegraph_short_name=None,
                telegraph_author_name=None,
                telegraph_author_url=None,
            ),
            db=FakeDb(),
        ))

    assert exc.value.status_code == 400
    assert "Telegra.ph URL" in exc.value.detail


def test_complete_telegraph_rejects_noncanonical_url_and_path(monkeypatch):
    item_uuid = uuid4()

    async def owned_item(*args, **kwargs):
        return SimpleNamespace(name="Deploy", value="run deploy", description="", links="[]")

    async def no_page(*args, **kwargs):
        return None

    monkeypatch.setattr(share_links, "_load_owned_item", owned_item)
    monkeypatch.setattr(share_links, "_load_telegraph_page", no_page)

    for path, url in [
        (" Deploy-06-09 ", "https://telegra.ph/Deploy-06-09"),
        ("Deploy-06-09", "https://telegra.ph:443/Deploy-06-09"),
        ("Deploy-06-09", "https://telegra.ph//Deploy-06-09"),
    ]:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(share_links.complete_telegraph_page(
                share_links.TelegraphCompleteRequest(
                    item_type="shortcut",
                    item_uuid=str(item_uuid),
                    path=path,
                    url=url,
                    title="Deploy",
                    content_hash="published-hash",
                    access_token="new-token",
                ),
                user=SimpleNamespace(
                    id=uuid4(),
                    api_key="abcdef123456",
                    telegraph_access_token=None,
                    telegraph_short_name=None,
                    telegraph_author_name=None,
                    telegraph_author_url=None,
                ),
                db=FakeDb(),
            ))

        assert exc.value.status_code == 400


def test_complete_telegraph_rejects_existing_page_path_swap(monkeypatch):
    item_uuid = uuid4()
    now = datetime.utcnow()

    async def owned_item(*args, **kwargs):
        return SimpleNamespace(name="Deploy", value="run deploy", description="", links="[]")

    async def existing_page(*args, **kwargs):
        return SimpleNamespace(
            item_type="shortcut",
            item_uuid=item_uuid,
            url="https://telegra.ph/Deploy-06-09",
            path="Deploy-06-09",
            title="Deploy",
            content_hash="old-hash",
            views=1,
            created_at=now,
            updated_at=now,
            published_at=now,
        )

    monkeypatch.setattr(share_links, "_load_owned_item", owned_item)
    monkeypatch.setattr(share_links, "_load_telegraph_page", existing_page)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(share_links.complete_telegraph_page(
            share_links.TelegraphCompleteRequest(
                item_type="shortcut",
                item_uuid=str(item_uuid),
                path="Other-06-09",
                url="https://telegra.ph/Other-06-09",
                title="Deploy",
                content_hash="published-hash",
                access_token="server-only-token",
            ),
            user=SimpleNamespace(
                id=uuid4(),
                api_key="abcdef123456",
                telegraph_access_token="server-only-token",
                telegraph_short_name="ister_abcdef12",
                telegraph_author_name=None,
                telegraph_author_url=None,
            ),
            db=FakeDb(),
        ))

    assert exc.value.status_code == 409
    assert "path mismatch" in exc.value.detail
