import hashlib
import html
import json
import os
import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from api.markdown_tables import normalize_table_cells, split_table_row, table_start_at
from api.media_utils import public_html_base_url, public_media_base_url


TELEGRAPH_API_BASE = os.getenv("TELEGRAPH_API_BASE_URL", "https://api.telegra.ph")
TELEGRAPH_CONNECT_TIMEOUT_SECONDS = float(os.getenv("TELEGRAPH_CONNECT_TIMEOUT_SECONDS", "6"))
TELEGRAPH_READ_TIMEOUT_SECONDS = float(os.getenv("TELEGRAPH_READ_TIMEOUT_SECONDS", "12"))
TELEGRAPH_CONTENT_MAX_BYTES = 60 * 1024
TELEGRAPH_AUTHOR_NAME = "Ister App"
SAFE_HREF_SCHEMES = {"http", "https", "mailto"}
SAFE_MEDIA_HOSTS = {"ister-app.ru"}
IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
FENCE_RE = re.compile(r"^[ \t]*```([A-Za-z0-9_+.#-]*)[ \t]*$")
HEADING_RE = re.compile(r"^(#{1,4})[ \t]+(.+?)\s*$")
UNORDERED_RE = re.compile(r"^[ \t]*[-*][ \t]+(.+?)\s*$")
ORDERED_RE = re.compile(r"^[ \t]*(\d{1,9})[.)][ \t]+(.+?)\s*$")
HTML_TAG_RE = re.compile(r"<[^>]+>")
BARE_URL_RE = re.compile(r"(?i)(?<!\w)(?:https?://|mailto:)[^\s<>{}\[\]]+")
BARE_URL_TRAILING_PUNCTUATION = ".,;:!?"
TELEGRAPH_COMPACT_TABLE_MAX_WIDTH = 32


@dataclass
class TelegraphPageResult:
    path: str
    url: str
    title: str
    views: int | None = None


@dataclass
class MarkdownTable:
    headers: list[str]
    rows: list[list[str]]
    alignments: list[str]


@dataclass(frozen=True)
class MarkdownInlineSpan:
    start: int
    end: int
    kind: str
    label: str
    target: str
    raw: str


@dataclass
class MarkdownParenthesisFrame:
    start: int
    kind: str
    mode: str = ""
    quote: str = ""


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
    raw = str(url or "").strip()
    try:
        parsed = urlparse(raw)
    except ValueError:
        return None
    if parsed.scheme.lower() not in SAFE_HREF_SCHEMES:
        return None
    if parsed.scheme.lower() in {"http", "https"} and not parsed.netloc:
        return None
    return raw


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


def _is_escaped(text: str, index: int) -> bool:
    backslashes = 0
    index -= 1
    while index >= 0 and text[index] == "\\":
        backslashes += 1
        index -= 1
    return backslashes % 2 == 1


def _markdown_label_ends(source: str) -> dict[int, int]:
    openings: list[int] = []
    endings: dict[int, int] = {}
    index = 0
    while index < len(source):
        char = source[index]
        if char == "\\":
            index += 2
            continue
        if char == "[":
            openings.append(index)
        elif char == "]" and openings:
            endings[openings.pop()] = index
        index += 1
    return endings


def _markdown_parenthesis_ends(
    source: str,
    destination_openings: set[int],
) -> dict[int, int]:
    frames: list[MarkdownParenthesisFrame] = []
    endings: dict[int, int] = {}
    index = 0
    while index < len(source):
        char = source[index]
        if char == "\\":
            index += 2
            continue

        if frames and frames[-1].kind == "destination":
            frame = frames[-1]
            if frame.mode == "angle":
                if char == ">":
                    frame.mode = "after_target"
                index += 1
                continue
            if frame.mode == "quoted_title":
                if char == frame.quote:
                    frame.mode = "after_title"
                    frame.quote = ""
                index += 1
                continue

            if char == ")":
                endings[frame.start] = index
                frames.pop()
                index += 1
                continue
            if char == "(":
                if frame.mode == "after_target":
                    frames.append(MarkdownParenthesisFrame(index, "title"))
                else:
                    if frame.mode == "leading":
                        frame.mode = "target"
                    frames.append(MarkdownParenthesisFrame(index, "nested"))
                index += 1
                continue

            if frame.mode == "leading":
                if char.isspace():
                    index += 1
                    continue
                frame.mode = "angle" if char == "<" else "target"
            elif frame.mode == "target" and char.isspace():
                frame.mode = "after_target"
            elif frame.mode == "after_target":
                if char.isspace():
                    index += 1
                    continue
                if char in {'"', "'"}:
                    frame.mode = "quoted_title"
                    frame.quote = char
                else:
                    frame.mode = "invalid"
            elif frame.mode == "after_title" and not char.isspace():
                frame.mode = "invalid"
            index += 1
            continue

        if frames and frames[-1].kind in {"nested", "title"}:
            kind = frames[-1].kind
            if char == "(":
                frames.append(MarkdownParenthesisFrame(index, kind))
            elif char == ")":
                frames.pop()
                if kind == "title" and frames and frames[-1].kind == "destination":
                    frames[-1].mode = "after_title"
            index += 1
            continue

        if char == "(":
            if index in destination_openings:
                frames.append(MarkdownParenthesisFrame(index, "destination", "leading"))
            else:
                frames.append(MarkdownParenthesisFrame(index, "generic"))
        elif char == ")" and frames:
            frames.pop()
        index += 1
    return endings


