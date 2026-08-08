"""Persona Lock — 异步锁管理器，确保同一 Persona 在 Loop 执行期间不被其他任务抢占。

设计原则：
- 基于 asyncio.Lock 的字典，每个 persona_id 对应一把锁
- 提供 async context manager 接口：``async with persona_lock.acquire(persona_id)``
- 支持手动释放（用于用户停止 Loop 场景）
- 线程安全：所有操作在事件循环中完成
"""

import asyncio
from contextlib import asynccontextmanager
from typing import Optional

from flowforge.core.tracing import get_logger

logger = get_logger("core.persona_lock")


class PersonaLock:
    """Persona 级别的异步锁管理器。

    每个 persona_id 对应一把 asyncio.Lock，确保同一 Persona
    在 Loop 执行期间不会被其他任务抢占。

    Usage::

        persona_lock = PersonaLock()

        # 在 LoopExecutor 中：整个 Loop 期间持有锁
        async with persona_lock.acquire("education"):
            for attempt in range(max_retries):
                ...  # 迭代逻辑

        # 手动停止时强制释放
        persona_lock.release("education")
    """

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = {}
        self._holders: dict[str, str] = {}  # persona_id -> holder info (e.g. loop_id)

    def _get_lock(self, persona_id: str) -> asyncio.Lock:
        """获取或创建 persona_id 对应的锁。"""
        if persona_id not in self._locks:
            self._locks[persona_id] = asyncio.Lock()
        return self._locks[persona_id]

    @asynccontextmanager
    async def acquire(self, persona_id: str, holder: str = ""):
        """获取 persona_id 对应的锁，作为异步上下文管理器使用。

        Args:
            persona_id: Persona 标识符。
            holder: 持有者信息（如 loop_id），用于调试和日志。
        """
        lock = self._get_lock(persona_id)
        await lock.acquire()
        self._holders[persona_id] = holder
        logger.info(f"PersonaLock acquired | persona={persona_id} holder={holder}")
        try:
            yield
        finally:
            if lock.locked():
                lock.release()
            self._holders.pop(persona_id, None)
            logger.info(f"PersonaLock released | persona={persona_id} holder={holder}")

    def release(self, persona_id: str) -> bool:
        """手动释放 persona_id 对应的锁（用于用户停止 Loop 场景）。

        注意：此方法只能在锁已被 acquire 但需要提前释放时调用。
        如果锁未被持有则返回 False。

        Args:
            persona_id: Persona 标识符。

        Returns:
            True 表示成功释放，False 表示锁未被持有。
        """
        lock = self._locks.get(persona_id)
        if lock is None or not lock.locked():
            return False

        holder = self._holders.get(persona_id, "")
        lock.release()
        self._holders.pop(persona_id, None)
        logger.info(f"PersonaLock manually released | persona={persona_id} holder={holder}")
        return True

    def is_locked(self, persona_id: str) -> bool:
        """检查 persona_id 对应的锁是否被持有。"""
        lock = self._locks.get(persona_id)
        return lock is not None and lock.locked()

    def get_holder(self, persona_id: str) -> Optional[str]:
        """获取 persona_id 对应锁的持有者信息。"""
        return self._holders.get(persona_id)
