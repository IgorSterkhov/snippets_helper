import re


TABLE_SEPARATOR_CELL_RE = re.compile(r"^:?-{3,}:?$")


def split_table_row(line: str) -> list[str] | None:
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


def parse_table_separator(line: str, expected_cells: int) -> list[str] | None:
    if expected_cells < 2:
        return None
    cells = split_table_row(line)
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


def table_start_at(lines: list[str], index: int) -> tuple[list[str], list[str]] | None:
    if index + 1 >= len(lines):
        return None
    headers = split_table_row(lines[index])
    if not headers:
        return None
    alignments = parse_table_separator(lines[index + 1], len(headers))
    if alignments is None:
        return None
    return headers, alignments


def normalize_table_cells(cells: list[str], width: int) -> list[str]:
    return (cells + [""] * width)[:width]