def _finish_markdown_destination(
    source: str,
    index: int,
    target: str,
    closing_parenthesis: int,
) -> tuple[str, int] | None:
    while index < closing_parenthesis and source[index].isspace():
        index += 1
    if index == closing_parenthesis:
        return target, closing_parenthesis + 1

    delimiter = source[index]
    if delimiter in {'"', "'"}:
        index += 1
        while index < closing_parenthesis:
            if source[index] == "\\":
                index += 2
                continue
            if source[index] == delimiter:
                index += 1
                break
            index += 1
        else:
            return None
    elif delimiter == "(":
        depth = 1
        index += 1
        while index < closing_parenthesis and depth:
            if source[index] == "\\":
                index += 2
                continue
            if source[index] == "(":
                depth += 1
            elif source[index] == ")":
                depth -= 1
            index += 1
        if depth:
            return None
    else:
        return None

    while index < closing_parenthesis and source[index].isspace():
        index += 1
    if index != closing_parenthesis:
        return None
    return target, closing_parenthesis + 1


def _parse_markdown_destination(
    source: str,
    opening_parenthesis: int,
    closing_parenthesis: int,
) -> tuple[str, int] | None:
    index = opening_parenthesis + 1
    while index < closing_parenthesis and source[index].isspace():
        index += 1
    if index == closing_parenthesis:
        return "", closing_parenthesis + 1

    if source[index] == "<":
        target_start = index + 1
        index = target_start
        while index < closing_parenthesis:
            if source[index] == "\\":
                index += 2
                continue
            if source[index] == ">":
                target = source[target_start:index]
                index += 1
                if index == closing_parenthesis:
                    return target, closing_parenthesis + 1
                if not source[index].isspace():
                    return None
                return _finish_markdown_destination(
                    source,
                    index,
                    target,
                    closing_parenthesis,
                )
            index += 1
        return None

    target_start = index
    depth = 0
    while index <= closing_parenthesis:
        char = source[index]
        if char == "\\":
            index += 2
            continue
        if char == "(":
            depth += 1
        elif char == ")":
            if depth == 0:
                return source[target_start:index], index + 1
            depth -= 1
        elif char.isspace():
            if depth:
                return None
            target = source[target_start:index]
            return _finish_markdown_destination(
                source,
                index,
                target,
                closing_parenthesis,
            )
        index += 1
    return None


