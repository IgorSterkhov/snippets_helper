# Post-Release Smoke Automation — Requirement Spec

## Status

Approved direction by user on 2026-05-23.

## Goal

Add a separate pytest-based post-release smoke layer for the Tasks sync release.
The smoke suite must verify the deployed API, the sync payload contract, and
release manifests after API, desktop, and mobile release steps are complete.

This phase explicitly does not add UI E2E automation for mobile or desktop.

## Scope

### In scope

- New pytest tests under `tests/post_release/`.
- API health smoke against a configurable deployed or local API base URL.
- Tasks sync contract smoke using `/v1/sync/push` and `/v1/sync/pull`.
- Release manifest smoke for:
  - desktop GitHub release assets for the expected `v*` tag;
  - mobile OTA `latest.json` and bundle URL for the expected version.
- Environment-variable based configuration so the same suite can run locally
  after release and later in CI.
- Safe repeated execution by using unique smoke row names and UUIDs.

### Out of scope

- Migrating existing Jest, Rust, or desktop browser-mock tests to pytest.
- Android emulator automation.
- Maestro, Detox, Appium, or other mobile UI E2E tooling.
- Desktop GUI automation.
- Creating release tags, deploying API migrations, uploading OTA bundles, or
  otherwise performing release actions.
- Destructive cleanup of production data.

## Test Layout

Add a new isolated test tree:

```text
tests/post_release/
  requirements.txt
  run.sh
  conftest.py
  test_api_health.py
  test_tasks_sync_contract.py
  test_release_manifests.py
```

Existing test systems remain in place:

- mobile Jest tests stay under `mobile/__tests__/`;
- desktop Rust tests stay under `desktop-rust/src-tauri`;
- desktop browser mock tests stay in `desktop-rust/src/dev-test.py`.

## Configuration

The smoke suite reads configuration from environment variables:

- `POST_RELEASE_API_BASE_URL`: required for API/sync tests. In production this
  should include the reverse-proxy path, for example
  `https://ister-app.ru/snippets-api`.
- `POST_RELEASE_API_KEY`: optional API key for an isolated smoke user.
- `POST_RELEASE_REGISTER_USER`: optional; when set to `1`, tests register a
  disposable user through `POST /v1/auth/register` if no API key is supplied.
- `POST_RELEASE_DESKTOP_TAG`: optional for local partial runs, required for
  desktop manifest smoke.
- `POST_RELEASE_MOBILE_VERSION`: optional for local partial runs, required for
  mobile OTA manifest smoke.
- `POST_RELEASE_MOBILE_MANIFEST_URL`: optional override for mobile OTA
  manifest URL; default is
  `https://ister-app.ru/snippets-updates/latest.json`.
- `POST_RELEASE_GITHUB_REPO`: optional override; default is
  `IgorSterkhov/snippets_helper`.

The intended full command is:

```bash
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api \
POST_RELEASE_REGISTER_USER=1 \
POST_RELEASE_DESKTOP_TAG=v1.3.28 \
POST_RELEASE_MOBILE_VERSION=1.0.6 \
bash tests/post_release/run.sh -q
```

`run.sh` creates and reuses `tests/post_release/.venv`, which is ignored by
git. This keeps frequent release smoke runs fast and avoids depending on a
globally installed pytest. The runner reinstalls dependencies only when
`tests/post_release/requirements.txt` changes, or when
`POST_RELEASE_SMOKE_REINSTALL=1` is set.

Individual tests should skip with a clear pytest reason when their specific
required configuration is missing. A fully configured post-release run must not
skip any tests.

## API Health Smoke

`test_api_health.py` verifies:

- `GET /v1/health` returns HTTP 200;
- response JSON contains `{"status": "ok"}`.

Health smoke only requires `POST_RELEASE_API_BASE_URL`. It must not require an
API key or disposable user registration.

## Tasks Sync Contract Smoke

`test_tasks_sync_contract.py` verifies the public sync contract using API calls
only. It does not import desktop or mobile runtime code.

The test must:

1. Obtain an API key from `POST_RELEASE_API_KEY` or by registering a disposable
   user when `POST_RELEASE_REGISTER_USER=1`.
2. Generate unique UUIDs and row names using a prefix like
   `smoke_<timestamp>`.
3. Push these tables through `POST /v1/sync/push`:
   - `task_categories`
   - `task_statuses`
   - `tasks`
   - `task_checkboxes`
   - `task_links`
4. Pull through `POST /v1/sync/pull` and assert that:
   - each pushed row is returned;
   - `tasks.category_uuid` matches the pushed category UUID;
   - `tasks.status_uuid` matches the pushed status UUID;
   - `task_checkboxes.task_uuid` matches the pushed task UUID;
   - `task_checkboxes.parent_uuid` links a child checkbox to the parent
     checkbox;
   - `task_links.task_uuid` matches the pushed task UUID.
5. Push a soft-deleted task row and assert pull returns `is_deleted=true`.
6. Verify last-write-wins behavior:
   - push a newer task title;
   - push an older update for the same UUID;
   - assert the older update is rejected as a conflict with
     `resolution="server_wins"`.

The contract intentionally mirrors the cross-device behavior:

- desktop can map local integer IDs to UUID relationship fields before push;
- mobile can consume UUID relationship fields directly;
- the API preserves those UUID relationships.

## Release Manifest Smoke

`test_release_manifests.py` verifies release artifacts without running either
desktop or mobile UI.

### Desktop

For `POST_RELEASE_DESKTOP_TAG`, call the GitHub releases API for
`POST_RELEASE_GITHUB_REPO` and assert:

- the release exists;
- `frontend-version.json` asset exists;
- `latest.json` asset exists;
- at least one native desktop artifact exists for a `v*` release, such as
  `.dmg`, `.exe`, `.msi`, `.nsis.zip`, or `.AppImage`;
- downloaded `frontend-version.json` contains valid JSON with a non-empty
  `version` and `url`.

### Mobile

For `POST_RELEASE_MOBILE_VERSION`, fetch `POST_RELEASE_MOBILE_MANIFEST_URL` and
assert:

- HTTP 200;
- JSON `version` equals the expected version;
- `bundle_url` is present;
- `bundle_url` returns HTTP 200 or a successful ranged response.

## Failure Behavior

The suite must fail if:

- API health is broken;
- Tasks sync UUID relationships are missing or changed incorrectly;
- soft delete propagation is broken;
- stale writes overwrite newer server state instead of producing a conflict;
- the expected desktop release is missing required assets;
- the mobile OTA manifest points to the wrong version or an unreachable bundle.

The suite must not require:

- an Android device or emulator;
- a desktop GUI session;
- local production secrets committed into the repository.

## Verification

After implementation, run:

```bash
python3 -m py_compile tests/post_release/conftest.py \
  tests/post_release/test_api_health.py \
  tests/post_release/test_tasks_sync_contract.py \
  tests/post_release/test_release_manifests.py
```

Run local pytest at least in configuration-validation mode:

```bash
bash tests/post_release/run.sh -q
```

When a test environment is available, run the full smoke command with real
post-release environment variables.
