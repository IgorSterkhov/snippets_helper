# Share Preview on the `www` Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return live-share URLs on `www.ister-app.ru`, preserve every apex-host share URL, and safely enable the new hostname in production TLS and Nginx before the API contract changes.

**Architecture:** Keep `build_public_url()` as the only canonicalization boundary and map only the exact production apex host to `www`, leaving test/staging hosts untouched. Expand the existing Let's Encrypt lineage and Nginx virtual host first, verify `www` end to end, then deploy the API change with a recovery-tagged previous image.

**Tech Stack:** Python 3.11+, FastAPI/Starlette, pytest/httpx/Pillow, vanilla JavaScript browser mock, Nginx 1.27, Docker Compose, certbot/Let's Encrypt.

**Spec:** `.workflow/specs/2026-09-03-share-preview-www-host.md`

## Global Constraints

- Work in the current `main`; preserve unrelated user and Claude changes.
- New production API responses use `https://www.ister-app.ru/share/v2/<token>`.
- Apex legacy, query-bearing legacy, and apex v2 URLs remain live and do not redirect.
- Only the exact `ister-app.ru` hostname is canonicalized; `www`, unrelated hosts, and other subdomains remain unchanged.
- Extend TLS/Nginx and verify `www` before deploying URL-generation code.
- Save root-only production recovery copies and tag the previous API image before any replacement.
- Do not change the database, Tauri commands, native desktop code, Help, release history, or desktop release tags.
- Use a short one-line commit.

---

### Task 1: Canonical Share URL Boundary

**Files:**
- Modify: `tests/api/test_share_utils.py`
- Modify: `tests/api/test_share_routes.py`
- Modify: `api/share_utils.py`

**Interfaces:**
- Consumes: `build_public_url(request_url: str, token: str, forwarded_proto: str | None = None) -> str`.
- Produces: the same signature with exact apex-to-`www` canonicalization and unchanged non-production behavior.

- [x] **Step 1: Add failing URL-boundary tests**

  Change the two existing production assertions to
  `https://www.ister-app.ru/share/v2/abc`, then add literal cases:

  ```python
  def test_build_public_url_keeps_canonical_www_host():
      assert build_public_url(
          "https://www.ister-app.ru/snippets-api/v1/share-links", "abc"
      ) == "https://www.ister-app.ru/share/v2/abc"


  def test_build_public_url_preserves_apex_port_while_canonicalizing():
      assert build_public_url(
          "http://ister-app.ru:8001/v1/share-links", "abc"
      ) == "http://www.ister-app.ru:8001/share/v2/abc"


  def test_build_public_url_drops_nonnumeric_apex_port_while_canonicalizing():
      assert build_public_url(
          "https://ister-app.ru:notaport/v1/share-links", "abc"
      ) == "https://www.ister-app.ru/share/v2/abc"


  def test_build_public_url_drops_out_of_range_apex_port_while_canonicalizing():
      assert build_public_url(
          "https://ister-app.ru:70000/v1/share-links", "abc"
      ) == "https://www.ister-app.ru/share/v2/abc"


  def test_build_public_url_does_not_rewrite_other_hosts_or_subdomains():
      assert build_public_url(
          "http://preview.example/v1/share-links", "abc"
      ) == "http://preview.example/share/v2/abc"
      assert build_public_url(
          "https://share.ister-app.ru/v1/share-links", "abc"
      ) == "https://share.ister-app.ru/share/v2/abc"
  ```

- [x] **Step 2: Add failing apex route canonicalization coverage**

  Extend the real-ASGI test with a second `httpx.AsyncClient` whose
  `base_url` is `http://ister-app.ru` and whose forwarded protocol is HTTPS.
  Fetch all three paths:

  ```python
  apex_v2 = await apex_client.get("/share/v2/abc")
  apex_legacy = await apex_client.get("/share/abc")
  apex_legacy_query = await apex_client.get("/share/abc?preview=1")
  ```

  Assert HTTP 200, identical bodies, and both canonical metadata values:

  ```python
  assert (
      '<meta property="og:url" '
      'content="https://www.ister-app.ru/share/v2/abc">'
      in apex_v2.text
  )
  assert (
      '<meta property="og:image" '
      'content="https://www.ister-app.ru/share/preview-card-v2.png">'
      in apex_v2.text
  )
  ```

  Keep the existing `preview.example` assertions to prove unrelated hosts are
  unchanged. Send real ASGI requests with `Host: ister-app.ru:notaport` and
  `Host: ister-app.ru:70000`; both must render HTTP 200 and canonical `www`
  metadata after the implementation.

