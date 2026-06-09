import hashlib
import html
import json
import re
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from api.media_utils import public_html_base_url, public_media_base_url


TELEGRAPH_API_BASE = "https://api.telegra.ph"
TELEGRAPH_CONTENT_MAX_BYTES = 60 * 1024
TELEGRAPH_AUTHOR_NAME = "Ister App"
SAFE_HREF_SCHEMES = {"http", "https", "mailto"}
SAFE_MEDIA_HOSTS = {"ister-app.ru"}
IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)\s]+)\)")
FENCE_RE = re.compile(r"^[ \t]*```([A-Za-z0-9_+.#-]*)[ \t]*$")
HEADING_RE = re.compile(r"^(#{1,4})[ \t]+(.+?)\s*$")
UNORDERED_RE = re.compile(r"^[ \t]*[-*][ \t]+(.+?)\s*$")
ORDERED_RE = re.compile(r"^[ \t]*(\d{1,9})[.)][ \t]+(.+?)\s*$")
TABLE_ROW_RE = re.compile(r"^[ \t]*\|.*\|[ \t]*$")
HTML_TAG_RE = re.compile(r"<[^>]+>")


@dataclass
class TelegraphPageResult:
    path: str
    url: str
    title: str
    views: int | None = None


class TelegraphError(Exception):
    pass


def api_key_prefix(api_key: str | None) -> str:
    clean = "".join(ch for ch in (api_key or "") if ch.isalnum())
    return clean[:8] or "user"


def telegraph_short_name(api_key: str | None) -> str:
    return f"ister_{api_key_prefix(api_key)}"[:32] or "ister_user"


