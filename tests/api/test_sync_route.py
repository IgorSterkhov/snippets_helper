from datetime import datetime

from api.routes.sync import (
    SYNC_PULL_CURSOR_SAFETY_SECONDS,
    _accepted_updated_at,
    _finance_allocation_conflict_resolution,
    _pull_server_time,
)


def test_accepted_updated_at_promotes_old_client_timestamp_to_push_time():
    client_updated = datetime(2026, 6, 14, 10, 0, 0)
    push_received_at = datetime(2026, 6, 14, 10, 5, 0)

    assert _accepted_updated_at(client_updated, push_received_at) == push_received_at


def test_accepted_updated_at_preserves_future_client_timestamp():
    client_updated = datetime(2026, 6, 14, 10, 10, 0)
    push_received_at = datetime(2026, 6, 14, 10, 5, 0)

    assert _accepted_updated_at(client_updated, push_received_at) == client_updated


def test_accepted_updated_at_uses_push_time_without_client_timestamp():
    push_received_at = datetime(2026, 6, 14, 10, 5, 0)

    assert _accepted_updated_at(None, push_received_at) == push_received_at


def test_pull_server_time_uses_safety_lookback():
    now = datetime(2026, 6, 14, 10, 5, 0)

    got = _pull_server_time(now)

    assert (now - got).total_seconds() == SYNC_PULL_CURSOR_SAFETY_SECONDS


class ExistingAllocation:
    uuid = "server-allocation"

    def __init__(self, updated_at):
        self.updated_at = updated_at


def test_finance_allocation_conflict_keeps_newer_server_assignment():
    existing = ExistingAllocation(datetime(2026, 6, 27, 12, 10, 0))
    incoming_updated = datetime(2026, 6, 27, 12, 0, 0)

    assert _finance_allocation_conflict_resolution(existing, "incoming-allocation", incoming_updated) == "server_wins"


def test_finance_allocation_conflict_allows_newer_incoming_assignment():
    existing = ExistingAllocation(datetime(2026, 6, 27, 12, 0, 0))
    incoming_updated = datetime(2026, 6, 27, 12, 10, 0)

    assert _finance_allocation_conflict_resolution(existing, "incoming-allocation", incoming_updated) == "incoming_wins"


def test_finance_allocation_conflict_accepts_same_allocation_uuid():
    existing = ExistingAllocation(datetime(2026, 6, 27, 12, 10, 0))

    assert _finance_allocation_conflict_resolution(existing, "server-allocation", datetime(2026, 6, 27, 12, 0, 0)) == "same_row"