- [x] **Step 3: Run focused tests to verify RED**

  Run:

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_share_utils.py tests/api/test_share_routes.py -q
  ```

  Expected: production URL assertions and apex OG assertions fail because the
  apex hostname is still emitted.

- [x] **Step 4: Implement exact-host canonicalization**

  Add constants and a focused helper near `build_public_url()`:

  ```python
  PRODUCTION_SHARE_HOST = "ister-app.ru"
  CANONICAL_SHARE_HOST = "www.ister-app.ru"


  def _canonical_share_netloc(parsed) -> str:
      if (parsed.hostname or "").lower() != PRODUCTION_SHARE_HOST:
          return parsed.netloc
      try:
          port = parsed.port
      except ValueError:
          return CANONICAL_SHARE_HOST
      if port is None:
          return CANONICAL_SHARE_HOST
      return f"{CANONICAL_SHARE_HOST}:{port}"
  ```

  Use the helper only in the returned public origin:

  ```python
  netloc = _canonical_share_netloc(parsed)
  return f"{scheme}://{netloc}/share/v2/{token}"
  ```

- [x] **Step 5: Run focused tests to verify GREEN**

  Run the Step 3 command again and run `git diff --check`. Expected: all tests
  pass and no whitespace errors are reported.

---

### Task 2: Browser Mock and Production Contract

**Files:**
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`
- Modify: `tests/post_release/test_share_links_contract.py`

**Interfaces:**
- Consumes: `ShareLinkResponse.public_url` and the unchanged live-share routes.
- Produces: browser mock parity and a production compatibility matrix for the canonical and apex hosts.

- [x] **Step 1: Strengthen browser smoke and post-release assertions**

  Make browser smoke require the exact prefix:

  ```python
  assert public_url.startswith('https://www.ister-app.ru/share/v2/'), public_url
  assert '?' not in public_url, public_url
  ```

  In the post-release contract, require production-generated links to use
  `www.ister-app.ru`. From the canonical URL construct these exact aliases:

  ```python
  canonical_parts = urlsplit(note_link["public_url"])
  assert canonical_parts.hostname == "www.ister-app.ru", note_link
  apex_v2_url = urlunsplit(canonical_parts._replace(netloc="ister-app.ru"))
  apex_legacy_url = urlunsplit(
      canonical_parts._replace(
          netloc="ister-app.ru",
          path=f"/share/{note_link['token']}",
      )
  )
  apex_legacy_query_url = urlunsplit(
      canonical_parts._replace(
          netloc="ister-app.ru",
          path=f"/share/{note_link['token']}",
          query="preview=1",
      )
  )
  ```

  Fetch the canonical URL and all three apex aliases before and after the v2
  content push. For every HTML response assert HTTP 200, current title/content,
  canonical `og:url`, and canonical `og:image`. After revocation assert all four
  HTML surfaces return 404. Apply the same matrix to the shortcut using its own
  token. Keep the existing PNG signature, MIME, immutable headers, format, and
  1200x630 decode checks.

  Also exercise the existing Share dialog reopen contract immediately after
  creation and again after the content refresh:

  ```python
  status, note_status = api_client.request_json(
      "GET",
      f"/v1/share-links?item_type=note&item_uuid={note_uuid}",
  )
  assert status == 200, note_status
  assert note_status["link"]["public_url"] == note_link["public_url"]
  assert note_status["link"]["public_url"].startswith(
      "https://www.ister-app.ru/share/v2/"
  )
  ```

  Repeat the exact status check for `shortcut`/`shortcut_uuid`, and after the
  v2 push require both tokens and query-free canonical URLs to remain unchanged.

- [x] **Step 2: Run browser smoke to verify RED**

  Run:

  ```bash
  cd desktop-rust/src && /tmp/snippets-helper-tests-20260831/bin/python dev-test.py
  ```

  Expected: the exact `www` Share link assertion fails because the mock still
  returns the apex hostname. Do not run the production contract before deploy.