def _markdown_inline_spans(source: str) -> list[MarkdownInlineSpan]:
    spans: list[MarkdownInlineSpan] = []
    label_ends = _markdown_label_ends(source)
    destination_openings = {
        label_end + 1
        for label_end in label_ends.values()
        if label_end + 1 < len(source) and source[label_end + 1] == "("
    }
    parenthesis_ends = _markdown_parenthesis_ends(source, destination_openings)
    index = 0
    while index < len(source):
        kind: str | None = None
        start = index
        if (
            source[index] == "!"
            and index + 1 < len(source)
            and source[index + 1] == "["
            and not _is_escaped(source, index)
        ):
            kind = "image"
            opening_bracket = index + 1
        elif (
            source[index] == "["
            and not _is_escaped(source, index)
            and (index == 0 or source[index - 1] != "!")
        ):
            kind = "link"
            opening_bracket = index
        else:
            index += 1
            continue

        label_end = label_ends.get(opening_bracket)
        if (
            label_end is None
            or label_end + 1 >= len(source)
            or source[label_end + 1] != "("
        ):
            index += 1
            continue
        opening_parenthesis = label_end + 1
        closing_parenthesis = parenthesis_ends.get(opening_parenthesis)
        if closing_parenthesis is None:
            index += 1
            continue
        destination = _parse_markdown_destination(
            source,
            opening_parenthesis,
            closing_parenthesis,
        )
        if destination is None:
            end = closing_parenthesis + 1
            spans.append(MarkdownInlineSpan(
                start=start,
                end=end,
                kind="literal",
                label=source[opening_bracket + 1:label_end],
                target="",
                raw=source[start:end],
            ))
            index = end
            continue
        target, end = destination
        spans.append(MarkdownInlineSpan(
            start=start,
            end=end,
            kind=kind,
            label=source[opening_bracket + 1:label_end],
            target=target,
            raw=source[start:end],
        ))
        index = end
    return spans


def _sanitized_protected_span(span: MarkdownInlineSpan) -> str:
    prefix = "![" if span.raw.startswith("![") else "["
    suffix_start = len(prefix) + len(span.label) + 1
    suffix = span.raw[suffix_start:]
    angle_start = 1 if suffix.startswith("(") else len(suffix)
    while angle_start < len(suffix) and suffix[angle_start].isspace():
        angle_start += 1
    if angle_start < len(suffix) and suffix[angle_start] == "<":
        angle_end = angle_start + 1
        while angle_end < len(suffix):
            if suffix[angle_end] == "\\":
                angle_end += 2
                continue
            if suffix[angle_end] == ">":
                break
            angle_end += 1
        if angle_end < len(suffix):
            suffix = (
                f"{_plain_text(suffix[:angle_start])}<"
                f"{_plain_text(suffix[angle_start + 1:angle_end])}>"
                f"{_plain_text(suffix[angle_end + 1:])}"
            )
        else:
            suffix = _plain_text(suffix)
    else:
        suffix = _plain_text(suffix)
    return f"{prefix}{_plain_text(span.label)}]{suffix}"


def _decoded_link_target(span: MarkdownInlineSpan) -> str:
    return html.unescape(span.target)


def _inline_nodes(text: str) -> list:
    source = str(text or "")
    nodes: list = []
    index = 0
    for span in _markdown_inline_spans(source):
        if span.start > index:
            nodes.append(_plain_text(source[index:span.start]))
        if span.kind == "link":
            href = _safe_href(_decoded_link_target(span))
            label = _plain_text(span.label)
            if href:
                nodes.append({"tag": "a", "attrs": {"href": href}, "children": [label]})
            else:
                nodes.append(label)
        else:
            nodes.append(_sanitized_protected_span(span))
        index = span.end
    if index < len(source):
        nodes.append(_plain_text(source[index:]))
    return nodes or [""]


def _visible_table_text(text: str) -> str:
    source = str(text or "")
    parts: list[str] = []
    index = 0
    for span in _markdown_inline_spans(source):
        parts.append(_plain_text(source[index:span.start]))
        parts.append(
            _plain_text(span.label)
            if span.kind == "link"
            else _sanitized_protected_span(span)
        )
        index = span.end
    parts.append(_plain_text(source[index:]))
    return "".join(parts)


def _append_inline_node(nodes: list, node) -> None:
    if isinstance(node, str) and nodes and isinstance(nodes[-1], str):
        nodes[-1] += node
    else:
        nodes.append(node)


def _bare_url_nodes(text: str) -> list:
    nodes: list = []
    index = 0
    for match in BARE_URL_RE.finditer(text):
        if match.start() > index:
            _append_inline_node(nodes, text[index:match.start()])
        candidate = match.group(0)
        target = candidate.rstrip(BARE_URL_TRAILING_PUNCTUATION)
        trailing = candidate[len(target):]
        href = _safe_href(target)
        if href:
            _append_inline_node(
                nodes,
                {"tag": "a", "attrs": {"href": href}, "children": [target]},
            )
        else:
            _append_inline_node(nodes, target)
        if trailing:
            _append_inline_node(nodes, trailing)
        index = match.end()
    if index < len(text):
        _append_inline_node(nodes, text[index:])
    return nodes


