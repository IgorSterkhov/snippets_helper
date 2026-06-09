# Telegra.ph Share Spec

## Requirement

Allow Notes and Snippets to be published to Telegra.ph as Telegram-friendly
public pages, alongside the existing live share-link workflow.

## Chosen Direction

Implement **A. Automatic per-user Telegra.ph publishing**:

- the first publish creates a Telegra.ph account for the current API user and
  stores the returned access token server-side;
- each note/snippet can have one Telegra.ph page mapping;
- publishing for the first time calls `createPage`;
- publishing again calls `editPage` and updates the existing Telegra.ph URL;
- the desktop Share modal shows Telegra.ph status, URL, Copy/Open, and
  Publish/Update controls.

API contract:

- `GET /v1/share-links/telegraph?item_type=note|shortcut&item_uuid=<uuid>`;
- `POST /v1/share-links/telegraph/publish` with `item_type` and `item_uuid`;
- every route requires the authenticated user to own the requested item.

## Product Semantics

Telegra.ph publishing is a **snapshot/export channel**, not a live share link.
The existing `/share/<token>` URL remains the live-by-token page. If source
content changes, the user updates the Telegra.ph page explicitly.

## Content Conversion

Server converts the existing note/snippet payload to Telegra.ph Node format:

- headings, paragraphs, links, ordered/unordered lists, code fences, and images
  are preserved where Telegra.ph supports them;
- Markdown tables degrade to preformatted text, because Telegra.ph does not
  support table tags;
- Sandbox HTML Cards degrade to a safe paragraph/figure-style link that opens
  the interactive HTML asset on `ister-app.ru`; raw uploaded HTML is not copied
  into Telegra.ph;
- content is capped below the Telegra.ph 64 KB API limit with a truncation note.

## Storage

Add server-only data:

- user-level Telegra.ph account token/settings;
- `telegraph_pages` mapping table keyed by user, item type, and item UUID.

The Telegra.ph access token is server-only: it is never returned to desktop,
never included in API errors/log payloads, and API responses expose only page
status fields such as URL, path, views, timestamps, and content hash. The page
mapping stores `user_id`, `item_type`, `item_uuid`, `path`, `url`, `title`,
`content_hash`, `created_at`, `updated_at`, `published_at`, and has a unique
constraint on `(user_id, item_type, item_uuid)`.

Generated Telegra.ph account defaults:

- `short_name = ister_<api_key_prefix>`, capped to 32 characters;
- `author_name = Ister App`;
- `author_url` empty by default.

These server-only tables are not part of the app sync protocol.

## Sanitization

The converter must emit only Telegra.ph-allowed Node tags and attrs. It must
drop raw HTML, reject dangerous URL schemes such as `javascript:`, and allow
`href` only for `http:`, `https:`, and `mailto:`. Media `src` is allowed only
for trusted `https:` URLs produced by the app media/share pipeline. The final
Node JSON payload is size-checked as UTF-8 before calling Telegra.ph; truncation
is char-safe and appends an explicit truncation paragraph if needed.

## Out Of Scope

- editing Telegra.ph account settings from desktop Settings;
- deleting Telegra.ph pages, because Telegra.ph does not provide real delete;
- publishing arbitrary interactive HTML directly into Telegra.ph;
- mobile UI for this first pass.
