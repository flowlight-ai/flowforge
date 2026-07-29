"""Credential store — secure API key storage with multiple backends.

Supports two backends:
- **env** (default): reads/writes credentials from environment variables
  with a ``FLOWFORGE_`` prefix.
- **encrypted_file**: stores credentials in an encrypted file using
  Fernet symmetric encryption (key derived from machine ID).  Falls back
  to env-only mode if the ``cryptography`` package is not installed.

License: MIT
"""

import hashlib
import json
import os
import platform
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from flowforge.core.tracing import get_logger

logger = get_logger("credential_store")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ENV_PREFIX = "FLOWFORGE_"
_DEFAULT_CREDENTIAL_FILE = Path("data/credentials.enc")

# Lazy cryptography import
_fernet_available = False
try:
    from cryptography.fernet import Fernet
    _fernet_available = True
except ImportError:
    Fernet = None  # type: ignore[assignment,misc]


# ---------------------------------------------------------------------------
# Machine-ID-based key derivation
# ---------------------------------------------------------------------------


def _derive_fernet_key() -> bytes:
    """Derive a Fernet-compatible 32-byte key from a machine-specific ID.

    Uses a combination of platform node, machine UUID, and a salt to
    produce a deterministic but machine-specific key.
    """
    machine_id = f"{platform.node()}-{uuid.getnode()}-flowforge-credential-store"
    digest = hashlib.sha256(machine_id.encode()).digest()
    # Fernet requires url-safe base64-encoded 32-byte key
    import base64
    return base64.urlsafe_b64encode(digest)


# ---------------------------------------------------------------------------
# Encrypted file backend
# ---------------------------------------------------------------------------


class _EncryptedFileBackend:
    """Store credentials in an encrypted JSON file."""

    def __init__(self, file_path: Optional[Path] = None) -> None:
        if not _fernet_available:
            raise RuntimeError(
                "cryptography package is required for encrypted file backend. "
                "Install it with: pip install cryptography"
            )
        self._path = file_path or _DEFAULT_CREDENTIAL_FILE
        self._fernet = Fernet(_derive_fernet_key())
        self._cache: Dict[str, str] = {}
        self._loaded = False

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if not self._path.exists():
            self._cache = {}
            return
        try:
            encrypted = self._path.read_bytes()
            decrypted = self._fernet.decrypt(encrypted)
            self._cache = json.loads(decrypted)
        except Exception as e:
            logger.warning(f"Failed to load encrypted credentials: {e}")
            self._cache = {}

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        data = json.dumps(self._cache).encode("utf-8")
        encrypted = self._fernet.encrypt(data)
        self._path.write_bytes(encrypted)

    def get(self, key: str) -> Optional[str]:
        self._load()
        return self._cache.get(key)

    def set(self, key: str, value: str) -> None:
        self._load()
        self._cache[key] = value
        self._save()

    def delete(self, key: str) -> None:
        self._load()
        if key in self._cache:
            del self._cache[key]
            self._save()

    def list_keys(self) -> List[str]:
        self._load()
        return list(self._cache.keys())


# ---------------------------------------------------------------------------
# CredentialStore
# ---------------------------------------------------------------------------


class CredentialStore:
    """Secure API key storage with pluggable backends.

    Backends:
        - ``env``: Environment variables with ``FLOWFORGE_`` prefix.
        - ``encrypted_file``: Fernet-encrypted file (requires ``cryptography``).

    If ``cryptography`` is not installed, the encrypted file backend is
    unavailable and a warning is logged.  All operations then fall back
    to the env backend.
    """

    def __init__(self, credential_file: Optional[Path] = None) -> None:
        self._env_backend = _EnvBackend()
        self._encrypted_backend: Optional[_EncryptedFileBackend] = None
        self._credential_file = credential_file

        if _fernet_available:
            try:
                self._encrypted_backend = _EncryptedFileBackend(credential_file)
            except Exception as e:
                logger.warning(
                    f"Encrypted file backend unavailable: {e}. "
                    f"Falling back to env-only mode."
                )
        else:
            logger.warning(
                "cryptography package not installed. "
                "CredentialStore running in env-only mode. "
                "Install cryptography for encrypted file support."
            )

    def get_credential(self, key_name: str) -> Optional[str]:
        """Retrieve a credential value.

        Resolution order: encrypted file → environment variable.
        Returns ``None`` if the credential is not found in any backend.
        """
        # Try encrypted file first
        if self._encrypted_backend is not None:
            value = self._encrypted_backend.get(key_name)
            if value is not None:
                return value

        # Fall back to environment variable
        return self._env_backend.get(key_name)

    def set_credential(
        self, key_name: str, value: str, backend: str = "env"
    ) -> None:
        """Store a credential in the specified backend.

        Args:
            key_name: The credential key.
            value: The credential value.
            backend: ``"env"`` or ``"encrypted_file"``.
        """
        if backend == "encrypted_file":
            if self._encrypted_backend is None:
                logger.warning(
                    "Encrypted file backend unavailable, falling back to env"
                )
                self._env_backend.set(key_name, value)
                return
            self._encrypted_backend.set(key_name, value)
        else:
            self._env_backend.set(key_name, value)

    def delete_credential(self, key_name: str) -> None:
        """Delete a credential from all backends."""
        self._env_backend.delete(key_name)
        if self._encrypted_backend is not None:
            self._encrypted_backend.delete(key_name)

    def list_credentials(self) -> List[str]:
        """List credential key names (never values).

        Returns a deduplicated union of keys from all backends.
        """
        keys = set()
        keys.update(self._env_backend.list_keys())
        if self._encrypted_backend is not None:
            keys.update(self._encrypted_backend.list_keys())
        return sorted(keys)


# ---------------------------------------------------------------------------
# Env backend (internal)
# ---------------------------------------------------------------------------


class _EnvBackend:
    """Environment variable backend with FLOWFORGE_ prefix."""

    def get(self, key_name: str) -> Optional[str]:
        env_key = f"{_ENV_PREFIX}{key_name}".upper()
        return os.environ.get(env_key)

    def set(self, key_name: str, value: str) -> None:
        env_key = f"{_ENV_PREFIX}{key_name}".upper()
        os.environ[env_key] = value

    def delete(self, key_name: str) -> None:
        env_key = f"{_ENV_PREFIX}{key_name}".upper()
        os.environ.pop(env_key, None)

    def list_keys(self) -> List[str]:
        prefix_len = len(_ENV_PREFIX)
        return [
            key[prefix_len:].lower()
            for key in os.environ
            if key.upper().startswith(_ENV_PREFIX)
        ]


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_credential_store_instance: Optional[CredentialStore] = None


def get_credential_store(credential_file: Optional[Path] = None) -> CredentialStore:
    """Return the singleton CredentialStore instance.

    On first call the instance is created.  If *credential_file* is
    provided on the first call it will be used to initialise the
    encrypted file backend; subsequent calls ignore the argument.

    Returns:
        The shared ``CredentialStore`` instance.
    """
    global _credential_store_instance
    if _credential_store_instance is None:
        _credential_store_instance = CredentialStore(credential_file)
    return _credential_store_instance
