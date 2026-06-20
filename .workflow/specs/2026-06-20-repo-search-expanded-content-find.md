# Repo Search Expanded Content Find

## Goal

Improve Repo Search content-result expanded view so it keeps line-match
highlighting and supports local find/navigation inside the opened file.

## Confirmed Direction

Use option A:

- Expanded file view keeps the same visual match treatment as collapsed/context
  views: highlighted match lines and a left marker on matching lines.
- Expanded header includes a local "Search in file" input prefilled from the
  global content-search query that produced the result.
- Local search updates only the expanded file view; it does not rerun the
  global repository search.
- Up/down controls navigate between local matches, show a `current / total`
  counter, mark the active line, and scroll it into view.
- Expanded header includes `Open in editor` and `Copy path` actions.
- Local matching is plain substring, case-insensitive, non-regex.

## Non-Goals

- No backend/API/Tauri command changes.
- No regex/case-sensitive UI in this pass.
- No changes to Git expand view.

## Acceptance

- Opening a content result in expanded mode preserves visible match markers.
- Changing the local query changes expanded line highlights.
- Navigation buttons move between matched lines.
- `Open in editor` opens the current match line when possible, otherwise line 1.
- `Copy path` copies the expanded file path.
