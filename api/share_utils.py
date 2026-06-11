import html
import json
import re
import secrets
from urllib.parse import urlparse

from api.media_utils import public_html_base_url


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


def _finance_kind_label(kind: str | None) -> str:
    return {
        "monthly": "Monthly",
        "project": "Project",
        "one_time": "One-time",
        "general": "General",
    }.get(kind or "", "General")


def public_finance_plan_payload(plan, rows) -> dict:
    by_uuid = {}
    children: dict[str | None, list[dict]] = {}
    for row in rows:
        uuid = str(row.uuid)
        parent_uuid = str(row.parent_uuid) if row.parent_uuid else None
        item = {
            "uuid": uuid,
            "parent_uuid": parent_uuid,
            "name": row.name or "",
            "amount_cents": int(row.amount_cents or 0),
            "due_day": row.due_day,
            "due_date": row.due_date,
            "note": row.note or "",
            "sort_order": int(row.sort_order or 0),
        }
        by_uuid[uuid] = item

    for item in by_uuid.values():
        parent_uuid = item["parent_uuid"] if item["parent_uuid"] in by_uuid else None
        item["parent_uuid"] = parent_uuid
        children.setdefault(parent_uuid, []).append(item)

    def sort_items(items: list[dict]) -> list[dict]:
        return sorted(items, key=lambda it: (it["sort_order"], it["name"], it["uuid"]))

    def total_for(item: dict, stack: set[str] | None = None) -> int:
        stack = stack or set()
        uuid = item["uuid"]
        if uuid in stack:
            return int(item["amount_cents"] or 0)
        next_stack = set(stack)
        next_stack.add(uuid)
        total = int(item["amount_cents"] or 0)
        for child in children.get(uuid, []):
            total += total_for(child, next_stack)
        return total

    rendered_rows = []

    def visit(item: dict, depth: int, stack: set[str] | None = None) -> None:
        stack = stack or set()
        uuid = item["uuid"]
        if uuid in stack:
            return
        next_stack = set(stack)
        next_stack.add(uuid)
        rendered_rows.append({
            **item,
            "depth": depth,
            "total_cents": total_for(item),
        })
        for child in sort_items(children.get(uuid, [])):
            visit(child, depth + 1, next_stack)

    roots = sort_items(children.get(None, []))
    for root in roots:
        visit(root, 0)

    return {
        "type": "finance_plan",
        "title": plan.name or "Finance list",
        "currency": plan.currency or "RUB",
        "kind": plan.kind or "general",
        "kind_label": _finance_kind_label(plan.kind),
        "total_cents": sum(total_for(root) for root in roots),
        "items": rendered_rows,
    }


IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)\s]+)\)")
CODE_SPAN_RE = re.compile(r"`([^`\n]+)`")
REFERENCE_LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\[([^\]]+)\]")
REFERENCE_DEF_RE = re.compile(r"^[ \t]*\[([^\]]+)\]:[ \t]*(\S+)(?:[ \t]+[\"'(].*)?[ \t]*$")
FENCE_RE = re.compile(r"^[ \t]*```([A-Za-z0-9_+.#-]*)[ \t]*$")
HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.+?)\s*$")
UNORDERED_LIST_RE = re.compile(r"^[ \t]*[-*][ \t]+(.+?)\s*$")
ORDERED_LIST_RE = re.compile(r"^[ \t]*(\d{1,9})[.)][ \t]+(.+?)\s*$")
SAFE_LANGUAGE_RE = re.compile(r"[^A-Za-z0-9_+.#-]")
SAFE_HTML_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,}$")
TABLE_SEPARATOR_CELL_RE = re.compile(r"^:?-{3,}:?$")
MARKDOWN_MARKER_RE = re.compile(
    r"!\[[^\]]*\]\([^)]+\)"
    r"|\[[^\]]+\]\([^)]+\)"
    r"|\[[^\]]+\]\[[^\]]+\]"
    r"|^[ \t]*\[([^\]]+)\]:[ \t]*\S+"
    r"|^[ \t]{0,3}#{1,6}[ \t]+"
    r"|^[ \t]*```"
    r"|^[ \t]*(?:[-*]|\d{1,9}[.)])[ \t]+"
    r"|\*\*[^*\n]+\*\*"
    r"|`[^`\n]+`",
    re.MULTILINE,
)


