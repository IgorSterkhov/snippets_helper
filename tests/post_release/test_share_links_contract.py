def _push(api_client, changes):
    status, data = api_client.request_json("POST", "/v1/sync/push", {"changes": changes})
    assert status == 200, data
    return data


def test_share_links_live_note_and_shortcut(
    smoke_config,
    api_client,
    public_http,
    iso_timestamp,
    unique_prefix,
    uuid_factory,
):
    note_uuid = uuid_factory()
    shortcut_uuid = uuid_factory()

    _push(
        api_client,
        {
            "notes": [
                {
                    "uuid": note_uuid,
                    "title": f"{unique_prefix}_note_v1",
                    "content": "note content v1",
                    "updated_at": iso_timestamp(),
                    "is_deleted": False,
                }
            ],
            "shortcuts": [
                {
                    "uuid": shortcut_uuid,
                    "name": f"{unique_prefix}_snippet_v1",
                    "value": "snippet value v1",
                    "description": "snippet description",
                    "links": '[{"label":"Docs","url":"https://example.com"}]',
                    "obsidian_note": "must not leak",
                    "updated_at": iso_timestamp(),
                    "is_deleted": False,
                }
            ],
        },
    )

    status, note_link = api_client.request_json(
        "POST",
        "/v1/share-links",
        {"item_type": "note", "item_uuid": note_uuid},
    )
    assert status == 200, note_link
    status, snippet_link = api_client.request_json(
        "POST",
        "/v1/share-links",
        {"item_type": "shortcut", "item_uuid": shortcut_uuid},
    )
    assert status == 200, snippet_link

    status, public_note = public_http.request_json(
        "GET",
        f"{smoke_config.api_base_url}/v1/public/share/{note_link['token']}",
        timeout=30,
    )
    assert status == 200, public_note
    assert public_note == {
        "type": "note",
        "title": f"{unique_prefix}_note_v1",
        "content": "note content v1",
    }

    status, public_snippet = public_http.request_json(
        "GET",
        f"{smoke_config.api_base_url}/v1/public/share/{snippet_link['token']}",
        timeout=30,
    )
    assert status == 200, public_snippet
    assert public_snippet["name"] == f"{unique_prefix}_snippet_v1"
    assert public_snippet["value"] == "snippet value v1"
    assert public_snippet["description"] == "snippet description"
    assert public_snippet["links"] == [{"label": "Docs", "url": "https://example.com"}]
    assert "obsidian_note" not in public_snippet

    _push(
        api_client,
        {
            "notes": [
                {
                    "uuid": note_uuid,
                    "title": f"{unique_prefix}_note_v2",
                    "content": "note content v2",
                    "updated_at": iso_timestamp(20),
                    "is_deleted": False,
                }
            ],
            "shortcuts": [
                {
                    "uuid": shortcut_uuid,
                    "name": f"{unique_prefix}_snippet_v2",
                    "value": "snippet value v2",
                    "description": "snippet description v2",
                    "links": '[{"label":"Docs 2","url":"https://example.com/2"}]',
                    "updated_at": iso_timestamp(20),
                    "is_deleted": False,
                }
            ],
        },
    )

    status, public_note_v2 = public_http.request_json(
        "GET",
        f"{smoke_config.api_base_url}/v1/public/share/{note_link['token']}",
    )
    assert status == 200, public_note_v2
    assert public_note_v2["title"] == f"{unique_prefix}_note_v2"
    assert public_note_v2["content"] == "note content v2"

    status, public_snippet_v2 = public_http.request_json(
        "GET",
        f"{smoke_config.api_base_url}/v1/public/share/{snippet_link['token']}",
    )
    assert status == 200, public_snippet_v2
    assert public_snippet_v2["name"] == f"{unique_prefix}_snippet_v2"
    assert public_snippet_v2["value"] == "snippet value v2"

    status, _ = api_client.request_json("DELETE", f"/v1/share-links/{note_link['token']}")
    assert status == 200
    status, revoked_note = public_http.request_json(
        "GET",
        f"{smoke_config.api_base_url}/v1/public/share/{note_link['token']}",
    )
    assert status == 404, revoked_note

    status, _ = api_client.request_json("DELETE", f"/v1/share-links/{snippet_link['token']}")
    assert status == 200
    status, revoked_snippet = public_http.request_json(
        "GET",
        f"{smoke_config.api_base_url}/v1/public/share/{snippet_link['token']}",
    )
    assert status == 404, revoked_snippet
