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
