# Complete Open Graph Share Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a standards-complete branded Open Graph card from stable v2 share URLs while preserving every legacy live-share URL.

**Architecture:** Keep the existing live payload lookup and HTML renderer, add optional canonical/image URL inputs at the rendering boundary, and expose the same handler at both legacy and v2 paths. Ship one immutable static PNG inside the existing API image and return v2 URLs from the unchanged `ShareLinkResponse.public_url` field.

**Tech Stack:** Python 3.11+, FastAPI/Starlette responses, standard-library HTML/PNG parsing, vanilla JavaScript development mock, pytest, browser smoke tests.

**Spec:** `.workflow/specs/2026-09-02-share-link-complete-open-graph.md`

## Global Constraints

- Work in current `main`; preserve unrelated user and Claude changes.
- Keep `/share/<token>` and its query-bearing variants valid.
- Do not expose shortcut values, finance data, or user content through the image.
- The PNG is exactly 1200×630 and has a versioned immutable public filename.
- The API response schema and native/desktop IPC surface do not change.
- Use a short one-line commit and no desktop release tag.

---

### Task 1: Branded Image and Complete Renderer Metadata

**Files:**
- Create: `api/static/share-preview-v2.png`
- Modify: `tests/api/test_share_utils.py`
- Modify: `api/share_utils.py`

**Interfaces:**
- Consumes: `render_share_html(payload: dict)` and the existing current desktop icon `desktop-rust/src-tauri/icons/icon.png`.
- Produces: `render_share_html(payload: dict, *, public_url: str = "", preview_image_url: str = "") -> str` and a static 1200×630 PNG.

- [x] **Step 1: Add failing metadata and asset tests**

  Add literal tests that call:

  ```python
  rendered = render_share_html(
      {"type": "note", "title": "Preview", "content": "Current summary"},
      public_url="https://ister-app.ru/share/v2/abc?bad='\"",
      preview_image_url="https://ister-app.ru/share/preview-card-v2.png?bad='\"",
  )
  ```

  Parse the metadata with the existing `MetaParser` and assert decoded values
  for `og:url`, `og:image`, `og:image:type`, `og:image:width`,
  `og:image:height`, and `og:image:alt`. Assert no extra injected tag exists.
  Add a PNG test using Pillow (already present in `api/requirements.txt`) so the
  entire file is decoded rather than trusting only its header:

  ```python
  from pathlib import Path
  from PIL import Image

  data = Path("api/static/share-preview-v2.png").read_bytes()
  assert data[:8] == b"\x89PNG\r\n\x1a\n"
  assert len(data) < 1_000_000
  with Image.open(Path("api/static/share-preview-v2.png")) as image:
      image.verify()
  with Image.open(Path("api/static/share-preview-v2.png")) as image:
      image.load()
      assert image.size == (1200, 630)
  ```

- [x] **Step 2: Verify RED**

  Run:

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_share_utils.py -q
  ```

  Expected: metadata assertions fail because the renderer has no URL/image
  inputs, and the asset assertion fails because the PNG does not exist.

- [x] **Step 3: Create the branded PNG**

  Use the built-in image generation workflow to create a dark violet/indigo
  social preview background with subtle cyan snippet/code accents and no text,
  logos, or watermark. Preserve the current desktop icon exactly by compositing
  `desktop-rust/src-tauri/icons/icon.png` over the generated background rather
  than asking the model to redraw it. Mechanically normalize the final artifact
  to exactly 1200×630 and save it as `api/static/share-preview-v2.png`. Inspect
  the final composite with `view_image` and confirm the desktop icon is intact
  and there is no generated text, extra logo, or watermark.

- [x] **Step 4: Emit complete escaped metadata**

  Extend `render_share_html` with keyword-only empty-string URL arguments. Use
  `html.escape(value, quote=True)` and emit the following block only when both
  URLs are non-empty:

  ```html
  <meta property="og:url" content="...">
  <meta property="og:image" content="...">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Ister App shared item">
  ```

  Preserve all existing title/description behavior for calls that omit the new
  arguments.

- [x] **Step 5: Verify GREEN**

  Run the focused test and `git diff --check`. Expected: all focused tests pass
  and the PNG is exactly 1200×630.

---

### Task 2: V2 Public Route, Image Endpoint, and Client Contract

**Files:**
- Modify: `tests/api/test_share_utils.py`
- Modify: `tests/api/test_share_headers.py`
- Create: `tests/api/test_share_routes.py`
- Modify: `tests/post_release/test_share_links_contract.py`
- Modify: `api/share_utils.py`
- Modify: `api/routes/share_links.py`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

**Interfaces:**
- Consumes: the extended `render_share_html`, `_public_payload(token, db)`, and `PUBLIC_SHARE_HEADERS`.
- Produces: `build_public_url(...) -> https://<origin>/share/v2/<token>`, `GET /share/v2/{token}`, and `GET /share/preview-card-v2.png`.

