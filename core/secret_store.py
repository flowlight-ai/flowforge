"""Secure secret storage backed by SQLite.

Provides the SecretStore class for persisting and retrieving sensitive
configuration values (API keys, tokens, etc.) with masked listing and
a multi-source resolution chain (database → environment variable → .env file).

License: MIT
"""

import os
import threading
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from flowforge.core.tracing import get_logger

logger = get_logger("secret_store")

_DEFAULT_DB_PATH = Path(__file__).parent.parent / "data" / "secrets.db"

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    category TEXT DEFAULT 'api_key',
    description TEXT,
    created_at TEXT,
    updated_at TEXT
)
"""


def _mask_value(value: str) -> str:
    """Mask a secret value for safe display.

    Short values (8 characters or fewer) are fully masked as ``"****"``.
    Longer values show the first 3 and last 4 characters with ``"****"``
    in between.

    Args:
        value: The secret string to mask.

    Returns:
        The masked representation of the value.
    """
    if not value:
        return ""
    if len(value) <= 8:
        return "****"
    return value[:3] + "****" + value[-4:]


class SecretStore:
    """Thread-safe SQLite-backed store for sensitive configuration values.

    Secrets are stored in a local SQLite database with key, value, category,
    description, and timestamp columns.  All database operations are
    protected by a threading lock.  The ``resolve`` method implements a
    fallback chain: database → environment variable → ``.env`` file.

    Attributes:
        _db_path: Path to the SQLite database file.
        _lock: Threading lock for serialized database access.
    """

    def __init__(self, db_path: Optional[Path] = None):
        """Initialize the SecretStore and ensure the database schema exists.

        Args:
            db_path: Optional path to the SQLite database file.  Defaults
                to ``<package_root>/data/secrets.db``.
        """
        if db_path is None:
            db_path = _DEFAULT_DB_PATH
        self._db_path = db_path
        self._lock = threading.Lock()
        self._ensure_db()

    def _ensure_db(self):
        """Create the database file and secrets table if they do not exist."""
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._get_conn() as conn:
            conn.execute(_CREATE_TABLE_SQL)
            conn.commit()
        logger.info(f"SecretStore initialized: {self._db_path}")

    def _get_conn(self) -> sqlite3.Connection:
        """Open a new SQLite connection with Row factory enabled.

        Returns:
            A ``sqlite3.Connection`` configured with ``Row`` row factory.
        """
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def get(self, key: str) -> Optional[str]:
        """Retrieve a secret value by key.

        Args:
            key: The unique key of the secret.

        Returns:
            The secret value string, or ``None`` if the key is not found.
        """
        with self._lock:
            with self._get_conn() as conn:
                row = conn.execute(
                    "SELECT value FROM secrets WHERE key = ?", (key,)
                ).fetchone()
                if row:
                    return row["value"]
        return None

    def set(self, key: str, value: str, category: str = "api_key", description: str = "") -> None:
        """Store or update a secret.

        If the key already exists, its value, category, description, and
        ``updated_at`` timestamp are updated.  Otherwise a new row is
        inserted.

        Args:
            key: The unique key for the secret.
            value: The secret value to store.
            category: Optional category label (default ``"api_key"``).
            description: Optional human-readable description.
        """
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            with self._get_conn() as conn:
                existing = conn.execute(
                    "SELECT key FROM secrets WHERE key = ?", (key,)
                ).fetchone()
                if existing:
                    conn.execute(
                        "UPDATE secrets SET value = ?, category = ?, description = ?, updated_at = ? WHERE key = ?",
                        (value, category, description, now, key),
                    )
                else:
                    conn.execute(
                        "INSERT INTO secrets (key, value, category, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (key, value, category, description, now, now),
                    )
                conn.commit()
        logger.info(f"Secret set: {key} [{category}]")

    def delete(self, key: str) -> None:
        """Delete a secret by key.

        Args:
            key: The unique key of the secret to delete.
        """
        with self._lock:
            with self._get_conn() as conn:
                conn.execute("DELETE FROM secrets WHERE key = ?", (key,))
                conn.commit()
        logger.info(f"Secret deleted: {key}")

    def list_keys(self, category: Optional[str] = None) -> List[Dict]:
        """List stored secrets with masked values.

        Args:
            category: Optional category filter.  If provided, only secrets
                in this category are returned.

        Returns:
            A list of dictionaries, each containing ``key``,
            ``value_masked``, ``category``, ``description``,
            ``created_at``, and ``updated_at``.
        """
        with self._lock:
            with self._get_conn() as conn:
                if category:
                    rows = conn.execute(
                        "SELECT key, value, category, description, created_at, updated_at FROM secrets WHERE category = ? ORDER BY key",
                        (category,),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT key, value, category, description, created_at, updated_at FROM secrets ORDER BY key"
                    ).fetchall()
        result = []
        for row in rows:
            result.append({
                "key": row["key"],
                "value_masked": _mask_value(row["value"]),
                "category": row["category"],
                "description": row["description"] or "",
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            })
        return result

    def has(self, key: str) -> bool:
        """Check whether a secret exists for the given key.

        Args:
            key: The unique key to check.

        Returns:
            ``True`` if the key exists in the store, ``False`` otherwise.
        """
        with self._lock:
            with self._get_conn() as conn:
                row = conn.execute(
                    "SELECT 1 FROM secrets WHERE key = ?", (key,)
                ).fetchone()
                return row is not None

    def resolve(self, key: str) -> str:
        """Resolve a secret value through a multi-source fallback chain.

        The resolution order is:
        1. SQLite database (via ``get``).
        2. Process environment variable (``os.environ``).
        3. ``.env`` file located at ``<package_root>/.env``.

        Args:
            key: The key to resolve.

        Returns:
            The resolved value string, or an empty string if the key is
            not found in any source.
        """
        db_value = self.get(key)
        if db_value:
            return db_value

        env_value = os.environ.get(key, "")
        if env_value:
            return env_value

        env_file = Path(__file__).parent.parent / ".env"
        if env_file.exists():
            try:
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("#") or "=" not in line:
                            continue
                        env_key, _, env_val = line.partition("=")
                        if env_key.strip() == key:
                            val = env_val.strip().strip('"').strip("'")
                            if val:
                                return val
            except Exception:
                pass

        return ""


_secret_store_instance: Optional[SecretStore] = None


def get_secret_store() -> SecretStore:
    """Return the singleton SecretStore instance.

    Creates the instance on first call and reuses it on subsequent calls.

    Returns:
        The shared ``SecretStore`` instance.
    """
    global _secret_store_instance
    if _secret_store_instance is None:
        _secret_store_instance = SecretStore()
    return _secret_store_instance
