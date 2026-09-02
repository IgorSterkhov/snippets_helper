from io import BytesIO
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

from PIL import Image


def _push(api_client, changes):
    status, data = api_client.request_json("POST", "/v1/sync/push", {"changes": changes})
    assert status == 200, data
    return data


def test_share_links_live_note_and_shortcut(
    smoke_config,
    api_client,
    public_http,
    iso_timestamp,
    unique_prefix,
    uuid_factory,
):
    note_uuid = uuid_factory()
    shortcut_uuid = uuid_factory()
    snippet_value_v1 = (
        "snippet value v1\n\n"
        "### Snippet Section\n\n"
        "**snippet bold** ([DocsRef][1])\n\n"
        "| Назначение | Внешний порт |\n"
        "|---|---:|\n"
        "| MTProxy | 7443 |\n\n"
        "[1]: https://example.com/ref \"DocsRef\""
    )
    snippet_description_v1 = "snippet description with `code` and [Docs](https://example.com)"

    _push(
        api_client,
        {
            "notes": [
                {
                    "uuid": note_uuid,
                    "title": f"{unique_prefix}_note_v1",
                    "content": "note content v1\n\n## Shared Section\n\n**bold** <script>alert(1)</script>",
                    "updated_at": iso_timestamp(),
                    "is_deleted": False,
                }
            ],
            "shortcuts": [
                {
                    "uuid": shortcut_uuid,
                    "name": f"{unique_prefix}_snippet_v1",
                    "value": snippet_value_v1,
                    "description": snippet_description_v1,
                    "links": '[{"label":"Docs","url":"https://example.com"}]',
                    "obsidian_note": "must not leak",
                    "updated_at": iso_timestamp(),
                    "is_deleted": False,
                }
            ],
        },
    )

    status, note_link = api_client.request_json(
        "POST",
        "/v1/share-links",
        {"item_type": "note", "item_uuid": note_uuid},
    )
    assert status == 200, note_link
    status, snippet_link = api_client.request_json(
        "POST",
        "/v1/share-links",
        {"item_type": "shortcut", "item_uuid": shortcut_uuid},
    )
    assert status == 200, snippet_link

    status, public_note = public_http.request_json(
        "GET",
        f"{smoke_config.api_base_url}/v1/public/share/{note_link['token']}",
        timeout=30,
    )
    assert status == 200, public_note
    assert public_note == {
        "type": "note",
        "title": f"{unique_prefix}_note_v1",
        "content": "note content v1\n\n## Shared Section\n\n**bold** <script>alert(1)</script>",
    }
    if smoke_config.api_base_url.startswith("https://"):
        assert note_link["public_url"].startswith("https://"), note_link
    note_url_parts = urlsplit(note_link["public_url"])
    assert note_url_parts.path == f"/share/v2/{note_link['token']}", note_link
    assert not note_url_parts.query, note_link
    assert not note_url_parts.fragment, note_link
    legacy_note_url = urlunsplit(
        note_url_parts._replace(path=f"/share/{note_link['token']}")
    )
    preview_image_url = urlunsplit(
        note_url_parts._replace(
            path="/share/preview-card-v2.png",
            query="",
            fragment="",
        )
    )
    assert public_http.head_or_get_status(note_link["public_url"]) == 200
    status, public_note_html = public_http.request_text("GET", note_link["public_url"])
    assert status == 200, public_note_html[:300]
    assert "<h2>Shared Section</h2>" in public_note_html
    assert "<strong>bold</strong>" in public_note_html
    assert "<script>alert(1)</script>" not in public_note_html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in public_note_html
    assert (
        f'<meta property="og:url" content="{note_link["public_url"]}">'
        in public_note_html
    )
    assert (
        f'<meta property="og:image" content="{preview_image_url}">'
        in public_note_html
    )
    status, legacy_note_html = public_http.request_text("GET", legacy_note_url)
    assert status == 200, legacy_note_html[:300]
    assert "<h2>Shared Section</h2>" in legacy_note_html
    assert "<strong>bold</strong>" in legacy_note_html
    assert (
        f'<meta property="og:url" content="{note_link["public_url"]}">'
        in legacy_note_html
    )

    image_request = Request(
        preview_image_url,
        headers={
            "Accept": "image/png",
            "User-Agent": "snippets-helper-post-release-smoke/1.0",
        },
    )
    with urlopen(image_request, timeout=30) as image_response:
        image_bytes = image_response.read()
        assert image_response.status == 200
        assert image_response.headers.get_content_type() == "image/png"
        assert image_response.headers["Cache-Control"] == (
            "public, max-age=31536000, immutable"
        )
        assert image_response.headers["X-Content-Type-Options"] == "nosniff"
    assert image_bytes[:8] == b"\x89PNG\r\n\x1a\n"
    with Image.open(BytesIO(image_bytes)) as image:
        image.load()
        assert image.format == "PNG"
        assert image.size == (1200, 630)

    status, public_snippet = public_http.request_json(
        "GET",
        f"{smoke_config.api_base_url}/v1/public/share/{snippet_link['token']}",
        timeout=30,
    )
    assert status == 200, public_snippet
    assert public_snippet["name"] == f"{unique_prefix}_snippet_v1"
    assert public_snippet["value"] == snippet_value_v1
    assert public_snippet["description"] == snippet_description_v1
    assert public_snippet["links"] == [{"label": "Docs", "url": "https://example.com"}]
    assert "obsidian_note" not in public_snippet
    if smoke_config.api_base_url.startswith("https://"):
        assert snippet_link["public_url"].startswith("https://"), snippet_link
    snippet_url_parts = urlsplit(snippet_link["public_url"])
    assert snippet_url_parts.path == f"/share/v2/{snippet_link['token']}", snippet_link
    assert not snippet_url_parts.query, snippet_link
    assert not snippet_url_parts.fragment, snippet_link
    legacy_snippet_url = urlunsplit(
        snippet_url_parts._replace(path=f"/share/{snippet_link['token']}")
    )
    assert public_http.head_or_get_status(snippet_link["public_url"]) == 200
    status, public_snippet_html = public_http.request_text("GET", snippet_link["public_url"])
    assert status == 200, public_snippet_html[:300]
    assert "<h3>Snippet Section</h3>" in public_snippet_html
    assert "<strong>snippet bold</strong>" in public_snippet_html
    assert "href='https://example.com/ref'>DocsRef</a>" in public_snippet_html
    assert "<table>" in public_snippet_html
    assert "<th>Назначение</th>" in public_snippet_html
    assert '<td style="text-align:right">7443</td>' in public_snippet_html
    assert "<code>code</code>" in public_snippet_html
    assert "[1]:" not in public_snippet_html
    status, legacy_snippet_html = public_http.request_text("GET", legacy_snippet_url)
    assert status == 200, legacy_snippet_html[:300]
    assert "<h3>Snippet Section</h3>" in legacy_snippet_html
    assert "<strong>snippet bold</strong>" in legacy_snippet_html

    _push(
        api_client,
        {
            "notes": [
                {
                    "uuid": note_uuid,
                    "title": f"{unique_prefix}_note_v2",
                    "content": "note content v2",
                    "updated_at": iso_timestamp(20),
                    "is_deleted": False,
                }
            ],
            "shortcuts": [
                {
                    "uuid": shortcut_uuid,
                    "name": f"{unique_prefix}_snippet_v2",
                    "value": "snippet value v2",
                    "description": "snippet description v2",
                    "links": '[{"label":"Docs 2","url":"https://example.com/2"}]',
                    "updated_at": iso_timestamp(20),
                    "is_deleted": False,
                }
            ],
        },
    )

    status, public_note_v2 = public_http.request_json(
        "GET",
        f"{smoke_config.api_base_url}/v1/public/share/{note_link['token']}",
    )
    assert status == 200, public_note_v2
    assert public_note_v2["title"] == f"{unique_prefix}_note_v2"
    assert public_note_v2["content"] == "note content v2"

    status, public_snippet_v2 = public_http.request_json(
        "GET",
        f"{smoke_config.api_base_url}/v1/public/share/{snippet_link['token']}",
    )
    assert status == 200, public_snippet_v2
    assert public_snippet_v2["name"] == f"{unique_prefix}_snippet_v2"
    assert public_snippet_v2["value"] == "snippet value v2"

    for public_url in (note_link["public_url"], legacy_note_url):
        status, public_note_html_v2 = public_http.request_text("GET", public_url)
        assert status == 200, public_note_html_v2[:300]
        assert f"{unique_prefix}_note_v2" in public_note_html_v2
        assert "note content v2" in public_note_html_v2

    for public_url in (snippet_link["public_url"], legacy_snippet_url):
        status, public_snippet_html_v2 = public_http.request_text("GET", public_url)
        assert status == 200, public_snippet_html_v2[:300]
        assert f"{unique_prefix}_snippet_v2" in public_snippet_html_v2
        assert "snippet value v2" in public_snippet_html_v2

    status, _ = api_client.request_json("DELETE", f"/v1/share-links/{note_link['token']}")
    assert status == 200
    status, revoked_note = public_http.request_json(
        "GET",
        f"{smoke_config.api_base_url}/v1/public/share/{note_link['token']}",
    )
    assert status == 404, revoked_note

    status, _ = api_client.request_json("DELETE", f"/v1/share-links/{snippet_link['token']}")
    assert status == 200
    status, revoked_snippet = public_http.request_json(
        "GET",
        f"{smoke_config.api_base_url}/v1/public/share/{snippet_link['token']}",
    )
    assert status == 404, revoked_snippet
