# -*- coding: utf-8 -*-
"""EchoStore 记忆存储统一接口（P-109）.

所有记忆存储子类实现该抽象接口，保证 MemoryManager 的 save() / retrieve() /
hybrid_search() 可以一致地调用，避免运行时 AttributeError / TypeError。
"""
from abc import ABC, abstractmethod
from typing import Any


class EchoStore(ABC):
    """记忆存储统一接口 — P-109.

    各存储子类（short_term / long_term / semantic / episodic / working）
    必须实现 store() 与 search()；search() 统一使用 limit 关键字参数。
    """

    @abstractmethod
    async def store(self, key: str, value: Any) -> None:
        """写入一条记忆。"""

    @abstractmethod
    async def search(self, query: str, limit: int = 10) -> list:
        """按关键字检索记忆，返回条目列表。"""