def content_hash(nodes: list) -> str:
    payload = json.dumps(nodes, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _safe_href(url: str) -> str | None:
    parsed = urlparse(str(url or "").strip())
    if parsed.scheme.lower() not in SAFE_HREF_SCHEMES:
        return None
    if parsed.scheme.lower() in {"http", "https"} and not parsed.netloc:
        return None
    return str(url).strip()


def _safe_image_src(url: str) -> str | None:
    raw = str(url or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        return None
    if parsed.hostname not in SAFE_MEDIA_HOSTS:
        return None
    media_base = urlparse(public_media_base_url())
    if not parsed.path.startswith(media_base.path.rstrip("/") + "/"):
        return None
    return raw


def _safe_html_href(url: str) -> str | None:
    raw = str(url or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        return None
    if parsed.hostname not in SAFE_MEDIA_HOSTS:
        return None
    html_base = urlparse(public_html_base_url())
    if not parsed.path.startswith(html_base.path.rstrip("/") + "/"):
        return None
    return raw


def _plain_text(text: str) -> str:
    clean = HTML_TAG_RE.sub("", text or "")
    return html.unescape(clean)


def _inline_nodes(text: str) -> list:
    source = _plain_text(text)
    nodes: list = []
    index = 0
    for match in LINK_RE.finditer(source):
        if match.start() > index:
            nodes.append(source[index:match.start()])
        href = _safe_href(match.group(2))
        label = _plain_text(match.group(1))
        if href:
            nodes.append({"tag": "a", "attrs": {"href": href}, "children": [label]})
        else:
            nodes.append(label)
        index = match.end()
    if index < len(source):
        nodes.append(source[index:])
    return nodes or [""]


def _paragraph(text: str) -> dict:
    return {"tag": "p", "children": _inline_nodes(text)}


def _split_blocks(markdown: str) -> list[tuple[str, str]]:
    lines = str(markdown or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[tuple[str, str]] = []
    paragraph: list[str] = []
    code: list[str] | None = None
    list_kind: str | None = None
    list_items: list[str] = []
    table_lines: list[str] = []

    def flush_paragraph():
        nonlocal paragraph
        if paragraph:
            blocks.append(("p", " ".join(part.strip() for part in paragraph if part.strip())))
            paragraph = []

    def flush_list():
        nonlocal list_kind, list_items
        if list_kind and list_items:
            blocks.append((list_kind, "\n".join(list_items)))
        list_kind = None
        list_items = []

    def flush_table():
        nonlocal table_lines
        if table_lines:
            blocks.append(("pre", "\n".join(line.strip() for line in table_lines)))
            table_lines = []

    for line in lines:
        fence = FENCE_RE.match(line)
        if code is not None:
            if fence:
                blocks.append(("pre", "\n".join(code)))
                code = None
            else:
                code.append(line)
            continue
        if fence:
            flush_paragraph()
            flush_list()
            flush_table()
            code = []
            continue
        if not line.strip():
            flush_paragraph()
            flush_list()
            flush_table()
            continue
        heading = HEADING_RE.match(line)
        if heading:
            flush_paragraph()
            flush_list()
            flush_table()
            tag = "h3" if len(heading.group(1)) <= 2 else "h4"
            blocks.append((tag, heading.group(2)))
            continue
        if TABLE_ROW_RE.match(line):
            flush_paragraph()
            flush_list()
            table_lines.append(line)
            continue
        unordered = UNORDERED_RE.match(line)
        ordered = ORDERED_RE.match(line)
        if unordered or ordered:
            flush_paragraph()
            flush_table()
            kind = "ul" if unordered else "ol"
            if list_kind != kind:
                flush_list()
                list_kind = kind
            list_items.append((unordered or ordered).group(1 if unordered else 2))
            continue
        flush_list()
        paragraph.append(line)

    if code is not None:
        blocks.append(("pre", "\n".join(code)))
    flush_paragraph()
    flush_list()
    flush_table()
    return blocks


def _html_card_node(alt: str, url: str) -> dict:
    title = alt[5:].strip() if alt.lower().startswith("html:") else alt.strip()
    safe_url = _safe_html_href(url)
    children = [f"Interactive HTML: {title or 'HTML'}"]
    if safe_url:
        children.extend([" ", {"tag": "a", "attrs": {"href": safe_url}, "children": ["Open"]}])
    return {"tag": "p", "children": children}


def _image_nodes(text: str) -> list[dict] | None:
    match = IMAGE_RE.fullmatch(text.strip())
    if not match:
        return None
    alt, url = match.group(1), match.group(2)
    if alt.strip().lower().startswith("html:"):
        return [_html_card_node(alt, url)]
    src = _safe_image_src(url)
    if not src:
        return [_paragraph(f"{alt or 'Image'}: {url}")]
    figure = {"tag": "figure", "children": [{"tag": "img", "attrs": {"src": src}}]}
    if alt:
        figure["children"].append({"tag": "figcaption", "children": [_plain_text(alt)]})
    return [figure]


def markdown_to_telegraph_nodes(title: str, markdown: str) -> list:
    nodes: list = []
    for tag, body in _split_blocks(markdown):
        image_nodes = _image_nodes(body)
        if image_nodes:
            nodes.extend(image_nodes)
            continue
        if tag == "pre":
            nodes.append({"tag": "pre", "children": [_plain_text(body)]})
        elif tag in {"ul", "ol"}:
            items = [
                {"tag": "li", "children": _inline_nodes(item)}
                for item in body.split("\n")
                if item.strip()
            ]
            if items:
                nodes.append({"tag": tag, "children": items})
        elif tag in {"h3", "h4"}:
            nodes.append({"tag": tag, "children": [_plain_text(body)]})
        else:
            nodes.append(_paragraph(body))
    if not nodes:
        nodes.append({"tag": "p", "children": ["(empty)"]})
    return _fit_nodes_to_limit(nodes)


def _nodes_size(nodes: list) -> int:
    return len(json.dumps(nodes, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _fit_nodes_to_limit(nodes: list) -> list:
    if _nodes_size(nodes) <= TELEGRAPH_CONTENT_MAX_BYTES:
        return nodes
    fitted: list = []
    notice = {"tag": "p", "children": ["Content was truncated for Telegra.ph size limits."]}
    for node in nodes:
        candidate = fitted + [node, notice]
        if _nodes_size(candidate) <= TELEGRAPH_CONTENT_MAX_BYTES:
            fitted.append(node)
            continue
        break
    if not fitted:
        text = _collect_text(nodes)
        while text and _nodes_size([{"tag": "pre", "children": [text]}, notice]) > TELEGRAPH_CONTENT_MAX_BYTES:
            text = text[:-512]
        fitted = [{"tag": "pre", "children": [text or "(truncated)"]}]
    fitted.append(notice)
    return fitted


def _collect_text(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(_collect_text(item) for item in value)
    if isinstance(value, dict):
        return _collect_text(value.get("children", []))
    return ""


class TelegraphClient:
    def __init__(self, base_url: str = TELEGRAPH_API_BASE):
        self.base_url = base_url.rstrip("/")

    async def create_account(
        self,
        *,
        short_name: str,
        author_name: str = TELEGRAPH_AUTHOR_NAME,
        author_url: str = "",
    ) -> dict:
        return await self._post(
            "/createAccount",
            {
                "short_name": short_name[:32],
                "author_name": author_name[:128],
                "author_url": author_url[:512],
            },
        )

    async def create_page(
        self,
        *,
        access_token: str,
        title: str,
        content: list,
        author_name: str = TELEGRAPH_AUTHOR_NAME,
        author_url: str = "",
    ) -> TelegraphPageResult:
        result = await self._post(
            "/createPage",
            self._page_payload(access_token, title, content, author_name, author_url),
        )
        return TelegraphPageResult(
            path=result["path"],
            url=result["url"],
            title=result.get("title") or title,
            views=result.get("views"),
        )

    async def edit_page(
        self,
        *,
        access_token: str,
        path: str,
        title: str,
        content: list,
        author_name: str = TELEGRAPH_AUTHOR_NAME,
        author_url: str = "",
    ) -> TelegraphPageResult:
        result = await self._post(
            f"/editPage/{path}",
            self._page_payload(access_token, title, content, author_name, author_url),
        )
        return TelegraphPageResult(
            path=result["path"],
            url=result["url"],
            title=result.get("title") or title,
            views=result.get("views"),
        )

    async def get_views(self, path: str) -> int | None:
        result = await self._post(f"/getViews/{path}", {})
        return result.get("views")

    def _page_payload(
        self,
        access_token: str,
        title: str,
        content: list,
        author_name: str,
        author_url: str,
    ) -> dict:
        return {
            "access_token": access_token,
            "title": (title or "Untitled")[:256],
            "author_name": (author_name or TELEGRAPH_AUTHOR_NAME)[:128],
            "author_url": (author_url or "")[:512],
            "content": json.dumps(content, ensure_ascii=False, separators=(",", ":")),
            "return_content": "false",
        }

    async def _post(self, path: str, data: dict) -> dict:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(f"{self.base_url}{path}", data=data)
        resp.raise_for_status()
        payload = resp.json()
        if not payload.get("ok"):
            error = str(payload.get("error") or "Telegraph API error")
            raise TelegraphError(error)
        return payload.get("result") or {}
