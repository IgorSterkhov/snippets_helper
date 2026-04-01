"""Sync engine: background synchronization with the API server."""
import logging
from datetime import datetime
from threading import Thread
from typing import Optional, Callable
from shared.sync_schema import SYNCED_TABLES
from sync.client import SyncClient

logger = logging.getLogger(__name__)


class SyncEngine:
    """Manages background sync between local DuckDB and remote API.

    Usage:
        engine = SyncEngine(db, root, api_url, api_key, computer_id)
        engine.start()   # begin periodic sync
        engine.stop()    # stop sync (on app exit)
        engine.trigger()  # manual sync now
    """

    def __init__(self, db, root, api_url: str, api_key: str,
                 computer_id: str, interval_ms: int = 60_000):
        self.db = db
        self.root = root
        self.client = SyncClient(api_url, api_key)
        self.computer_id = computer_id
        self.interval_ms = interval_ms
        self.running = False
        self.sync_in_progress = False
        self._schedule_id = None
        self._status_callback: Optional[Callable] = None

    def set_status_callback(self, callback: Callable[[str, str], None]):
        """Set callback for sync status updates: callback(status, detail)."""
        self._status_callback = callback

    def start(self):
        """Start periodic sync."""
        self.running = True
        self._schedule_next()

    def stop(self):
        """Stop periodic sync."""
        self.running = False
        if self._schedule_id:
            try:
                self.root.after_cancel(self._schedule_id)
            except Exception:
                pass
            self._schedule_id = None

    def trigger(self):
        """Trigger immediate sync (from UI button)."""
        if not self.sync_in_progress:
            Thread(target=self._do_sync, daemon=True).start()

    def _schedule_next(self):
        if self.running:
            self._schedule_id = self.root.after(self.interval_ms, self._on_timer)

    def _on_timer(self):
        if not self.sync_in_progress:
            Thread(target=self._do_sync, daemon=True).start()
        self._schedule_next()

    def _do_sync(self):
        self.sync_in_progress = True
        self._notify("syncing")
        try:
            self._push()
            self._pull()
            self._notify("ok", f"Last sync: {datetime.now().strftime('%H:%M:%S')}")
        except ConnectionError:
            self._notify("offline", "Server unreachable")
        except Exception as e:
            logger.exception("Sync error")
            self._notify("error", str(e)[:100])
        finally:
            self.sync_in_progress = False

    def _push(self):
        """Push all pending local changes to server."""
        changes = {}
        deleted_uuids = {}  # track for purge after successful push

        for table_name in SYNCED_TABLES:
            pending = self.db.get_pending_changes(table_name)
            if not pending:
                continue

            rows_to_push = []
            table_deleted_uuids = []
            for row in pending:
                row_data = {k: _serialize(v) for k, v in row.items() if k != 'sync_status'}
                if row.get('sync_status') == 'deleted':
                    row_data['is_deleted'] = True
                    table_deleted_uuids.append(row['uuid'])
                else:
                    row_data['is_deleted'] = False
                rows_to_push.append(row_data)

            if rows_to_push:
                changes[table_name] = rows_to_push
                if table_deleted_uuids:
                    deleted_uuids[table_name] = table_deleted_uuids

        if not changes:
            return

        result = self.client.push(changes)

        # Mark successfully pushed rows as synced
        conflict_uuids = {c['uuid'] for c in result.get('conflicts', [])}
        for table_name, rows in changes.items():
            synced_uuids = [r['uuid'] for r in rows
                            if r['uuid'] not in conflict_uuids and not r.get('is_deleted')]
            self.db.mark_as_synced(table_name, synced_uuids)

            # Purge confirmed deletes
            if table_name in deleted_uuids:
                confirmed_deletes = [u for u in deleted_uuids[table_name]
                                     if u not in conflict_uuids]
                self.db.purge_deleted(table_name, confirmed_deletes)

    def _pull(self):
        """Pull changes from server and apply locally."""
        last_sync = self.db.get_app_setting(self.computer_id, 'last_sync_at')

        result = self.client.pull(last_sync)

        for table_name, rows in result.get('changes', {}).items():
            if table_name in SYNCED_TABLES and rows:
                self.db.upsert_from_server(table_name, rows)

        # Update last sync timestamp
        server_time = result.get('server_time')
        if server_time:
            self.db.save_app_setting(self.computer_id, 'last_sync_at', server_time)

    def _notify(self, status: str, detail: str = ""):
        """Thread-safe UI notification via root.after."""
        if self._status_callback:
            try:
                self.root.after(0, lambda: self._status_callback(status, detail))
            except Exception:
                pass


def _serialize(value):
    """Convert value to JSON-serializable format."""
    if isinstance(value, datetime):
        return value.isoformat()
    return value
