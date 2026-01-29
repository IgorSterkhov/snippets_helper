import os
import duckdb
from dotenv import load_dotenv
from typing import Optional, List, Dict

class Database:
    def __init__(self):
        # Load environment variables
        load_dotenv()
        self.db_path = os.getenv('DUCKDB_PATH')
        if not self.db_path:
            raise ValueError("DUCKDB_PATH not found in .env file")
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        
        # Initialize database
        self._init_database()
    
    def _init_database(self):
        """Initialize the database and create tables if they don't exist."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS shortcuts (
                    id INTEGER PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    value TEXT NOT NULL,
                    description TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sql_table_analyzer_templates (
                    id INTEGER PRIMARY KEY,
                    template_text TEXT NOT NULL
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
                    separator VARCHAR NOT NULL DEFAULT ';\\n'
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS note_folders (
                    id INTEGER PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    sort_order INTEGER DEFAULT 0
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
                    is_pinned INTEGER DEFAULT 0
                )
            """)
        finally:
            conn.close()
    
    def get_all_items(self):
        """Get all items from the database."""
        conn = duckdb.connect(self.db_path)
        try:
            result = conn.execute("SELECT * FROM shortcuts ORDER BY id").fetchall()
            return [
                {
                    'id': row[0],
                    'name': row[1],
                    'value': row[2],
                    'description': row[3]
                }
                for row in result
            ]
        finally:
            conn.close()
    
    def update_item(self, item):
        """Update a single item in the database."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("""
                UPDATE shortcuts 
                SET name = ?, value = ?, description = ?
                WHERE id = ?
            """, (item['name'], item['value'], item.get('description', ''), item['id']))
        finally:
            conn.close()
    
    def create_item(self, item):
        """Create a new item in the database."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("""
                INSERT INTO shortcuts (id, name, value, description)
                VALUES (?, ?, ?, ?)
            """, (item['id'], item['name'], item['value'], item.get('description', '')))
        finally:
            conn.close()
    
    def delete_item(self, item_id):
        """Delete an item from the database."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("DELETE FROM shortcuts WHERE id = ?", (item_id,))
        finally:
            conn.close()
    
    def get_max_id(self):
        """Get the maximum ID from the database."""
        conn = duckdb.connect(self.db_path)
        try:
            result = conn.execute("SELECT MAX(id) FROM shortcuts").fetchone()
            return result[0] if result[0] is not None else 0
        finally:
            conn.close() 

    def get_sql_table_analyzer_templates(self):
        """Get all SQL Table Analyzer templates."""
        conn = duckdb.connect(self.db_path)
        try:
            result = conn.execute("""
                SELECT template_text
                FROM sql_table_analyzer_templates
                ORDER BY id
            """).fetchall()
            return [row[0] for row in result]
        finally:
            conn.close()

    def save_sql_table_analyzer_templates(self, templates):
        """Replace SQL Table Analyzer templates."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("DELETE FROM sql_table_analyzer_templates")
            for index, template_text in enumerate(templates, start=1):
                conn.execute("""
                    INSERT INTO sql_table_analyzer_templates (id, template_text)
                    VALUES (?, ?)
                """, (index, template_text))
        finally:
            conn.close()

    def get_superset_settings(self, computer_id):
        """Get Superset settings for a specific computer."""
        conn = duckdb.connect(self.db_path)
        try:
            result = conn.execute("""
                SELECT setting_key, setting_value
                FROM superset_settings
                WHERE computer_id = ?
            """, (computer_id,)).fetchall()
            return {row[0]: row[1] for row in result}
        finally:
            conn.close()

    def upsert_superset_setting(self, computer_id, setting_key, setting_value):
        """Upsert a single Superset setting for a computer."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("""
                INSERT INTO superset_settings (computer_id, setting_key, setting_value)
                VALUES (?, ?, ?)
                ON CONFLICT (computer_id, setting_key) DO UPDATE
                SET setting_value = excluded.setting_value
            """, (computer_id, setting_key, setting_value))
        finally:
            conn.close()

    def get_app_setting(self, computer_id, key):
        """Get a single app setting."""
        conn = duckdb.connect(self.db_path)
        try:
            result = conn.execute("""
                SELECT setting_value
                FROM app_settings
                WHERE computer_id = ? AND setting_key = ?
            """, (computer_id, key)).fetchone()
            return result[0] if result else None
        finally:
            conn.close()

    def save_app_setting(self, computer_id, key, value):
        """Save a single app setting."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("""
                INSERT INTO app_settings (computer_id, setting_key, setting_value)
                VALUES (?, ?, ?)
                ON CONFLICT (computer_id, setting_key) DO UPDATE
                SET setting_value = excluded.setting_value
            """, (computer_id, key, value))
        finally:
            conn.close()

    def get_all_app_settings(self, computer_id):
        """Get all app settings for a computer."""
        conn = duckdb.connect(self.db_path)
        try:
            result = conn.execute("""
                SELECT setting_key, setting_value
                FROM app_settings
                WHERE computer_id = ?
            """, (computer_id,)).fetchall()
            return {row[0]: row[1] for row in result}
        finally:
            conn.close()

    def get_commit_tags(self, computer_id):
        """Get all commit tags for a computer."""
        conn = duckdb.connect(self.db_path)
        try:
            result = conn.execute("""
                SELECT tag_name, is_default
                FROM commit_tags
                WHERE computer_id = ?
                ORDER BY id
            """, (computer_id,)).fetchall()
            return [{'tag_name': row[0], 'is_default': bool(row[1])} for row in result]
        finally:
            conn.close()

    def add_commit_tag(self, computer_id, tag_name, is_default=False):
        """Add a commit tag for a computer."""
        conn = duckdb.connect(self.db_path)
        try:
            max_id_result = conn.execute("SELECT MAX(id) FROM commit_tags").fetchone()
            new_id = (max_id_result[0] or 0) + 1
            conn.execute("""
                INSERT INTO commit_tags (id, computer_id, tag_name, is_default)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (computer_id, tag_name) DO NOTHING
            """, (new_id, computer_id, tag_name, 1 if is_default else 0))
        finally:
            conn.close()

    def delete_commit_tag(self, computer_id, tag_name):
        """Delete a commit tag for a computer."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("""
                DELETE FROM commit_tags
                WHERE computer_id = ? AND tag_name = ?
            """, (computer_id, tag_name))
        finally:
            conn.close()

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
        conn = duckdb.connect(self.db_path)
        try:
            result = conn.execute("""
                SELECT id, template_name, template_text, placeholders_config, combination_mode, separator
                FROM sql_macrosing_templates
                ORDER BY template_name
            """).fetchall()
            return [
                {
                    'id': row[0],
                    'template_name': row[1],
                    'template_text': row[2],
                    'placeholders_config': row[3],
                    'combination_mode': row[4],
                    'separator': row[5]
                }
                for row in result
            ]
        finally:
            conn.close()

    def get_sql_macrosing_template_by_name(self, name: str) -> Optional[Dict]:
        """Get a SQL Macrosing template by name."""
        conn = duckdb.connect(self.db_path)
        try:
            result = conn.execute("""
                SELECT id, template_name, template_text, placeholders_config, combination_mode, separator
                FROM sql_macrosing_templates
                WHERE template_name = ?
            """, (name,)).fetchone()
            if result:
                return {
                    'id': result[0],
                    'template_name': result[1],
                    'template_text': result[2],
                    'placeholders_config': result[3],
                    'combination_mode': result[4],
                    'separator': result[5]
                }
            return None
        finally:
            conn.close()

    def save_sql_macrosing_template(self, name, template_text, placeholders_config, combination_mode, separator):
        """Save or update a SQL Macrosing template."""
        conn = duckdb.connect(self.db_path)
        try:
            existing = conn.execute(
                "SELECT id FROM sql_macrosing_templates WHERE template_name = ?", (name,)
            ).fetchone()
            if existing:
                conn.execute("""
                    UPDATE sql_macrosing_templates
                    SET template_text = ?, placeholders_config = ?, combination_mode = ?, separator = ?
                    WHERE template_name = ?
                """, (template_text, placeholders_config, combination_mode, separator, name))
            else:
                max_id_result = conn.execute("SELECT MAX(id) FROM sql_macrosing_templates").fetchone()
                new_id = (max_id_result[0] or 0) + 1
                conn.execute("""
                    INSERT INTO sql_macrosing_templates (id, template_name, template_text, placeholders_config, combination_mode, separator)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (new_id, name, template_text, placeholders_config, combination_mode, separator))
        finally:
            conn.close()

    def delete_sql_macrosing_template(self, name):
        """Delete a SQL Macrosing template by name."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("DELETE FROM sql_macrosing_templates WHERE template_name = ?", (name,))
        finally:
            conn.close()

    # ==================== Note Folders ====================

    def get_all_note_folders(self) -> List[Dict]:
        """Get all note folders."""
        conn = duckdb.connect(self.db_path)
        try:
            result = conn.execute("""
                SELECT id, name, sort_order
                FROM note_folders
                ORDER BY sort_order, name
            """).fetchall()
            return [
                {'id': row[0], 'name': row[1], 'sort_order': row[2]}
                for row in result
            ]
        finally:
            conn.close()

    def create_note_folder(self, name: str, sort_order: int = 0) -> int:
        """Create a new note folder and return its id."""
        conn = duckdb.connect(self.db_path)
        try:
            max_id_result = conn.execute("SELECT MAX(id) FROM note_folders").fetchone()
            new_id = (max_id_result[0] or 0) + 1
            conn.execute("""
                INSERT INTO note_folders (id, name, sort_order)
                VALUES (?, ?, ?)
            """, (new_id, name, sort_order))
            return new_id
        finally:
            conn.close()

    def update_note_folder(self, folder_id: int, name: str):
        """Update a note folder name."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("""
                UPDATE note_folders SET name = ? WHERE id = ?
            """, (name, folder_id))
        finally:
            conn.close()

    def delete_note_folder(self, folder_id: int):
        """Delete a note folder. Notes in this folder will have folder_id set to NULL."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("UPDATE notes SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
            conn.execute("DELETE FROM note_folders WHERE id = ?", (folder_id,))
        finally:
            conn.close()

    def init_default_note_folder(self):
        """Initialize default 'General' folder if no folders exist."""
        existing = self.get_all_note_folders()
        if not existing:
            self.create_note_folder("General", sort_order=0)

    # ==================== Notes ====================

    def get_all_notes(self) -> List[Dict]:
        """Get all notes."""
        conn = duckdb.connect(self.db_path)
        try:
            result = conn.execute("""
                SELECT id, folder_id, title, content, created_at, updated_at, is_pinned
                FROM notes
                ORDER BY is_pinned DESC, updated_at DESC
            """).fetchall()
            return [
                {
                    'id': row[0],
                    'folder_id': row[1],
                    'title': row[2],
                    'content': row[3],
                    'created_at': row[4],
                    'updated_at': row[5],
                    'is_pinned': bool(row[6])
                }
                for row in result
            ]
        finally:
            conn.close()

    def get_notes_by_folder(self, folder_id: int) -> List[Dict]:
        """Get all notes in a specific folder."""
        conn = duckdb.connect(self.db_path)
        try:
            if folder_id is None:
                result = conn.execute("""
                    SELECT id, folder_id, title, content, created_at, updated_at, is_pinned
                    FROM notes
                    WHERE folder_id IS NULL
                    ORDER BY is_pinned DESC, updated_at DESC
                """).fetchall()
            else:
                result = conn.execute("""
                    SELECT id, folder_id, title, content, created_at, updated_at, is_pinned
                    FROM notes
                    WHERE folder_id = ?
                    ORDER BY is_pinned DESC, updated_at DESC
                """, (folder_id,)).fetchall()
            return [
                {
                    'id': row[0],
                    'folder_id': row[1],
                    'title': row[2],
                    'content': row[3],
                    'created_at': row[4],
                    'updated_at': row[5],
                    'is_pinned': bool(row[6])
                }
                for row in result
            ]
        finally:
            conn.close()

    def create_note(self, folder_id: Optional[int], title: str, content: str) -> int:
        """Create a new note and return its id."""
        conn = duckdb.connect(self.db_path)
        try:
            max_id_result = conn.execute("SELECT MAX(id) FROM notes").fetchone()
            new_id = (max_id_result[0] or 0) + 1
            conn.execute("""
                INSERT INTO notes (id, folder_id, title, content, created_at, updated_at, is_pinned)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)
            """, (new_id, folder_id, title, content))
            return new_id
        finally:
            conn.close()

    def update_note(self, note_id: int, folder_id: Optional[int], title: str, content: str):
        """Update a note."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("""
                UPDATE notes
                SET folder_id = ?, title = ?, content = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (folder_id, title, content, note_id))
        finally:
            conn.close()

    def delete_note(self, note_id: int):
        """Delete a note."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        finally:
            conn.close()

    def toggle_note_pin(self, note_id: int):
        """Toggle the is_pinned status of a note."""
        conn = duckdb.connect(self.db_path)
        try:
            conn.execute("""
                UPDATE notes
                SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END
                WHERE id = ?
            """, (note_id,))
        finally:
            conn.close()

    def get_note_by_id(self, note_id: int) -> Optional[Dict]:
        """Get a note by its id."""
        conn = duckdb.connect(self.db_path)
        try:
            result = conn.execute("""
                SELECT id, folder_id, title, content, created_at, updated_at, is_pinned
                FROM notes
                WHERE id = ?
            """, (note_id,)).fetchone()
            if result:
                return {
                    'id': result[0],
                    'folder_id': result[1],
                    'title': result[2],
                    'content': result[3],
                    'created_at': result[4],
                    'updated_at': result[5],
                    'is_pinned': bool(result[6])
                }
            return None
        finally:
            conn.close()