- [x] **Step 3: Update the development mock**

  Change only the share-link mock URL:

  ```javascript
  public_url: `https://www.ister-app.ru/share/v2/${token}`,
  ```

- [x] **Step 4: Verify the complete local change**

  Run:

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api -q
  node --check desktop-rust/src/dev-mock.js
  cd desktop-rust/src && /tmp/snippets-helper-tests-20260831/bin/python dev-test.py
  git diff --check
  ```

  Expected: all API and browser tests pass, with only existing warnings.

- [x] **Step 5: Obtain independent code review**

  Ask a reviewer to inspect the complete diff for exact-host behavior,
  `www→www` idempotence, apex compatibility, OG metadata, revocation, privacy,
  and absence of native desktop release changes. Resolve every Critical or
  Important finding and rerun Step 4.

- [ ] **Step 6: Commit and push current `main`**

  Confirm the diff contains only the spec, plan, API helper/tests, browser mock
  smoke assertion, and post-release contract. Commit with:

  ```bash
  git commit -m "Use www for shared links"
  git push origin main
  ```

  Record the full commit SHA for the production gate.

---

### Task 3: Prepare Recovery and Enable `www` TLS/Nginx

**Production files/state:**
- Modify: `/etc/letsencrypt/renewal/ister-app.ru.conf` through certbot only.
- Modify: `/etc/letsencrypt/live/ister-app.ru/*` through certbot only.
- Modify: `/opt/ssl/snippets.crt` and `/opt/ssl/snippets.key` through the existing deploy hook only.
- Modify: `/opt/isterapp/backend/nginx/conf.d/isterapp.conf`.
- Create: `/var/backups/isterapp-share-www-20260903/` with mode `0700`.
- Create: Docker image tag `snippets_helper_api:recovery-53b01f1`.
- Create: Docker image tag `snippets_helper_migrate:recovery-53b01f1`.

**Interfaces:**
- Consumes: existing `www` DNS A record, certbot lineage/hooks, bind-mounted Nginx configuration, current API image.
- Produces: valid HTTPS and routing for both apex and `www`, plus recoverable pre-change state.

- [ ] **Step 1: Revalidate immutable preconditions**

  Read and record:

  ```bash
  getent ahosts www.ister-app.ru
  certbot --version
  sudo certbot certificates
  sudo cat /etc/letsencrypt/renewal/ister-app.ru.conf
  sudo stat -c '%A %a %U:%G %n' /usr/local/sbin/isterapp-cert-deploy
  sudo cat /usr/local/sbin/isterapp-cert-deploy
  sudo find /etc/letsencrypt/renewal-hooks/pre /etc/letsencrypt/renewal-hooks/deploy /etc/letsencrypt/renewal-hooks/post -maxdepth 1 -type f -executable -printf '%m %u:%g %p\n'
  docker exec isterapp_nginx nginx -t
  docker inspect --type container --format '{{.Name}} {{.Id}} {{.Image}} {{.State.Status}}' isterapp_nginx snippets_api snippets_migrate
  docker image inspect --format '{{.Id}} {{json .RepoTags}} {{json .RepoDigests}}' snippets_helper_api snippets_helper_migrate
  docker-compose --project-directory /opt/snippets_helper -f /opt/snippets_helper/docker-compose.yml config --quiet
  docker-compose --project-directory /opt/snippets_helper -f /opt/snippets_helper/docker-compose.yml config --services
  git -C /opt/snippets_helper rev-parse HEAD
  curl -fsS https://ister-app.ru/snippets-api/v1/health
  ```

  Expected: `www` resolves to `109.172.85.124`; the existing certificate is
  valid for apex; renewal uses standalone with the current stop/start/deploy
  hooks; every executable directory hook has been inspected; the deploy hook
  is executable, idempotent, installs only the certificate/key, and does not
  call Docker while Nginx is stopped; Nginx/API are running; migration is exit
  0; resolved Compose config is valid and contains `migrate`/`api`; apex health
  is OK. Stop if any extra hook is not understood.

