# Post-Release Smoke Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pytest-only post-release smoke suite for API, Tasks sync contract, and release manifests without adding mobile or desktop UI E2E.

**Architecture:** The suite lives in `tests/post_release/` and uses pytest fixtures for environment configuration, API key setup, JSON HTTP helpers, and unique smoke data. Tests call public HTTP endpoints only, so they can run against a deployed release or a local API without importing desktop or mobile runtime code.

**Tech Stack:** Python 3, pytest, standard-library `urllib.request`, public FastAPI sync endpoints, GitHub releases API.

---

## Scope Check

This plan creates a new isolated pytest layer. It does not migrate existing
Jest, Rust, or browser-mock tests, and it does not add UI E2E automation.

## File Map

- Create `tests/post_release/requirements.txt`: pytest dependency for this
  isolated smoke layer.
- Create `tests/post_release/run.sh`: persistent local venv runner for frequent
  post-release smoke runs.
- Create `tests/post_release/conftest.py`: environment fixtures, HTTP helpers,
  smoke user registration, UUID/time helpers, release URL helpers.
- Create `tests/post_release/test_api_health.py`: API health smoke.
- Create `tests/post_release/test_tasks_sync_contract.py`: task tables
  push/pull, UUID relationships, soft delete, and last-write-wins conflict.
- Create `tests/post_release/test_release_manifests.py`: desktop GitHub
  release assets and mobile OTA manifest/bundle checks.

## Task 1: Add pytest dependency, fixture, and HTTP helper layer

**Files:**
- Create: `tests/post_release/requirements.txt`
- Create: `tests/post_release/conftest.py`

- [x] **Step 1: Create the test directory**

Run:

```bash
mkdir -p tests/post_release
```

Expected: `tests/post_release` exists.

- [x] **Step 2: Add smoke-layer pytest dependency**

Create `tests/post_release/requirements.txt` with:

```text
pytest>=8.0.0
```

- [x] **Step 3: Add `conftest.py`**

Create `tests/post_release/conftest.py` with:

```python
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

import pytest


DEFAULT_MOBILE_MANIFEST_URL = "https://ister-app.ru/snippets-updates/latest.json"
DEFAULT_GITHUB_REPO = "IgorSterkhov/snippets_helper"


@dataclass(frozen=True)
class SmokeConfig:
    api_base_url: str | None
    api_key: str | None
    register_user: bool
    desktop_tag: str | None
    mobile_version: str | None
    mobile_manifest_url: str
    github_repo: str


def _clean_base_url(value: str | None) -> str | None:
    if not value:
        return None
    return value.rstrip("/")


@pytest.fixture(scope="session")
def smoke_config() -> SmokeConfig:
    return SmokeConfig(
        api_base_url=_clean_base_url(os.environ.get("POST_RELEASE_API_BASE_URL")),
        api_key=os.environ.get("POST_RELEASE_API_KEY"),
        register_user=os.environ.get("POST_RELEASE_REGISTER_USER") == "1",
        desktop_tag=os.environ.get("POST_RELEASE_DESKTOP_TAG"),
        mobile_version=os.environ.get("POST_RELEASE_MOBILE_VERSION"),
        mobile_manifest_url=os.environ.get(
            "POST_RELEASE_MOBILE_MANIFEST_URL",
            DEFAULT_MOBILE_MANIFEST_URL,
        ),
        github_repo=os.environ.get("POST_RELEASE_GITHUB_REPO", DEFAULT_GITHUB_REPO),
    )


def smoke_prefix() -> str:
    return f"smoke_{int(time.time())}_{uuid.uuid4().hex[:8]}"


class HttpClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self.base_url = base_url.rstrip("/") if base_url else None
        self.api_key = api_key

    def url(self, path_or_url: str) -> str:
        if path_or_url.startswith(("http://", "https://")):
            return path_or_url
        if not self.base_url:
            raise AssertionError("HTTP client base_url is not configured")
        return f"{self.base_url}/{path_or_url.lstrip('/')}"

    def request_json(
        self,
        method: str,
        path_or_url: str,
        payload: dict | None = None,
        headers: dict[str, str] | None = None,
        timeout: int = 30,
    ) -> tuple[int, dict]:
        request_headers = {"Accept": "application/json"}
        if payload is not None:
            request_headers["Content-Type"] = "application/json"
        if self.api_key:
            request_headers["Authorization"] = f"Bearer {self.api_key}"
        if headers:
            request_headers.update(headers)

        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            self.url(path_or_url),
            data=body,
            method=method,
            headers=request_headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
                data = json.loads(raw) if raw else {}
                return response.status, data
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                data = {"raw": raw}
            return exc.code, data

    def head_or_get_status(self, path_or_url: str, timeout: int = 30) -> int:
        url = self.url(path_or_url)
        request = urllib.request.Request(url, method="HEAD")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status
        except urllib.error.HTTPError as exc:
            if exc.code in {405, 403}:
                request = urllib.request.Request(
                    url,
                    method="GET",
                    headers={"Range": "bytes=0-0"},
                )
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    return response.status
            return exc.code


@pytest.fixture(scope="session")
def base_api_client(smoke_config: SmokeConfig) -> HttpClient:
    if not smoke_config.api_base_url:
        pytest.skip("POST_RELEASE_API_BASE_URL is required for API smoke tests")
    return HttpClient(smoke_config.api_base_url)


@pytest.fixture(scope="session")
def api_client(smoke_config: SmokeConfig, base_api_client: HttpClient) -> HttpClient:
    if not smoke_config.api_base_url:
        pytest.skip("POST_RELEASE_API_BASE_URL is required for API smoke tests")

    if smoke_config.api_key:
        return HttpClient(smoke_config.api_base_url, smoke_config.api_key)

    if not smoke_config.register_user:
        pytest.skip(
            "POST_RELEASE_API_KEY or POST_RELEASE_REGISTER_USER=1 is required "
            "for authenticated API smoke tests"
        )

    user_name = smoke_prefix()
    status, data = base_api_client.request_json("POST", "/v1/auth/register", {"name": user_name})
    assert status == 200, data
    api_key = data.get("api_key")
    assert api_key, data
    return HttpClient(smoke_config.api_base_url, api_key)


@pytest.fixture(scope="session")
def public_http() -> HttpClient:
    return HttpClient()


@pytest.fixture
def unique_prefix() -> str:
    return smoke_prefix()


@pytest.fixture
def uuid_factory() -> Callable[[], str]:
    return lambda: str(uuid.uuid4())


@pytest.fixture
def iso_timestamp() -> Callable[[int], str]:
    def _build(offset_seconds: int = 0) -> str:
        return datetime.fromtimestamp(
            time.time() + offset_seconds,
            tz=timezone.utc,
        ).isoformat()

    return _build


@pytest.fixture
def github_release_url() -> Callable[[str, str], str]:
    def _build(repo: str, tag: str) -> str:
        quoted_tag = urllib.parse.quote(tag, safe="")
        return f"https://api.github.com/repos/{repo}/releases/tags/{quoted_tag}"

    return _build
```

- [x] **Step 4: Verify syntax**

Run:

```bash
python3 -m py_compile tests/post_release/conftest.py
```

Expected: command exits 0.

## Task 2: Add API health smoke

**Files:**
- Create: `tests/post_release/test_api_health.py`

- [x] **Step 1: Add health test**

Create `tests/post_release/test_api_health.py` with:

```python
def test_api_health_returns_ok(base_api_client):
    status, data = base_api_client.request_json("GET", "/v1/health")

    assert status == 200
    assert data == {"status": "ok"}
```

- [x] **Step 2: Run health test in configuration-validation mode**

Run without API env:

```bash
pytest tests/post_release/test_api_health.py -q
```

Expected: skipped with a clear reason about `POST_RELEASE_API_BASE_URL`.

## Task 3: Add Tasks sync contract smoke

**Files:**
- Create: `tests/post_release/test_tasks_sync_contract.py`

- [x] **Step 1: Add sync contract helpers and test**

