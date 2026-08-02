# 自主任务产出审阅

- **task_id**: swarm-f0acdeef6155
- **title**: 修复代码 TODO: flowforge\harness\durable_state.py
- **agent**: forgemind:sherlock
- **model**: openrouter/poolside/laguna-xs-2.1:free
- **generated_at**: 2026-07-31T23:13:31.404245+00:00
- **source_file**: flowforge\harness\durable_state.py
- **required_capabilities**: code_generation

## 审阅指南

1. 检查产出的代码是否符合项目规范（CONTRIBUTING.md 15 条红线）
2. 检查是否引入循环依赖或违反分层架构
3. 通过审核后，将下方代码块内容应用到对应源文件
4. 应用后必须运行对应测试验证（铁律 T1-T8）

## 任务上下文

```
文件 flowforge\harness\durable_state.py 中发现 3 处 TODO/FIXME/NotImplementedError。请分析代码上下文并实现缺失的逻辑。
```

## LLM 产出内容

# 文件路径：flowforge/core/durable_state/base.py

python

```
"""
Durable State 持久状态层 — Built-to-Persist
roleagent.md §3.2 第一层"感知现实"统一读写接口
后端实现：SQLite / Git 文件仓库
不变量约束：
1. read 不存在返回 None，不抛出异常
2. write 自动版本自增（乐观锁）
3. delete 返回布尔标记是否成功
4. 全部接口 async/await，适配异步事件循环
License: MIT
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
import subprocess
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

from flowforge.core.logging import get_logger

logger = get_logger("durable_state")

class DurableState(BaseModel):
    """持久化单条状态记录模型。"""
    state_id: str = Field(
        default_factory=lambda: uuid.uuid4().hex,
        description="记录唯一 ID",
    )
    key: str = Field(..., description="状态键")
    value: Any = Field(..., description="状态值（JSON 可序列化）")
    version: int = Field(default=1, ge=1, description="乐观锁版本号")
    last_writer: str = Field(..., description="最后写入者标识")
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="创建时间 ISO 8601",
    )
    updated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="最后更新时间 ISO 8601",
    )

# ──────────────────────────────────────────────────────────────────────────────
# 抽象接口
# ──────────────────────────────────────────────────────────────────────────────
class DurableStateSurface(ABC):
    """Durable State Surface 抽象接口 —— Built-to-Persist。
    roleagent.md §3.2 第一层"感知现实"的统一读写接口。
    所有具体后端（SQLite / Git / 文件系统 / 数据库）必须实现此接口。
    关键不变量：
    1. read 不存在时返回 None（不抛异常）
    2. write 自动版本自增（乐观锁）
    3. delete 返回是否删除成功（不存在返回 False）
    4. 所有操作 async，适配 IO-bound 场景
    """

    @abstractmethod
    async def read(self, key: str) -> Optional[Any]:
        """读取指定 key 的当前值。
        Args:
            key: 状态键。
        Returns:
            状态值；不存在时返回 None。
        """
        raise NotImplementedError("Subclass must implement read()")

    @abstractmethod
    async def write(self, key: str, value: Any, writer: str) -> DurableState:
        """写入状态（自动版本自增）。
        Args:
            key: 状态键。
            value: 状态值（JSON 可序列化）。
            writer: 写入者标识（agent_id / operator_id）。
        Returns:
            写入后的 DurableState 记录。
        """
        raise NotImplementedError("Subclass must implement write()")

    @abstractmethod
    async def delete(self, key: str) -> bool:
        """删除指定 key。
        Args:
            key: 状态键。
        Returns:
            True 表示删除成功；False 表示 key 不存在。
        """
        raise NotImplementedError("Subclass must implement delete()")

# ──────────────────────────────────────────────────────────────────────────────
# SQLite 实现
# ──────────────────────────────────────────────────────────────────────────────
class SqliteDurableState(DurableStateSurface):
    """SQLite 后端 DurableState 实现 —— Built-to-Persist。
    
```