- [ ] **Step 2: Create validated recovery artifacts**

  First prove `/var/backups/isterapp-share-www-20260903` does not exist. Then
  create it with mode `0700` and use `install` to copy:

  ```bash
  sudo install -d -m 0700 /var/backups/isterapp-share-www-20260903
  sudo install -m 0644 /opt/ssl/snippets.crt /var/backups/isterapp-share-www-20260903/snippets.crt
  sudo install -m 0600 /opt/ssl/snippets.key /var/backups/isterapp-share-www-20260903/snippets.key
  sudo install -m 0644 /opt/isterapp/backend/nginx/conf.d/isterapp.conf /var/backups/isterapp-share-www-20260903/isterapp.conf
  sudo install -m 0600 /etc/letsencrypt/renewal/ister-app.ru.conf /var/backups/isterapp-share-www-20260903/ister-app.ru.conf
  sudo install -m 0755 /usr/local/sbin/isterapp-cert-deploy /var/backups/isterapp-share-www-20260903/isterapp-cert-deploy
  ```

  Prove both recovery tags are absent. Read the immutable `.Image` values from
  the exact running/exited `snippets_api` and `snippets_migrate` containers.
  Both must equal the already recorded current production image
  `sha256:f6ee66f07cc5fc47846daea768961b7059cc6d44fc497586244dd0083ffc6218`;
  abort on an empty value or any mismatch. Tag that exact immutable ID for each
  Compose service:

  ```bash
  docker tag sha256:f6ee66f07cc5fc47846daea768961b7059cc6d44fc497586244dd0083ffc6218 snippets_helper_api:recovery-53b01f1
  docker tag sha256:f6ee66f07cc5fc47846daea768961b7059cc6d44fc497586244dd0083ffc6218 snippets_helper_migrate:recovery-53b01f1
  ```

  Confirm each recovery tag resolves to that exact ID. Enumerate exactly the
  five backup files, their modes/owners, and both recovery image IDs. Do not
  print private-key content.

- [ ] **Step 3: Expand the existing certificate**

  Tell the user that the existing renewal flow will briefly stop Nginx. Run:

  ```bash
  sudo certbot certonly --standalone --cert-name ister-app.ru --expand \
    --non-interactive -d ister-app.ru -d www.ister-app.ru \
    --pre-hook "/usr/bin/docker stop isterapp_nginx" \
    --post-hook "/usr/bin/docker start isterapp_nginx" \
    --deploy-hook "/usr/local/sbin/isterapp-cert-deploy" \
    --no-directory-hooks
  ```

  Run this only after the hook gate in Step 1 passes. Certbot invokes the
  deploy hook before the post hook; the inspected deploy hook must therefore
  remain safe while `isterapp_nginx` is stopped. If hook contents or directory
  hooks differ from the recorded safe state, do not invoke certbot.

  If it fails, immediately use the spec rollback and prove apex health before
  stopping.

- [ ] **Step 4: Verify certificate lineage and deployed pair**

  Confirm `certbot certificates` lists exactly both domains. Confirm the
  renewal file still contains `authenticator = standalone`, the Nginx stop/start
  hooks, and the deploy hook. Compare public-key SHA-256 digests derived from
  `/opt/ssl/snippets.crt` and `/opt/ssl/snippets.key` without printing the key;
  they must match. Confirm `isterapp_nginx` is running and apex health is OK.

  If issuance/deploy/start/key matching fails, first compare the current live
  certificate fingerprint and symlink targets to the preflight record:

  - If no new certificate was saved, verify `certbot certificates`, the live
    symlink targets, renewal parameters, and hooks still describe the original
    apex lineage. Restore only deployed files that actually changed.
  - If a valid certificate containing both SANs was saved, keep the expanded
    certbot lineage. Because it remains valid for apex, rerun the already
    inspected copy-only deploy hook while Nginx is stopped, verify the deployed
    pair, then start Nginx. If deployment still cannot be repaired, restore the
    saved `/opt/ssl` pair only to recover apex service, but do not overwrite the
    new lineage or renewal file.
  - If the managed lineage is inconsistent or cannot be verified, do not edit
    individual `live`/`archive`/renewal files. Recover apex service from the
    saved deployed pair and stop for a supported certbot repair.

  Service-recovery commands for the deployed pair are:

  ```bash
  sudo install -m 0644 /var/backups/isterapp-share-www-20260903/snippets.crt /opt/ssl/snippets.crt
  sudo install -m 0600 /var/backups/isterapp-share-www-20260903/snippets.key /opt/ssl/snippets.key
  sudo install -m 0644 /var/backups/isterapp-share-www-20260903/isterapp.conf /opt/isterapp/backend/nginx/conf.d/isterapp.conf
  docker start isterapp_nginx
  docker exec isterapp_nginx nginx -t
  docker exec isterapp_nginx nginx -s reload
  curl -fsS https://ister-app.ru/snippets-api/v1/health
  ```

  Recompare the restored certificate/key public-key digests and verify the
  served apex fingerprint matches the preflight record before stopping. In all
  branches, verify `certbot certificates`, the live symlink targets, renewal
  parameters, and hooks; the saved renewal config and deploy hook are reference
  copies, not files to restore independently into an advanced lineage.

