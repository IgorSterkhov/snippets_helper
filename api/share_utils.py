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
        body = f"<article>{_render_text_with_figures(payload.get('content', ''))}</article>"

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
    button {{ background: #238636; color: white; border: 0; border-radius: 6px; padding: 8px 12px; font-weight: 600; }}
    a {{ color: #58a6ff; }}
    .desc {{ color: #8b949e; }}
    .figure-card {{ margin: 14px 0; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; background: #161b22; }}
    .figure-card img {{ display: block; max-width: 100%; height: auto; margin: 0 auto; }}
    .figure-card figcaption {{ border-top: 1px solid #30363d; padding: 8px 10px; color: #8b949e; font-size: 13px; }}
  </style>
</head>
<body><main><h1>{safe_title}</h1>{body}</main></body>
</html>"""
