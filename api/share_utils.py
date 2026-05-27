import html
import json
import re
import secrets
from urllib.parse import urlparse


def generate_share_token() -> str:
    return secrets.token_urlsafe(32)


def build_public_url(request_url: str, token: str, forwarded_proto: str | None = None) -> str:
    parsed = urlparse(str(request_url))
    scheme = parsed.scheme
    if forwarded_proto:
        candidate = forwarded_proto.split(",", 1)[0].strip().lower()
        if candidate in {"http", "https"}:
            scheme = candidate
    return f"{scheme}://{parsed.netloc}/share/{token}"


def _safe_links(raw: str | list | None) -> list[dict[str, str]]:
    if not raw:
        return []
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError):
            return []
    else:
        parsed = raw
    if not isinstance(parsed, list):
        return []

    links = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        label = str(item.get("label") or url).strip()
        scheme = urlparse(url).scheme.lower()
        if scheme not in {"http", "https"}:
            continue
        links.append({"label": label or url, "url": url})
    return links


def public_note_payload(row) -> dict:
    return {
        "type": "note",
        "title": row.title or "",
        "content": row.content or "",
    }


def public_shortcut_payload(row) -> dict:
    return {
        "type": "shortcut",
        "name": row.name or "",
        "value": row.value or "",
        "description": row.description or "",
        "links": _safe_links(row.links),
    }


IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)\s]+)\)")
CODE_SPAN_RE = re.compile(r"`([^`\n]+)`")
FENCE_RE = re.compile(r"^[ \t]*```([A-Za-z0-9_+.#-]*)[ \t]*$")
HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.+?)\s*$")
UNORDERED_LIST_RE = re.compile(r"^[ \t]*[-*][ \t]+(.+?)\s*$")
SAFE_LANGUAGE_RE = re.compile(r"[^A-Za-z0-9_+.#-]")


def _is_safe_image_url(url: str) -> bool:
    if url.startswith("/snippets-media/"):
        return True
    parsed = urlparse(url)
    return parsed.scheme.lower() in {"http", "https"}


def _figure_card(alt: str, url: str) -> str:
    safe_alt = html.escape(alt or "image")
    safe_url = html.escape(url, quote=True)
    return (
        "<figure class='figure-card'>"
        f"<img src='{safe_url}' alt='{safe_alt}' loading='lazy'>"
        f"<figcaption>{safe_alt}</figcaption>"
        "</figure>"
    )


def _safe_link_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme.lower() in {"http", "https"}


def _render_inline_markdown(text: str) -> str:
    tokens: list[str] = []

    def stash(value: str) -> str:
        token = f"SHAREINLINETOKEN{len(tokens)}END"
        tokens.append(value)
        return token

    def image_repl(match: re.Match) -> str:
        alt, url = match.group(1), match.group(2)
        if _is_safe_image_url(url):
            return stash(_figure_card(alt, url))
        return stash(html.escape(match.group(0)))

    def link_repl(match: re.Match) -> str:
        label, url = match.group(1), match.group(2)
        if not _safe_link_url(url):
            return stash(html.escape(match.group(0)))
        return stash(
            "<a rel='noopener noreferrer' target='_blank' "
            f"href='{html.escape(url, quote=True)}'>{html.escape(label)}</a>"
        )

    def code_repl(match: re.Match) -> str:
        return stash(f"<code>{html.escape(match.group(1))}</code>")

    marked = IMAGE_RE.sub(image_repl, text or "")
    marked = LINK_RE.sub(link_repl, marked)
    marked = CODE_SPAN_RE.sub(code_repl, marked)
    rendered = html.escape(marked)
    rendered = re.sub(r"\*\*([^*\n]+)\*\*", r"<strong>\1</strong>", rendered)
    rendered = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", rendered)
    for index, value in enumerate(tokens):
        rendered = rendered.replace(f"SHAREINLINETOKEN{index}END", value)
    return rendered


def _language_class(language: str) -> str:
    cleaned = SAFE_LANGUAGE_RE.sub("", language or "").strip(".")
    return f' class="language-{html.escape(cleaned, quote=True)}"' if cleaned else ""


def _render_code_block(lines: list[str], language: str) -> str:
    code = "\n".join(lines)
    if code and not code.endswith("\n"):
        code += "\n"
    return f"<pre><code{_language_class(language)}>{html.escape(code)}</code></pre>"


