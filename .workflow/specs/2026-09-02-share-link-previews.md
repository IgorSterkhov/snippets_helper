# Share Link Preview Metadata Spec

## Requirement

When a public note URL under `https://ister-app.ru/share/...` is pasted into
Telegram, the link must produce a text preview containing the note title and a
short, readable beginning of its public content. The current production
response is reachable by Telegram but exposes only an HTML `<title>`, so
Telegram has no explicit description to render.

## Approved Behavior

- Keep the existing stable share URL and visible public-page rendering.
- Add an HTML description and Telegram-targeted Open Graph text metadata to the
  public share page: `description`, `og:title`, `og:description`, `og:type`,
  and `og:site_name`.
- Use only note `content` as the preview-description source. Shortcut and
  finance-plan descriptions are outside this change; in particular, never put
  shortcut `value` into metadata because it may contain commands or secrets.
- Convert the source to plain text before placing it in metadata:
  - remove fenced code blocks, Markdown tables, reference definitions, images,
    and raw HTML tags;
  - preserve readable heading, paragraph, list, link-label, emphasis, and
    inline-code text;
  - convert `<br>` spellings and line boundaries to spaces;
  - collapse repeated whitespace.
- Limit the result to 200 Unicode characters including a trailing ellipsis.
  When truncation is needed, use the last word boundary that fits; if none
  exists, hard-truncate to 199 characters and append `…`.
- Escape title and description for quoted HTML attributes so user content
  cannot create tags or additional metadata attributes.
- Recompute metadata on every request from the current public payload. Existing
  live-share auto-synchronisation therefore updates the source metadata without
  changing or republishing the share URL.
- Return newly copied public links with the stable cache-version query
  `?preview=1`. The public route ignores this parameter, so the same URL keeps
  serving current content after every save; the version exists only to give
  Telegram a cache key that was not negatively cached before preview metadata
  was introduced.
- Keep legacy `/share/<token>` URLs valid. Users do not need to recreate or
  republish a share; copying it again returns `/share/<token>?preview=1`.

## Non-Goals

- No manually editable summary field, AI-generated summary, shortcut or finance
  description, database migration, preview image, desktop/mobile UI change, or
  Telegra.ph change. This is intentionally text metadata for Telegram, not a
  complete Open Graph media object with `og:image` and `og:url`.
- No guarantee that Telegram immediately replaces a preview already cached on
  its servers. Newly generated previews must use the current page metadata.
- Do not vary `preview=1` on every note save. A changing query would undermine
  the stable-link workflow and is not needed because page content is rendered
  live.

## Verification

- A note with representative Markdown produces a readable, escaped, maximum
  200-character `description` and matching `og:description`.
- A short plain-text note is not padded or given an ellipsis.
- Empty or markup-only content does not emit empty description tags.
- Relative and reference Markdown links retain only readable labels; HTML-like
  attribute-injection input stays escaped, while ordinary comparisons such as
  `2 < 3 > 1` remain readable.
- Existing public Markdown rendering and security tests remain green.
- After deployment, fetching the reported public URL shows the new metadata in
  `<head>` and the API health endpoint remains healthy.
- A newly created, previously uncached note share pasted into Telegram displays
  the expected title and description. The existing reported URL remains useful
  for HTML inspection but may retain Telegram's cached preview temporarily.
- `build_public_url` preserves its existing request-derived scheme/host behavior
  and returns exactly `/share/<token>?preview=1`; requesting that URL returns
  the same live page as the legacy query-free URL.
- Public-origin/forwarded-host hardening is outside this cache-version change
  and should be handled separately if the deployment trust model changes.

## Release

This is an API public-share rendering improvement with a matching development
mock update. Deploy the reviewed commit to the existing production API; do not
create a desktop `f-*` or native `v*` tag because the mock is excluded from OTA
assets and no packaged desktop asset or IPC surface changes.