def _table_inline_nodes(text: str) -> list:
    source = str(text or "").strip()
    nodes: list = []
    index = 0
    for span in _markdown_inline_spans(source):
        if span.start > index:
            for node in _bare_url_nodes(_plain_text(source[index:span.start])):
                _append_inline_node(nodes, node)
        if span.kind == "link":
            href = _safe_href(_decoded_link_target(span))
            label = _plain_text(span.label)
            if href:
                _append_inline_node(
                    nodes,
                    {"tag": "a", "attrs": {"href": href}, "children": [label]},
                )
            else:
                _append_inline_node(nodes, label)
        else:
            _append_inline_node(nodes, _sanitized_protected_span(span))
        index = span.end
    if index < len(source):
        for node in _bare_url_nodes(_plain_text(source[index:])):
            _append_inline_node(nodes, node)
    return nodes or [""]


def _paragraph(text: str) -> dict:
    return {"tag": "p", "children": _inline_nodes(text)}


def _display_width(text: str) -> int:
    width = 0
    for char in text:
        if unicodedata.combining(char):
            continue
        width += 2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1
    return width


def _pad_table_cell(text: str, width: int, alignment: str) -> str:
    padding = max(0, width - _display_width(text))
    if alignment == "right":
        return " " * padding + text
    if alignment == "center":
        left = padding // 2
        return " " * left + text + " " * (padding - left)
    return text + " " * padding


def _format_table(headers: list[str], rows: list[list[str]], alignments: list[str]) -> str:
    width = len(headers)
    clean_headers = [
        _visible_table_text(cell).strip()
        for cell in normalize_table_cells(headers, width)
    ]
    clean_rows = [
        [
            _visible_table_text(cell).strip()
            for cell in normalize_table_cells(row, width)
        ]
        for row in rows
    ]
    column_widths = [
        max(_display_width(row[index]) for row in [clean_headers, *clean_rows])
        for index in range(width)
    ]

    def format_row(row: list[str]) -> str:
        return "  ".join(
            _pad_table_cell(row[index], column_widths[index], alignments[index])
            for index in range(width)
        ).rstrip()

    divider = "  ".join("─" * column_width for column_width in column_widths)
    return "\n".join([format_row(clean_headers), divider, *(format_row(row) for row in clean_rows)])


def _normalized_table_rows(table: MarkdownTable) -> list[list[str]]:
    width = len(table.headers)
    return [normalize_table_cells(row, width) for row in table.rows]


def _table_display_width(table: MarkdownTable) -> int:
    width = len(table.headers)
    clean_headers = [
        _visible_table_text(cell).strip()
        for cell in normalize_table_cells(table.headers, width)
    ]
    clean_rows = [
        [_visible_table_text(cell).strip() for cell in row]
        for row in _normalized_table_rows(table)
    ]
    column_widths = [
        max(_display_width(row[index]) for row in [clean_headers, *clean_rows])
        for index in range(width)
    ]
    return sum(column_widths) + 2 * max(0, width - 1)


def _table_has_link(table: MarkdownTable) -> bool:
    cells = [*normalize_table_cells(table.headers, len(table.headers))]
    for row in _normalized_table_rows(table):
        cells.extend(row)
    for cell in cells:
        source = str(cell or "")
        if any(span.kind == "link" for span in _markdown_inline_spans(source)):
            return True
        if any(
            isinstance(node, dict) and node.get("tag") == "a"
            for node in _table_inline_nodes(cell)
        ):
            return True
    return False


def _table_has_visible_row(table: MarkdownTable) -> bool:
    return any(
        any(_visible_table_text(cell).strip() for cell in row)
        for row in _normalized_table_rows(table)
    )


def _should_render_table_records(table: MarkdownTable) -> bool:
    if not _table_has_visible_row(table):
        return False
    return (
        _table_has_link(table)
        or _table_display_width(table) > TELEGRAPH_COMPACT_TABLE_MAX_WIDTH
    )


