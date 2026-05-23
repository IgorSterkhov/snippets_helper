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