def _is_safe_image_url(url: str) -> bool:
    if url.startswith("/snippets-media/"):
        return True
    parsed = urlparse(url)
    return parsed.scheme.lower() in {"http", "https"}


def _is_safe_html_url(url: str) -> bool:
    if url.startswith("/snippets-api/v1/media/html/") or url.startswith("/v1/media/html/"):
        token = url.rsplit("/", 1)[-1]
        return bool(SAFE_HTML_TOKEN_RE.match(token))
    parsed = urlparse(url)
    if parsed.scheme.lower() not in {"http", "https"}:
        return False
    base = urlparse(public_html_base_url())
    if (
        parsed.scheme.lower() != base.scheme.lower()
        or parsed.hostname != base.hostname
        or parsed.port != base.port
    ):
        return False
    base_path = base.path.rstrip("/")
    if not parsed.path.startswith(base_path + "/"):
        return False
    token = parsed.path[len(base_path) + 1:]
    return bool(SAFE_HTML_TOKEN_RE.match(token))


def _figure_card(alt: str, url: str) -> str:
    safe_alt = html.escape(alt or "image")
    safe_url = html.escape(url, quote=True)
    return (
        "<figure class='figure-card'>"
        f"<img src='{safe_url}' alt='{safe_alt}' loading='lazy'>"
        f"<figcaption>{safe_alt}</figcaption>"
        "</figure>"
    )


def _html_card(alt: str, url: str) -> str:
    raw_title = (alt or "").strip()
    title = raw_title[5:].strip() if raw_title.lower().startswith("html:") else raw_title
    safe_title = html.escape(title or "HTML")
    safe_url = html.escape(url, quote=True)
    return (
        "<figure class='html-card'>"
        "<figcaption>"
        f"<span>{safe_title}</span>"
        "<a rel='noopener noreferrer' target='_blank' "
        f"href='{safe_url}'>Open</a>"
        "</figcaption>"
        "<iframe sandbox='allow-scripts' loading='lazy' "
        f"referrerpolicy='no-referrer' src='{safe_url}'></iframe>"
        "</figure>"
    )


def _safe_link_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme.lower() in {"http", "https"}


def _render_inline_markdown(text: str, references: dict[str, str] | None = None) -> str:
    tokens: list[str] = []
    refs = references or {}

    def stash(value: str) -> str:
        token = f"SHAREINLINETOKEN{len(tokens)}END"
        tokens.append(value)
        return token

    def image_repl(match: re.Match) -> str:
        alt, url = match.group(1), match.group(2)
        if alt.strip().lower().startswith("html:"):
            if _is_safe_html_url(url):
                return stash(_html_card(alt, url))
            return stash(html.escape(match.group(0)))
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

    def reference_link_repl(match: re.Match) -> str:
        label, key = match.group(1), match.group(2)
        url = refs.get(key.strip().lower())
        if not url or not _safe_link_url(url):
            return stash(html.escape(match.group(0)))
        return stash(
            "<a rel='noopener noreferrer' target='_blank' "
            f"href='{html.escape(url, quote=True)}'>{html.escape(label)}</a>"
        )

    def code_repl(match: re.Match) -> str:
        return stash(f"<code>{html.escape(match.group(1))}</code>")

    marked = CODE_SPAN_RE.sub(code_repl, text or "")
    marked = IMAGE_RE.sub(image_repl, marked)
    marked = REFERENCE_LINK_RE.sub(reference_link_repl, marked)
    marked = LINK_RE.sub(link_repl, marked)
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


def _split_table_row(line: str) -> list[str] | None:
    stripped = (line or "").strip()
    if "|" not in stripped:
        return None
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|") and not stripped.endswith("\\|"):
        stripped = stripped[:-1]

    cells: list[str] = []
    current: list[str] = []
    escaped = False
    in_code_span = False
    for char in stripped:
        if escaped:
            current.append(char if char == "|" else f"\\{char}")
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == "`":
            in_code_span = not in_code_span
            current.append(char)
            continue
        if char == "|" and not in_code_span:
            cells.append("".join(current).strip())
            current = []
            continue
        current.append(char)
    if escaped:
        current.append("\\")
    cells.append("".join(current).strip())

    return cells if len(cells) >= 2 else None