Create `tests/post_release/test_tasks_sync_contract.py` with:

```python
def _rows_by_uuid(changes, table):
    return {row["uuid"]: row for row in changes.get(table, [])}


def _push(api_client, changes):
    status, data = api_client.request_json("POST", "/v1/sync/push", {"changes": changes})
    assert status == 200, data
    assert data["status"] == "ok"
    return data


def _pull_all(api_client):
    status, data = api_client.request_json("POST", "/v1/sync/pull", {"last_sync_at": None})
    assert status == 200, data
    return data["changes"]


def test_tasks_sync_contract_preserves_uuid_relationships(
    api_client,
    iso_timestamp,
    unique_prefix,
    uuid_factory,
):
    category_uuid = uuid_factory()
    status_uuid = uuid_factory()
    task_uuid = uuid_factory()
    parent_checkbox_uuid = uuid_factory()
    child_checkbox_uuid = uuid_factory()
    link_uuid = uuid_factory()

    changes = {
        "task_categories": [
            {
                "uuid": category_uuid,
                "name": f"{unique_prefix}_category",
                "color": "#4f8cff",
                "sort_order": 1,
                "updated_at": iso_timestamp(),
                "is_deleted": False,
            }
        ],
        "task_statuses": [
            {
                "uuid": status_uuid,
                "name": f"{unique_prefix}_status",
                "color": "#2fb344",
                "sort_order": 1,
                "updated_at": iso_timestamp(),
                "is_deleted": False,
            }
        ],
        "tasks": [
            {
                "uuid": task_uuid,
                "title": f"{unique_prefix}_task",
                "category_uuid": category_uuid,
                "status_uuid": status_uuid,
                "is_pinned": 1,
                "bg_color": "#fff7d6",
                "tracker_url": "https://example.invalid/task",
                "notes_md": "post release smoke",
                "sort_order": 1,
                "updated_at": iso_timestamp(),
                "is_deleted": False,
            }
        ],
        "task_checkboxes": [
            {
                "uuid": parent_checkbox_uuid,
                "task_uuid": task_uuid,
                "parent_uuid": None,
                "text": f"{unique_prefix}_parent_checkbox",
                "is_checked": 0,
                "sort_order": 1,
                "updated_at": iso_timestamp(),
                "is_deleted": False,
            },
            {
                "uuid": child_checkbox_uuid,
                "task_uuid": task_uuid,
                "parent_uuid": parent_checkbox_uuid,
                "text": f"{unique_prefix}_child_checkbox",
                "is_checked": 1,
                "sort_order": 2,
                "updated_at": iso_timestamp(),
                "is_deleted": False,
            },
        ],
        "task_links": [
            {
                "uuid": link_uuid,
                "task_uuid": task_uuid,
                "url": "https://example.invalid/smoke",
                "label": f"{unique_prefix}_link",
                "sort_order": 1,
                "updated_at": iso_timestamp(),
                "is_deleted": False,
            }
        ],
    }

    push_result = _push(api_client, changes)
    assert push_result["accepted"] == 6
    assert push_result["conflicts"] == []

    pulled = _pull_all(api_client)
    categories = _rows_by_uuid(pulled, "task_categories")
    statuses = _rows_by_uuid(pulled, "task_statuses")
    tasks = _rows_by_uuid(pulled, "tasks")
    checkboxes = _rows_by_uuid(pulled, "task_checkboxes")
    links = _rows_by_uuid(pulled, "task_links")

    assert categories[category_uuid]["name"] == f"{unique_prefix}_category"
    assert statuses[status_uuid]["name"] == f"{unique_prefix}_status"
    assert tasks[task_uuid]["category_uuid"] == category_uuid
    assert tasks[task_uuid]["status_uuid"] == status_uuid
    assert checkboxes[parent_checkbox_uuid]["task_uuid"] == task_uuid
    assert checkboxes[parent_checkbox_uuid]["parent_uuid"] is None
    assert checkboxes[child_checkbox_uuid]["task_uuid"] == task_uuid
    assert checkboxes[child_checkbox_uuid]["parent_uuid"] == parent_checkbox_uuid
    assert links[link_uuid]["task_uuid"] == task_uuid

    delete_result = _push(
        api_client,
        {
            "tasks": [
                {
                    "uuid": task_uuid,
                    "updated_at": iso_timestamp(10),
                    "is_deleted": True,
                }
            ]
        },
    )
    assert delete_result["accepted"] == 1
    assert delete_result["conflicts"] == []

    pulled_after_delete = _pull_all(api_client)
    deleted_task = _rows_by_uuid(pulled_after_delete, "tasks")[task_uuid]
    assert deleted_task["is_deleted"] is True


def test_tasks_sync_contract_uses_last_write_wins(
    api_client,
    iso_timestamp,
    unique_prefix,
    uuid_factory,
):
    task_uuid = uuid_factory()

    _push(
        api_client,
        {
            "tasks": [
                {
                    "uuid": task_uuid,
                    "title": f"{unique_prefix}_initial",
                    "notes_md": "",
                    "sort_order": 1,
                    "updated_at": iso_timestamp(),
                    "is_deleted": False,
                }
            ]
        },
    )

    newer = _push(
        api_client,
        {
            "tasks": [
                {
                    "uuid": task_uuid,
                    "title": f"{unique_prefix}_newer",
                    "updated_at": iso_timestamp(20),
                    "is_deleted": False,
                }
            ]
        },
    )
    assert newer["accepted"] == 1

    older = _push(
        api_client,
        {
            "tasks": [
                {
                    "uuid": task_uuid,
                    "title": f"{unique_prefix}_older",
                    "updated_at": iso_timestamp(5),
                    "is_deleted": False,
                }
            ]
        },
    )
    assert older["accepted"] == 0
    assert older["conflicts"]
    assert older["conflicts"][0]["uuid"] == task_uuid
    assert older["conflicts"][0]["resolution"] == "server_wins"

    pulled = _pull_all(api_client)
    task = _rows_by_uuid(pulled, "tasks")[task_uuid]
    assert task["title"] == f"{unique_prefix}_newer"
```

