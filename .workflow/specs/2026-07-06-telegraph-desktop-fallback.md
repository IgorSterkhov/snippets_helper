# Telegra.ph Desktop Fallback Spec

## Goal

Make "Publish to Telegra.ph" work when the production API server cannot reach
`api.telegra.ph`, by letting the desktop native app perform the Telegra.ph API
calls and letting the server keep ownership, content conversion, and page
metadata storage.

## Chosen Direction

Use a desktop-native fallback flow:

1. Desktop asks the sync API to prepare a Telegra.ph publish payload.
2. The API validates item ownership, converts the current note/snippet content
   to Telegra.ph Node JSON, computes a content hash, and returns the per-user
   Telegra.ph account token if one already exists.
3. If no account token exists, desktop creates the Telegra.ph account directly.
4. Desktop creates or edits the Telegra.ph page directly from the user's
   machine.
5. Desktop posts the published page metadata back to the API, and the API stores
   the account token and `telegraph_pages` row for future updates.

The existing server-side `POST /v1/share-links/telegraph/publish` route remains
available, but the desktop Tauri command uses the fallback-first flow to avoid
waiting for a known production egress timeout.

## API Contract

Add authenticated routes:

- `POST /v1/share-links/telegraph/prepare`
  - request: `item_type`, `item_uuid`
  - response: item identity, title, author info, short name, optional
    `access_token`, optional existing page, content hash, and Telegra.ph Node
    content.
- `POST /v1/share-links/telegraph/complete`
  - request: item identity, published page metadata, content hash, optional
    `access_token`, and account metadata
  - response: the stored `TelegraphPageResponse`

Both routes require the authenticated user to own the requested item. The
complete route stores the `content_hash` that was actually published. It does
not reject a hash that differs from the latest source content, because the
external Telegra.ph page may already have been created or edited before
complete runs. A later explicit Update publishes the newer snapshot.

## Security

The Telegra.ph access token is still server-owned storage, but this fallback
intentionally exposes it to the authenticated desktop client for publication.
This is acceptable for this fallback because the same client already holds the
sync API key and owns the item content. Normal status responses continue to
avoid exposing the token.

If the server already has a Telegra.ph token and desktop returns a different
token, the complete route rejects it instead of silently moving the user to a
different Telegra.ph account.

If the server has no Telegra.ph token yet, `complete` requires a non-empty
`access_token` and stores it only after ownership and published URL/path
validation. If the server already has a token, desktop may omit the token, or
it may send the same token.

The complete route accepts only canonical Telegra.ph page metadata:

- `url` must be `https://telegra.ph/<path>`;
- `path` must be a single path segment with no slash/control characters;
- if a page mapping already exists, the completed `path` must match the
  existing page path.

## Desktop Behavior

The existing `publish_telegraph_page` Tauri command keeps the same JavaScript
interface. Internally it:

- calls `prepare`;
- creates an account when needed;
- calls `createPage` for first publish or `editPage/<path>` for updates;
- calls `complete`;
- returns the stored page response to the Share modal.

The Share modal error dialog remains the standard large copyable error modal.

## Release

This changes native Rust code and server API routes, so it requires an API
deploy and a full desktop `v*` release. Because the change adds server API
surface, the desktop version bump is minor.
