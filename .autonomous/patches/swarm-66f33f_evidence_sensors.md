# 自主任务产出审阅

- **task_id**: swarm-66f33f2240ba
- **title**: 修复代码 TODO: flowforge\harness\evidence_sensors.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-07-31T22:17:20.711627+00:00
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

# 文件路径：flowforge/agent/evidence.py

python

```
from __future__ import annotations

import hashlib
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

class EvidenceSource(str, Enum):
    """证据来源枚举"""
    TOOL_OUTPUT = "tool_output"
    LLM_TRACE = "llm_trace"
    FILE_SNAPSHOT = "file_snapshot"
    SENSOR_READING = "sensor_reading"
    USER_FEEDBACK = "user_feedback"

class Evidence(BaseModel):
    """证据持久化模型
    Attributes:
        evidence_id: 证据唯一 ID
        source_type: 证据来源类型
        content: 证据内容
        content_hash: 内容哈希（完整性校验）
        metadata: 附加元数据
        created_at: 采集时间 ISO 8601
        verified: 是否已通过 verify
    """
    evidence_id: str = Field(
        default_factory=lambda: f"ev-{uuid4().hex[:12]}",
        description="证据唯一 ID"
    )
    source_type: EvidenceSource = Field(..., description="证据来源类型")
    content: str = Field(..., description="证据内容")
    content_hash: str = Field(..., description="内容哈希（完整性校验）")
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="附加元数据"
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="采集时间 ISO 8601"
    )
    verified: bool = Field(default=False, description="是否已通过 verify")

class SensorReading(BaseModel):
    """传感器读数 —— Built-to-Persist。
    SensorBase.observe() 的返回值，描述环境当前状态。
    Attributes:
        sensor_id: 传感器实例 ID。
        reading_id: 读数唯一 ID。
        value: 读数值（任意可序列化数据）。
        unit: 单位（如 "ms" / "count" / "ratio"）。
        timestamp: 读数时间 ISO 8601。
        anomaly: 是否异常（用于触发告警）。
    """
    sensor_id: str = Field(..., description="传感器实例 ID")
    reading_id: str = Field(
        default_factory=lambda: f"rd-{uuid4().hex[:12]}",
        description="读数唯一 ID",
    )
    value: Any = Field(..., description="读数值")
    unit: str = Field(default="", description="单位")
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="读数时间 ISO 8601",
    )
    anomaly: bool = Field(default=False, description="是否异常")

# ──────────────────────────────────────────────────────────────────────────────
# EvidenceCollector
# ──────────────────────────────────────────────────────────────────────────────
class EvidenceCollector:
    """证据采集器 —— Built-to-Persist（验证反馈回路）。
    roleagent.md §3.2 第三层"验证现实"的核心组件。
    采集 agent 产出的证据并校验完整性。
    职责：
    1. 采集证据（compute hash + 写入存储）
    2. 校验证据完整性（重算 hash 比对）
    3. 自动验证（可选，调用外部 verifier）
    4. 保留期管理（超过 retention_days 的证据归档/清理）
    # Built-to-Persist: 验证反馈回路是复利型基础设施
    Attributes:

```