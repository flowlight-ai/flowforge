"""API Key 认证中间件 — 从 OpenSieve 提取并通用化.

与 OpenSieve 的 AuthMiddleware 保持一致：
- 支持 X-API-Key 和 Authorization: Bearer 两种请求头
- SHA256 哈希存储 API Key
- 未配置 Key 时默认放行
- 支持环境变量和配置文件两种 Key 来源
"""

import hashlib
import logging
import os
import time
from typing import Optional, Dict, Any

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class APIKeyAuth:
    """API Key 认证管理器 — 通用版本，可被任何 FlowForge 项目复用。"""

    def __init__(self, env_prefix: str = "FLOWFORGE", config_keys: Optional[Dict[str, Any]] = None):
        """初始化认证管理器。

        Args:
            env_prefix: 环境变量前缀，如 CONTENTFORGE → CONTENTFORGE_API_KEYS
            config_keys: 从配置文件加载的 API Key 列表，格式:
                [
                    {"key": "or-local", "name": "local-dev", "rate_limit": 0},
                    ...
                ]
        """
        self._api_keys: Dict[str, Dict[str, Any]] = {}  # key_hash -> info
        self._env_prefix = env_prefix
        self._load_keys(config_keys or [])

    def _load_keys(self, config_keys: list):
        """从环境变量和配置加载 API Keys。"""
        # 1. 从环境变量加载: {PREFIX}_API_KEYS=key1:name1:30,key2:name2:60
        keys_env = os.environ.get(f"{self._env_prefix}_API_KEYS", "")
        if keys_env:
            for entry in keys_env.split(","):
                parts = entry.strip().split(":")
                if len(parts) >= 1 and parts[0]:
                    key = parts[0]
                    name = parts[1] if len(parts) > 1 else "default"
                    rate_limit = int(parts[2]) if len(parts) > 2 else 60
                    self._add_key(key, name, rate_limit)

        # 2. 从配置文件加载
        for entry in config_keys:
            key = entry.get("key", "")
            if not key:
                continue
            # 支持环境变量引用: ${ENV_VAR}
            if key.startswith("${") and key.endswith("}"):
                env_name = key[2:-1]
                key = os.environ.get(env_name, "")
                if not key:
                    continue
            name = entry.get("name", "config")
            rate_limit = entry.get("rate_limit", 60)
            self._add_key(key, name, rate_limit)

        # 3. 主密钥: {PREFIX}_MASTER_KEY
        master_key = os.environ.get(f"{self._env_prefix}_MASTER_KEY", "")
        if master_key:
            self._add_key(master_key, "master", 0)

    def _add_key(self, key: str, name: str, rate_limit: int):
        """添加一个 API Key。"""
        key_hash = self._hash_key(key)
        self._api_keys[key_hash] = {
            "prefix": key[:8],
            "name": name,
            "rate_limit": rate_limit,
            "created_at": time.time(),
        }
        logger.info(f"[Auth] 加载 API Key: {key[:8]}... ({name}, rate_limit={rate_limit})")

    @staticmethod
    def _hash_key(key: str) -> str:
        """SHA256 哈希 API Key。"""
        return hashlib.sha256(key.encode()).hexdigest()

    def validate_key(self, key: str) -> Optional[dict]:
        """验证 API Key，返回 key info 或 None。"""
        if not key:
            return None
        key_hash = self._hash_key(key)
        return self._api_keys.get(key_hash)

    def is_configured(self) -> bool:
        """是否配置了 API Key 认证。"""
        return len(self._api_keys) > 0


class AuthMiddleware(BaseHTTPMiddleware):
    """API Key 认证中间件 — 与 OpenSieve 保持一致。"""

    # 不需要认证的路径
    PUBLIC_PATHS = {
        "/health", "/ready", "/docs", "/openapi.json", "/redoc",
        "/api/v1/health",
    }

    def __init__(self, app, auth: APIKeyAuth):
        super().__init__(app)
        self._auth = auth

    async def dispatch(self, request: Request, call_next):
        # 公开路径免认证
        path = request.url.path
        if path in self.PUBLIC_PATHS or path.startswith("/ws"):
            return await call_next(request)

        # 未配置 Key 则放行
        if not self._auth.is_configured():
            return await call_next(request)

        # 从请求头提取 API Key
        api_key = request.headers.get("X-API-Key", "")
        if not api_key:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                api_key = auth_header[7:]

        if not api_key:
            return JSONResponse(
                status_code=401,
                content={"detail": "Missing API key. Provide X-API-Key header or Authorization: Bearer <key>"},
            )

        key_info = self._auth.validate_key(api_key)
        if not key_info:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid API key"},
            )

        # 将 key info 存入 request.state，供后续中间件使用
        request.state.api_key_info = key_info

        return await call_next(request)
