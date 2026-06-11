from api.share_utils import (
    build_public_url,
    generate_share_token,
    public_note_payload,
    public_finance_plan_payload,
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


def test_build_public_url_uses_forwarded_proto():
    assert (
        build_public_url(
            "http://ister-app.ru/snippets-api/v1/share-links",
            "abc",
            forwarded_proto="https",
        )
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


def test_render_share_html_renders_image_markdown_as_figure_card():
    rendered = render_share_html(
        {
            "type": "note",
            "title": "T",
            "content": "Before\n![diagram](https://ister-app.ru/snippets-media/token.webp)\nAfter",
        }
    )
    assert "figure-card" in rendered
    assert "src='https://ister-app.ru/snippets-media/token.webp'" in rendered
    assert "<figcaption>diagram</figcaption>" in rendered


def test_render_share_html_renders_html_markdown_as_sandbox_card():
    rendered = render_share_html(
        {
            "type": "note",
            "title": "Deck",
            "content": "Before\n![html:Architecture Deck](https://ister-app.ru/snippets-api/v1/media/html/html_TOKEN_123456)\nAfter",
        }
    )
    assert "class='html-card'" in rendered
    assert "Architecture Deck" in rendered
    assert "src='https://ister-app.ru/snippets-api/v1/media/html/html_TOKEN_123456'" in rendered
    assert "sandbox='allow-scripts'" in rendered
    assert "referrerpolicy='no-referrer'" in rendered
    assert "<img" not in rendered


def test_render_share_html_rejects_arbitrary_html_iframe_url():
    rendered = render_share_html(
        {
            "type": "note",
            "title": "Deck",
            "content": "![html:Evil](https://example.com/deck.html)",
        }
    )
    assert "class='html-card'" not in rendered
    assert "<iframe" not in rendered
    assert "![html:Evil]" in rendered


def test_render_share_html_renders_note_content_as_safe_markdown():
    rendered = render_share_html(
        {
            "type": "note",
            "title": "Markdown note",
            "content": "# Section\n\n**bold** and `code`\n\n```bash\necho hi\n```",
        }
    )
    assert "<h1>Section</h1>" in rendered
    assert "<strong>bold</strong>" in rendered
    assert "<code>code</code>" in rendered
    assert '<pre><code class="language-bash">echo hi\n</code></pre>' in rendered


def test_render_share_html_renders_shortcut_value_and_description_as_safe_markdown():
    rendered = render_share_html(
        {
            "type": "shortcut",
            "name": "Markdown shortcut",
            "value": (
                "![screen](https://ister-app.ru/snippets-media/token.webp)\n"
                "### Section\n\n"
                "**bold** ([Cursor][1])\n\n"
                "[1]: https://cursor.com \"Cursor\""
            ),
            "description": "Description with `code` and [Docs](https://example.com).",
            "links": [],
        }
    )
    assert "<article id='share-code' class='share-markdown share-value'>" in rendered
    assert "figure-card" in rendered
    assert "<h3>Section</h3>" in rendered
    assert "<strong>bold</strong>" in rendered
    assert "href='https://cursor.com'>Cursor</a>" in rendered
    assert "[1]:" not in rendered
    assert '<section class="desc share-markdown">' in rendered
    assert "<code>code</code>" in rendered
    assert "href='https://example.com'>Docs</a>" in rendered


def test_render_share_html_renders_shortcut_pipe_tables_and_full_width_copy_button():
    rendered = render_share_html(
        {
            "type": "shortcut",
            "name": "Port rules",
            "value": (
                "Правила:\n\n"
                "| Назначение | Внешний порт | Внутренний адрес | Внутренний порт |\n"
                "|---|---:|---|---:|\n"
                "| MTProxy | `7443` | 192.168.1.96 | 7443 |\n"
                "| SSH в VM | 5555 | 192.168.1.96 | 5555 |"
            ),
            "description": "",
            "links": [],
        }
    )

    assert "<table>" in rendered
    assert "<thead><tr>" in rendered
    assert "<tbody>" in rendered
    assert "<th>Назначение</th>" in rendered
    assert '<th style="text-align:right">Внешний порт</th>' in rendered
    assert "<td>MTProxy</td>" in rendered
    assert '<td style="text-align:right"><code>7443</code></td>' in rendered
    assert "|---|---:" not in rendered
    assert "class='share-copy-button'" in rendered
    assert ".share-copy-button {" in rendered
    assert "width: 100%" in rendered


def test_render_share_html_treats_table_only_shortcut_value_as_markdown():
    rendered = render_share_html(
        {
            "type": "shortcut",
            "name": "Only table",
            "value": "| A | B |\n|---|---|\n| 1 | 2 |",
            "description": "",
            "links": [],
        }
    )

    assert "<article id='share-code' class='share-markdown share-value'>" in rendered
    assert "<table>" in rendered
    assert "<th>A</th>" in rendered
    assert "<td>2</td>" in rendered
    assert "<pre><code id='share-code'>" not in rendered


def test_render_share_html_renders_ordered_lists_split_by_code_blocks():
    rendered = render_share_html(
        {
            "type": "shortcut",
            "name": "Manual",
            "value": (
                "### Порядок действий\n"
                "1. Берем SQL запрос и адаптируем его.\n\n"
                "```sql\n"
                "SELECT 1;\n"
                "```\n"
                "2. Адаптируем запрос для процессинга куба.\n\n"
                "```json\n"
                "{\"refresh\": true}\n"
                "```\n"
                "3. Запускаем процессинг."
            ),
            "description": "",
            "links": [],
        }
    )

    assert "<h3>Порядок действий</h3>" in rendered
    assert "<ol><li>Берем SQL запрос и адаптируем его.</li></ol>" in rendered
    assert '<pre><code class="language-sql">SELECT 1;\n</code></pre>' in rendered
    assert '<ol start="2"><li>Адаптируем запрос для процессинга куба.</li></ol>' in rendered
    assert '<pre><code class="language-json">{&quot;refresh&quot;: true}\n</code></pre>' in rendered
    assert '<ol start="3"><li>Запускаем процессинг.</li></ol>' in rendered
    assert "<p>1. Берем SQL запрос" not in rendered


def test_render_share_html_preserves_plain_shortcut_value_as_code_block():
    rendered = render_share_html(
        {
            "type": "shortcut",
            "name": "Plain code",
            "value": "kubectl apply -f deploy.yaml",
            "description": "",
            "links": [],
        }
    )
    assert "<pre><code id='share-code'>kubectl apply -f deploy.yaml</code></pre>" in rendered


def test_render_share_html_renders_finance_plan_tree_and_totals():
    plan = Row(name="Regular payments", currency="RUB", kind="monthly")
    parent = Row(
        uuid="11111111-1111-4111-8111-111111111111",
        parent_uuid=None,
        name="Дом",
        amount_cents=10000,
        due_day=3,
        due_date=None,
        note="",
        sort_order=0,
    )
    child = Row(
        uuid="22222222-2222-4222-8222-222222222222",
        parent_uuid=parent.uuid,
        name="Интернет",
        amount_cents=50000,
        due_day=21,
        due_date=None,
        note="",
        sort_order=0,
    )

    payload = public_finance_plan_payload(plan, [child, parent])
    rendered = render_share_html(payload)

    assert payload["type"] == "finance_plan"
    assert payload["total_cents"] == 60000
    assert "Regular payments" in rendered
    assert "finance-share-table" in rendered
    assert "Дом" in rendered
    assert "Интернет" in rendered
    assert "600 RUB" in rendered
    assert "--depth:1" in rendered


def test_render_share_html_rejects_unsafe_image_url_scheme():
    rendered = render_share_html(
        {"type": "note", "title": "T", "content": "![bad](javascript:alert(1))"}
    )
    assert "<figure" not in rendered
    assert "<img" not in rendered
