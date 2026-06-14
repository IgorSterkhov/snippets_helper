def _rows_by_uuid(changes, table):
    return {row["uuid"]: row for row in changes.get(table, [])}


def _push(api_client, changes):
    status, data = api_client.request_json("POST", "/v1/sync/push", {"changes": changes})
    assert status == 200, data
    assert data["status"] == "ok"
    return data


def _pull(api_client, last_sync_at=None):
    status, data = api_client.request_json("POST", "/v1/sync/pull", {"last_sync_at": last_sync_at})
    assert status == 200, data
    return data


def test_finance_sync_promotes_old_client_timestamps_past_pull_cursor(
    api_client,
    iso_timestamp,
    unique_prefix,
    uuid_factory,
):
    baseline = _pull(api_client)
    baseline_cursor = baseline["server_time"]
    old_client_timestamp = iso_timestamp(-120)
    plan_uuid = uuid_factory()
    item_uuid = uuid_factory()

    push_result = _push(
        api_client,
        {
            "finance_plans": [
                {
                    "uuid": plan_uuid,
                    "name": f"{unique_prefix}_regular",
                    "currency": "RUB",
                    "kind": "monthly",
                    "sort_order": 1,
                    "updated_at": old_client_timestamp,
                    "is_deleted": False,
                }
            ],
            "finance_items": [
                {
                    "uuid": item_uuid,
                    "plan_uuid": plan_uuid,
                    "parent_uuid": None,
                    "name": f"{unique_prefix}_subscriptions",
                    "amount_cents": 12345,
                    "due_day": 21,
                    "due_date": None,
                    "note": "",
                    "sort_order": 1,
                    "updated_at": old_client_timestamp,
                    "is_deleted": False,
                }
            ],
        },
    )
    assert push_result["accepted"] == 2
    assert push_result["conflicts"] == []

    pulled_after_cursor = _pull(api_client, baseline_cursor)["changes"]
    plans = _rows_by_uuid(pulled_after_cursor, "finance_plans")
    items = _rows_by_uuid(pulled_after_cursor, "finance_items")

    assert plans[plan_uuid]["name"] == f"{unique_prefix}_regular"
    assert items[item_uuid]["name"] == f"{unique_prefix}_subscriptions"
    assert items[item_uuid]["plan_uuid"] == plan_uuid
