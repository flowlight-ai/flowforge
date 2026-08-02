# 自主任务产出审阅

- **task_id**: swarm-c47d370124fe
- **title**: 修复代码 TODO: flowforge\harness\evidence_sensors.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-08-01T06:58:09.644139+00:00
- **source_file**: flowforge\harness\evidence_sensors.py
- **required_capabilities**: code_generation

## 审阅指南

1. 检查产出的代码是否符合项目规范（CONTRIBUTING.md 15 条红线）
2. 检查是否引入循环依赖或违反分层架构
3. 通过审核后，将下方代码块内容应用到对应源文件
4. 应用后必须运行对应测试验证（铁律 T1-T8）

## 任务上下文

```
文件 flowforge\harness\evidence_sensors.py 中发现 1 处 TODO/FIXME/NotImplementedError。请分析代码上下文并实现缺失的逻辑。
```

## LLM 产出内容

python

```
import asyncio
import json
import sqlite3
import subprocess
import hashlib
import uuid
from datetime import datetime, timezone
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Optional
from pydantic import BaseModel, Field

# ──────────────────────────────────────────────────────────────────────────────
# DurableState 数据模型
# ──────────────────────────────────────────────────────────────────────────────
class DurableState(BaseModel):
    state_id: str = Field(
        default_factory=lambda: f"state-{uuid.uuid4().hex[:16]}",
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
    4. 所有操
```