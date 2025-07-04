import os
import json
import duckdb
from dotenv import load_dotenv

def init_database():
    # Load environment variables
    load_dotenv()
    db_path = os.getenv('DUCKDB_PATH')
    
    if not db_path:
        raise ValueError("DUCKDB_PATH not found in .env file")
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    
    # Connect to database
    conn = duckdb.connect(db_path)
    
    try:
        # Create table if not exists
        conn.execute("""
            CREATE TABLE IF NOT EXISTS shortcuts (
                id INTEGER PRIMARY KEY,
                name VARCHAR NOT NULL,
                value TEXT NOT NULL,
                description TEXT
            )
        """)
        
        # Import data from JSON if exists
        if os.path.exists('items.json'):
            with open('items.json', 'r', encoding='utf-8') as f:
                items = json.load(f)
                
                # Convert items to list of tuples for bulk insert
                values = [(item['id'], 
                          item['name'], 
                          item['value'], 
                          item.get('description', '')) for item in items]
                
                if values:
                    # Clear existing data
                    conn.execute("DELETE FROM shortcuts")
                    
                    # Insert new data
                    conn.executemany("""
                        INSERT INTO shortcuts (id, name, value, description)
                        VALUES (?, ?, ?, ?)
                    """, values)
        
        print("Database initialized successfully!")
        
    finally:
        conn.close()

if __name__ == "__main__":
    init_database() 