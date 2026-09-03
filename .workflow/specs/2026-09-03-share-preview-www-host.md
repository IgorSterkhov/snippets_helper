# Share Preview on the `www` Host

## Status

Approved product direction: use `www.ister-app.ru` as the canonical host for
new live-share links while preserving all existing `ister-app.ru` links.

## Problem

The live-share HTML and its Open Graph image are publicly reachable, return
HTTP 200, and contain complete Open Graph metadata. Telegram Desktop 7.1.4
renders previews for known external sites but not for these share links.

The observed Telegram behavior has two distinct forms. An earlier request for
`/share/<token>?tg_preview=20260902-2` reached Nginx from `95.161.76.54` with a
Firefox 95 user agent and returned HTTP 200, but Telegram still displayed no
card. Later tests with a new `/share/v2/<token>` URL and a direct versioned PNG
caused no corresponding HTML or image request in Nginx at all. A control
request made outside Telegram appeared in the same access log immediately.

Query-string cache busting, a new `/share/v2/` path, and a standards-complete
Open Graph card have already been tried on the same hostname. The remaining
working hypothesis is a hostname-level negative cache or suppression in
Telegram, but the evidence does not prove that root cause. Moving to `www` is
a controlled hostname experiment with a clean public URL, not a claim that the
failure mechanism inside Telegram is known. Further changes to the same page
markup would not test this hypothesis.

## Requirements

- New and refreshed share-link API responses must use
  `https://www.ister-app.ru/share/v2/<token>`.
- HTML served from the canonical `www` URL must use that exact URL in
  `og:url` and must use
  `https://www.ister-app.ru/share/preview-card-v2.png` in `og:image`.
- Existing `https://ister-app.ru/share/<token>`, query-bearing legacy URLs,
  and `https://ister-app.ru/share/v2/<token>` must continue returning the
  current live item without requiring republishing.
- Requests received on the apex host must render canonical Open Graph URLs on
  the `www` host. They must not redirect, so old links retain their current
  response and compatibility characteristics.
- Non-production hosts used by ASGI tests and local environments must retain
  their incoming hostname rather than being rewritten to `www.ister-app.ru`.
- Both `ister-app.ru` and `www.ister-app.ru` must have a valid TLS certificate.
- Nginx must explicitly accept both hostnames on HTTP and HTTPS.
- Existing content privacy rules remain unchanged: the preview image is a
  static brand asset and contains no note, shortcut, or finance data.
- No database, schema, Tauri command, or native desktop release surface may
  change.

## Design

### Canonical URL generation

`api.share_utils.build_public_url()` remains the single URL-generation
boundary. It will map the exact production apex hostname `ister-app.ru` to
`www.ister-app.ru`, while retaining the resolved scheme, optional forwarded
HTTPS handling, path `/share/v2/<token>`, and any valid explicit port. An
invalid or out-of-range port on the production host is discarded so an
attacker-controlled `Host` header cannot turn public share rendering into an
HTTP 500 response. All other hostnames remain unchanged.

The public share handler already calls `build_public_url()` for `og:url` and
derives `og:image` from the resulting origin. Therefore the same mapping makes
both metadata URLs canonical without duplicating hostname rules in the route.

The browser development mock will emit the same production-shaped `www` URL
so smoke tests cover the user-visible contract.

### TLS and Nginx

The `www.ister-app.ru` DNS record already resolves to `109.172.85.124`. The
existing Let's Encrypt certificate named `ister-app.ru` currently contains
only the apex name. It will be expanded in place to contain both names using
the existing standalone authenticator and renewal hooks.

The current renewal configuration stops `isterapp_nginx` before the ACME
challenge, starts it afterwards, and runs
`/usr/local/sbin/isterapp-cert-deploy` to copy the renewed certificate and key
into `/opt/ssl`. This existing mechanism must be preserved. The certificate
operation causes a short HTTPS/HTTP interruption and must be followed by
explicit container, certificate SAN, and health checks.

Certbot executes deploy hooks before post hooks, so the deploy hook must remain
safe while Nginx is stopped. Before issuance, record the certbot version,
inspect the hook's contents and executable mode, and enumerate every executable
directory hook under `/etc/letsencrypt/renewal-hooks/{pre,deploy,post}`. Proceed
only when the effective hooks are understood, idempotent, and compatible with
the stopped container. The currently observed deploy hook only installs the
certificate/key files and does not call Docker or reload Nginx.

Both Nginx server blocks in
`/opt/isterapp/backend/nginx/conf.d/isterapp.conf` will explicitly list
`ister-app.ru www.ister-app.ru`. The existing catch-all behavior and every
location remain unchanged. The configuration must pass `nginx -t` before a
reload/restart.

### Deployment order

