import base64
import json
import time
import urllib.request


TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP8z8BQDwAFgwJ/luzAIwAAAABJRU5ErkJggg=="
)


def _multipart_upload(api_client, path, field_name, filename, content, content_type):
    boundary = "----snippets-helper-smoke"
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            (
                f'Content-Disposition: form-data; name="{field_name}"; '
                f'filename="{filename}"\r\n'
            ).encode(),
            f"Content-Type: {content_type}\r\n\r\n".encode(),
            content,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    headers = {
        "Accept": "application/json",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Authorization": f"Bearer {api_client.api_key}",
    }
    req = urllib.request.Request(
        api_client.url(path),
        data=body,
        method="POST",
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def test_media_upload_select_delete_contract(api_client):
    status, me = api_client.request_json("GET", "/v1/admin/me")
    assert status == 200, me
    assert me["media_quota_bytes"] >= me["media_max_upload_bytes"] > 0

    status, upload = _multipart_upload(
        api_client,
        "/v1/media/uploads",
        "file",
        "smoke.png",
        TINY_PNG,
        "image/png",
    )
    assert status == 200, upload
    job_id = upload["job_id"]

    job = None
    for _ in range(20):
        status, job = api_client.request_json("GET", f"/v1/media/jobs/{job_id}")
        assert status == 200, job
        if job["status"] in {"ready", "failed"}:
            break
        time.sleep(0.25)
    assert job["status"] == "ready", job
    assert job["asset_uuid"]
    assert {v["variant"] for v in job["variants"]} >= {"small", "balanced", "readable", "original"}

    status, selected = api_client.request_json(
        "POST",
        f"/v1/media/assets/{job['asset_uuid']}/select",
        {"variant": "balanced"},
    )
    assert status == 200, selected
    assert selected["markdown"].startswith("![smoke](")
    assert "/snippets-media/" in selected["url"]
    assert selected["url"].endswith(".webp")

    status, deleted = api_client.request_json(
        "DELETE",
        f"/v1/media/assets/{job['asset_uuid']}",
    )
    assert status == 200, deleted
    assert deleted["status"] == "ok"
