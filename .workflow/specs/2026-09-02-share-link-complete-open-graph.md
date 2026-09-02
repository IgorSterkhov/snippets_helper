# Complete Open Graph Share Preview Spec

## Requirement

Public share links must give Telegram the most standards-complete card that the
application can provide: current title and note summary, an absolute canonical
URL, and a public branded PNG image. Existing public links must remain valid.

## Diagnostic Evidence

- The legacy URL was negatively cached before preview metadata existed.
- Query variants `?preview=1`, `?tg_preview=1`, and
  `?tg_preview=20260902-2` did not reliably produce a visible Telegram card.
- Production access logs prove that Telegram's crawler fetched the last query
  variant with HTTP 200, but Telegram still rendered no card.
- The current page has `og:title`, `og:description`, `og:type`, and
  `og:site_name`, but lacks the basic Open Graph `og:url` and `og:image`
  properties.

The fix therefore completes the server metadata. It does not claim that URL
cache busting alone can control Telegram's client-side rendering.

## Approved Behavior

- API-generated public URLs use `/share/v2/<token>` with no query string.
- `/share/v2/<token>` and legacy `/share/<token>` render the same live payload.
  Existing query-bearing legacy URLs also continue to work because the legacy
  route ignores their query string.
- Every HTML share page emits escaped `og:title`, `og:type=article`,
  `og:site_name=Ister App`, `og:url`, `og:image`, `og:image:type=image/png`,
  `og:image:width=1200`, `og:image:height=630`, and an accessible
  `og:image:alt` value.
- Note pages retain the existing escaped `description` and `og:description`.
  Shortcut and finance values remain excluded from descriptions.
- `og:url` is the API-generated v2 URL for the token, even when a legacy URL is
  requested. This gives all aliases one canonical Open Graph identity.
- `og:image` is an absolute URL under the same public origin:
  `/share/preview-card-v2.png`.
- The preview image is a 1200×630 PNG that uses the current Ister App desktop
  icon unchanged over a dark violet/indigo background with subtle cyan visual
  accents. It contains no generated text and no user content.
- The image endpoint returns `image/png`, `X-Content-Type-Options: nosniff`, and
  a long-lived immutable cache header because the filename is versioned.

## Security and Privacy

- Public URLs inserted into metadata are escaped for quoted HTML attributes.
- The image is static and contains no note, shortcut, finance, account, or
  authentication data.
- No user-supplied URL is accepted by the image endpoint.
- Share token validation and revocation behavior are unchanged.

## Non-Goals

- No per-note generated image, screenshot, AI summary, database migration,
  payload-schema change, mobile change, or packaged desktop frontend change.
- No promise that Telegram will render every valid card; production logs and a
  manual Telegram acceptance test remain the final evidence.
- No removal or redirect of legacy share links.

## Verification

- Unit tests prove exact v2 URL generation and escaping of `og:url` and
  `og:image`.
- Unit tests prove the committed PNG signature and exact 1200×630 dimensions.
- The PNG fully decodes through Pillow, stays within a reasonable static-asset
  size, and is visually inspected for an intact current icon and absence of
  generated text, extra logos, or watermarks.
- An ASGI-level test requests the real image, v2, and legacy routes with a
  forwarded HTTPS origin and proves route precedence, headers, canonical
  metadata, and identical live content.
- API tests remain green, including the existing Markdown/security cases.
- Desktop development smoke proves the mock returns `/share/v2/<token>`.
- Production checks prove both v2 and legacy URLs return HTTP 200, share the
  current title/content, the PNG endpoint returns the correct headers and image,
  and, after the user pastes the exact v2 URL, Telegram's crawler can fetch the
  v2 page and image.

## Release

Deploy the API image from current `main`. Do not create a desktop `f-*` or
native `v*` tag: the only desktop file involved is the development mock/test,
which is excluded from packaged OTA assets.