def _render_markdown(text: str) -> str:
    output: list[str] = []
    paragraph: list[str] = []
    list_items: list[str] = []
    code_lines: list[str] = []
    code_language = ""
    in_code = False

    def flush_paragraph() -> None:
        if not paragraph:
            return
        output.append(
            "<p>"
            + "<br>".join(_render_inline_markdown(line) for line in paragraph)
            + "</p>"
        )
        paragraph.clear()

    def flush_list() -> None:
        if not list_items:
            return
        items = "".join(f"<li>{_render_inline_markdown(item)}</li>" for item in list_items)
        output.append(f"<ul>{items}</ul>")
        list_items.clear()

    def flush_blocks() -> None:
        flush_paragraph()
        flush_list()

    for line in (text or "").splitlines():
        fence = FENCE_RE.match(line)
        if fence:
            if in_code:
                output.append(_render_code_block(code_lines, code_language))
                code_lines = []
                code_language = ""
                in_code = False
            else:
                flush_blocks()
                in_code = True
                code_language = fence.group(1)
            continue

        if in_code:
            code_lines.append(line)
            continue

        if not line.strip():
            flush_blocks()
            continue

        heading = HEADING_RE.match(line)
        if heading:
            flush_blocks()
            level = min(len(heading.group(1)), 6)
            output.append(f"<h{level}>{_render_inline_markdown(heading.group(2))}</h{level}>")
            continue

        unordered = UNORDERED_LIST_RE.match(line)
        if unordered:
            flush_paragraph()
            list_items.append(unordered.group(1))
            continue

        flush_list()
        paragraph.append(line)

    if in_code:
        output.append(_render_code_block(code_lines, code_language))
    flush_blocks()
    return "\n".join(output)


def _render_text_with_figures(text: str) -> str:
    rendered_lines = []
    for line in (text or "").splitlines():
        pos = 0
        parts = []
        for match in IMAGE_RE.finditer(line):
            parts.append(html.escape(line[pos:match.start()]))
            alt, url = match.group(1), match.group(2)
            if _is_safe_image_url(url):
                parts.append(_figure_card(alt, url))
            else:
                parts.append(html.escape(match.group(0)))
            pos = match.end()
        parts.append(html.escape(line[pos:]))
        rendered_lines.append("".join(parts))
    return "<br>".join(rendered_lines)


def render_share_html(payload: dict) -> str:
    title = payload.get("title") or payload.get("name") or "Shared item"
    safe_title = html.escape(title)

    if payload.get("type") == "shortcut":
        value = payload.get("value", "")
        rendered_value = _render_text_with_figures(value)
        if IMAGE_RE.search(value or ""):
            value_html = f"<article id='share-code'>{rendered_value}</article>"
        else:
            value_html = f"<pre><code id='share-code'>{html.escape(value)}</code></pre>"
        body = (
            f"<p class='desc'>{_render_text_with_figures(payload.get('description', ''))}</p>"
            f"{value_html}"
            "<button type='button' onclick='navigator.clipboard.writeText("
            'document.getElementById("share-code").innerText)'
            "'>Copy</button>"
        )
        links = payload.get("links") or []
        if links:
            items = "".join(
                "<li><a rel='noopener noreferrer' target='_blank' "
                f"href='{html.escape(link['url'], quote=True)}'>"
                f"{html.escape(link['label'])}</a></li>"
                for link in links
            )
            body += f"<ul>{items}</ul>"
    else:
        body = f"<article class='share-markdown'>{_render_markdown(payload.get('content', ''))}</article>"

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{safe_title}</title>
  <style>
    body {{ margin: 0; background: #0d1117; color: #c9d1d9; font: 15px/1.55 system-ui, -apple-system, Segoe UI, sans-serif; }}
    main {{ max-width: 860px; margin: 0 auto; padding: 32px 18px; }}
    h1 {{ color: #f0f6fc; font-size: 28px; line-height: 1.2; }}
    pre {{ background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; overflow: auto; }}
    code {{ background: #161b22; border: 1px solid #30363d; border-radius: 4px; padding: 1px 4px; }}
    pre code {{ background: transparent; border: 0; padding: 0; }}
    button {{ background: #238636; color: white; border: 0; border-radius: 6px; padding: 8px 12px; font-weight: 600; }}
    a {{ color: #58a6ff; }}
    .desc {{ color: #8b949e; }}
    .share-markdown h1, .share-markdown h2, .share-markdown h3 {{ color: #f0f6fc; margin: 20px 0 10px; }}
    .share-markdown p, .share-markdown ul {{ margin: 0 0 12px; }}
    .share-markdown li {{ margin: 4px 0; }}
    .figure-card {{ margin: 14px 0; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; background: #161b22; }}
    .figure-card img {{ display: block; max-width: 100%; height: auto; margin: 0 auto; }}
    .figure-card figcaption {{ border-top: 1px solid #30363d; padding: 8px 10px; color: #8b949e; font-size: 13px; }}
  </style>
</head>
<body><main><h1>{safe_title}</h1>{body}</main></body>
</html>"""
