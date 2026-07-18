"""SessionManager — 三方 Agent 会话管理（EAC v1 契约 3 Session）。

会话隔离与共享：每个 forgekin × provider 组合可拥有独立会话，
session_id 作为跨调用追踪与状态共享的命名空间键。

设计依据：
    - [doc:review/review.md#13.3] F241 CL-016 ACP transport（session 维度）
    - [doc:design/naming-contract.md#2.2] 灵印（forgekin_id 命名空间隔离）
    - [doc:design.md v7.1-§D6.2] EAC v1 七契约 #3 Session

铁律遵守：
    - 铁律 3：依赖通过构造函数注入（无外部依赖时构造函数留空，
      由 DI 容器管理生命周期，禁止在类内 self-instantiate）
    - 编程红线 7：本类为具体实现类（非抽象基类），ABC 不适用
    - 编程红线 12：禁止绕过 DI 容器直接实例化
    - 所有 I/O 操作使用 async/await（为未来持久化后端预留 API）

License: MIT
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.session_manager")


class SessionInfo(BaseModel):
    """会话信息（单条会话元数据）。

    Attributes:
        session_id: 会话唯一标识（sess-{provider}-{forgekin_id}-{ts}-{rand6}）。
        forgekin_id: 灵智体 ID（命名空间隔离键，[doc:design/naming-contract.md#2.2] 灵印）。
        provider_name: 三方 Agent Provider 名称。
        created_at: 创建时间（UTC）。
        expires_at: 过期时间（UTC）。
        shared_context: 会话共享上下文（跨调用传递的状态字典）。
    """

    session_id: str = Field(..., description="会话唯一标识")
    forgekin_id: str = Field(..., description="灵智体 ID")
    provider_name: str = Field(..., description="Provider 名称")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="创建时间（UTC）",
    )
    expires_at: datetime = Field(..., description="过期时间（UTC）")
    shared_context: dict[str, Any] = Field(
        default_factory=dict, description="会话共享上下文"
    )


class SessionManager:
    """三方 Agent 会话管理器（EAC v1 契约 3 Session）。

    会话隔离与共享：每个 forgekin × provider 组合可拥有独立会话，
    session_id 作为跨调用追踪与状态共享的命名空间键。

    详见 [doc:design.md v7.1-§D6.2] EAC v1 七契约 #3 Session

    设计要点：
        - session_id 格式：sess-{provider}-{forgekin_id}-{timestamp}-{random6}
        - 仅内存存储（dict），TTL 过期检查在 get_session 时惰性清理
        - shared_context 供跨调用传递状态（与 ExternalAgentSharedState 互补）
    """

    def __init__(self) -> None:
        """初始化空会话表。

        会话数据通过 create_session 填充。本类为具体实现，由 DI 容器
        管理生命周期（编程红线 12）。
        """
        self._sessions: dict[str, SessionInfo] = {}

    async def create_session(
        self,
        forgekin_id: str,
        provider_name: str,
        ttl_seconds: int = 3600,
    ) -> SessionInfo:
        """创建新会话。

        Args:
            forgekin_id: 灵智体 ID。
            provider_name: Provider 名称。
            ttl_seconds: 会话有效期（秒），默认 3600。

        Returns:
            新创建的 SessionInfo。
        """
        now = datetime.now(timezone.utc)
        session_id = self._gen_session_id(provider_name, forgekin_id, now)
        session = SessionInfo(
            session_id=session_id,
            forgekin_id=forgekin_id,
            provider_name=provider_name,
            created_at=now,
            expires_at=now + timedelta(seconds=ttl_seconds),
            shared_context={},
        )
        self._sessions[session_id] = session
        logger.info(
            "session.create forgekin=%s provider=%s ttl=%d sid=%s",
            forgekin_id,
            provider_name,
            ttl_seconds,
            session_id,
        )
        return session

    async def get_session(self, session_id: str) -> Optional[SessionInfo]:
        """获取会话（惰性清理过期会话）。

        Args:
            session_id: 会话唯一标识。

        Returns:
            SessionInfo（若已过期或不存在返回 None）。
        """
        session = self._sessions.get(session_id)
        if session is None:
            return None
        # 惰性清理：过期会话立即清除
        if datetime.now(timezone.utc) > session.expires_at:
            del self._sessions[session_id]
            logger.debug(
                "session.expired lazy_cleanup sid=%s", session_id
            )
            return None
        return session

    async def extend_session(self, session_id: str, ttl_seconds: int) -> bool:
        """延长会话有效期。

        Args:
            session_id: 会话唯一标识。
            ttl_seconds: 新的有效期（秒，从当前时刻起算）。

        Returns:
            是否成功延长（会话不存在或已过期返回 False）。
        """
        session = await self.get_session(session_id)
        if session is None:
            return False
        session.expires_at = datetime.now(timezone.utc) + timedelta(
            seconds=ttl_seconds
        )
        logger.debug(
            "session.extend sid=%s new_ttl=%d expires_at=%s",
            session_id,
            ttl_seconds,
            session.expires_at.isoformat(),
        )
        return True

    async def close_session(self, session_id: str) -> bool:
        """主动关闭会话（立即从内存移除）。

        Args:
            session_id: 会话唯一标识。

        Returns:
            是否成功关闭（不存在返回 False）。
        """
        if session_id in self._sessions:
            del self._sessions[session_id]
            logger.info("session.close sid=%s", session_id)
            return True
        return False

    async def list_active_sessions(
        self, forgekin_id: str
    ) -> list[SessionInfo]:
        """列出某灵智体的所有活跃会话（惰性清理过期）。

        Args:
            forgekin_id: 灵智体 ID。

        Returns:
            活跃会话列表（已过期的不返回，且会被清理）。
        """
        now = datetime.now(timezone.utc)
        # 惰性清理过期会话
        expired_sids = [
            sid
            for sid, s in self._sessions.items()
            if now > s.expires_at
        ]
        for sid in expired_sids:
            del self._sessions[sid]
        if expired_sids:
            logger.debug(
                "session.list expired_cleaned=%d forgekin=%s",
                len(expired_sids),
                forgekin_id,
            )
        return [
            s
            for s in self._sessions.values()
            if s.forgekin_id == forgekin_id
        ]

    @staticmethod
    def _gen_session_id(
        provider: str, forgekin_id: str, now: datetime
    ) -> str:
        """生成 session_id。

        格式：sess-{provider}-{forgekin_id}-{timestamp}-{random6}
        其中 timestamp 为 UTC 时间紧凑格式，random6 为 6 位 hex。
        """
        ts = now.strftime("%Y%m%dT%H%M%S")
        rand6 = secrets.token_hex(3)  # 3 bytes = 6 hex chars
        return f"sess-{provider}-{forgekin_id}-{ts}-{rand6}"
