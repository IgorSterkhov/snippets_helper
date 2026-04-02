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
