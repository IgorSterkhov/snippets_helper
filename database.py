import os
import threading
import uuid as uuid_mod
import duckdb
from contextlib import contextmanager
from dotenv import load_dotenv
from typing import Optional, List, Dict

class Database:
    def __init__(self):
        # Load environment variables
        load_dotenv()
        self.db_path = os.getenv('DUCKDB_PATH')
        if not self.db_path:
            raise ValueError("DUCKDB_PATH not found in .env file")

        self._lock = threading.Lock()

        # Ensure directory exists
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

        # Initialize database
        self._init_database()

        # Run sync migration
        from sync.migration import run_migration
        run_migration(self.db_path)

    @contextmanager
    def _connect(self):
        """Thread-safe DuckDB connection context manager."""
        with self._lock:
            conn = duckdb.connect(self.db_path)
            try:
                yield conn
            finally:
                conn.close()
    
    def _init_database(self):
        """Initialize the database and create tables if they don't exist."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS shortcuts (
                    id INTEGER PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    value TEXT NOT NULL,
                    description TEXT,
                    uuid VARCHAR,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    sync_status VARCHAR DEFAULT 'synced',
                    user_id VARCHAR
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sql_table_analyzer_templates (
                    id INTEGER PRIMARY KEY,
                    template_text TEXT NOT NULL,
                    uuid VARCHAR,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    sync_status VARCHAR DEFAULT 'synced',
                    user_id VARCHAR
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS superset_settings (
                    computer_id VARCHAR NOT NULL,
                    setting_key VARCHAR NOT NULL,
                    setting_value TEXT NOT NULL,
                    PRIMARY KEY (computer_id, setting_key)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    computer_id VARCHAR NOT NULL,
                    setting_key VARCHAR NOT NULL,
                    setting_value TEXT NOT NULL,
                    PRIMARY KEY (computer_id, setting_key)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS commit_tags (
                    id INTEGER PRIMARY KEY,
                    computer_id VARCHAR NOT NULL,
                    tag_name VARCHAR NOT NULL,
                    is_default INTEGER DEFAULT 0,
                    UNIQUE(computer_id, tag_name)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sql_macrosing_templates (
                    id INTEGER PRIMARY KEY,
                    template_name VARCHAR NOT NULL UNIQUE,
                    template_text TEXT NOT NULL,
                    placeholders_config TEXT NOT NULL,
                    combination_mode VARCHAR NOT NULL DEFAULT 'cartesian',
                    separator VARCHAR NOT NULL DEFAULT ';\\n',
                    uuid VARCHAR,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    sync_status VARCHAR DEFAULT 'synced',
                    user_id VARCHAR
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS note_folders (
                    id INTEGER PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    sort_order INTEGER DEFAULT 0,
                    uuid VARCHAR,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    sync_status VARCHAR DEFAULT 'synced',
                    user_id VARCHAR
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS notes (
                    id INTEGER PRIMARY KEY,
                    folder_id INTEGER,
                    title VARCHAR NOT NULL,
                    content TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_pinned INTEGER DEFAULT 0,
                    uuid VARCHAR,
                    sync_status VARCHAR DEFAULT 'synced',
                    user_id VARCHAR
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS commit_history (
                    id INTEGER PRIMARY KEY,
                    computer_id VARCHAR NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    task_link TEXT,
                    task_id VARCHAR,
                    commit_type VARCHAR,
                    object_category VARCHAR,
                    object_value VARCHAR,
                    message TEXT,
                    selected_tags TEXT,
                    mr_link TEXT,
                    test_report TEXT,
                    prod_report TEXT,
                    transfer_connect TEXT,
                    test_dag TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS obfuscation_mappings (
                    id INTEGER PRIMARY KEY,
                    session_name VARCHAR NOT NULL,
                    entity_type VARCHAR NOT NULL,
                    original_value VARCHAR NOT NULL,
                    obfuscated_value VARCHAR NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    uuid VARCHAR,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    sync_status VARCHAR DEFAULT 'synced',
                    user_id VARCHAR
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS exec_categories (
                    id INTEGER PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    sort_order INTEGER DEFAULT 0
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS exec_commands (
                    id INTEGER PRIMARY KEY,
                    category_id INTEGER NOT NULL,
                    name VARCHAR NOT NULL,
                    command TEXT NOT NULL,
                    description TEXT,
                    sort_order INTEGER DEFAULT 0,
                    hide_after_run INTEGER DEFAULT 0
                )
            """)
            # Migration: add hide_after_run column if it doesn't exist
            try:
                conn.execute("ALTER TABLE exec_commands ADD COLUMN hide_after_run INTEGER DEFAULT 0")
            except Exception:
                pass  # Column already exists
        finally:
            conn.close()
    
    def get_all_items(self):
        """Get all items from the database."""
        with self._connect() as conn:
            result = conn.execute(
                "SELECT id, name, value, description FROM shortcuts WHERE sync_status != 'deleted' ORDER BY id"
            ).fetchall()
            return [
                {'id': row[0], 'name': row[1], 'value': row[2], 'description': row[3]}
                for row in result
            ]
    
    def update_item(self, item):
        """Update a single item in the database."""
        with self._connect() as conn:
            conn.execute("""
                UPDATE shortcuts
                SET name = ?, value = ?, description = ?,
                    sync_status = 'pending', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (item['name'], item['value'], item.get('description', ''), item['id']))
    
    def create_item(self, item):
        """Create a new item in the database."""
        with self._connect() as conn:
            conn.execute("""
                INSERT INTO shortcuts (id, name, value, description, uuid, updated_at, sync_status)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending')
            """, (item['id'], item['name'], item['value'], item.get('description', ''),
                  str(uuid_mod.uuid4())))
    
    def delete_item(self, item_id):
        """Soft-delete an item from the database."""
        with self._connect() as conn:
            conn.execute("""
                UPDATE shortcuts SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (item_id,))
    
    def get_max_id(self):
        """Get the maximum ID from the database."""
        with self._connect() as conn:
            result = conn.execute("SELECT MAX(id) FROM shortcuts").fetchone()
            return result[0] if result[0] is not None else 0

    def get_sql_table_analyzer_templates(self):
        """Get all SQL Table Analyzer templates."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT template_text
                FROM sql_table_analyzer_templates
                WHERE sync_status != 'deleted'
                ORDER BY id
            """).fetchall()
            return [row[0] for row in result]

    def save_sql_table_analyzer_templates(self, templates):
        """Save SQL Table Analyzer templates using upsert + soft-delete."""
        with self._connect() as conn:
            existing = conn.execute("""
                SELECT id, template_text, uuid
                FROM sql_table_analyzer_templates
                WHERE sync_status != 'deleted'
                ORDER BY id
            """).fetchall()

            existing_by_id = {row[0]: {'text': row[1], 'uuid': row[2]} for row in existing}
            incoming_ids = set()

            for index, template_text in enumerate(templates, start=1):
                incoming_ids.add(index)
                if index in existing_by_id:
                    if existing_by_id[index]['text'] != template_text:
                        conn.execute("""
                            UPDATE sql_table_analyzer_templates
                            SET template_text = ?, sync_status = 'pending',
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        """, (template_text, index))
                else:
                    conn.execute("""
                        INSERT INTO sql_table_analyzer_templates
                            (id, template_text, uuid, updated_at, sync_status)
                        VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'pending')
                    """, (index, template_text, str(uuid_mod.uuid4())))

            # Soft-delete templates that are no longer in the list
            for old_id in existing_by_id:
                if old_id not in incoming_ids:
                    conn.execute("""
                        UPDATE sql_table_analyzer_templates
                        SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """, (old_id,))

    def get_superset_settings(self, computer_id):
        """Get Superset settings for a specific computer."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT setting_key, setting_value
                FROM superset_settings
                WHERE computer_id = ?
            """, (computer_id,)).fetchall()
            return {row[0]: row[1] for row in result}

    def upsert_superset_setting(self, computer_id, setting_key, setting_value):
        """Upsert a single Superset setting for a computer."""
        with self._connect() as conn:
            conn.execute("""
                INSERT INTO superset_settings (computer_id, setting_key, setting_value)
                VALUES (?, ?, ?)
                ON CONFLICT (computer_id, setting_key) DO UPDATE
                SET setting_value = excluded.setting_value
            """, (computer_id, setting_key, setting_value))

    def get_app_setting(self, computer_id, key):
        """Get a single app setting."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT setting_value
                FROM app_settings
                WHERE computer_id = ? AND setting_key = ?
            """, (computer_id, key)).fetchone()
            return result[0] if result else None

    def save_app_setting(self, computer_id, key, value):
        """Save a single app setting."""
        with self._connect() as conn:
            conn.execute("""
                INSERT INTO app_settings (computer_id, setting_key, setting_value)
                VALUES (?, ?, ?)
                ON CONFLICT (computer_id, setting_key) DO UPDATE
                SET setting_value = excluded.setting_value
            """, (computer_id, key, value))

    def get_all_app_settings(self, computer_id):
        """Get all app settings for a computer."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT setting_key, setting_value
                FROM app_settings
                WHERE computer_id = ?
            """, (computer_id,)).fetchall()
            return {row[0]: row[1] for row in result}

    def get_commit_tags(self, computer_id):
        """Get all commit tags for a computer."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT tag_name, is_default
                FROM commit_tags
                WHERE computer_id = ?
                ORDER BY id
            """, (computer_id,)).fetchall()
            return [{'tag_name': row[0], 'is_default': bool(row[1])} for row in result]

    def add_commit_tag(self, computer_id, tag_name, is_default=False):
        """Add a commit tag for a computer."""
        with self._connect() as conn:
            max_id_result = conn.execute("SELECT MAX(id) FROM commit_tags").fetchone()
            new_id = (max_id_result[0] or 0) + 1
            conn.execute("""
                INSERT INTO commit_tags (id, computer_id, tag_name, is_default)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (computer_id, tag_name) DO NOTHING
            """, (new_id, computer_id, tag_name, 1 if is_default else 0))

    def delete_commit_tag(self, computer_id, tag_name):
        """Delete a commit tag for a computer."""
        with self._connect() as conn:
            conn.execute("""
                DELETE FROM commit_tags
                WHERE computer_id = ? AND tag_name = ?
            """, (computer_id, tag_name))

    def init_default_commit_tags(self, computer_id):
        """Initialize default commit tags if none exist."""
        existing = self.get_commit_tags(computer_id)
        if not existing:
            default_tags = [
                "@dataops-dags",
                "@dataops-click",
                "@kravcov.artemiy @inchenko.ilona"
            ]
            for tag in default_tags:
                self.add_commit_tag(computer_id, tag, is_default=False)

    def get_sql_macrosing_templates(self) -> List[Dict]:
        """Get all SQL Macrosing templates."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT id, template_name, template_text, placeholders_config, combination_mode, separator
                FROM sql_macrosing_templates
                WHERE sync_status != 'deleted'
                ORDER BY template_name
            """).fetchall()
            return [
                {
                    'id': row[0], 'template_name': row[1], 'template_text': row[2],
                    'placeholders_config': row[3], 'combination_mode': row[4], 'separator': row[5]
                }
                for row in result
            ]

    def get_sql_macrosing_template_by_name(self, name: str) -> Optional[Dict]:
        """Get a SQL Macrosing template by name."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT id, template_name, template_text, placeholders_config, combination_mode, separator
                FROM sql_macrosing_templates
                WHERE template_name = ? AND sync_status != 'deleted'
            """, (name,)).fetchone()
            if result:
                return {
                    'id': result[0], 'template_name': result[1], 'template_text': result[2],
                    'placeholders_config': result[3], 'combination_mode': result[4], 'separator': result[5]
                }
            return None

    def save_sql_macrosing_template(self, name, template_text, placeholders_config, combination_mode, separator):
        """Save or update a SQL Macrosing template."""
        with self._connect() as conn:
            existing = conn.execute(
                "SELECT id FROM sql_macrosing_templates WHERE template_name = ? AND sync_status != 'deleted'",
                (name,)
            ).fetchone()
            if existing:
                conn.execute("""
                    UPDATE sql_macrosing_templates
                    SET template_text = ?, placeholders_config = ?, combination_mode = ?, separator = ?,
                        sync_status = 'pending', updated_at = CURRENT_TIMESTAMP
                    WHERE template_name = ?
                """, (template_text, placeholders_config, combination_mode, separator, name))
            else:
                max_id_result = conn.execute("SELECT MAX(id) FROM sql_macrosing_templates").fetchone()
                new_id = (max_id_result[0] or 0) + 1
                conn.execute("""
                    INSERT INTO sql_macrosing_templates
                        (id, template_name, template_text, placeholders_config, combination_mode, separator,
                         uuid, updated_at, sync_status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending')
                """, (new_id, name, template_text, placeholders_config, combination_mode, separator,
                      str(uuid_mod.uuid4())))

    def delete_sql_macrosing_template(self, name):
        """Soft-delete a SQL Macrosing template by name."""
        with self._connect() as conn:
            conn.execute("""
                UPDATE sql_macrosing_templates
                SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP
                WHERE template_name = ?
            """, (name,))

    # ==================== Note Folders ====================

    def get_all_note_folders(self) -> List[Dict]:
        """Get all note folders."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT id, name, sort_order
                FROM note_folders
                WHERE sync_status != 'deleted'
                ORDER BY sort_order, name
            """).fetchall()
            return [
                {'id': row[0], 'name': row[1], 'sort_order': row[2]}
                for row in result
            ]

    def create_note_folder(self, name: str, sort_order: int = 0) -> int:
        """Create a new note folder and return its id."""
        with self._connect() as conn:
            max_id_result = conn.execute("SELECT MAX(id) FROM note_folders").fetchone()
            new_id = (max_id_result[0] or 0) + 1
            conn.execute("""
                INSERT INTO note_folders (id, name, sort_order, uuid, updated_at, sync_status)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending')
            """, (new_id, name, sort_order, str(uuid_mod.uuid4())))
            return new_id

    def update_note_folder(self, folder_id: int, name: str):
        """Update a note folder name."""
        with self._connect() as conn:
            conn.execute("""
                UPDATE note_folders
                SET name = ?, sync_status = 'pending', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (name, folder_id))

    def delete_note_folder(self, folder_id: int):
        """Soft-delete a note folder. Notes in this folder will have folder_id set to NULL."""
        with self._connect() as conn:
            conn.execute("""
                UPDATE notes SET folder_id = NULL, sync_status = 'pending',
                    updated_at = CURRENT_TIMESTAMP
                WHERE folder_id = ?
            """, (folder_id,))
            conn.execute("""
                UPDATE note_folders
                SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (folder_id,))

    def init_default_note_folder(self):
        """Initialize default 'General' folder if no folders exist."""
        existing = self.get_all_note_folders()
        if not existing:
            self.create_note_folder("General", sort_order=0)

    # ==================== Notes ====================

    def _note_from_row(self, row) -> Dict:
        return {
            'id': row[0], 'folder_id': row[1], 'title': row[2], 'content': row[3],
            'created_at': row[4], 'updated_at': row[5], 'is_pinned': bool(row[6])
        }

    def get_all_notes(self) -> List[Dict]:
        """Get all notes."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT id, folder_id, title, content, created_at, updated_at, is_pinned
                FROM notes
                WHERE sync_status != 'deleted'
                ORDER BY is_pinned DESC, updated_at DESC
            """).fetchall()
            return [self._note_from_row(row) for row in result]

    def get_notes_by_folder(self, folder_id: int) -> List[Dict]:
        """Get all notes in a specific folder."""
        with self._connect() as conn:
            if folder_id is None:
                result = conn.execute("""
                    SELECT id, folder_id, title, content, created_at, updated_at, is_pinned
                    FROM notes
                    WHERE folder_id IS NULL AND sync_status != 'deleted'
                    ORDER BY is_pinned DESC, updated_at DESC
                """).fetchall()
            else:
                result = conn.execute("""
                    SELECT id, folder_id, title, content, created_at, updated_at, is_pinned
                    FROM notes
                    WHERE folder_id = ? AND sync_status != 'deleted'
                    ORDER BY is_pinned DESC, updated_at DESC
                """, (folder_id,)).fetchall()
            return [self._note_from_row(row) for row in result]

    def create_note(self, folder_id: Optional[int], title: str, content: str) -> int:
        """Create a new note and return its id."""
        with self._connect() as conn:
            max_id_result = conn.execute("SELECT MAX(id) FROM notes").fetchone()
            new_id = (max_id_result[0] or 0) + 1
            conn.execute("""
                INSERT INTO notes (id, folder_id, title, content, created_at, updated_at,
                                   is_pinned, uuid, sync_status)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, ?, 'pending')
            """, (new_id, folder_id, title, content, str(uuid_mod.uuid4())))
            return new_id

    def update_note(self, note_id: int, folder_id: Optional[int], title: str, content: str):
        """Update a note."""
        with self._connect() as conn:
            conn.execute("""
                UPDATE notes
                SET folder_id = ?, title = ?, content = ?, updated_at = CURRENT_TIMESTAMP,
                    sync_status = 'pending'
                WHERE id = ?
            """, (folder_id, title, content, note_id))

    def delete_note(self, note_id: int):
        """Soft-delete a note."""
        with self._connect() as conn:
            conn.execute("""
                UPDATE notes SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (note_id,))

    def toggle_note_pin(self, note_id: int):
        """Toggle the is_pinned status of a note."""
        with self._connect() as conn:
            conn.execute("""
                UPDATE notes
                SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END,
                    sync_status = 'pending', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (note_id,))

    def get_note_by_id(self, note_id: int) -> Optional[Dict]:
        """Get a note by its id."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT id, folder_id, title, content, created_at, updated_at, is_pinned
                FROM notes
                WHERE id = ? AND sync_status != 'deleted'
            """, (note_id,)).fetchone()
            return self._note_from_row(result) if result else None

    # ==================== Commit History ====================

    def get_commit_history(self, computer_id: str) -> List[Dict]:
        """Get last 30 commit history entries for a computer."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT id, computer_id, created_at, task_link, task_id, commit_type,
                       object_category, object_value, message, selected_tags, mr_link,
                       test_report, prod_report, transfer_connect, test_dag
                FROM commit_history
                WHERE computer_id = ?
                ORDER BY created_at DESC
                LIMIT 30
            """, (computer_id,)).fetchall()
            return [
                {
                    'id': row[0], 'computer_id': row[1], 'created_at': row[2],
                    'task_link': row[3], 'task_id': row[4], 'commit_type': row[5],
                    'object_category': row[6], 'object_value': row[7], 'message': row[8],
                    'selected_tags': row[9], 'mr_link': row[10], 'test_report': row[11],
                    'prod_report': row[12], 'transfer_connect': row[13], 'test_dag': row[14]
                }
                for row in result
            ]

    def save_commit_history(self, computer_id: str, data: Dict):
        """Save a commit history entry, keeping only last 30."""
        with self._connect() as conn:
            max_id_result = conn.execute("SELECT MAX(id) FROM commit_history").fetchone()
            new_id = (max_id_result[0] or 0) + 1
            conn.execute("""
                INSERT INTO commit_history (
                    id, computer_id, created_at, task_link, task_id, commit_type,
                    object_category, object_value, message, selected_tags, mr_link,
                    test_report, prod_report, transfer_connect, test_dag
                )
                VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                new_id, computer_id,
                data.get('task_link', ''), data.get('task_id', ''),
                data.get('commit_type', ''), data.get('object_category', ''),
                data.get('object_value', ''), data.get('message', ''),
                data.get('selected_tags', ''), data.get('mr_link', ''),
                data.get('test_report', ''), data.get('prod_report', ''),
                data.get('transfer_connect', ''), data.get('test_dag', '')
            ))
            self._cleanup_old_commit_history(conn, computer_id)

    def _cleanup_old_commit_history(self, conn, computer_id: str):
        """Delete old commit history entries, keeping only last 30."""
        conn.execute("""
            DELETE FROM commit_history
            WHERE computer_id = ? AND id NOT IN (
                SELECT id FROM commit_history
                WHERE computer_id = ?
                ORDER BY created_at DESC
                LIMIT 30
            )
        """, (computer_id, computer_id))

    # ==================== Obfuscation Mappings ====================

    def save_obfuscation_mapping(self, session_name: str, mappings: List[Dict]):
        """Save obfuscation mappings for a session."""
        with self._connect() as conn:
            max_id_result = conn.execute("SELECT MAX(id) FROM obfuscation_mappings").fetchone()
            current_id = (max_id_result[0] or 0)

            for mapping in mappings:
                current_id += 1
                conn.execute("""
                    INSERT INTO obfuscation_mappings
                        (id, session_name, entity_type, original_value, obfuscated_value,
                         uuid, updated_at, sync_status)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending')
                """, (current_id, session_name, mapping['entity_type'],
                      mapping['original_value'], mapping['obfuscated_value'],
                      str(uuid_mod.uuid4())))

    def get_obfuscation_sessions(self) -> List[str]:
        """Get all unique session names."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT DISTINCT session_name
                FROM obfuscation_mappings
                WHERE sync_status != 'deleted'
                ORDER BY session_name DESC
            """).fetchall()
            return [row[0] for row in result]

    def get_obfuscation_mapping(self, session_name: str) -> List[Dict]:
        """Get all mappings for a session."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT entity_type, original_value, obfuscated_value
                FROM obfuscation_mappings
                WHERE session_name = ? AND sync_status != 'deleted'
                ORDER BY entity_type, original_value
            """, (session_name,)).fetchall()
            return [
                {'entity_type': row[0], 'original_value': row[1], 'obfuscated_value': row[2]}
                for row in result
            ]

    # ==================== Exec Categories ====================

    def get_all_exec_categories(self) -> List[Dict]:
        """Get all exec categories."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT id, name, sort_order
                FROM exec_categories
                ORDER BY sort_order, name
            """).fetchall()
            return [{'id': row[0], 'name': row[1], 'sort_order': row[2]} for row in result]

    def create_exec_category(self, name: str) -> int:
        """Create a new exec category and return its id."""
        with self._connect() as conn:
            max_id_result = conn.execute("SELECT MAX(id) FROM exec_categories").fetchone()
            new_id = (max_id_result[0] or 0) + 1
            max_order = conn.execute("SELECT MAX(sort_order) FROM exec_categories").fetchone()
            new_order = (max_order[0] or 0) + 1
            conn.execute("""
                INSERT INTO exec_categories (id, name, sort_order)
                VALUES (?, ?, ?)
            """, (new_id, name, new_order))
            return new_id

    def update_exec_category(self, category_id: int, name: str):
        """Update an exec category name."""
        with self._connect() as conn:
            conn.execute("UPDATE exec_categories SET name = ? WHERE id = ?", (name, category_id))

    def delete_exec_category(self, category_id: int):
        """Delete an exec category and all its commands."""
        with self._connect() as conn:
            conn.execute("DELETE FROM exec_commands WHERE category_id = ?", (category_id,))
            conn.execute("DELETE FROM exec_categories WHERE id = ?", (category_id,))

    # ==================== Exec Commands ====================

    def _exec_cmd_from_row(self, row) -> Dict:
        return {
            'id': row[0], 'category_id': row[1], 'name': row[2], 'command': row[3],
            'description': row[4], 'sort_order': row[5], 'hide_after_run': bool(row[6])
        }

    def get_all_exec_commands(self) -> List[Dict]:
        """Get all exec commands."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT id, category_id, name, command, description, sort_order, hide_after_run
                FROM exec_commands
                ORDER BY category_id, sort_order, name
            """).fetchall()
            return [self._exec_cmd_from_row(row) for row in result]

    def delete_obfuscation_session(self, session_name: str):
        """Soft-delete all mappings for a session."""
        with self._connect() as conn:
            conn.execute("""
                UPDATE obfuscation_mappings
                SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP
                WHERE session_name = ?
            """, (session_name,))

    def get_exec_commands_by_category(self, category_id: int) -> List[Dict]:
        """Get all exec commands in a specific category."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT id, category_id, name, command, description, sort_order, hide_after_run
                FROM exec_commands
                WHERE category_id = ?
                ORDER BY sort_order, name
            """, (category_id,)).fetchall()
            return [self._exec_cmd_from_row(row) for row in result]

    def create_exec_command(self, category_id: int, name: str, command: str, description: str = '', hide_after_run: bool = False) -> int:
        """Create a new exec command and return its id."""
        with self._connect() as conn:
            max_id_result = conn.execute("SELECT MAX(id) FROM exec_commands").fetchone()
            new_id = (max_id_result[0] or 0) + 1
            max_order = conn.execute(
                "SELECT MAX(sort_order) FROM exec_commands WHERE category_id = ?",
                (category_id,)
            ).fetchone()
            new_order = (max_order[0] or 0) + 1
            conn.execute("""
                INSERT INTO exec_commands (id, category_id, name, command, description, sort_order, hide_after_run)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (new_id, category_id, name, command, description, new_order, 1 if hide_after_run else 0))
            return new_id

    def update_exec_command(self, cmd_id: int, category_id: int, name: str, command: str, description: str = '', hide_after_run: bool = False):
        """Update an exec command."""
        with self._connect() as conn:
            conn.execute("""
                UPDATE exec_commands
                SET category_id = ?, name = ?, command = ?, description = ?, hide_after_run = ?
                WHERE id = ?
            """, (category_id, name, command, description, 1 if hide_after_run else 0, cmd_id))

    def delete_exec_command(self, cmd_id: int):
        """Delete an exec command."""
        with self._connect() as conn:
            conn.execute("DELETE FROM exec_commands WHERE id = ?", (cmd_id,))

    def get_exec_command_by_id(self, cmd_id: int) -> Optional[Dict]:
        """Get an exec command by its id."""
        with self._connect() as conn:
            result = conn.execute("""
                SELECT id, category_id, name, command, description, sort_order, hide_after_run
                FROM exec_commands
                WHERE id = ?
            """, (cmd_id,)).fetchone()
            return self._exec_cmd_from_row(result) if result else None

    # ==================== Sync Helpers ====================

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
            return [dict(zip(fields, row)) for row in result]

    def mark_as_synced(self, table_name: str, uuids: List[str]):
        """Mark rows as synced after successful push."""
        if not uuids:
            return
        placeholders = ', '.join(['?'] * len(uuids))
        with self._connect() as conn:
            conn.execute(
                f"UPDATE {table_name} SET sync_status = 'synced' WHERE uuid IN ({placeholders})",
                uuids
            )

    def purge_deleted(self, table_name: str, uuids: List[str]):
        """Physically delete soft-deleted rows after server confirmed deletion."""
        if not uuids:
            return
        placeholders = ', '.join(['?'] * len(uuids))
        with self._connect() as conn:
            conn.execute(
                f"DELETE FROM {table_name} WHERE uuid IN ({placeholders}) AND sync_status = 'deleted'",
                uuids
            )

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
                        conn.execute(f"DELETE FROM {table_name} WHERE uuid = ?", (row['uuid'],))
                    continue

                if existing:
                    local_status = existing[0]
                    local_updated = existing[1]
                    # If local is pending and local is newer, skip (local wins)
                    if local_status == 'pending' and local_updated and row.get('updated_at'):
                        if str(local_updated) > str(row['updated_at']):
                            continue
                    # Update from server
                    set_parts = [f"{f} = ?" for f in data_fields if f in row]
                    set_parts.append("sync_status = 'synced'")
                    set_parts.append("updated_at = ?")
                    values = [row[f] for f in data_fields if f in row]
                    values.append(row.get('updated_at'))
                    values.append(row['uuid'])
                    conn.execute(
                        f"UPDATE {table_name} SET {', '.join(set_parts)} WHERE uuid = ?",
                        values
                    )
                else:
                    # Insert new row from server
                    max_id_result = conn.execute(f"SELECT MAX(id) FROM {table_name}").fetchone()
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
