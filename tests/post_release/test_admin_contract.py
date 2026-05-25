def test_admin_me_available_for_authenticated_user(api_client):
    status, data = api_client.request_json("GET", "/v1/admin/me")
    assert status == 200, data
    assert data["is_admin"] is False
    assert data["media_quota_bytes"] >= data["media_max_upload_bytes"] > 0


def test_non_admin_cannot_list_users(api_client):
    status, data = api_client.request_json("GET", "/v1/admin/users")
    assert status == 403, data