def _parse_table_separator(line: str, expected_cells: int) -> list[str] | None:
    if expected_cells < 2:
        return None
    cells = _split_table_row(line)
    if not cells or len(cells) != expected_cells:
        return None

    alignments: list[str] = []
    for cell in cells:
        marker = cell.replace(" ", "")
        if not TABLE_SEPARATOR_CELL_RE.match(marker):
            return None
        if marker.startswith(":") and marker.endswith(":"):
            alignments.append("center")
        elif marker.endswith(":"):
            alignments.append("right")
        elif marker.startswith(":"):
            alignments.append("left")
        else:
            alignments.append("")
    return alignments


def _table_start_at(lines: list[str], index: int) -> tuple[list[str], list[str]] | None:
    if index + 1 >= len(lines):
        return None
    headers = _split_table_row(lines[index])
    if not headers:
        return None
    alignments = _parse_table_separator(lines[index + 1], len(headers))
    if alignments is None:
        return None
    return headers, alignments


def _has_pipe_table(text: str) -> bool:
    lines = (text or "").splitlines()
    in_code = False
    index = 0
    while index < len(lines):
        if FENCE_RE.match(lines[index]):
            in_code = not in_code
            index += 1
            continue
        if not in_code and _table_start_at(lines, index):
            return True
        index += 1
    return False


def _alignment_attr(alignment: str) -> str:
    return f' style="text-align:{alignment}"' if alignment else ""


def _normalize_table_cells(cells: list[str], width: int) -> list[str]:
    return (cells + [""] * width)[:width]


def _render_table(
    headers: list[str],
    rows: list[list[str]],
    alignments: list[str],
    references: dict[str, str],
) -> str:
    width = len(headers)
    normalized_headers = _normalize_table_cells(headers, width)
    head = "".join(
        f"<th{_alignment_attr(alignments[index])}>"
        f"{_render_inline_markdown(normalized_headers[index], references)}</th>"
        for index in range(width)
    )
    body_rows = []
    for row in rows:
        normalized_row = _normalize_table_cells(row, width)
        body_cells = "".join(
            f"<td{_alignment_attr(alignments[index])}>"
            f"{_render_inline_markdown(normalized_row[index], references)}</td>"
            for index in range(width)
        )
        body_rows.append(f"<tr>{body_cells}</tr>")
    body = "".join(body_rows)
    return (
        "<div class='share-table-scroll'>"
        f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"
        "</div>"
    )


def _extract_reference_definitions(text: str) -> tuple[str, dict[str, str]]:
    refs: dict[str, str] = {}
    output: list[str] = []
    in_code = False
    for line in (text or "").splitlines():
        if FENCE_RE.match(line):
            in_code = not in_code
            output.append(line)
            continue
        if not in_code:
            match = REFERENCE_DEF_RE.match(line)
            if match:
                refs[match.group(1).strip().lower()] = match.group(2).strip()
                continue
        output.append(line)
    return "\n".join(output), refs


def _is_markdown_like(text: str) -> bool:
    return bool(MARKDOWN_MARKER_RE.search(text or "")) or _has_pipe_table(text or "")


def _format_money_cents(amount_cents: int, currency: str) -> str:
    amount = (int(amount_cents or 0)) / 100
    text = f"{amount:,.2f}".replace(",", " ")
    if text.endswith(".00"):
        text = text[:-3]
    return f"{text} {currency or ''}".strip()


def _finance_date_text(item: dict, kind: str) -> str:
    if kind == "monthly":
        day = item.get("due_day")
        return f"{day}-е" if day else ""
    return str(item.get("due_date") or "")


