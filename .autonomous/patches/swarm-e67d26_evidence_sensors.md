# 自主任务产出审阅

- **task_id**: swarm-e67d2657bde1
- **title**: 修复代码 TODO: flowforge\harness\evidence_sensors.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-08-01T09:27:21.699945+00:00
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

# 文件路径：flowforge/core/evidence_sensor.py

python

```
import asyncio
import hashlib
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Optional, Self
from uuid import uuid4

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# 前置枚举定义（与项目现有 EvidenceSource 对齐，如已有外部定义可直接删除本段）
class EvidenceSource(str):
    TOOL_CALL = "tool_call"
    FILE_READ = "file_read"
    FILE_WRITE = "file_write"
    LLM_TRACE = "llm_trace"
    COMMAND_EXEC = "command_exec"
    MANUAL = "manual"

class Evidence(BaseModel):
    evidence_id: str = Field(
        default_factory=lambda: f"ev-{uuid4().hex[:12]}",
        description="证据唯一 ID",
    )
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

    # 兼容旧序列化数据，提供别名映射
    model_config = {"populate_by_name": True}

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
    """

    def __init__(
        self,
        hash_algorithm: str = "sha256",
        retention_days: int = 90,
        auto_verify: bool = True,
        enabled_sources: Optional[set[EvidenceSource]] = None,
    ) -> None:
        self.hash_algorithm = hash_algorithm
        self.retention_days = retention_days
        self.auto_verify = auto_verify
        self.enabled_sources = enabled_sources or set(EvidenceSource)
        # 内存存储（生产环境应替换为持久存储）
        self.storage: dict[str, Evidence] = {}

        logger.info(
            "EvidenceCollector initialized",
            hash_algorithm=hash_algorithm,
            retention_days=retention_days,
            auto_verify=auto_verify,
            enabled_sources=[s.value for s in self.enabled_sources],
        )

    def _compute_hash(self, content: str) -> str:
        """计算内容哈希。
        Args:
            content: 待哈希的内容字符串。
        Returns:
            十六进制哈希字符串。
        """
        algo = hashlib.new(self.hash_algorithm)
        algo.update(content.encode("utf-8"))
        return algo.hexdigest()

    async def collect(
        self,
        source_type: EvidenceSource,
        content: str,
        metadata: Optional[dict[str, Any]] = None,
    ) -> Evidence:
        """采集一条证据。
        Args:
            source_type: 证据来源类型。
            content: 证据内容。
            metadata: 附加元数据。
        Returns:
            采集的 Evidence 对象（已计算 hash）。
        Raises:
            ValueError: 来源类型未启用。
        """
        if source_type not in self.enabled_sources:
            raise ValueError(
                f"EvidenceSource '{source_type.value}' is not enabled; "
                f"enabled: {[s.value for s in self.enabled_sources]}"
            )

        evidence = Evidence(
            source_type=source_type,
            content=content,
            content_hash=self._compute_hash(content),
            metadata=metadata or {},
        )
        self.storage[evidence.evidence_id] = evidence

        if self.auto_verify:
            evidence.verified = await self.verify(evidence)

        logger.info(
            "Evidence collected",
            evidence_id=evidence.evidence_id,
            source

```