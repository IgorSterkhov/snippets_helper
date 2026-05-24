import html
import json
import secrets
from urllib.parse import urlparse


def generate_share_token() -> str:
    return secrets.token_urlsafe(32)


def build_public_url(request_url: str, token: str) -> str:
    parsed = urlparse(str(request_url))
    return f"{parsed.scheme}://{parsed.netloc}/share/{token}"


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


def _preserve_line_breaks(text: str) -> str:
    return "<br>".join(html.escape(text or "").splitlines())


def render_share_html(payload: dict) -> str:
    title = payload.get("title") or payload.get("name") or "Shared item"
    safe_title = html.escape(title)

    if payload.get("type") == "shortcut":
        body = (
            f"<p class='desc'>{_preserve_line_breaks(payload.get('description', ''))}</p>"
            f"<pre><code id='share-code'>{html.escape(payload.get('value', ''))}</code></pre>"
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
        body = f"<article>{_preserve_line_breaks(payload.get('content', ''))}</article>"

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
  </style>
</head>
<body><main><h1>{safe_title}</h1>{body}</main></body>
</html>"""
