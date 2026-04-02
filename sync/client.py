"""HTTP client for communicating with the Snippets Helper Sync API."""
import os
import logging
import requests
import urllib3
from typing import Optional

logger = logging.getLogger(__name__)


class SyncClient:
    def __init__(self, api_url: str, api_key: str, timeout: int = 30):
        self.api_url = api_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        })
        # SSL verification: CA cert file > skip verify for self-signed
        ca_cert = os.getenv("SYNC_CA_CERT")
        if ca_cert and os.path.isfile(ca_cert):
            self.session.verify = ca_cert
        elif self.api_url.startswith("https://"):
            # No CA cert provided — disable verify for self-signed certs
            self.session.verify = False
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    def health(self) -> bool:
        """Check if server is reachable."""
        try:
            r = self.session.get(f"{self.api_url}/v1/health", timeout=5)
            return r.status_code == 200
        except Exception:
            return False

    def register(self, name: str) -> dict:
        """Register a new user. Returns {user_id, api_key, name}.

        Uses a separate request without Authorization header.
        """
        r = requests.post(
            f"{self.api_url}/v1/auth/register",
            json={"name": name},
            timeout=self.timeout,
            verify=self.session.verify,
        )
        r.raise_for_status()
        return r.json()

    def check_auth(self) -> Optional[dict]:
        """Verify API key. Returns user info or None."""
        try:
            r = self.session.get(f"{self.api_url}/v1/auth/me", timeout=self.timeout)
            if r.status_code == 200:
                return r.json()
            return None
        except Exception:
            return None

    def push(self, changes: dict) -> dict:
        """Push local changes to server.

        Args:
            changes: {table_name: [row_dicts]}
        Returns:
            {status, accepted, conflicts}
        """
        r = self.session.post(
            f"{self.api_url}/v1/sync/push",
            json={"changes": changes},
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def pull(self, last_sync_at: Optional[str] = None) -> dict:
        """Pull changes from server since last_sync_at.

        Returns:
            {changes: {table_name: [row_dicts]}, server_time: str}
        """
        r = self.session.post(
            f"{self.api_url}/v1/sync/pull",
            json={"last_sync_at": last_sync_at},
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()