def _render_finance_share(payload: dict) -> str:
    currency = str(payload.get("currency") or "RUB")
    kind = str(payload.get("kind") or "general")
    meta = " · ".join(
        part for part in [payload.get("kind_label") or "General", currency] if part
    )
    rows_html = []
    for item in payload.get("items") or []:
        depth = max(0, int(item.get("depth") or 0))
        name = html.escape(item.get("name") or "Untitled item")
        note = html.escape(item.get("note") or "")
        date_text = html.escape(_finance_date_text(item, kind))
        amount = html.escape(_format_money_cents(item.get("amount_cents") or 0, currency))
        total = html.escape(_format_money_cents(item.get("total_cents") or 0, currency))
        rows_html.append(
            "<tr>"
            f"<td><span class='finance-indent' style='--depth:{depth}'></span>{name}</td>"
            f"<td class='money'>{amount}</td>"
            f"<td>{date_text}</td>"
            f"<td class='money strong'>{total}</td>"
            f"<td>{note}</td>"
            "</tr>"
        )
    if rows_html:
        table = (
            "<div class='share-table-scroll'>"
            "<table class='finance-share-table'>"
            "<thead><tr><th>Name</th><th>Amount</th><th>Date</th><th>Total</th><th>Note</th></tr></thead>"
            f"<tbody>{''.join(rows_html)}</tbody>"
            "</table>"
            "</div>"
        )
    else:
        table = "<div class='share-empty'>No expense rows.</div>"
    total = html.escape(_format_money_cents(payload.get("total_cents") or 0, currency))
    return (
        f"<div class='share-meta'>{html.escape(meta)}</div>"
        "<section class='finance-share-summary'>"
        "<div class='finance-share-total-label'>Total</div>"
        f"<div class='finance-share-total'>{total}</div>"
        "</section>"
        f"{table}"
    )


def _render_markdown(text: str) -> str:
    text, references = _extract_reference_definitions(text or "")
    output: list[str] = []
    paragraph: list[str] = []
    list_items: list[str] = []
    list_kind = ""
    list_start = 1
    code_lines: list[str] = []
    code_language = ""
    in_code = False

    def flush_paragraph() -> None:
        if not paragraph:
            return
        output.append(
            "<p>"
            + "<br>".join(_render_inline_markdown(line, references) for line in paragraph)
            + "</p>"
        )
        paragraph.clear()

    def flush_list() -> None:
        nonlocal list_kind, list_start
        if not list_items:
            return
        items = "".join(f"<li>{_render_inline_markdown(item, references)}</li>" for item in list_items)
        if list_kind == "ol":
            start_attr = f' start="{list_start}"' if list_start != 1 else ""
            output.append(f"<ol{start_attr}>{items}</ol>")
        else:
            output.append(f"<ul>{items}</ul>")
        list_items.clear()
        list_kind = ""
        list_start = 1

    def flush_blocks() -> None:
        flush_paragraph()
        flush_list()

    lines = (text or "").splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
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
            index += 1
            continue

        if in_code:
            code_lines.append(line)
            index += 1
            continue

        if not line.strip():
            flush_blocks()
            index += 1
            continue

        table = _table_start_at(lines, index)
        if table:
            headers, alignments = table
            rows: list[list[str]] = []
            flush_blocks()
            index += 2
            while index < len(lines):
                if not lines[index].strip():
                    break
                row = _split_table_row(lines[index])
                if not row:
                    break
                rows.append(row)
                index += 1
            output.append(_render_table(headers, rows, alignments, references))
            continue

        heading = HEADING_RE.match(line)
        if heading:
            flush_blocks()
            level = min(len(heading.group(1)), 6)
            output.append(f"<h{level}>{_render_inline_markdown(heading.group(2), references)}</h{level}>")
            index += 1
            continue

        unordered = UNORDERED_LIST_RE.match(line)
        if unordered:
            flush_paragraph()
            if list_kind and list_kind != "ul":
                flush_list()
            list_kind = "ul"
            list_items.append(unordered.group(1))
            index += 1
            continue

        ordered = ORDERED_LIST_RE.match(line)
        if ordered:
            number = int(ordered.group(1))
            flush_paragraph()
            if list_kind and list_kind != "ol":
                flush_list()
            if not list_items:
                list_kind = "ol"
                list_start = number
            list_items.append(ordered.group(2))
            index += 1
            continue

        flush_list()
        paragraph.append(line)
        index += 1

    if in_code:
        output.append(_render_code_block(code_lines, code_language))
    flush_blocks()
    return "\n".join(output)


