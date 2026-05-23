def test_api_health_returns_ok(base_api_client):
    status, data = base_api_client.request_json("GET", "/v1/health")

    assert status == 200
    assert data == {"status": "ok"}