- [ ] **Step 5: Add `www` through an inspected Nginx candidate**

  Enumerate exactly two active anchored directives with line numbers and
  surrounding server-block context. Require this anchored `awk` check to exit
  0:

  ```bash
  sudo awk '
    /^[[:space:]]*server_name[[:space:]]+ister-app\.ru[[:space:]]+_;[[:space:]]*$/ {
      print NR ":" $0; count++
    }
    END { exit(count == 2 ? 0 : 1) }
  ' /opt/isterapp/backend/nginx/conf.d/isterapp.conf
  ```

  Create `/var/backups/isterapp-share-www-20260903/isterapp.conf.candidate`
  from the saved/current config and edit only the anchored active directives:

  ```bash
  sudo install -m 0644 /opt/isterapp/backend/nginx/conf.d/isterapp.conf /var/backups/isterapp-share-www-20260903/isterapp.conf.candidate
  sudo sed -i -E 's/^([[:space:]]*)server_name[[:space:]]+ister-app\.ru[[:space:]]+_;[[:space:]]*$/\1server_name ister-app.ru www.ister-app.ru _;/' /var/backups/isterapp-share-www-20260903/isterapp.conf.candidate
  sudo diff -u /opt/isterapp/backend/nginx/conf.d/isterapp.conf /var/backups/isterapp-share-www-20260903/isterapp.conf.candidate
  ```

  `diff` is expected to exit 1 and show exactly two line replacements:
  `server_name ister-app.ru _;` to
  `server_name ister-app.ru www.ister-app.ru _;`, with no other change. Require
  this anchored candidate check to exit 0 and print exactly two lines:

  ```bash
  sudo awk '
    /^[[:space:]]*server_name[[:space:]]+ister-app\.ru[[:space:]]+www\.ister-app\.ru[[:space:]]+_;[[:space:]]*$/ {
      print NR ":" $0; count++
    }
    END { exit(count == 2 ? 0 : 1) }
  ' /var/backups/isterapp-share-www-20260903/isterapp.conf.candidate
  ```

  Only then install the candidate and run:

  ```bash
  sudo install -m 0644 /var/backups/isterapp-share-www-20260903/isterapp.conf.candidate /opt/isterapp/backend/nginx/conf.d/isterapp.conf
  docker exec isterapp_nginx nginx -t
  docker exec isterapp_nginx nginx -s reload
  ```

  If validation or reload fails, restore the saved config and follow rollback.

- [ ] **Step 6: Gate API deployment on working `www`**

  Verify the served certificate SAN contains both names, then check:

  ```bash
  curl -fsS https://www.ister-app.ru/snippets-api/v1/health
  curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://ister-app.ru/share/v2/JZsRs5YOiLkwmWekg9p3l4qDUCeNuzm0jqUkYRO8dQY
  curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://www.ister-app.ru/share/v2/JZsRs5YOiLkwmWekg9p3l4qDUCeNuzm0jqUkYRO8dQY
  curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://ister-app.ru/share/v2/JZsRs5YOiLkwmWekg9p3l4qDUCeNuzm0jqUkYRO8dQY
  curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.ister-app.ru/share/v2/JZsRs5YOiLkwmWekg9p3l4qDUCeNuzm0jqUkYRO8dQY
  curl -fsS -D - -o /dev/null https://www.ister-app.ru/share/preview-card-v2.png
  ```

  Expected: health OK; all four HTML checks return `200` with an empty redirect
  URL; PNG returns 200 with `image/png`, immutable cache, and `nosniff`. Fetch
  the HTML and assert its `og:url` and `og:image` both use `www`. Do not deploy
  the API commit unless every check passes.

---

### Task 4: Deploy API Contract and Perform Telegram Acceptance

**Production state:**
- Modify: `/opt/snippets_helper` by fast-forward only.
- Replace: exact containers `snippets_api` and `snippets_migrate` only.
- Preserve: `/opt/snippets_helper/backups/` and every other container/service.