1. Create a root-only recovery directory and save permission-preserving copies
   of the deployed `/opt/ssl` certificate and private key, the Nginx virtual
   host, the certbot renewal configuration, and the deploy hook. Record the
   current certificate
   fingerprint/SANs, git commit, API/migration container IDs and running image
   IDs/digests, Nginx container ID, effective certbot hooks, and service health.
   Add non-overwriting recovery tags to the exact running API and migration
   image IDs before a new build can replace their compose tags.
2. Expand the certificate to both hostnames through the existing certbot
   lineage and deploy hook.
3. Confirm the expanded lineage contains both names and still uses the
   standalone authenticator plus the existing pre-, post-, and deploy-hooks.
   Add `www` to both active Nginx `server_name` declarations through an
   inspected candidate diff, validate the effective configuration inside
   `isterapp_nginx`, and reload.
4. Verify HTTPS, share HTML, and the PNG through `www` before changing API URL
   generation.
5. Deploy the tested API commit and verify new API responses, canonical
   metadata, apex compatibility, and service health.
6. Ask the user to paste the exact `www` share URL into Telegram Desktop. Only
   after that action, correlate visible behavior with Nginx requests for both
   the share HTML and PNG.

## Failure Handling and Rollback

- If certificate issuance, its deploy-hook, Nginx start/reload, certificate/key
  matching, or HTTPS validation fails, first determine whether certbot advanced
  the managed lineage. If a valid dual-SAN certificate was saved, retain that
  backward-compatible lineage and repair/retry only deployment of its files. If
  no certificate was saved, verify the original lineage remains intact. Never
  create a partially rolled-back lineage by manually mixing an old renewal file
  with new `live`/`archive` state. Restore the saved deployed certificate,
  private key, and Nginx configuration only when needed to recover service;
  validate/reload `isterapp_nginx` and prove apex HTTPS health. Do not deploy
  the API hostname change while certbot state is inconsistent or unverified.
- If Nginx validation fails after the hostname edit, restore only the saved
  `isterapp.conf`, validate again inside the container, and keep the API on the
  apex hostname.
- If the API deployment fails, retag the recorded/recovery-tagged preceding API
  and migration images back to their Compose-managed tags and recreate only the
  API and migration services from those images.
  Verify their image IDs, migration exit code, logs, and apex health. The
  dual-host certificate and Nginx support may remain because they are
  backward-compatible.
- If Telegram still makes no request to the new hostname, record that evidence
  and stop. A dedicated `share.ister-app.ru` hostname is a separate product and
  DNS decision, not an automatic follow-up.

## Verification

- Unit tests prove exact apex-to-`www` mapping, idempotent `www`-to-`www`
  behavior, forwarded HTTPS behavior, explicit port preservation, and
  pass-through for unrelated hosts and other subdomains. They also prove that
  nonnumeric and out-of-range production ports are safely discarded.
- ASGI route tests prove that apex legacy, query-bearing apex legacy, and apex
  v2 requests all emit both canonical Open Graph URLs on `www`; they also
  continue proving that arbitrary test hosts are preserved and legacy/v2
  routes share identical content. Invalid production ports are exercised
  through real ASGI requests and must still return the canonical page.
- Browser smoke asserts the development mock returns a query-free
  `https://www.ister-app.ru/share/v2/` URL.
- The post-release contract asserts production API URLs use the `www` host,
  fetches the canonical page and PNG, and explicitly fetches the old apex
  legacy URL, the query-bearing apex legacy URL, and the apex v2 URL. The same
  matrix is checked after live content refresh, and revocation remains verified
  through the public API and canonical/legacy HTML surfaces.
- The post-release contract checks both the create response and authenticated
  `GET /v1/share-links?item_type=...&item_uuid=...` status response before and
  after content refresh, matching the existing Share dialog reopen flow.
- When automated smoke credentials are unavailable, the user must reopen an
  existing Share dialog after deployment and report the exact returned `www`
  URL. Public-only HTTP checks are not accepted as proof of the authenticated
  create/status response contract.
- Production checks verify certificate SANs, Nginx syntax, HTTP 200 for both
  canonical and apex paths over the required HTTP/HTTPS combinations with no
  unexpected redirect, OG metadata, PNG headers/dimensions, migration exit
  code, API container image ID, and the external health endpoint.
- Final acceptance requires the Telegram Desktop composer/message to display
  the preview and Nginx logs to show Telegram fetching the canonical HTML and
  PNG.

## Non-goals

- Replacing the existing branded PNG or changing the note summary algorithm.
- Redirecting or revoking existing share URLs.
- Introducing another DNS record or a general-purpose hostname configuration
  system.
- Changing Telegra.ph publishing, Telegram bot polling, or desktop native code.
