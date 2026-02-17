
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'backend', 'database.db')

def migrate():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Check if column exists
        cursor.execute("PRAGMA table_info(themes)")
        columns = [info[1] for info in cursor.fetchall()]
        
        if 'priority' not in columns:
            print("Adding priority column to themes table...")
            cursor.execute("ALTER TABLE themes ADD COLUMN priority INTEGER DEFAULT 0")
            conn.commit()
            print("Migration successful.")
        else:
            print("priority column already exists.")
            
    except Exception as e:
        print(f"Migration failed: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
