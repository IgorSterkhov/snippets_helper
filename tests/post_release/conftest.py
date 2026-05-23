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
USER_AGENT = "snippets-helper-post-release-smoke/1.0"


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
        request_headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
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
        request = urllib.request.Request(
            url,
            method="HEAD",
            headers={"User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status
        except urllib.error.HTTPError as exc:
            if exc.code not in {403, 405}:
                return exc.code

        request = urllib.request.Request(
            url,
            method="GET",
            headers={"Range": "bytes=0-0", "User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status
        except urllib.error.HTTPError as exc:
            return exc.code


@pytest.fixture(scope="session")
def base_api_client(smoke_config: SmokeConfig) -> HttpClient:
    if not smoke_config.api_base_url:
        pytest.skip("POST_RELEASE_API_BASE_URL is required for API smoke tests")
    return HttpClient(smoke_config.api_base_url)


@pytest.fixture(scope="session")
def api_client(smoke_config: SmokeConfig, base_api_client: HttpClient) -> HttpClient:
    if smoke_config.api_key:
        return HttpClient(smoke_config.api_base_url, smoke_config.api_key)

    if not smoke_config.register_user:
        pytest.skip(
            "POST_RELEASE_API_KEY or POST_RELEASE_REGISTER_USER=1 is required "
            "for authenticated API smoke tests"
        )

    user_name = smoke_prefix()
    status, data = base_api_client.request_json(
        "POST",
        "/v1/auth/register",
        {"name": user_name},
    )
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
