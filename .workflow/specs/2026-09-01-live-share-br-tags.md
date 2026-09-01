# Live Share `<br>` Tags Spec

## Requirement

Public live-share pages must render intentional Markdown inline line breaks
written as `<br>`, `<br/>`, or `<br />`. The production page
`/share/8oHNXu0IQjGGtGNmU-OlqaBeUpWyouy4ijPxUkiGOZc` currently shows these tags
as the literal text `&lt;br&gt;`, especially inside comparison-table cells.

## Approved Behavior

- Recognize `<br>`, `<br/>`, and `<br />` case-insensitively using the exact
  grammar `(?i)<br[ \t]*(?:/[ \t]*)?>`: spaces/tabs are allowed before the
  optional slash and closing `>`, but newlines and attributes are not.
- Normalize every recognized form to the emitted HTML element `<br>`.
- Apply the behavior in the safe inline Markdown renderer used by public-share
  table cells, paragraphs, and list items.
- Preserve `<br>` as literal escaped text inside inline-code spans and fenced
  code blocks.
- Continue escaping every other raw HTML tag, including `<script>` and any
  attributed form such as `<br class="gap">` or `<br onerror="...">`.
- Preserve the existing safe handling of Markdown links, images, HTML cards,
  emphasis, tables, and public-share cache headers.

## Implementation Boundary

Add one allowlisted line-break tokenization step to
`api.share_utils._render_inline_markdown` after protected code/link/image spans
have been stashed and before the remaining user text is HTML-escaped. Do not
enable generic raw HTML or add a sanitizer dependency.

## Verification

- A real public note table renders each approved spelling in ordinary table
  cell content as `<br>` rather than escaped break-tag text.
- Paragraph and list inline content use the same behavior.
- Inline and fenced code keep the tag visible as escaped text.
- Attributed `<br>` and unrelated raw HTML remain escaped.
- The complete `tests/api/test_share_utils.py` and practical API suite pass.
- After deployment, the reported stable share URL is fetched again and the
  affected ordinary table-cell fragments are checked for real `<br>` elements
  instead of literal `&lt;br&gt;`; escaped break tags remain valid inside
  `<code>`/`<pre>` contexts.

## Release

This is an API-only live-share rendering hotfix. Deploy the reviewed commit to
the existing production API and verify `/v1/health`; do not create a desktop
`f-*` or native `v*` tag because no desktop asset or IPC surface changes.