- [x] **Step 1: Add failing URL, headers, and contract tests**

  Change the two literal `build_public_url` expectations to
  `https://ister-app.ru/share/v2/abc`. Add a literal immutable image-header
  assertion. Create an async ASGI test app containing the real
  `public_router`; override `get_db` with a yielding fake and monkeypatch only
  `_public_payload` to return a literal note. Request the real image endpoint,
  `/share/v2/abc`, and `/share/abc` through `httpx.ASGITransport` with host
  `preview.example` and `x-forwarded-proto=https`. Assert actual HTTP 200,
  image content type/cache/nosniff headers, fully decoded 1200×630 PNG through
  Pillow, identical v2/legacy HTML content, canonical
  `og:url=https://preview.example/share/v2/abc`, and same-origin absolute
  `og:image=https://preview.example/share/preview-card-v2.png`. This also proves
  the static route wins over `/share/{token}` and the file path is independent
  of the process working directory. Update browser smoke to require
  `/share/v2/` and update the
  post-release contract to derive the legacy alias by replacing
  `/share/v2/<token>` with `/share/<token>` rather than clearing a query.
  Assert the v2 page metadata contains the exact v2 URL and absolute image URL;
  fetch the image and validate HTTP 200, `image/png`, PNG signature, and
  1200×630 dimensions.

- [x] **Step 2: Verify RED**

  Run the focused unit tests and browser smoke. Expected: URL tests fail with
  the old `?preview=1` value, header/route expectations fail because the image
  endpoint is absent, the ASGI route test cannot reach the expected route, and
  browser smoke reports the old mock URL. Do not run the production contract
  before deployment.

- [x] **Step 3: Implement the v2 aliases and image response**

  Make `build_public_url` return `/share/v2/<token>`. Add the v2 decorator to
  the existing HTML handler so both paths execute identical code. Accept
  `Request`, preserve the existing forwarded-protocol rule, build the canonical
  URL with `build_public_url`, derive the same-origin absolute image URL, and
  pass both into `render_share_html`. Add a static image route before the
  dynamic legacy route using a module-relative `Path` and `FileResponse` with
  `media_type="image/png"` and:

  ```python
  PUBLIC_PREVIEW_IMAGE_HEADERS = {
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
  }
  ```

  Update the development mock URL to `/share/v2/${token}`.

- [x] **Step 4: Verify GREEN and regressions**

  Run:

  ```bash
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_share_utils.py tests/api/test_share_headers.py -q
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api/test_share_routes.py -q
  /tmp/snippets-helper-tests-20260831/bin/python -m pytest tests/api -q
  node --check desktop-rust/src/dev-mock.js
  cd desktop-rust/src && /tmp/snippets-helper-tests-20260831/bin/python dev-test.py
  git diff --check
  ```

  Expected: all tests pass with only the already-known `datetime.utcnow()`
  warnings.

- [ ] **Step 5: Review, commit, deploy, and verify production**

  Obtain independent review with no Critical or Important findings. Commit and
  push current `main`, fast-forward `/opt/snippets_helper`, rebuild/restart only
  the API/migration services, and verify exact commit/image IDs, healthy service,
  v2 and legacy HTTP 200 responses, metadata, and PNG headers/dimensions. Run
  the production post-release contract after deployment when smoke credentials
  are available; otherwise record the skip and perform the equivalent public
  checks manually. Then give the exact new v2 link to the user. Only after the
  user pastes it into Telegram, inspect access logs for both the v2 HTML and PNG
  fetch and confirm the visible card with the user.