**Interfaces:**
- Consumes: pushed exact commit SHA, verified dual-host TLS/Nginx, recovery-tagged previous API image.
- Produces: canonical `www` API responses and verified apex compatibility.

- [ ] **Step 1: Fast-forward and verify exact production commit**

  Require `git status --short --branch` to show only the known untracked
  `backups/`. Run `git -C /opt/snippets_helper pull --ff-only`, then require
  `rev-parse HEAD` to equal the recorded local SHA.

- [ ] **Step 2: Build without stopping the current API**

  Run:

  ```bash
  docker-compose --project-directory /opt/snippets_helper -f /opt/snippets_helper/docker-compose.yml config --quiet
  docker-compose --project-directory /opt/snippets_helper -f /opt/snippets_helper/docker-compose.yml build migrate api
  ```

  Record the new image ID and confirm it differs from the recovery image.

- [ ] **Step 3: Replace only the exact API/migration containers**

  Inspect `snippets_api` and `snippets_migrate` by exact name/type/status/image.
  Tell the user about the short API interruption, then run only:

  ```bash
  docker rm -f snippets_api snippets_migrate
  docker-compose --project-directory /opt/snippets_helper -f /opt/snippets_helper/docker-compose.yml up -d migrate api
  ```

  Do not run an unscoped `docker-compose up -d`.

  Rollback, if required, must first retag both recorded recovery images to the
  Compose-managed tags, verify the IDs, then recreate only the same two exact
  services with the same `--project-directory /opt/snippets_helper` option:

  ```bash
  docker tag snippets_helper_api:recovery-53b01f1 snippets_helper_api:latest
  docker tag snippets_helper_migrate:recovery-53b01f1 snippets_helper_migrate:latest
  docker-compose --project-directory /opt/snippets_helper -f /opt/snippets_helper/docker-compose.yml up -d migrate api
  ```

  Before the scoped `up`, inspect `snippets_api` and `snippets_migrate` in two
  separate exact-name tool calls. Each name may resolve to exactly one validated
  container or be absent; more than one match or any unexpected type/image/name
  is a stop condition. For each exact container that exists, run its matching
  literal removal command (`docker rm -f snippets_api` and/or
  `docker rm -f snippets_migrate`) separately. Do not run a removal command for
  an absent name and do not use filters, globs, variables, or command
  substitutions. Verify both retagged Compose images resolve to the recorded
  recovery ID before removal. After recreation, inspect both new container image
  IDs, require `snippets_migrate` to have actually run and exit 0, then prove API
  startup logs and apex health.

- [ ] **Step 4: Verify services and public compatibility**

  Confirm migration exit 0, API running on the new image ID, clean startup
  logs, and `https://ister-app.ru/snippets-api/v1/health` plus
  `https://www.ister-app.ru/snippets-api/v1/health` both return OK.

  Fetch and inspect all four forms for the known token:

  ```text
  https://www.ister-app.ru/share/v2/<token>
  https://ister-app.ru/share/v2/<token>
  https://ister-app.ru/share/<token>
  https://ister-app.ru/share/<token>?preview=1
  ```

  Require HTTP 200, current content, and canonical `www` values in both OG URL
  fields. Validate the public PNG headers and full 1200x630 PNG decode.

- [ ] **Step 5: Run the production contract**

  Run:

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/post_release/test_share_links_contract.py -q
  ```

  If credentials are unavailable and the test skips, record the skip and use
  the manual checks from Step 4 only for the public surfaces. The changed
  authenticated contract remains unverified until the user reopens an existing
  Share dialog in the desktop app and reports/copies its exact query-free
  `https://www.ister-app.ru/share/v2/<token>` URL. Do not describe the API
  contract as verified before that check.

- [ ] **Step 6: Perform manual Telegram acceptance**

  Give the user the exact canonical URL:

  ```text
  https://www.ister-app.ru/share/v2/JZsRs5YOiLkwmWekg9p3l4qDUCeNuzm0jqUkYRO8dQY
  ```

  Ask them to paste it into Telegram Desktop and wait for the composer card.
  Only after they report the attempt, inspect `isterapp_nginx` access logs for
  both the canonical HTML and `/share/preview-card-v2.png`. Report separately:
  visible card result, HTML crawler request/status/user agent, and PNG crawler
  request/status/user agent. Do not claim the Telegram issue fixed unless the
  card is visible.
