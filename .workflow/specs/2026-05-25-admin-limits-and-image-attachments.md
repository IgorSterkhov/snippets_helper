# Admin Limits And Image Attachments Spec

## Requirement

Add image support for Notes and Snippets so images can sit naturally inside
Markdown text and remain visible in preview and public share pages. Before
image upload is enabled, add an admin-controlled user and storage limit layer so
the server can enforce per-user quotas safely.

This work is split into two phases:

1. **Admin Users & Storage Limits**: user administration, storage quotas, and
   admin-only desktop Settings UI.
2. **Images In Notes/Snippets**: upload, optimization, Figure Card rendering,
   sync-safe Markdown insertion, and share-link rendering.

## Current Infrastructure Facts

Production server state checked on 2026-05-25:

- root filesystem: `50G`, used `8.3G`, available `39G`;
- `/opt/isterapp/uploads`: `80K`;
- `/opt/isterapp/releases`: `129M`;
- `/var/lib/docker`: `4.0G`;
- Postgres docker volume `backend_postgres_data`: about `75M`.

The current disk headroom is enough for local file storage, but quotas are
required before allowing user uploads.

## Phase 1: Admin Users & Storage Limits

### User Model

Extend API `users` with:

- `is_admin BOOLEAN NOT NULL DEFAULT false`
- `last_seen_at TIMESTAMP NULL`
- `media_quota_bytes BIGINT NOT NULL DEFAULT 1073741824`
- `media_max_upload_bytes BIGINT NOT NULL DEFAULT 20971520`

Default limits are the "moderate" profile:

- total media quota per user: `1 GB`;
- max single upload: `20 MB`;
- originals count toward quota;
- optimized variants count toward quota.

### Last Seen

`last_seen_at` should update from authenticated API activity, but not on every
request. Use throttling so a user is written at most once every 5-10 minutes.
This avoids write amplification during frequent sync calls.

### Admin Assignment

Do not add a public or authenticated bootstrap endpoint for becoming admin.
There must be no "Become admin" button in Settings.

Admin assignment is a server-side operation only:

```bash
python -m api.admin_tools make-admin --api-key-prefix f33d8ddd
```

The command must:

- find users whose `api_key` starts with the given prefix;
- fail if no users match;
- fail if more than one user matches;
- set `is_admin=true` for the matched user;
- print `user_id`, `name`, `api_key_prefix`, and `is_admin`.

For the current production setup, the intended admin prefix is `f33d8ddd`.

### Admin API

Add admin-related endpoints under `/v1/admin`:

- `GET /v1/admin/me`
  - returns current user admin status and their storage limits;
  - regular authenticated users may call this endpoint.

- `GET /v1/admin/users`
  - admin only;
  - returns user list with `user_id`, `name`, `created_at`, `last_seen_at`,
    `is_admin`, `media_quota_bytes`, `media_max_upload_bytes`,
    `media_used_bytes`;
  - sort by `last_seen_at DESC NULLS LAST`, then `created_at DESC`.

- `PATCH /v1/admin/users/{user_id}/limits`
  - admin only;
  - accepts `media_quota_bytes` and `media_max_upload_bytes`;
  - values must be positive;
  - `media_max_upload_bytes` must not exceed `media_quota_bytes`;
  - returns the updated user summary.

### Desktop Settings UI

Add a Settings tab/section for admin users only:

- title: `Users / Limits`;
- visible only when `GET /v1/admin/me` reports `is_admin=true`;
- hidden for regular users;
- no "become admin" flow.

The admin view should show:

- user name;
- API key prefix or user id short label;
- created date;
- last seen date;
- admin badge;
- media usage vs quota;
- max upload;
- controls to change quota and max upload.

Admin state is displayed as a badge only. It is not editable through API or UI
in this release; admin assignment remains command-only on the server.

This is a desktop-only admin UI for the first release. Mobile Settings do not
need user administration in this phase.

## Phase 2: Images In Notes/Snippets

### Supported Text Fields

Images are supported in:

- `notes.content`
- `shortcuts.description`
- `shortcuts.value`

`shortcuts.value` may continue to behave as raw text/code when it has no
Markdown markers, but Markdown image syntax should render when present.

### Visual Pattern

