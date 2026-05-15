import uuid
import os
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from flowforge.core.tracing import get_trace_id, get_logger
from flowforge.core.config import system_config

logger = get_logger("auth_api")

router = APIRouter(prefix="/auth", tags=["auth"])

try:
    import jwt
    _JWT_AVAILABLE = True
except ImportError:
    _JWT_AVAILABLE = False

_ALGORITHM = "HS256"
_ACCESS_TOKEN_EXPIRE_MINUTES = 60
_REFRESH_TOKEN_EXPIRE_HOURS = 24

# SECURITY: 生产环境必须通过环境变量 FLOWFORGE_USERS 配置用户，禁止使用默认凭据
_users_db = {
    "admin": {"password": os.getenv("FLOWFORGE_ADMIN_PASSWORD", "admin123"), "role": "admin"},
    "editor": {"password": os.getenv("FLOWFORGE_EDITOR_PASSWORD", "editor123"), "role": "editor"},
    "viewer": {"password": os.getenv("FLOWFORGE_VIEWER_PASSWORD", "viewer123"), "role": "viewer"},
}

_env_users = os.getenv("FLOWFORGE_USERS")
if _env_users:
    import json as _json
    try:
        _users_db = _json.loads(_env_users)
    except _json.JSONDecodeError:
        pass


class TokenRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


def _make_response(data: dict) -> dict:
    return {
        "status": "success",
        "data": data,
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat() + "Z"},
    }


def _make_error(code: str, message: str, details: dict = None) -> dict:
    return {
        "status": "error",
        "error": {"code": code, "message": message, "details": details or {}},
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat() + "Z"},
    }


def _create_token(user_id: str, role: str, expires_delta: timedelta) -> str:
    if not _JWT_AVAILABLE:
        raise RuntimeError("PyJWT is not installed. Run: pip install PyJWT")
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "iat": now,
        "exp": now + expires_delta,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, system_config.secret_key, algorithm=_ALGORITHM)


@router.post("/token")
async def create_token(request: TokenRequest):
    if not _JWT_AVAILABLE:
        raise HTTPException(status_code=501, detail=_make_error(
            "NOT_IMPLEMENTED", "PyJWT is not installed. Run: pip install PyJWT"))
    user = _users_db.get(request.username)
    if user is None or user["password"] != request.password:
        raise HTTPException(status_code=401, detail=_make_error(
            "AUTH_FAILED", "Invalid username or password"))
    access_token = _create_token(request.username, user["role"],
                                 timedelta(minutes=_ACCESS_TOKEN_EXPIRE_MINUTES))
    refresh_token = _create_token(request.username, user["role"],
                                  timedelta(hours=_REFRESH_TOKEN_EXPIRE_HOURS))
    logger.info(f"token issued for user={request.username}")
    return _make_response({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": _ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    })


@router.post("/refresh")
async def refresh_token(request: RefreshRequest):
    if not _JWT_AVAILABLE:
        raise HTTPException(status_code=501, detail=_make_error(
            "NOT_IMPLEMENTED", "PyJWT is not installed. Run: pip install PyJWT"))
    try:
        payload = jwt.decode(request.refresh_token, system_config.secret_key, algorithms=[_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail=_make_error(
            "TOKEN_EXPIRED", "Refresh token has expired"))
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail=_make_error(
            "INVALID_TOKEN", "Invalid refresh token"))
    user_id = payload.get("sub")
    role = payload.get("role")
    user = _users_db.get(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail=_make_error(
            "USER_NOT_FOUND", "User no longer exists"))
    access_token = _create_token(user_id, role,
                                 timedelta(minutes=_ACCESS_TOKEN_EXPIRE_MINUTES))
    refresh_token = _create_token(user_id, role,
                                  timedelta(hours=_REFRESH_TOKEN_EXPIRE_HOURS))
    logger.info(f"token refreshed for user={user_id}")
    return _make_response({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": _ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    })