- [x] **Step 2: Verify syntax**

Run:

```bash
python3 -m py_compile tests/post_release/test_tasks_sync_contract.py
```

Expected: command exits 0.

## Task 4: Add release manifest smoke

**Files:**
- Create: `tests/post_release/test_release_manifests.py`

- [x] **Step 1: Add manifest tests**

Create `tests/post_release/test_release_manifests.py` with:

```python
import pytest


NATIVE_ASSET_SUFFIXES = (
    ".dmg",
    ".exe",
    ".msi",
    ".AppImage",
    ".nsis.zip",
)


def _asset_by_name(release, name):
    for asset in release.get("assets", []):
        if asset.get("name") == name:
            return asset
    return None


def test_desktop_release_manifest_assets(smoke_config, public_http, github_release_url):
    if not smoke_config.desktop_tag:
        pytest.skip("POST_RELEASE_DESKTOP_TAG is required for desktop release smoke")

    status, release = public_http.request_json(
        "GET",
        github_release_url(smoke_config.github_repo, smoke_config.desktop_tag),
    )
    assert status == 200, release

    assets = release.get("assets", [])
    asset_names = [asset.get("name", "") for asset in assets]
    assert "frontend-version.json" in asset_names
    assert "latest.json" in asset_names

    if smoke_config.desktop_tag.startswith("v"):
        assert any(name.endswith(NATIVE_ASSET_SUFFIXES) for name in asset_names), asset_names

    frontend_asset = _asset_by_name(release, "frontend-version.json")
    assert frontend_asset and frontend_asset.get("browser_download_url")

    status, manifest = public_http.request_json("GET", frontend_asset["browser_download_url"])
    assert status == 200, manifest
    assert manifest.get("version")
    assert manifest.get("url")


def test_mobile_ota_manifest(smoke_config, public_http):
    if not smoke_config.mobile_version:
        pytest.skip("POST_RELEASE_MOBILE_VERSION is required for mobile OTA smoke")

    status, manifest = public_http.request_json("GET", smoke_config.mobile_manifest_url)
    assert status == 200, manifest
    assert manifest.get("version") == smoke_config.mobile_version

    bundle_url = manifest.get("bundle_url")
    assert bundle_url

    bundle_status = public_http.head_or_get_status(bundle_url)
    assert bundle_status in {200, 206}
```