Use **Figure Card** rendering:

- image in a framed block;
- caption from Markdown alt text or file name;
- compact metadata/actions when metadata or actions are available;
- no nested decorative cards;
- dark theme aligned with the existing compact desktop UI.

Markdown storage remains simple:

```markdown
![caption](https://ister-app.ru/snippets-media/<variant_public_token>.webp)
```

Preview renderers transform image Markdown into Figure Cards. Plain Markdown
source remains portable and sync-friendly.

Each generated variant has its own unguessable public token. Markdown stores
only the selected variant URL, so a `balanced` insert does not reveal or imply
the URL for `readable` or `original`.

### Storage Model

Store image binaries as files on the server, not in Postgres and not base64 in
note/snippet content.

Proposed server path:

- storage root: `/opt/isterapp/uploads/snippets-media`
- public URL prefix: `https://ister-app.ru/snippets-media/`
- public file path: `/opt/isterapp/uploads/snippets-media/<variant_public_token>.webp`

The API container must mount the host storage root persistently. Media files
must survive container rebuilds and API redeploys.

Add API table `media_assets`:

- `uuid UUID PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id)`
- `original_file_name TEXT NOT NULL`
- `selected_variant TEXT NOT NULL`
- `created_at TIMESTAMP NOT NULL`
- `updated_at TIMESTAMP NOT NULL`
- `is_deleted BOOLEAN NOT NULL DEFAULT false`

Store all file-specific metadata in `media_asset_variants` from the start:

- `media_asset_variants`
  - `id BIGSERIAL PRIMARY KEY`
  - `asset_uuid UUID NOT NULL REFERENCES media_assets(uuid)`
  - `variant TEXT NOT NULL` with `small`, `balanced`, `readable`, `original`
  - `public_token TEXT UNIQUE NOT NULL`
  - `storage_path TEXT NOT NULL`
  - `mime_type TEXT NOT NULL`
  - `size_bytes BIGINT NOT NULL`
  - `width INTEGER NOT NULL`
  - `height INTEGER NOT NULL`
  - `sha256 TEXT NOT NULL`
  - `created_at TIMESTAMP NOT NULL`

Quota usage is the sum of non-deleted stored variant bytes for that user.
Quota enforcement must be concurrency-safe: committing media files and updating
database rows must happen under a transaction with a per-user lock or equivalent
quota reservation, so two simultaneous uploads cannot both pass the same
remaining-quota check.

### Optimization Model

Use server-side canonical optimization:

1. Client selects a file.
2. Client shows a local temporary preview immediately if available.
3. Client uploads the original file to API.
4. Server validates file type, size, dimensions, and decodes the image.
5. Server returns a `job_id` immediately after upload acceptance if processing
   is not already complete.
6. Server strips metadata.
7. Server generates variants:
   - `small`
   - `balanced` (default)
   - `readable`
   - `original` when allowed/requested
8. Client polls `GET /v1/media/jobs/{job_id}` for processing progress.
9. Server returns variant metadata and preview URLs.
10. User chooses the variant and inserts the Figure Card Markdown.

Client-side optimization is optional future acceleration only. The server must
always validate and normalize the final stored asset.

### Upload Modal

Use modal design **C: Presets + Advanced**:

- default selected variant: `Balanced`;
- presets: `Small`, `Balanced`, `Readable`, `Original`;
- advanced quality control available;
- show quota cost before insert;
- full-size preview opens on image click;
- full-size preview shows the currently selected optimized result at 100%;
- user can choose `Readable`, reduce compression/optimization, or save
  `Original` if optimized output is not readable.
- desktop can start the same upload flow from an image file or from a
  clipboard screenshot without writing the screenshot to user-visible disk.

### Progress States

The modal must show progress for long operations:

1. **Upload progress**
   - percent;
   - bytes uploaded / total bytes;
   - speed when available;
   - cancel action.

2. **Server processing progress**
   - show only if processing takes longer than 1 second;
   - use step progress when available, such as `2 / 4`;
   - otherwise show indeterminate progress.

3. **Preview download progress**
   - show while generated previews are being downloaded;
   - show loaded count, such as `3 / 4`.

### Media API

Authenticated media endpoints:

- `POST /v1/media/uploads`
  - multipart upload;
  - enforces `media_max_upload_bytes`;
  - enforces remaining quota;
  - creates a pending media job or asset;
  - returns `job_id` or ready variants.

- `GET /v1/media/jobs/{job_id}`
  - returns processing status, progress, variant metadata, and errors.

- `POST /v1/media/assets/{asset_uuid}/select`
  - selects the variant to use;
  - returns Markdown URL and Figure Card metadata.

- `DELETE /v1/media/assets/{asset_uuid}`
  - soft-deletes asset and removes or tombstones files;
  - only owner or admin.

Public media endpoint:

- `GET /snippets-media/{variant_public_token}.webp`
  - served by nginx or API-backed static route;
  - token is unguessable and scoped to one stored variant;
  - variant names are not part of the public URL;
  - safe for share pages because anyone with a shared note/snippet link can
    load referenced images.

### Desktop UX

Add image insertion to Markdown toolbar:

- Notes editor;
- Snippet description editor;
- Snippet value editor.

The image button opens the upload modal. On successful insert, it inserts
Markdown image syntax at the cursor. Preview renders the Figure Card.

Desktop upload uses native Tauri commands, not direct browser `fetch`, so API
key handling stays in Rust and upload progress can be emitted reliably. The
native bridge provides file picking, multipart upload, job polling, variant
selection, and progress events for upload, server processing, and preview
loading.

### Mobile UX

Mobile supports image rendering in preview and public-share-compatible content.
Upload UI can be added after desktop if native image picking/upload proves too
large for the first implementation, but mobile must not break on Markdown image
syntax.

If mobile upload is included in the first image implementation:

- use native image picker/file picker already approved for the app or add an
  APK release if a new native dependency is required;
- show upload, processing, and preview download progress;
- render Figure Cards in Markdown preview.

### Public Share Links

Public note/snippet pages must render referenced media as Figure Cards. Because
public share links expose the note/snippet content, referenced images are also
public to anyone who has the link.

Rules:

- shared notes show images embedded in `notes.content`;
- shared snippets show images embedded in `value` and `description`;
- revoked share links stop exposing the page, but media URLs may remain
  accessible if someone copied a direct media token URL;
- media tokens must be unguessable.

## Compatibility

- Existing notes/snippets remain valid.
- Markdown image syntax using external URLs still renders if allowed by the
  sanitizer.
- Existing sync payloads continue to sync text fields as plain strings.
- Media assets are managed through dedicated API endpoints, not generic sync.
- If an old mobile client sees image Markdown, it may show Markdown text or a
  simple image depending on renderer support; it should not corrupt content.

## Security And Validation

- Accept only image MIME types initially: JPEG, PNG, WebP.
- Decode images server-side to verify they are real images.
- Strip metadata.
- Reject oversized files before full processing when possible.
- Enforce per-user quota before committing files.
- Store files with server-generated names only.
- Do not trust client-provided MIME type, file name, dimensions, or size.
- Prevent path traversal in all file operations.
- Never expose API keys in admin user lists; show only short prefixes.

## Testing

Admin tests:

- migration adds defaults for existing users;
- `GET /v1/admin/me` works for any authenticated user;
- non-admin cannot list users or edit limits;
- admin can list users;
- admin can edit limits;
- invalid limits are rejected;
- `make-admin --api-key-prefix` succeeds with exactly one match;
- command fails with zero matches;
- command fails with multiple matches.

Image tests:

- upload rejects non-images;
- upload rejects files larger than `media_max_upload_bytes`;
- upload rejects when quota would be exceeded;
- server generates variants for a valid image;
- selected variant returns Markdown URL;
- media usage increases by stored bytes;
- deleting media reduces active usage;
- note/snippet public share renders Figure Cards;
- public share does not leak non-approved snippet fields.

Desktop tests:

- Settings hides `Users / Limits` for non-admin;
- Settings shows user list for admin;
- Settings can update quotas through mocked admin API;
- image modal shows upload/server/preview progress states;
- inserting an image writes Markdown at the cursor;
- preview renders Figure Card for notes, snippet description, and snippet value.

Mobile tests:

- existing note/snippet screens render image Markdown safely;
- mobile does not corrupt image Markdown during edit/save/sync.
