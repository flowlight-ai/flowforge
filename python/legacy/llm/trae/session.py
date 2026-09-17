"""Trae LLM 会话管理.

管理 Trae LLM 客户端的会话上下文，支持持久化到 SQLite。
通过 flowforge MemoryManager 进行持久化，不直接操作数据库（铁律4）。
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional

from flowforge.core.tracing import get_logger

from flowforge.llm.trae.config import TraeConfig

logger = get_logger("trae_llm.session")

# MemoryManager 的 short_term 存储使用的 key 前缀
_SESSION_KEY_PREFIX = "trae_session:"


class TraeSession:
    """Trae LLM 会话上下文.

    维护一个会话的消息历史，支持持久化到 SQLite（通过 MemoryManager）。
    每个会话有唯一的 session_id，用于关联 devforge 的任务。
    """

    def __init__(self, session_id: str, config: TraeConfig):
        self.session_id = session_id
        self._config = config
        self._messages: List[Dict[str, str]] = []
        self._created_at: float = time.time()
        self._updated_at: float = time.time()
        self._memory_manager: Optional[Any] = None

    def add_message(self, role: str, content: str) -> None:
        """添加消息到会话历史.

        Args:
            role: 消息角色 (system | user | assistant)
            content: 消息内容
        """
        if role not in ("system", "user", "assistant"):
            raise ValueError(f"role 必须是 system/user/assistant，得到: {role}")
        self._messages.append({"role": role, "content": content})
        self._updated_at = time.time()
        logger.debug(
            f"Session {self.session_id} 添加消息: role={role}, "
            f"len={len(content)}, total_messages={len(self._messages)}"
        )

    def get_context(self) -> List[Dict[str, str]]:
        """获取会话上下文（role/content 列表）.

        Returns:
            消息列表的副本。
        """
        return list(self._messages)

    def clear(self) -> None:
        """清除会话历史."""
        self._messages.clear()
        self._updated_at = time.time()
        logger.debug(f"Session {self.session_id} 已清除")

    def set_memory_manager(self, memory_manager: Any) -> None:
        """设置 MemoryManager 用于持久化（依赖注入，铁律3）.

        Args:
            memory_manager: flowforge MemoryManager 实例
        """
        self._memory_manager = memory_manager

    async def save(self) -> None:
        """持久化会话到 SQLite（通过 MemoryManager，不直接操作数据库）.

        如果未配置 session_persistence 或未注入 MemoryManager，则跳过。
        """
        if not self._config.session_persistence:
            return
        if self._memory_manager is None:
            logger.debug(
                f"Session {self.session_id} 未注入 MemoryManager，跳过持久化"
            )
            return
        try:
            data = {
                "session_id": self.session_id,
                "messages": self._messages,
                "created_at": self._created_at,
                "updated_at": self._updated_at,
            }
            key = f"{_SESSION_KEY_PREFIX}{self.session_id}"
            await self._memory_manager.save("short_term", key, data)
            logger.debug(f"Session {self.session_id} 已持久化 ({len(self._messages)} 条消息)")
        except Exception as e:
            logger.warning(f"Session {self.session_id} 持久化失败: {e}")

    async def load(self) -> None:
        """从持久化加载会话.

        如果未配置 session_persistence 或未注入 MemoryManager，则跳过。
        """
        if not self._config.session_persistence:
            return
        if self._memory_manager is None:
            logger.debug(
                f"Session {self.session_id} 未注入 MemoryManager，跳过加载"
            )
            return
        try:
            key = f"{_SESSION_KEY_PREFIX}{self.session_id}"
            results = await self._memory_manager.retrieve("short_term", key)
            if results:
                # retrieve 返回的是 search 结果列表，取第一个匹配的
                item = results[0]
                data = item.get("value", item) if isinstance(item, dict) else item
                if isinstance(data, dict) and "messages" in data:
                    self._messages = data["messages"]
                    self._created_at = data.get("created_at", self._created_at)
                    self._updated_at = data.get("updated_at", self._updated_at)
                    logger.debug(
                        f"Session {self.session_id} 已加载 ({len(self._messages)} 条消息)"
                    )
        except Exception as e:
            logger.warning(f"Session {self.session_id} 加载失败: {e}")

    def to_dict(self) -> Dict[str, Any]:
        """序列化会话为字典."""
        return {
            "session_id": self.session_id,
            "messages": self._messages,
            "created_at": self._created_at,
            "updated_at": self._updated_at,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any], config: TraeConfig) -> TraeSession:
        """从字典反序列化会话."""
        session = cls(data["session_id"], config)
        session._messages = data.get("messages", [])
        session._created_at = data.get("created_at", time.time())
        session._updated_at = data.get("updated_at", time.time())
        return session


class TraeSessionManager:
    """Trae LLM 会话管理器.

    管理多个 TraeSession 实例，支持创建、获取、关闭会话。
    """

    def __init__(self, config: Optional[TraeConfig] = None):
        self._config = config or TraeConfig()
        self._sessions: Dict[str, TraeSession] = {}
        self._memory_manager: Optional[Any] = None

    def set_memory_manager(self, memory_manager: Any) -> None:
        """注入 MemoryManager（依赖注入，铁律3）.

        设置后，所有新建的会话都会自动使用该 MemoryManager 进行持久化。
        """
        self._memory_manager = memory_manager

    def create_session(self, session_id: str) -> TraeSession:
        """创建新会话.

        如果 session_id 已存在，返回现有会话。

        Args:
            session_id: 会话唯一标识（如 devforge:coder:task123）

        Returns:
            TraeSession 实例
        """
        if session_id in self._sessions:
            logger.debug(f"Session {session_id} 已存在，返回现有会话")
            return self._sessions[session_id]
        session = TraeSession(session_id, self._config)
        if self._memory_manager is not None:
            session.set_memory_manager(self._memory_manager)
        self._sessions[session_id] = session
        logger.info(f"创建会话: {session_id}")
        return session

    def get_session(self, session_id: str) -> Optional[TraeSession]:
        """获取会话.

        Args:
            session_id: 会话唯一标识

        Returns:
            TraeSession 实例，不存在则返回 None
        """
        return self._sessions.get(session_id)

    def close_session(self, session_id: str) -> None:
        """关闭会话（从内存中移除）.

        注意：不会删除已持久化的数据。

        Args:
            session_id: 会话唯一标识
        """
        if session_id in self._sessions:
            del self._sessions[session_id]
            logger.info(f"关闭会话: {session_id}")

    def list_sessions(self) -> List[str]:
        """列出所有活跃会话 ID."""
        return list(self._sessions.keys())

    async def close_all(self) -> None:
        """关闭所有会话."""
        self._sessions.clear()
        logger.info("所有会话已关闭")
