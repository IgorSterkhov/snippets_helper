import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://snippets_sync:snippets_sync@localhost:5432/snippets_sync"
)
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8001"))
DEBUG = os.getenv("DEBUG", "0") == "1"
