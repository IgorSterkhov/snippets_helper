"""Sync engine: background synchronization with the API server."""
import logging
import time
import threading
from datetime import datetime, timezone
from typing import Optional, Callable
from shared.sync_schema import SYNCED_TABLES
from sync.client import SyncClient

logger = logging.getLogger(__name__)


class SyncEngine:
    """Background sync between local DuckDB and remote API.

    Simple loop: push pending -> pull new -> sleep.
    """

    def __init__(self, db, client: SyncClient, computer_id: str,
                 interval: int = 60, on_status: Optional[Callable] = None):
        """
        Args:
            db: Database instance (thread-safe via Lock)
            client: SyncClient instance
            computer_id: unique identifier for this device
            interval: sync interval in seconds
            on_status: callback(status: str, detail: str) for UI updates
        """
        self.db = db
        self.client = client
        self.computer_id = computer_id
        self.interval = interval
        self.on_status = on_status
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        """Start background sync loop."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info("Sync engine started (interval=%ds)", self.interval)

    def stop(self):
        """Stop background sync loop."""
        self._running = False
        logger.info("Sync engine stopped")

    def _loop(self):
        """Main sync loop. Runs in daemon thread."""
        while self._running:
            self._do_sync()
            # Interruptible sleep: check _running every second
            for _ in range(self.interval):
                if not self._running:
                    return
                time.sleep(1)

    def _do_sync(self):
        """Execute one sync cycle: push then pull."""
        self._notify("syncing", "")
        try:
            self._push()
            self._pull()
            now = datetime.now(timezone.utc).strftime('%H:%M:%S UTC')
            self._notify("ok", f"Last sync: {now}")
        except Exception as e:
            logger.exception("Sync error")
            self._notify("error", str(e)[:100])

    def _push(self):
        """Push all pending local changes to server."""
        changes = {}
        deleted_uuids = {}

        for table_name in SYNCED_TABLES:
            pending = self.db.get_pending_changes(table_name)
            if not pending:
                continue

            rows_to_push = []
            table_deleted = []
            for row in pending:
                row_data = {k: v for k, v in row.items() if k != 'sync_status'}

                if row.get('sync_status') == 'deleted':
                    row_data['is_deleted'] = True
                    table_deleted.append(row['uuid'])
                else:
                    row_data['is_deleted'] = False

                # Resolve folder_id -> folder_uuid for notes
                if table_name == 'notes' and row_data.get('folder_id') is not None:
                    folder_uuid = self.db.get_folder_uuid_by_id(row_data['folder_id'])
                    row_data['folder_uuid'] = folder_uuid

                rows_to_push.append(row_data)

            if rows_to_push:
                changes[table_name] = rows_to_push
                if table_deleted:
                    deleted_uuids[table_name] = table_deleted

        if not changes:
            return

        result = self.client.push(changes)

        # Validate response
        if not isinstance(result, dict):
            logger.error("Push returned invalid response: %s", type(result))
            return

        conflict_uuids = set()
        for c in result.get('conflicts', []):
            if isinstance(c, dict) and 'uuid' in c:
                conflict_uuids.add(c['uuid'])

        # Mark synced (with race guard: only if updated_at unchanged)
        for table_name, rows in changes.items():
            synced = [
                (r['uuid'], r.get('updated_at'))
                for r in rows
                if r['uuid'] not in conflict_uuids and not r.get('is_deleted')
            ]
            self.db.mark_as_synced(table_name, synced)

            # Purge confirmed deletes
            if table_name in deleted_uuids:
                confirmed = [u for u in deleted_uuids[table_name]
                             if u not in conflict_uuids]
                self.db.purge_deleted(table_name, confirmed)

    def _pull(self):
        """Pull changes from server and apply locally."""
        last_sync = self.db.get_app_setting(self.computer_id, 'last_sync_at')

        result = self.client.pull(last_sync)

        if not isinstance(result, dict):
            logger.error("Pull returned invalid response: %s", type(result))
            return

        for table_name, rows in result.get('changes', {}).items():
            if table_name not in SYNCED_TABLES or not rows:
                continue

            # Resolve folder_uuid -> local folder_id for notes
            if table_name == 'notes':
                for row in rows:
                    if row.get('folder_uuid'):
                        row['folder_id'] = self.db.get_folder_id_by_uuid(
                            row['folder_uuid']
                        )
                    elif 'folder_id' not in row:
                        row['folder_id'] = None

            self.db.upsert_from_server(table_name, rows)

        # Update last sync timestamp only after successful pull
        server_time = result.get('server_time')
        if server_time:
            self.db.save_app_setting(
                self.computer_id, 'last_sync_at', server_time
            )

    def _notify(self, status: str, detail: str = ""):
        """Notify UI about sync status."""
        if self.on_status:
            try:
                self.on_status(status, detail)
            except Exception:
                pass
