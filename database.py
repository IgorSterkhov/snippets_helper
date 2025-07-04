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