def _table_record_nodes(table: MarkdownTable) -> list[dict]:
    width = len(table.headers)
    headers = normalize_table_cells(table.headers, width)
    records: list[dict] = []
    for row in _normalized_table_rows(table):
        if not any(_visible_table_text(cell).strip() for cell in row):
            continue
        entries: list[list] = []
        if _visible_table_text(row[0]).strip():
            entries.append([{"tag": "strong", "children": _table_inline_nodes(row[0])}])
        for index in range(1, width):
            if not _visible_table_text(row[index]).strip():
                continue
            entry: list = []
            if _visible_table_text(headers[index]).strip():
                entry.extend([
                    {"tag": "strong", "children": _table_inline_nodes(headers[index])},
                    ": ",
                ])
            entry.extend(_table_inline_nodes(row[index]))
            entries.append(entry)
        children: list = []
        for entry in entries:
            if children:
                children.append({"tag": "br"})
            children.extend(entry)
        if children:
            records.append({"tag": "blockquote", "children": children})
    return records


def _split_blocks(markdown: str) -> list[tuple[str, str | MarkdownTable]]:
    lines = str(markdown or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[tuple[str, str | MarkdownTable]] = []
    paragraph: list[str] = []
    code: list[str] | None = None
    list_kind: str | None = None
    list_items: list[str] = []

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

    index = 0
    while index < len(lines):
        line = lines[index]
        fence = FENCE_RE.match(line)
        if code is not None:
            if fence:
                blocks.append(("pre", "\n".join(code)))
                code = None
            else:
                code.append(line)
            index += 1
            continue
        if fence:
            flush_paragraph()
            flush_list()
            code = []
            index += 1
            continue
        if not line.strip():
            flush_paragraph()
            flush_list()
            index += 1
            continue
        table = table_start_at(lines, index)
        if table:
            headers, alignments = table
            rows: list[list[str]] = []
            flush_paragraph()
            flush_list()
            index += 2
            while index < len(lines):
                if not lines[index].strip():
                    break
                row = split_table_row(lines[index])
                if not row:
                    break
                rows.append(row)
                index += 1
            blocks.append(("table", MarkdownTable(headers, rows, alignments)))
            continue
        heading = HEADING_RE.match(line)
        if heading:
            flush_paragraph()
            flush_list()
            tag = "h3" if len(heading.group(1)) <= 2 else "h4"
            blocks.append((tag, heading.group(2)))
            index += 1
            continue
        unordered = UNORDERED_RE.match(line)
        ordered = ORDERED_RE.match(line)
        if unordered or ordered:
            flush_paragraph()
            kind = "ul" if unordered else "ol"
            if list_kind != kind:
                flush_list()
                list_kind = kind
            list_items.append((unordered or ordered).group(1 if unordered else 2))
            index += 1
            continue
        flush_list()
        paragraph.append(line)
        index += 1

    if code is not None:
        blocks.append(("pre", "\n".join(code)))
    flush_paragraph()
    flush_list()
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
        if isinstance(body, MarkdownTable):
            if _should_render_table_records(body):
                nodes.extend(_table_record_nodes(body))
            else:
                nodes.append({
                    "tag": "pre",
                    "children": [_format_table(body.headers, body.rows, body.alignments)],
                })
            continue
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


def _is_atomic_table_record(node) -> bool:
    return isinstance(node, dict) and node.get("tag") == "blockquote"


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
        if nodes and _is_atomic_table_record(nodes[0]):
            return [notice]
        fallback_nodes: list = []
        for node in nodes:
            if _is_atomic_table_record(node):
                break
            fallback_nodes.append(node)
        text = _collect_text(fallback_nodes)
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
        url = f"{self.base_url}{path}"
        timeout = httpx.Timeout(
            TELEGRAPH_READ_TIMEOUT_SECONDS,
            connect=TELEGRAPH_CONNECT_TIMEOUT_SECONDS,
        )
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(url, data=data)
            resp.raise_for_status()
        except httpx.TimeoutException as exc:
            raise TelegraphError(
                "Telegra.ph API timeout. The server cannot reach Telegra.ph "
                f"at {self.base_url}; check outbound network access or configure TELEGRAPH_API_BASE_URL."
            ) from exc
        except httpx.ConnectError as exc:
            raise TelegraphError(
                "Telegra.ph API connection failed. The server cannot connect to "
                f"{self.base_url}; check outbound network access or configure TELEGRAPH_API_BASE_URL."
            ) from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code if exc.response is not None else "unknown"
            body = exc.response.text[:300] if exc.response is not None else ""
            raise TelegraphError(f"Telegra.ph API HTTP {status}: {body}") from exc
        payload = resp.json()
        if not payload.get("ok"):
            error = str(payload.get("error") or "Telegraph API error")
            raise TelegraphError(error)
        return payload.get("result") or {}
