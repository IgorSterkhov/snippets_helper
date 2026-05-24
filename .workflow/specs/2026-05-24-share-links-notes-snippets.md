# Share Links For Notes And Snippets Spec

## Requirement

Add public live share links for Notes and Snippets. A user should be able to
create, copy, preview, and revoke a share link from both the desktop app and
the mobile app. Anyone who knows the link can read the shared content without
an API key until the owner revokes the link.

## Product Decisions

- Link mode: live link only.
- Access model: secret token only.
- No password, no expiration, no public listing.
- Revoke is the only access-control operation after creation.
- Desktop and mobile both support link management.
- The public page is read-only.

## Shared Content

For a shared snippet, publish only:

- `name`
- `value`
- `description`
- `links`

Do not publish snippet tags, pinned state/order, `obsidian_note`, local ids,
sync metadata, or user/account metadata.

For a shared note, publish only:

- `title`
- `content`

Do not publish folder, folder breadcrumbs, pinned state/order, local ids, sync
metadata, or user/account metadata.

## Server Data Model

Add a new API table:

- `share_links`
  - `token TEXT PRIMARY KEY`
  - `user_id UUID NOT NULL REFERENCES users(id)`
  - `item_type TEXT NOT NULL` with values `note` or `shortcut`
  - `item_uuid UUID NOT NULL`
  - `is_active BOOLEAN NOT NULL DEFAULT true`
  - `created_at TIMESTAMP NOT NULL`
  - `updated_at TIMESTAMP NOT NULL`
  - `revoked_at TIMESTAMP NULL`

Indexes:

- unique active link lookup for owner/item:
  `(user_id, item_type, item_uuid, is_active)`
- public lookup by `token`

Token generation:

- Generate a long random URL-safe token on the server.
- Do not derive the token from item UUID, user ID, or content.
- On collision, retry with a new token.

`share_links` is not part of the generic content sync schema. It is
access-control metadata and is managed through dedicated authenticated API
endpoints.

## API

Authenticated endpoints under `/v1/share-links`:

- `POST /v1/share-links`
  - Input: `item_type`, `item_uuid`
  - Behavior: create a new active link or return the existing active link for
    the same owner/item.
  - Output: token, public URL, active state, timestamps.

- `GET /v1/share-links?item_type=...&item_uuid=...`
  - Behavior: return the active link for the owner/item, or `null` if none.

- `DELETE /v1/share-links/{token}`
  - Behavior: revoke only if the token belongs to the authenticated user.
  - Sets `is_active=false`, `revoked_at`, and `updated_at`.

Public endpoints:

- `GET /share/{token}`
  - Returns a public HTML page for browser viewing.

- `GET /v1/public/share/{token}`
  - Returns public JSON for tests and possible future native rendering.

Public lookup rules:

- Unknown token: `404`.
- Revoked token: `404`.
- Owner/item mismatch or deleted item: `404`.
- Shared note or snippet deleted through sync: `404`.
- Server reads the current item row on every public request, so content changes
  appear immediately in the public page.

## Public Rendering

The public HTML page should be simple, readable, and safe:

- Dark theme by default.
- Escape user-provided text before injecting into HTML.
- Render note content and snippet description with preserved line breaks.
- Render snippet `value` in a code/preformatted block with a `Copy` button.
- Render snippet `links` as a list of clickable links when they are valid
  URLs; invalid or malformed entries are shown as text or omitted safely.
- Do not execute arbitrary HTML or scripts from shared content.

## Desktop UX

In Notes and Snippets detail views, use this toolbar order:

1. Pin icon `📌`
2. Share icon `🔗`
3. Copy
4. Edit
5. Del

Share behavior:

- The `🔗` button opens a compact share modal.
- If no active link exists, the modal offers `Create link`.
- If an active link exists, the modal shows the public URL and actions:
  `Copy link`, `Open preview`, `Revoke`.
- The `🔗` button has an active visual state when the current item has an
  active share link.
- Network/API errors show a toast and leave the local content unchanged.

Pinned snippet chip adjustment:

- Add the same `📌` icon before each pinned snippet chip label, matching Tasks
  pinned chips.

Desktop implementation should follow existing compact, utilitarian patterns
and use icon tooltips for icon-only actions.

If Notes currently lacks a detail `Copy` action, add one that copies the note
content and place it in the same toolbar order.

## Mobile UX

Mobile Notes and Snippets detail screens should expose the same share actions:

- Create link.
- Copy link.
- Open preview.
- Revoke.

The mobile UI can use the platform clipboard/open-link APIs already available
in the app. If the device is offline or the API key is missing, show a clear
error state and do not create local-only share links.

Mobile does not sync `share_links` through the generic sync flow. When an item
detail screen opens or the share sheet/modal opens, it queries the share-link
status from the API. The server remains the source of truth.

## Data Flow

Create:

1. User taps/clicks `🔗`.
2. Client asks authenticated API for the current item share status.
3. User chooses `Create link`.
4. API creates or returns the active link.
5. Client shows the public URL and marks the share icon active.

Preview:

1. User selects `Open preview`.
2. Client opens `/share/{token}` in the browser/webview.

Revoke:

1. User selects `Revoke`.
2. Client calls authenticated delete endpoint.
3. API marks the link inactive.
4. Client clears the active share state for that item.

Public read:

1. Browser requests `/share/{token}`.
2. API validates token and active state.
3. API loads the current note/snippet row for the token owner.
4. API returns safe read-only HTML.

## Compatibility

- Existing notes and snippets remain private by default.
- Existing clients without this feature continue syncing content normally.
- Adding `share_links` does not alter the generic sync contract for notes,
  snippets, tags, tasks, or folders.
- If a user creates a share link on desktop, mobile should show the active
  share state after querying the API for that item, and vice versa.

## Testing

API tests:

- Create link for note.
- Create link for snippet.
- Repeated create returns the existing active link.
- Public JSON/HTML returns only approved fields.
- Public read reflects live content after item update.
- Revoke makes old token return `404`.
- A user cannot revoke another user's token.
- Deleted shared item returns `404`.
- Unknown token returns `404`.

Desktop tests:

- Snippets detail toolbar order is `Pin`, `Share`, `Copy`, `Edit`, `Del`.
- Notes detail toolbar has the same order, including a note-content `Copy`
  action if it is not present before this change.
- Share modal create/copy/preview/revoke flows work against the dev mock.
- Pinned snippet chips include the `📌` icon.

Mobile tests:

- Share-link API client creates, reads, and revokes links.
- Notes and Snippets detail UI exposes create/copy/open/revoke actions.
- Offline/API error states do not mutate local note/snippet content.

Post-release smoke:

- Production API health.
- Create a temporary user.
- Push a note and a snippet.
- Create share links for both.
- Verify public reads return expected fields.
- Update content and verify the same token returns updated content.
- Revoke and verify `404`.
- Verify mobile OTA manifest when mobile JS changes ship.

## Release Scope

This is a server, desktop, and mobile feature:

- API deploy with Alembic migration.
- Desktop full `v*` release because native commands/API integration and UI
  release history will change.
- Mobile OTA if only JS changes are needed; APK only if native dependencies or
  Android permissions change.
- Update desktop help and release history for the release.
