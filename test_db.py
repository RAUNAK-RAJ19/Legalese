import os
import sys
from dotenv import load_dotenv

# Add backend directory to sys.path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from sqlmodel import Session, create_engine, select
# We'll try to import without 'app.' if running from backend, 
# or with it if sys.path is set.
try:
    from app.models.document import Document
except ImportError:
    from models.document import Document

load_dotenv(dotenv_path="backend/.env")

DATABASE_URL = os.getenv("DATABASE_URL")

print(f"Testing connection to: {DATABASE_URL.split('@')[-1] if DATABASE_URL else 'None'}")

if not DATABASE_URL:
    print("❌ DATABASE_URL not found in backend/.env")
    exit(1)

try:
    engine = create_engine(DATABASE_URL)
    with Session(engine) as session:
        # Try a simple query
        session.exec(select(Document)).first()
        print("✅ Database connection successful!")
except Exception as e:
    print(f"❌ Database connection failed: {e}")
