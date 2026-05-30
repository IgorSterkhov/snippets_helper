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

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_TIMEOUT_SECONDS = float(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "30"))

TELEGRAM_POLLING_ENABLED = os.getenv("TELEGRAM_POLLING_ENABLED", "1").lower() not in {"0", "false", "no", "off"}
TELEGRAM_POLLING_INTERVAL_SECONDS = float(os.getenv("TELEGRAM_POLLING_INTERVAL_SECONDS", "3"))
TELEGRAM_POLLING_USER_LIMIT = int(os.getenv("TELEGRAM_POLLING_USER_LIMIT", "50"))