- [x] **Step 2: Verify syntax**

Run:

```bash
python3 -m py_compile tests/post_release/test_release_manifests.py
```

Expected: command exits 0.

## Task 5: Run local verification

**Files:**
- Read: `tests/post_release/*.py`

- [x] **Step 1: Compile all smoke files**

Run:

```bash
python3 -m py_compile tests/post_release/conftest.py tests/post_release/test_api_health.py tests/post_release/test_tasks_sync_contract.py tests/post_release/test_release_manifests.py
```

Expected: command exits 0.

- [x] **Step 2: Run pytest without post-release env**

Run:

```bash
pytest tests/post_release -q
```

Expected: tests skip cleanly when required env vars are absent. This validates
collection and skip behavior without needing deployed release credentials.

- [ ] **Step 3: Run full smoke when release environment is available**

Run after API deploy, desktop tag, and mobile OTA release:

```bash
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api \
POST_RELEASE_REGISTER_USER=1 \
POST_RELEASE_DESKTOP_TAG=v1.3.28 \
POST_RELEASE_MOBILE_VERSION=1.0.6 \
bash tests/post_release/run.sh -q
```

Expected: all tests pass, with no skips in a fully configured post-release run.

## Task 6: Add persistent venv runner

**Files:**
- Modify: `.gitignore`
- Create: `tests/post_release/run.sh`

- [x] **Step 1: Ignore the persistent smoke venv**

Add this line to `.gitignore`:

```gitignore
tests/post_release/.venv/
```

- [x] **Step 2: Add runner script**

Create `tests/post_release/run.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
VENV_DIR="${POST_RELEASE_SMOKE_VENV:-${SCRIPT_DIR}/.venv}"
PYTHON_BIN="${PYTHON:-python3}"
REQUIREMENTS_FILE="${SCRIPT_DIR}/requirements.txt"
STAMP_FILE="${VENV_DIR}/.requirements.sha256"

if [ ! -x "${VENV_DIR}/bin/python" ]; then
  "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi

requirements_hash="$(sha256sum "${REQUIREMENTS_FILE}" | cut -d ' ' -f 1)"
installed_hash=""
if [ -f "${STAMP_FILE}" ]; then
  installed_hash="$(cat "${STAMP_FILE}")"
fi

if [ "${POST_RELEASE_SMOKE_REINSTALL:-0}" = "1" ] || [ "${installed_hash}" != "${requirements_hash}" ]; then
  "${VENV_DIR}/bin/python" -m pip install -r "${REQUIREMENTS_FILE}"
  printf '%s\n' "${requirements_hash}" > "${STAMP_FILE}"
fi

pytest_args=("$@")
has_test_path=0
for arg in "$@"; do
  if [[ "${arg}" != -* ]]; then
    has_test_path=1
    break
  fi
done

if [ "${has_test_path}" -eq 0 ]; then
  pytest_args=("tests/post_release" "${pytest_args[@]}")
fi

cd "${REPO_ROOT}"
exec "${VENV_DIR}/bin/python" -m pytest "${pytest_args[@]}"
```

- [x] **Step 3: Verify runner in configuration-validation mode**

Run:

```bash
bash tests/post_release/run.sh -q -rs
```

Expected: tests are collected and skipped cleanly when post-release env vars
are absent.

## Self-Review

- Spec coverage: API health, Tasks sync contract, UUID relationships, soft
  delete, conflict handling, desktop manifest, mobile OTA manifest, and no UI
  E2E are covered by tasks.
- Placeholder scan: no placeholder markers are intentionally left.
- Scope: existing test systems remain untouched; pytest is added only under
  `tests/post_release/`.
