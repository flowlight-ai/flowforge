# 自主任务产出审阅

- **task_id**: swarm-0916e1022802
- **title**: 修复代码 TODO: flowforge\harness\evidence_sensors.py
- **agent**: forgemind:sherlock
- **model**: glm-4-flash
- **generated_at**: 2026-08-01T11:18:38.181256+00:00
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

```python
# flowforge\harness\evidence_sensors.py

"""Evidence & Sensors — Harness 第 3 层：验证现实。

对应 roleagent.md §3.2 Harness 七层中的"验证现实"层（F009）。
解决开放环境失败模式 3：验证失败（agent 声称做完但没证据）。

核心机制：
    agent 声称完成时，必须提供可验证的证据（commit / test / trace / screenshot / log）。
    EvidenceCollector 负责采集 + 哈希校验 + 自动验证。
    SensorBase 提供主动感知机制，定期观测环境状态。

半衰期标记（roleagent.md §1.3）：
    - Evidence 数据模型 → Built-to-Persist（验证锚点）
    - EvidenceSource 枚举 → Built-to-Persist（架构契约）
    - EvidenceCollector → Built-to-Persist（验证反馈回路）
    - SensorBase 抽象 → Built-to-Persist（探针基础设施）

设计依据：
    - F009-evidence-sensors.md
    - roleagent.md §3.1（验证失败）+ §3.2（七层）+ §2.2（五项终止条件 2：证据已附）
    - ADR 007 §3（Evidence & Sensors）

铁律遵守：
    - 铁律 3：抽象类定义依赖契约，不直接实例化外部服务
    - 铁律 5：哈希算法通过配置注入
    - 编程红线 9：使用组合（Pydantic 字段）而非继承表达数据模型
    - 编程红线 11：提示词外置到 config/prompts.yaml

License: MIT
"""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("harness.evidence_sensors")


# ──────────────────────────────────────────────────────────────────────────────
# 枚举与数据模型
# ──────────────────────────────────────────────────────────────────────────────


class EvidenceSource(str, Enum):
    """证据来源类型 —— Built-to-Persist。

    对应 roleagent.md §2.2 五项终止条件中的"证据已附"。
    每种来源对应不同的验证手段。
    """

    COMMIT = "commit"  # git commit hash
    TEST = "test"  # 测试用例通过结果
    TRACE = "trace"  # 执行 trace 日志
    SCREENSHOT = "screenshot"  # DOM / UI 截图（T8 测试铁律）
    LOG = "log"  # 运行日志


class Evidence(BaseModel):
    """证据记录 —— Built-to-Persist。

    每条证据代表一个可验证的产出锚点。
    hash 字段用于校验证据内容未被篡改。

    Attributes:
        evidence_id: 证据唯一 ID。
        source_type: 证据来源类型枚举。
        content: 证据内容（commit hash / 测试输出 / trace 摘要 等）。
        hash: 内容哈希（用于完整性校验）。
        metadata: 附加元数据（如 commit_url / test_run_id）。
        created_at: 采集时间 ISO 8601。
        verified: 是否已通过 verify。
    """

    evidence_id: str = Field(
        default_factory=lambda: f"ev-{uuid4().hex[:12]}",
        description="证据唯一 ID",
    )
    source_type: EvidenceSource = Field(..., description="证据来源类型")
    content: str = Field(..., description="证据内容")
    hash: str = Field(..., description="内容哈希（完整性校验）")
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="附加元数据"
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="采集时间 ISO 8601",
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
        4. 保留期管理（超过 retention_days 的证据归档）

    # Built-to-Persist: 验证反馈回路是复利型基础设施

    Attributes:
        hash_algorithm: 哈希算法名（sha256 / md5）。
        retention_days: 证据保留期（天）。
        auto_verify: 是否自动调用 verify。
        enabled_sources: 启用的证据来源类型集合。
        storage: 内存存储（生产环境应替换为持久存储）。
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
            hash=self._compute_hash(content),
            metadata=metadata or {},
        )
        self.storage[evidence.evidence_id] = evidence

        if self.auto_verify:
            evidence.verified = await self.verify(evidence)

        logger.info(
            "Evidence collected",
            evidence_id=evidence.evidence_id,
            source_type=source_type.value,
            hash=evidence.hash[:16] + "...",
            verified=evidence.verified,
        )
        return evidence

    async def verify(self, evidence: Evidence) -> bool:
        """校验证据完整性。

        重新计算内容哈希，与 evidence.hash 比对。
        若不匹配，说明证据被篡改或截断。

        Args:
            evidence: 待校验的证据。

        Returns:
            True 表示哈希匹配（证据完整）；False 表示不匹配。
        """
        actual_hash = self._compute_hash(evidence.content)
        if actual_hash != evidence.hash:
            logger.warning(
                "Evidence hash mismatch",
                evidence_id=evidence.evidence_id,
                expected=evidence.hash[:16] + "...",
                actual=actual_hash[:16] + "...",
            )
            return False
        logger.debug(
            "Evidence verified",
            evidence_id=evidence.evidence_id,
            source_type=evidence.source_type.value,
        )
        return True

    def get_evidence(self, evidence_id: str) -> Optional[Evidence]:
        """按 ID 查询证据。"""
        return self.storage.get(evidence_id)

    def list_evidence(
        self, source_type: Optional[EvidenceSource] = None
    ) -> list[Evidence]:
        """列出证据（可按来源过滤）。"""
        if source_type is None:
            return list(self.storage.values())
        return [
            e for e in self.storage.values() if e.source_type == source_type
        ]


# ──────────────────────────────────────────────────────────────────────────────
# SensorBase 抽象
# ──────────────────────────────────────────────────────────────────────────────


class SensorBase(ABC):
    """传感器抽象基类 —— Built-to-Persist（探针基础设施）。

    roleagent.md §3.2 第三层的主动感知组件。
    定期观测环境状态，返回 SensorReading。

    实现者需实现 observe() 方法，描述具体感知逻辑。
    典型实现：FileWatcher / GitLogSensor / TestRunnerSensor / TraceLatencySensor。

    Attributes:
        sensor_id: 传感器实例 ID。
        name: 传感器名称（人类可读）。
    """

    def __init__(self, sensor_id: str, name: str = "") -> None:
        self.sensor_id = sensor_id
        self.name = name or sensor_id

    @abstractmethod
    async def observe(self) -> SensorReading:
        """观测环境状态，返回读数。

        实现者应在此方法中执行具体感知逻辑（如读文件 / 调 API / 跑测试）。
        若检测到异常，应设置 SensorReading.anomaly=True。
        """
        raise NotImplementedError


__all__ = [
    "EvidenceSource",
    "Evidence",
    "SensorReading",
    "EvidenceCollector",
    "SensorBase",
]
```