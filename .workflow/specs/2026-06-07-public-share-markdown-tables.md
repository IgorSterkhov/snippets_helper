# Public Share Markdown Tables

## Goal

Public share pages for snippets and notes must render Markdown pipe tables as real HTML tables, matching the behavior users see in the desktop snippet viewer.

## Requirements

1. Existing share links must start rendering tables after the server update; no link regeneration or data migration is required.
2. The server-side renderer in `api/share_utils.py` must support GitHub-style pipe tables:
   - header row followed by a separator row;
   - left, right, and center alignment from `---`, `---:`, and `:---:`;
   - inline Markdown inside cells, including links, reference links, code spans, bold, and images where already supported.
3. Table rendering must remain safe:
   - raw HTML from user content stays escaped;
   - only existing safe URL rules are used for links and images;
   - no raw Markdown table separator text should leak into rendered HTML.
4. Shortcut values that contain only a table must be treated as Markdown, not as a plain `<pre><code>` block.
5. Public share table styles must be readable in the existing dark theme and usable on narrow screens.
6. The public share shortcut `Copy` button must span the width of the shared text/value block instead of rendering as a small inline button.

## Non-Goals

- Do not add a third-party Markdown dependency in this hotfix.
- Do not change the desktop Markdown renderer.
- Do not change share-link API contracts or stored payloads.
- Do not render arbitrary raw HTML from shared content.

## Verification

- Add unit coverage in `tests/api/test_share_utils.py` for table rendering, alignment, table-only shortcut values, inline Markdown in cells, HTML escaping, and full-width Copy styling.
- Extend the post-release share-link contract test with a snippet table assertion when practical.
- Run targeted API tests before committing.
