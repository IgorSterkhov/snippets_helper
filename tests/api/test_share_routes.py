import asyncio
from io import BytesIO

import httpx
from fastapi import FastAPI
from PIL import Image

from api.database import get_db
from api.routes import share_links


def test_public_share_routes_serve_v2_legacy_and_preview_image(monkeypatch, tmp_path):
    async def fake_db():
        yield object()

    async def fake_public_payload(token, db):
        return {
            "type": "note",
            "title": f"Title {token}",
            "content": f"Current content {token}",
        }

    monkeypatch.setattr(share_links, "_public_payload", fake_public_payload)
    app = FastAPI()
    app.include_router(share_links.public_router)
    app.dependency_overrides[get_db] = fake_db
    monkeypatch.chdir(tmp_path)

    async def request_routes():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://preview.example",
            headers={"x-forwarded-proto": "https"},
        ) as client:
            image = await client.get("/share/preview-card-v2.png")
            v2 = await client.get("/share/v2/abc")
            legacy = await client.get("/share/abc")
            legacy_query = await client.get("/share/abc?preview=1")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://ister-app.ru",
            headers={"x-forwarded-proto": "https"},
        ) as apex_client:
            apex_v2 = await apex_client.get("/share/v2/abc")
            apex_legacy = await apex_client.get("/share/abc")
            apex_legacy_query = await apex_client.get("/share/abc?preview=1")
            invalid_port = await apex_client.get(
                "/share/v2/abc", headers={"host": "ister-app.ru:notaport"}
            )
            out_of_range_port = await apex_client.get(
                "/share/v2/abc", headers={"host": "ister-app.ru:70000"}
            )
        return (
            image,
            v2,
            legacy,
            legacy_query,
            apex_v2,
            apex_legacy,
            apex_legacy_query,
            invalid_port,
            out_of_range_port,
        )

    (
        image_response,
        v2_response,
        legacy_response,
        legacy_query_response,
        apex_v2_response,
        apex_legacy_response,
        apex_legacy_query_response,
        invalid_port_response,
        out_of_range_port_response,
    ) = asyncio.run(request_routes())

    assert image_response.status_code == 200
    assert image_response.headers["content-type"] == "image/png"
    assert image_response.headers["cache-control"] == (
        "public, max-age=31536000, immutable"
    )
    assert image_response.headers["x-content-type-options"] == "nosniff"
    assert image_response.content[:8] == b"\x89PNG\r\n\x1a\n"
    with Image.open(BytesIO(image_response.content)) as image:
        image.load()
        assert image.size == (1200, 630)

    assert v2_response.status_code == 200
    assert legacy_response.status_code == 200
    assert legacy_query_response.status_code == 200
    assert v2_response.text == legacy_response.text
    assert v2_response.text == legacy_query_response.text
    assert "Current content abc" in v2_response.text
    assert (
        '<meta property="og:url" content="https://preview.example/share/v2/abc">'
        in v2_response.text
    )
    assert (
        '<meta property="og:image" '
        'content="https://preview.example/share/preview-card-v2.png">'
        in v2_response.text
    )

    assert apex_v2_response.status_code == 200
    assert apex_legacy_response.status_code == 200
    assert apex_legacy_query_response.status_code == 200
    assert apex_v2_response.text == apex_legacy_response.text
    assert apex_v2_response.text == apex_legacy_query_response.text
    assert (
        '<meta property="og:url" '
        'content="https://www.ister-app.ru/share/v2/abc">'
        in apex_v2_response.text
    )
    assert (
        '<meta property="og:image" '
        'content="https://www.ister-app.ru/share/preview-card-v2.png">'
        in apex_v2_response.text
    )
    for invalid_host_response in (invalid_port_response, out_of_range_port_response):
        assert invalid_host_response.status_code == 200
        assert (
            '<meta property="og:url" '
            'content="https://www.ister-app.ru/share/v2/abc">'
            in invalid_host_response.text
        )
        assert (
            '<meta property="og:image" '
            'content="https://www.ister-app.ru/share/preview-card-v2.png">'
            in invalid_host_response.text
        )
