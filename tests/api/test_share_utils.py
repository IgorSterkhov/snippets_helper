from api.share_utils import (
    build_public_url,
    generate_share_token,
    public_note_payload,
    public_shortcut_payload,
    render_share_html,
)


class Row:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def test_generate_share_token_is_url_safe_and_long():
    token = generate_share_token()
    assert len(token) >= 32
    assert all(ch.isalnum() or ch in "_-" for ch in token)


def test_build_public_url_uses_root_share_path():
    assert (
        build_public_url("https://ister-app.ru/snippets-api/v1/share-links", "abc")
        == "https://ister-app.ru/share/abc"
    )


def test_public_note_payload_exposes_only_title_and_content():
    row = Row(title="T", content="<b>secret</b>", folder_uuid="hidden", is_pinned=1)
    payload = public_note_payload(row)
    assert payload == {"type": "note", "title": "T", "content": "<b>secret</b>"}


def test_public_shortcut_payload_exposes_only_allowed_fields():
    row = Row(
        name="Deploy",
        value="kubectl apply",
        description="desc",
        links='[{"label":"Docs","url":"https://example.com"}, {"url":"javascript:bad"}]',
        obsidian_note="hidden",
        is_pinned=1,
    )
    payload = public_shortcut_payload(row)
    assert payload["type"] == "shortcut"
    assert payload["name"] == "Deploy"
    assert payload["value"] == "kubectl apply"
    assert payload["description"] == "desc"
    assert payload["links"] == [{"label": "Docs", "url": "https://example.com"}]
    assert "obsidian_note" not in payload


def test_render_share_html_escapes_user_content():
    rendered = render_share_html(
        {"type": "note", "title": "<script>x</script>", "content": "<b>hi</b>"}
    )
    assert "<script>" not in rendered
    assert "&lt;script&gt;x&lt;/script&gt;" in rendered
    assert "&lt;b&gt;hi&lt;/b&gt;" in rendered
