import os
import duckdb
from dotenv import load_dotenv

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