def render_share_html(payload: dict) -> str:
    title = payload.get("title") or payload.get("name") or "Shared item"
    safe_title = html.escape(title)

    if payload.get("type") == "finance_plan":
        body = _render_finance_share(payload)
    elif payload.get("type") == "shortcut":
        value = payload.get("value", "")
        description = payload.get("description", "")
        description_html = (
            f'<section class="desc share-markdown">{_render_markdown(description)}</section>'
            if description
            else ""
        )
        if _is_markdown_like(value):
            value_html = (
                "<article id='share-code' class='share-markdown share-value'>"
                f"{_render_markdown(value)}"
                "</article>"
            )
        else:
            value_html = f"<pre><code id='share-code'>{html.escape(value)}</code></pre>"
        body = (
            f"{description_html}"
            f"{value_html}"
            "<button class='share-copy-button' type='button' onclick='navigator.clipboard.writeText("
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
    .share-copy-button {{ display: block; width: 100%; margin: 16px 0 0; padding: 10px 12px; }}
    a {{ color: #58a6ff; }}
    .desc {{ color: #8b949e; }}
    .share-markdown h1, .share-markdown h2, .share-markdown h3 {{ color: #f0f6fc; margin: 20px 0 10px; }}
    .share-markdown p, .share-markdown ul, .share-markdown ol {{ margin: 0 0 12px; }}
    .share-markdown li {{ margin: 4px 0; }}
    .share-table-scroll {{ overflow-x: auto; margin: 12px 0 16px; }}
    .share-markdown table {{ width: 100%; min-width: 520px; border-collapse: collapse; background: #0d1117; }}
    .share-markdown th, .share-markdown td {{ border: 1px solid #30363d; padding: 7px 10px; vertical-align: top; }}
    .share-markdown th {{ background: #161b22; color: #f0f6fc; font-weight: 700; }}
    .share-markdown td {{ color: #c9d1d9; }}
    .share-meta {{ color: #8b949e; margin: -10px 0 18px; font-size: 13px; }}
    .share-empty {{ border: 1px dashed #30363d; border-radius: 8px; padding: 22px; color: #8b949e; text-align: center; }}
    .finance-share-summary {{ border: 1px solid #30363d; border-radius: 8px; padding: 12px 14px; margin: 0 0 14px; background: #161b22; }}
    .finance-share-total-label {{ color: #8b949e; font-size: 12px; margin-bottom: 4px; }}
    .finance-share-total {{ color: #f0f6fc; font-size: 24px; font-weight: 750; }}
    .finance-share-table {{ width: 100%; min-width: 760px; border-collapse: collapse; background: #0d1117; }}
    .finance-share-table th, .finance-share-table td {{ border: 1px solid #30363d; padding: 8px 10px; vertical-align: top; }}
    .finance-share-table th {{ background: #161b22; color: #f0f6fc; font-weight: 700; text-align: left; }}
    .finance-share-table .money {{ text-align: right; white-space: nowrap; }}
    .finance-share-table .strong {{ color: #f0f6fc; font-weight: 700; }}
    .finance-indent {{ display: inline-block; width: calc(var(--depth) * 18px); }}
    .figure-card {{ margin: 14px 0; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; background: #161b22; }}
    .figure-card img {{ display: block; max-width: 100%; height: auto; margin: 0 auto; }}
    .figure-card figcaption {{ border-top: 1px solid #30363d; padding: 8px 10px; color: #8b949e; font-size: 13px; }}
    .html-card {{ margin: 14px 0; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; background: #161b22; }}
    .html-card figcaption {{ display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid #30363d; padding: 8px 10px; color: #c9d1d9; font-size: 13px; }}
    .html-card figcaption span {{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
    .html-card figcaption a {{ flex-shrink: 0; font-size: 12px; }}
    .html-card iframe {{ display: block; width: 100%; min-height: 520px; border: 0; background: white; }}
  </style>
</head>
<body><main><h1>{safe_title}</h1>{body}</main></body>
</html>"""
