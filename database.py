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
    
    def save_items(self, items):
        """Save all items to the database."""
        conn = duckdb.connect(self.db_path)
        try:
            # Start transaction
            conn.execute("BEGIN TRANSACTION")
            
            # Clear existing data
            conn.execute("DELETE FROM shortcuts")
            
            # Insert all items
            if items:
                values = [(item['id'], 
                          item['name'], 
                          item['value'], 
                          item.get('description', '')) for item in items]
                
                conn.executemany("""
                    INSERT INTO shortcuts (id, name, value, description)
                    VALUES (?, ?, ?, ?)
                """, values)
            
            # Commit transaction
            conn.execute("COMMIT")
        except:
            # Rollback on error
            conn.execute("ROLLBACK")
            raise
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