# Sync Client: Audit + Fixes + Settings UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all bugs in the desktop client sync layer and add full Settings UI for sync configuration.

**Architecture:** Offline-first sync (DuckDB ↔ PostgreSQL via REST API). Daemon thread pushes pending changes and pulls new ones on a timer. Last-write-wins by `updated_at` in UTC. Settings stored in `app_settings` table with `.env` fallback.

**Tech Stack:** Python 3.11, DuckDB, Tkinter/ttk, requests, threading

**Spec:** `.workflow/specs/sync_client_audit.md`

---

### Task 1: Fix `shared/sync_schema.py`

**Files:**
- Modify: `shared/sync_schema.py`

- [ ] **Step 1: Update sync_schema.py**

Remove `fk_uuid_map` from notes (broken, references non-existent field). Add missing `is_pinned` to notes `data_fields`. Add `created_at` to obfuscation_mappings. Remove `updated_at` from notes data_fields (it's in SYNC_FIELDS, would be duplicated).

```python
"""
Definition of syncable tables and their data fields.
Used by both client (sync engine) and server (API) to ensure consistency.
"""

# Fields added to every synced table in local DuckDB
SYNC_FIELDS = ['uuid', 'updated_at', 'sync_status', 'user_id']

# Syncable tables and their original data fields (excluding sync fields)
SYNCED_TABLES = {
    'shortcuts': {
        'data_fields': ['id', 'name', 'value', 'description'],
        'pk': 'id',
    },
    'sql_table_analyzer_templates': {
        'data_fields': ['id', 'template_text'],
        'pk': 'id',
    },
    'sql_macrosing_templates': {
        'data_fields': ['id', 'template_name', 'template_text', 'placeholders_config',
                        'combination_mode', 'separator'],
        'pk': 'id',
    },
    'note_folders': {
        'data_fields': ['id', 'name', 'sort_order'],
        'pk': 'id',
    },
    'notes': {
        'data_fields': ['id', 'folder_id', 'title', 'content', 'created_at',
                        'is_pinned'],
        'pk': 'id',
    },
    'obfuscation_mappings': {
        'data_fields': ['id', 'session_name', 'entity_type', 'original_value',
                        'obfuscated_value', 'created_at'],
        'pk': 'id',
    },
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/sync_schema.py
git commit -m "fix sync_schema: remove broken fk_uuid_map, fix data_fields"
```

---

### Task 2: Fix `sync/migration.py`

**Files:**
- Modify: `sync/migration.py`

- [ ] **Step 1: Fix backfill sync_status and updated_at**

Change `_backfill_sync_status` to set `'pending'` (existing rows were never synced).
Change `_add_column_if_missing` for sync_status default to `'pending'` instead of `'synced'`.
Use Python UTC datetime for updated_at backfill instead of DuckDB `CURRENT_TIMESTAMP`.

```python
"""
Idempotent DuckDB migration: adds sync fields (uuid, updated_at, sync_status, user_id)
to all syncable tables. Safe to run multiple times.
"""
import uuid as uuid_mod
from datetime import datetime, timezone
import duckdb
from shared.sync_schema import SYNCED_TABLES


def _utc_now() -> str:
    """Return current UTC time as ISO string."""
    return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')


def _column_exists(conn, table: str, column: str) -> bool:
    """Check if a column exists in a DuckDB table."""
    try:
        conn.execute(f"SELECT {column} FROM {table} LIMIT 0")
        return True
    except Exception:
        return False


def _add_column_if_missing(conn, table: str, column: str, col_type: str, default=None):
    """Add a column to a table if it doesn't exist."""
    if _column_exists(conn, table, column):
        return False
    default_clause = f" DEFAULT {default}" if default is not None else ""
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}{default_clause}")
    return True


def _backfill_uuids(conn, table: str):
    """Generate UUIDs for rows that don't have one."""
    rows = conn.execute(
        f"SELECT rowid FROM {table} WHERE uuid IS NULL"
    ).fetchall()
    for (rid,) in rows:
        conn.execute(
            f"UPDATE {table} SET uuid = ? WHERE rowid = ?",
            (str(uuid_mod.uuid4()), rid)
        )


def _backfill_sync_status(conn, table: str):
    """Set sync_status='pending' for rows without a status."""
    conn.execute(
        f"UPDATE {table} SET sync_status = 'pending' WHERE sync_status IS NULL"
    )


def _backfill_updated_at(conn, table: str):
    """Set updated_at to current UTC time for rows that don't have it."""
    now = _utc_now()
    conn.execute(
        f"UPDATE {table} SET updated_at = ? WHERE updated_at IS NULL",
        (now,)
    )


def run_migration(db_path: str):
    """Run sync migration on all syncable tables. Idempotent."""
    conn = duckdb.connect(db_path)
    try:
        for table in SYNCED_TABLES:
            # Check table exists
            try:
                conn.execute(f"SELECT 1 FROM {table} LIMIT 0")
            except Exception:
                continue  # Table not created yet, skip

            # Add sync columns
            _add_column_if_missing(conn, table, 'uuid', 'VARCHAR')
            _add_column_if_missing(conn, table, 'sync_status', 'VARCHAR', "'pending'")
            _add_column_if_missing(conn, table, 'user_id', 'VARCHAR')
            _add_column_if_missing(conn, table, 'updated_at', 'TIMESTAMP')

            # Backfill existing rows
            _backfill_uuids(conn, table)
            _backfill_sync_status(conn, table)
            _backfill_updated_at(conn, table)
    finally:
        conn.close()
```

Key changes:
- `_backfill_uuids`: uses `rowid` instead of `id` (more reliable if id is NULL)
- `_backfill_updated_at`: uses Python UTC datetime instead of DuckDB `CURRENT_TIMESTAMP`
- Default for sync_status: `'pending'` (new rows need sync, not `'synced'`)
- Default for updated_at: removed `CURRENT_TIMESTAMP` default (will always be set explicitly)

- [ ] **Step 2: Commit**

```bash
git add sync/migration.py
git commit -m "fix sync migration: UTC timestamps, pending default, rowid backfill"
```

---

### Task 3: Add UTC helper and fix `database.py` CRUD timestamps

**Files:**
- Modify: `database.py:1-8` (imports)
- Modify: `database.py` (all CRUD methods with `CURRENT_TIMESTAMP`)

- [ ] **Step 1: Add `_utc_now` helper and import**

Add `from datetime import datetime, timezone` to imports, add helper function after the class `_connect` method is not ideal — add it as a module-level function before the class:

At the top of `database.py`, after existing imports, add:

```python
from datetime import datetime, timezone


def _utc_now() -> str:
    """Return current UTC time as ISO string for DuckDB."""
    return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
```

- [ ] **Step 2: Replace CURRENT_TIMESTAMP in shortcuts CRUD**

`update_item` (line ~203):
```python
# Old:
    sync_status = 'pending', updated_at = CURRENT_TIMESTAMP
# New:
    sync_status = 'pending', updated_at = ?
# Add _utc_now() to params tuple
```

`create_item` (line ~212):
```python
# Old:
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending')
# New:
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
# Add _utc_now() to params
```

`delete_item` (line ~221):
```python
# Old:
    SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP
# New:
    SET sync_status = 'deleted', updated_at = ?
# Add _utc_now() to params
```

- [ ] **Step 3: Replace CURRENT_TIMESTAMP in sql_table_analyzer_templates CRUD**

`save_sql_table_analyzer_templates` — UPDATE (line ~262):
```python
# Old:
    SET template_text = ?, sync_status = 'pending',
        updated_at = CURRENT_TIMESTAMP
# New:
    SET template_text = ?, sync_status = 'pending',
        updated_at = ?
# Add _utc_now() to params: (template_text, _utc_now(), index)
```

`save_sql_table_analyzer_templates` — INSERT (line ~269):
```python
# Old:
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'pending')
# New:
    VALUES (?, ?, ?, ?, 'pending')
# Add _utc_now() to params
```

`save_sql_table_analyzer_templates` — DELETE (line ~277):
```python
# Old:
    SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP
# New:
    SET sync_status = 'deleted', updated_at = ?
# Add _utc_now() to params
```

- [ ] **Step 4: Replace CURRENT_TIMESTAMP in sql_macrosing_templates CRUD**

`save_sql_macrosing_template` — UPDATE (line ~416):
```python
# Old:
    sync_status = 'pending', updated_at = CURRENT_TIMESTAMP
# New:
    sync_status = 'pending', updated_at = ?
# Add _utc_now() before WHERE param: (..., _utc_now(), name)
```

`save_sql_macrosing_template` — INSERT (line ~426):
```python
# Old:
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending')
# New:
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
# Add _utc_now() to params
```

`delete_sql_macrosing_template` (line ~435):
```python
# Old:
    SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP
# New:
    SET sync_status = 'deleted', updated_at = ?
# Add _utc_now() to params
```

- [ ] **Step 5: Replace CURRENT_TIMESTAMP in note_folders CRUD**

`create_note_folder` (line ~462):
```python
# Old:
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending')
# New:
    VALUES (?, ?, ?, ?, ?, 'pending')
# Params: (new_id, name, sort_order, str(uuid_mod.uuid4()), _utc_now())
```

`update_note_folder` (line ~471):
```python
# Old:
    SET name = ?, sync_status = 'pending', updated_at = CURRENT_TIMESTAMP
# New:
    SET name = ?, sync_status = 'pending', updated_at = ?
# Params: (name, _utc_now(), folder_id)
```

`delete_note_folder` (line ~479-487):
```python
# Old (orphan notes):
    UPDATE notes SET folder_id = NULL, sync_status = 'pending',
        updated_at = CURRENT_TIMESTAMP
# New:
    UPDATE notes SET folder_id = NULL, sync_status = 'pending',
        updated_at = ?
# Params: (_utc_now(), folder_id)

# Old (soft-delete folder):
    SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP
# New:
    SET sync_status = 'deleted', updated_at = ?
# Params: (_utc_now(), folder_id)
```

- [ ] **Step 6: Replace CURRENT_TIMESTAMP in notes CRUD**

`create_note` (line ~540):
```python
# Old:
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, ?, 'pending')
# New:
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'pending')
# Params: (new_id, folder_id, title, content, _utc_now(), _utc_now(), str(uuid_mod.uuid4()))
```

`update_note` (line ~550):
```python
# Old:
    SET folder_id = ?, title = ?, content = ?, updated_at = CURRENT_TIMESTAMP,
# New:
    SET folder_id = ?, title = ?, content = ?, updated_at = ?,
# Params: (folder_id, title, content, _utc_now(), note_id)
```

`delete_note` (line ~559):
```python
# Old:
    SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP
# New:
    SET sync_status = 'deleted', updated_at = ?
# Params: (_utc_now(), note_id)
```

`toggle_note_pin` (line ~568):
```python
# Old:
    sync_status = 'pending', updated_at = CURRENT_TIMESTAMP
# New:
    sync_status = 'pending', updated_at = ?
# Params: (_utc_now(), note_id)
```

- [ ] **Step 7: Replace CURRENT_TIMESTAMP in obfuscation CRUD**

`save_obfuscation_mapping` (line ~657):
```python
# Old:
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending')
# New:
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
# Add _utc_now() to params
```

`delete_obfuscation_session` (line ~746):
```python
# Old:
    SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP
# New:
    SET sync_status = 'deleted', updated_at = ?
# Params: (_utc_now(), session_name)
```

- [ ] **Step 8: Commit**

```bash
git add database.py
git commit -m "fix database.py: UTC timestamps in all CRUD methods"
```

---

### Task 4: Fix `database.py` sync helpers

**Files:**
- Modify: `database.py:804-891` (sync helpers section)

- [ ] **Step 1: Fix `get_pending_changes` — add datetime serialization**

```python
def get_pending_changes(self, table_name: str) -> List[Dict]:
    """Get all rows with sync_status 'pending' or 'deleted' for a synced table."""
    from shared.sync_schema import SYNCED_TABLES
    if table_name not in SYNCED_TABLES:
        return []
    fields = SYNCED_TABLES[table_name]['data_fields'] + ['uuid', 'updated_at', 'sync_status']
    cols = ', '.join(fields)
    with self._connect() as conn:
        result = conn.execute(
            f"SELECT {cols} FROM {table_name} WHERE sync_status IN ('pending', 'deleted')"
        ).fetchall()
        rows = []
        for row in result:
            d = dict(zip(fields, row))
            # Serialize datetime to ISO string with UTC
            if d.get('updated_at') and hasattr(d['updated_at'], 'isoformat'):
                d['updated_at'] = d['updated_at'].isoformat()
            if d.get('created_at') and hasattr(d['created_at'], 'isoformat'):
                d['created_at'] = d['created_at'].isoformat()
            rows.append(d)
        return rows
```

- [ ] **Step 2: Fix `mark_as_synced` — add updated_at guard**

```python
def mark_as_synced(self, table_name: str, uuids_with_ts: List[tuple]):
    """Mark rows as synced after successful push.
    
    Args:
        uuids_with_ts: list of (uuid, updated_at) tuples.
            Only marks as synced if updated_at hasn't changed (race protection).
    """
    if not uuids_with_ts:
        return
    with self._connect() as conn:
        for uuid_val, updated_at in uuids_with_ts:
            conn.execute(
                f"UPDATE {table_name} SET sync_status = 'synced' "
                f"WHERE uuid = ? AND updated_at = ?",
                (uuid_val, updated_at)
            )
```

- [ ] **Step 3: Fix `upsert_from_server` — fix date comparison**

```python
def upsert_from_server(self, table_name: str, rows: List[Dict]):
    """Insert or update rows received from server during pull."""
    from shared.sync_schema import SYNCED_TABLES
    if table_name not in SYNCED_TABLES or not rows:
        return
    data_fields = SYNCED_TABLES[table_name]['data_fields']
    with self._connect() as conn:
        for row in rows:
            existing = conn.execute(
                f"SELECT sync_status, updated_at FROM {table_name} WHERE uuid = ?",
                (row['uuid'],)
            ).fetchone()

            if row.get('is_deleted'):
                if existing:
                    conn.execute(
                        f"DELETE FROM {table_name} WHERE uuid = ?",
                        (row['uuid'],)
                    )
                continue

            if existing:
                local_status = existing[0]
                local_updated = existing[1]
                # LWW: if local is pending and local is newer, skip
                if local_status == 'pending' and local_updated and row.get('updated_at'):
                    from datetime import datetime
                    local_dt = local_updated if isinstance(local_updated, datetime) else datetime.fromisoformat(str(local_updated))
                    server_dt = datetime.fromisoformat(row['updated_at']) if isinstance(row['updated_at'], str) else row['updated_at']
                    if local_dt > server_dt:
                        continue
                # Update from server
                set_parts = []
                values = []
                for f in data_fields:
                    if f in row:
                        set_parts.append(f"{f} = ?")
                        values.append(row[f])
                set_parts.append("sync_status = 'synced'")
                set_parts.append("updated_at = ?")
                values.append(row.get('updated_at'))
                values.append(row['uuid'])
                conn.execute(
                    f"UPDATE {table_name} SET {', '.join(set_parts)} WHERE uuid = ?",
                    values
                )
            else:
                # Insert new row from server
                max_id_result = conn.execute(
                    f"SELECT MAX(id) FROM {table_name}"
                ).fetchone()
                new_id = (max_id_result[0] or 0) + 1
                insert_fields = ['id', 'uuid', 'sync_status', 'updated_at']
                insert_values = [new_id, row['uuid'], 'synced', row.get('updated_at')]
                for f in data_fields:
                    if f != 'id' and f in row:
                        insert_fields.append(f)
                        insert_values.append(row[f])
                placeholders = ', '.join(['?'] * len(insert_fields))
                cols = ', '.join(insert_fields)
                conn.execute(
                    f"INSERT INTO {table_name} ({cols}) VALUES ({placeholders})",
                    insert_values
                )
```

- [ ] **Step 4: Add folder UUID resolution helpers**

Add these methods to the Database class, before the sync helpers section:

```python
def get_folder_uuid_by_id(self, folder_id: int) -> Optional[str]:
    """Get folder UUID by local folder_id (for sync push)."""
    if folder_id is None:
        return None
    with self._connect() as conn:
        result = conn.execute(
            "SELECT uuid FROM note_folders WHERE id = ?", (folder_id,)
        ).fetchone()
        return result[0] if result else None

def get_folder_id_by_uuid(self, folder_uuid: str) -> Optional[int]:
    """Get local folder_id by folder UUID (for sync pull)."""
    if not folder_uuid:
        return None
    with self._connect() as conn:
        result = conn.execute(
            "SELECT id FROM note_folders WHERE uuid = ? AND sync_status != 'deleted'",
            (folder_uuid,)
        ).fetchone()
        return result[0] if result else None
```

- [ ] **Step 5: Commit**

```bash
git add database.py
git commit -m "fix database.py sync helpers: date comparison, race guard, folder UUID"
```

---

### Task 5: Rewrite `sync/engine.py`

**Files:**
- Modify: `sync/engine.py` (full rewrite)

- [ ] **Step 1: Write new engine**

```python
"""Sync engine: background synchronization with the API server."""
import logging
import time
import threading
from datetime import datetime, timezone
from typing import Optional, Callable, List
from shared.sync_schema import SYNCED_TABLES
from sync.client import SyncClient

logger = logging.getLogger(__name__)


class SyncEngine:
    """Background sync between local DuckDB and remote API.

    Simple loop: push pending → pull new → sleep.
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

                # Resolve folder_id → folder_uuid for notes
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

            # Resolve folder_uuid → local folder_id for notes
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
```

Key changes from original:
- No dependency on `root` (Tkinter) — pure threading
- `on_status` callback called directly (caller wraps with `root.after` if needed)
- Constructor takes `SyncClient` instance instead of creating one
- `mark_as_synced` passes `(uuid, updated_at)` tuples for race guard
- Folder UUID resolution for notes during push/pull
- Response validation before accessing fields
- Interruptible sleep via 1-second chunks

- [ ] **Step 2: Commit**

```bash
git add sync/engine.py
git commit -m "rewrite sync engine: simple daemon loop, UTC, folder UUID resolution"
```

---

### Task 6: Fix `sync/client.py`

**Files:**
- Modify: `sync/client.py:29-37` (register method)

- [ ] **Step 1: Fix register() to skip auth header**

```python
def register(self, name: str) -> dict:
    """Register a new user. Returns {user_id, api_key, name}.
    
    Uses a separate request without Authorization header.
    """
    import requests as req
    r = req.post(
        f"{self.api_url}/v1/auth/register",
        json={"name": name},
        timeout=self.timeout,
        verify=self.session.verify,
    )
    r.raise_for_status()
    return r.json()
```

Note: uses `self.api_url` (consistent with other methods) and `self.session.verify` to inherit CA cert settings, but no auth header.

- [ ] **Step 2: Commit**

```bash
git add sync/client.py
git commit -m "fix client.py: register without auth header"
```

---

### Task 7: Update `main.py` — _init_sync and sync status

**Files:**
- Modify: `main.py:202-237` (_init_sync, _on_sync_status)

- [ ] **Step 1: Rewrite `_init_sync` to read from app_settings with .env fallback**

```python
def _init_sync(self):
    """Initialize sync engine from app_settings (with .env fallback)."""
    # Read settings: app_settings first, .env fallback
    sync_enabled = self.db.get_app_setting(self.app_computer_id, 'sync_enabled')
    if sync_enabled is None:
        sync_enabled = os.getenv('SYNC_ENABLED', '0')

    api_url = self.db.get_app_setting(self.app_computer_id, 'sync_api_url')
    if not api_url:
        api_url = os.getenv('SYNC_API_URL', '')

    api_key = self.db.get_app_setting(self.app_computer_id, 'sync_api_key')
    if not api_key:
        api_key = os.getenv('SYNC_API_KEY', '')

    if sync_enabled != '1' or not api_url or not api_key:
        return

    interval_str = self.db.get_app_setting(self.app_computer_id, 'sync_interval')
    if not interval_str:
        interval_str = os.getenv('SYNC_INTERVAL_SECONDS', '60')
    interval = int(interval_str)

    ca_cert = self.db.get_app_setting(self.app_computer_id, 'sync_ca_cert')
    if not ca_cert:
        ca_cert = os.getenv('SYNC_CA_CERT', '')
    if ca_cert:
        os.environ['SYNC_CA_CERT'] = ca_cert

    from sync.client import SyncClient
    from sync.engine import SyncEngine

    client = SyncClient(api_url, api_key)
    self.sync_engine = SyncEngine(
        db=self.db,
        client=client,
        computer_id=self.app_computer_id,
        interval=interval,
        on_status=lambda s, d: self.root.after(0, self._on_sync_status, s, d),
    )
    self.sync_engine.start()
```

- [ ] **Step 2: Update `_on_sync_status`**

Keep existing implementation — it works correctly:
```python
def _on_sync_status(self, status: str, detail: str = ""):
    """Handle sync status updates (called via root.after from sync thread)."""
    if hasattr(self, 'sync_status_label') and self.sync_status_label.winfo_exists():
        icons = {'ok': '\u2713', 'syncing': '\u21BB', 'offline': '\u2715', 'error': '\u26A0'}
        icon = icons.get(status, '')
        self.sync_status_label.config(text=f"Sync: {icon} {detail}")
```

- [ ] **Step 3: Commit**

```bash
git add main.py
git commit -m "rewrite _init_sync: read settings from DB with .env fallback"
```

---

### Task 8: Rewrite sync settings tab in `main.py`

**Files:**
- Modify: `main.py:2950-3082` (_build_settings_sync_tab, _sync_register, _sync_test, _sync_save_config)

- [ ] **Step 1: Rewrite `_build_settings_sync_tab`**

```python
def _build_settings_sync_tab(self, parent):
    """Build Sync settings tab with registration and config."""
    # Read current settings from DB with .env fallback
    def _get(key, env_key, default=''):
        val = self.db.get_app_setting(self.app_computer_id, key)
        return val if val else os.getenv(env_key, default)

    api_url = _get('sync_api_url', 'SYNC_API_URL')
    api_key = _get('sync_api_key', 'SYNC_API_KEY')
    sync_enabled = _get('sync_enabled', 'SYNC_ENABLED', '0')
    interval = _get('sync_interval', 'SYNC_INTERVAL_SECONDS', '60')
    ca_cert = _get('sync_ca_cert', 'SYNC_CA_CERT')

    # --- Server ---
    server_frame = ttk.LabelFrame(parent, text="Server")
    server_frame.pack(fill=tk.X, padx=10, pady=(10, 5))

    url_frame = ttk.Frame(server_frame)
    url_frame.pack(fill=tk.X, padx=10, pady=(10, 5))
    ttk.Label(url_frame, text="Server URL:").pack(side=tk.LEFT)
    self.sync_url_entry = ttk.Entry(url_frame, width=40)
    self.sync_url_entry.pack(side=tk.LEFT, padx=(10, 0), fill=tk.X, expand=True)
    self.sync_url_entry.insert(0, api_url)

    cert_frame = ttk.Frame(server_frame)
    cert_frame.pack(fill=tk.X, padx=10, pady=(0, 10))
    ttk.Label(cert_frame, text="CA Cert:").pack(side=tk.LEFT)
    self.sync_ca_cert_entry = ttk.Entry(cert_frame, width=35)
    self.sync_ca_cert_entry.pack(side=tk.LEFT, padx=(10, 0), fill=tk.X, expand=True)
    self.sync_ca_cert_entry.insert(0, ca_cert)
    ttk.Button(cert_frame, text="...", width=3,
               command=self._sync_browse_cert).pack(side=tk.LEFT, padx=(5, 0))

    # --- Registration ---
    reg_frame = ttk.LabelFrame(parent, text="Registration")
    reg_frame.pack(fill=tk.X, padx=10, pady=5)

    name_frame = ttk.Frame(reg_frame)
    name_frame.pack(fill=tk.X, padx=10, pady=(10, 5))
    ttk.Label(name_frame, text="Name:").pack(side=tk.LEFT)
    self.sync_name_entry = ttk.Entry(name_frame, width=40)
    self.sync_name_entry.pack(side=tk.LEFT, padx=(10, 0), fill=tk.X, expand=True)
    import getpass as gp
    self.sync_name_entry.insert(0, gp.getuser())

    reg_btn_frame = ttk.Frame(reg_frame)
    reg_btn_frame.pack(fill=tk.X, padx=10, pady=(0, 10))
    ttk.Button(reg_btn_frame, text="Register",
               command=self._sync_register).pack(side=tk.LEFT)

    # --- API Key ---
    key_frame = ttk.LabelFrame(parent, text="API Key")
    key_frame.pack(fill=tk.X, padx=10, pady=5)

    key_inner = ttk.Frame(key_frame)
    key_inner.pack(fill=tk.X, padx=10, pady=10)
    self.sync_key_entry = ttk.Entry(key_inner, width=50)
    self.sync_key_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
    self.sync_key_entry.insert(0, api_key)

    # --- Sync control ---
    ctrl_frame = ttk.LabelFrame(parent, text="Sync")
    ctrl_frame.pack(fill=tk.X, padx=10, pady=5)

    ctrl_inner = ttk.Frame(ctrl_frame)
    ctrl_inner.pack(fill=tk.X, padx=10, pady=10)

    self.sync_enabled_var = tk.BooleanVar(value=sync_enabled == '1')
    ttk.Checkbutton(ctrl_inner, text="Enable sync",
                    variable=self.sync_enabled_var).pack(side=tk.LEFT)

    ttk.Label(ctrl_inner, text="  Interval:").pack(side=tk.LEFT, padx=(20, 0))
    self.sync_interval_entry = ttk.Entry(ctrl_inner, width=5)
    self.sync_interval_entry.pack(side=tk.LEFT, padx=(5, 0))
    self.sync_interval_entry.insert(0, interval)
    ttk.Label(ctrl_inner, text="sec").pack(side=tk.LEFT, padx=(3, 0))

    # --- Status ---
    status_frame = ttk.LabelFrame(parent, text="Status")
    status_frame.pack(fill=tk.X, padx=10, pady=5)

    last_sync = self.db.get_app_setting(self.app_computer_id, 'last_sync_at')
    self.sync_settings_status = ttk.Label(
        status_frame,
        text=f"Last sync: {last_sync or 'never'}"
    )
    self.sync_settings_status.pack(anchor=tk.W, padx=10, pady=10)

    # --- Buttons ---
    btn_frame = ttk.Frame(parent)
    btn_frame.pack(fill=tk.X, padx=10, pady=(5, 10))
    ttk.Button(btn_frame, text="Test Connection",
               command=self._sync_test).pack(side=tk.LEFT, padx=(0, 5))
    ttk.Button(btn_frame, text="Save Settings",
               command=self._sync_save_config).pack(side=tk.LEFT)

    # Message label for feedback
    self.sync_msg_label = ttk.Label(parent, text="")
    self.sync_msg_label.pack(anchor=tk.W, padx=10, pady=(0, 5))
```

- [ ] **Step 2: Add cert browse helper**

```python
def _sync_browse_cert(self):
    """Browse for CA certificate file."""
    from tkinter import filedialog
    path = filedialog.askopenfilename(
        title="Select CA Certificate",
        filetypes=[("PEM files", "*.pem"), ("CRT files", "*.crt"), ("All files", "*.*")]
    )
    if path:
        self.sync_ca_cert_entry.delete(0, tk.END)
        self.sync_ca_cert_entry.insert(0, path)
```

- [ ] **Step 3: Rewrite `_sync_register`**

```python
def _sync_register(self):
    """Register a new user on the sync server."""
    url = self.sync_url_entry.get().strip()
    name = self.sync_name_entry.get().strip()
    if not url or not name:
        self.sync_msg_label.config(text="Fill in Server URL and Name")
        return
    try:
        from sync.client import SyncClient
        ca_cert = self.sync_ca_cert_entry.get().strip()
        if ca_cert:
            os.environ['SYNC_CA_CERT'] = ca_cert
        client = SyncClient(url, "")
        data = client.register(name)
        self.sync_key_entry.delete(0, tk.END)
        self.sync_key_entry.insert(0, data['api_key'])
        self.sync_msg_label.config(text=f"Registered! User ID: {data['user_id']}")
    except Exception as e:
        self.sync_msg_label.config(text=f"Error: {str(e)[:80]}")
```

- [ ] **Step 4: Keep `_sync_test` mostly unchanged**

```python
def _sync_test(self):
    """Test connection to sync server."""
    url = self.sync_url_entry.get().strip()
    api_key = self.sync_key_entry.get().strip()
    if not url or not api_key:
        self.sync_msg_label.config(text="Fill in Server URL and API Key")
        return
    try:
        ca_cert = self.sync_ca_cert_entry.get().strip()
        if ca_cert:
            os.environ['SYNC_CA_CERT'] = ca_cert
        from sync.client import SyncClient
        client = SyncClient(url, api_key)
        user_info = client.check_auth()
        if user_info:
            self.sync_msg_label.config(text=f"OK! User: {user_info.get('name', '?')}")
        else:
            self.sync_msg_label.config(text="Auth failed — invalid API key")
    except Exception as e:
        self.sync_msg_label.config(text=f"Error: {str(e)[:80]}")
```

- [ ] **Step 5: Rewrite `_sync_save_config` to save to app_settings DB**

```python
def _sync_save_config(self):
    """Save sync config to app_settings and restart sync engine."""
    url = self.sync_url_entry.get().strip()
    api_key = self.sync_key_entry.get().strip()
    enabled = '1' if self.sync_enabled_var.get() else '0'
    interval = self.sync_interval_entry.get().strip() or '60'
    ca_cert = self.sync_ca_cert_entry.get().strip()

    if enabled == '1' and (not url or not api_key):
        self.sync_msg_label.config(text="Fill in Server URL and API Key to enable sync")
        return

    # Save to app_settings DB
    cid = self.app_computer_id
    self.db.save_app_setting(cid, 'sync_api_url', url)
    self.db.save_app_setting(cid, 'sync_api_key', api_key)
    self.db.save_app_setting(cid, 'sync_enabled', enabled)
    self.db.save_app_setting(cid, 'sync_interval', interval)
    self.db.save_app_setting(cid, 'sync_ca_cert', ca_cert)

    # Set env vars for current session (for SyncClient CA cert)
    if ca_cert:
        os.environ['SYNC_CA_CERT'] = ca_cert

    # Restart sync engine
    if self.sync_engine:
        self.sync_engine.stop()
        self.sync_engine = None

    if enabled == '1':
        self._init_sync()
        self.sync_msg_label.config(text="Saved! Sync enabled.")
    else:
        self.sync_msg_label.config(text="Saved. Sync disabled.")
```

- [ ] **Step 6: Commit**

```bash
git add main.py
git commit -m "rewrite sync settings tab: DB storage, CA cert, interval, enable/disable"
```

---

### Task 9: Cleanup and remove dead Sync button from top bar

**Files:**
- Modify: `main.py:424-430` (top_frame sync button)

- [ ] **Step 1: Remove the standalone Sync button from top bar**

The sync status indicator stays, but the "Sync" trigger button is removed (sync is timer-only per spec).

Replace lines 424-430:
```python
# Sync status indicator
self.sync_status_label = ttk.Label(top_frame, text="")
self.sync_status_label.pack(side=tk.LEFT, padx=(0, 5))
```

Remove the old conditional block with `sync_btn`.

- [ ] **Step 2: Commit**

```bash
git add main.py
git commit -m "remove manual sync button from top bar (timer-only sync)"
```

---

### Task 10: Fix API route — register endpoint path

**Files:**
- Verify: `sync/client.py` register method uses `/v1/auth/register`
- Verify: `api/routes/auth.py` register endpoint path

The client's register method builds URL as `{api_url}/v1/auth/register`. The API URL in settings includes the base path (e.g., `https://109.172.85.124/snippets-api`). The nginx rewrites `/snippets-api/(.*)` → `/$1`. So the full path becomes `/v1/auth/register` which is correct (server has `prefix="/v1"` and route is `/auth/register`).

The `SyncClient` methods use `self.api_url` which is the base URL. But the health/push/pull methods use paths like `/health`, `/sync/push` — these DON'T include `/v1` prefix.

- [ ] **Step 1: Verify and fix client.py endpoint paths**

Check current paths in client.py:
- `health()`: `{api_url}/health` — should be `{api_url}/v1/health`
- `check_auth()`: `{api_url}/auth/me` — should be `{api_url}/v1/auth/me`
- `push()`: `{api_url}/sync/push` — should be `{api_url}/v1/sync/push`
- `pull()`: `{api_url}/sync/pull` — should be `{api_url}/v1/sync/pull`

Fix all paths in `sync/client.py`:

```python
def health(self) -> bool:
    try:
        r = self.session.get(f"{self.api_url}/v1/health", timeout=5)
        return r.status_code == 200
    except Exception:
        return False

def check_auth(self) -> Optional[dict]:
    try:
        r = self.session.get(f"{self.api_url}/v1/auth/me", timeout=self.timeout)
        if r.status_code == 200:
            return r.json()
        return None
    except Exception:
        return None

def push(self, changes: dict) -> dict:
    r = self.session.post(
        f"{self.api_url}/v1/sync/push",
        json={"changes": changes},
        timeout=self.timeout,
    )
    r.raise_for_status()
    return r.json()

def pull(self, last_sync_at: Optional[str] = None) -> dict:
    r = self.session.post(
        f"{self.api_url}/v1/sync/pull",
        json={"last_sync_at": last_sync_at},
        timeout=self.timeout,
    )
    r.raise_for_status()
    return r.json()
```

- [ ] **Step 2: Commit**

```bash
git add sync/client.py
git commit -m "fix client.py: add /v1 prefix to all API paths"
```

---

### Task 11: End-to-end verification

- [ ] **Step 1: Verify the migration runs without errors**

Start the app with `SYNC_ENABLED=0`. Check DuckDB tables have correct sync columns.

- [ ] **Step 2: Test registration flow**

1. Open Settings → Sync tab
2. Enter server URL: `https://109.172.85.124/snippets-api`
3. Enter CA cert path (if using self-signed)
4. Enter name, click Register
5. Verify API key appears in the field
6. Verify "Registered!" message

- [ ] **Step 3: Test sync enable**

1. Check "Enable sync", set interval to 30 sec
2. Click "Save Settings"
3. Verify sync status indicator shows "syncing" then "ok"

- [ ] **Step 4: Test data sync**

1. Create a shortcut on device A
2. Wait for sync
3. Check that shortcut appears on device B (or verify via API pull)

- [ ] **Step 5: Test conflict resolution (LWW)**

1. Create a note on device A, let it sync
2. Disconnect device B
3. Edit the note on device A, let it sync
4. Edit the same note on device B (locally)
5. Reconnect device B, let it sync
6. Verify the newer edit wins

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "sync client: audit fixes complete"
```
