# 自主任务产出审阅

- **task_id**: swarm-06ebd9f710de
- **title**: 修复代码 TODO: flowforge\harness\evidence_sensors.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-07-31T22:42:38.283674+00:00
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

# 文件路径：core/persistence/evidence_sensor.py

python

```
import hashlib
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import uuid4
from pydantic import BaseModel, Field, ConfigDict

logger = logging.getLogger(__name__)

class EvidenceSource(str, Enum):
    """证据来源枚举"""
    AGENT_OUTPUT = "agent_output"
    SENSOR_OBSERVATION = "sensor_observation"
    EXTERNAL_API = "external_api"
    USER_INPUT = "user_input"
    SYSTEM_TRACE = "system_trace"

class Evidence(BaseModel):
    """证据模型 —— Built-to-Persist。
    用于记录所有可校验的事实证据，支持完整性哈希校验。
    """
    evidence_id: str = Field(default_factory=lambda: str(uuid4()), description="证据唯一 ID")
    source_type: EvidenceSource = Field(..., description="证据来源类型")
    content: str = Field(..., description="证据内容")
    content_hash: str = Field(..., description="内容哈希（完整性校验）")
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="附加元数据"
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="采集时间 ISO 8601",
    )
    verified: bool = Field(default=False, description="是否已通过 verify")

    model_config = ConfigDict(extra="forbid")

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

    model_config = ConfigDict(extra="forbid")

# ──────────────────────────────────────────────────────────────────────────────
# EvidenceCollector
# ──────────────────────────────────────────────────────────────────────────────
class EvidenceCollector:
    """证据采集器 —— Built-to-Persist（验证反馈回路）。
    
```