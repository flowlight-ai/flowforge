"""跨模型评审数据模型 — Pydantic 数据结构定义。

定义跨模型代码评审所需的核心数据模型：
- SeverityLevel: 严重性分级（P1 阻断 / P2 应修 / P3 可选）
- ReviewFinding: 单条评审发现
- ReviewRequest: 评审请求（五件套）
- ReviewResponse: 评审响应
- ReviewerInfo: 评审者信息
- ReviewProvenance: 评审溯源记录

设计原则：
1. 同一个体不能 review 自己的代码（铁律）
2. 跨 family 优先（如 DeepSeek 写的代码用 GLM 审查）
3. 每个发现必须有明确严重性：P1/P2/P3
4. 每个发现必须有明确立场：must_fix/should_fix/consider
5. 禁止表演性同意
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    """返回当前 UTC 时间（带时区）。"""
    return datetime.now(UTC)


def _gen_id(prefix: str = "") -> str:
    """生成唯一 ID。"""
    return f"{prefix}{uuid.uuid4().hex[:12]}"


class SeverityLevel(str, Enum):
    """评审发现严重性分级。"""

    P1 = "P1"  # 阻断 — 必须修复才能合并
    P2 = "P2"  # 应修 — 应该修复，但不是阻断的
    P3 = "P3"  # 可选 — 可以修复，也可以不修


class ReviewFinding(BaseModel):
    """单条评审发现 — 必须包含明确立场和证据。"""

    finding_id: str = Field(default_factory=lambda: _gen_id("finding-"))
    severity: SeverityLevel = Field(description="严重性：P1/P2/P3")
    category: str = Field(
        description="问题类别：security|performance|correctness|style|architecture|test_coverage"
    )
    title: str = Field(description="问题标题（简短摘要）")
    description: str = Field(description="问题详细描述")
    file_path: str = Field(default="", description="涉及的文件路径")
    line_start: int = Field(default=0, ge=0, description="起始行号")
    line_end: int = Field(default=0, ge=0, description="结束行号")
    suggestion: str = Field(default="", description="修复建议")
    evidence: str = Field(default="", description="证据（代码片段/文档引用）")
    stance: str = Field(
        default="must_fix",
        description="明确立场：must_fix|should_fix|consider — 不要 'up to you'",
    )


class ReviewRequest(BaseModel):
    """评审请求 — 五件套 + 证据。

    五件套：
    1. original_requirements — 原始需求摘录（铁律：必须附）
    2. code_changes — 代码变更（diff + content）
    3. test_evidence — 测试证据
    4. self_check_report — 自检报告
    5. design_doc_ref — 设计文档引用
    """

    request_id: str = Field(default_factory=lambda: _gen_id("rev-req-"))
    author_agent: str = Field(description="写代码的 agent（如 'devforge:coder'）")
    author_model: str = Field(description="写代码用的模型（如 'DeepSeek-V4-Pro'）")
    feature_id: str = Field(description="功能 ID")
    original_requirements: str = Field(description="原始需求摘录（铁律：必须附）")
    code_changes: list[dict[str, Any]] = Field(
        default_factory=list,
        description="代码变更列表：[{file_path, diff, content}]",
    )
    test_evidence: str = Field(default="", description="测试证据（测试输出/覆盖率）")
    design_doc_ref: str = Field(default="", description="设计文档引用")
    self_check_report: str = Field(default="", description="自检报告")
    created_at: datetime = Field(default_factory=_utcnow, description="创建时间")


class ReviewResponse(BaseModel):
    """评审响应 — 包含发现列表和最终裁定。"""

    response_id: str = Field(default_factory=lambda: _gen_id("rev-res-"))
    request_id: str = Field(description="对应的评审请求 ID")
    reviewer_agent: str = Field(description="审查的 agent")
    reviewer_model: str = Field(description="审查用的模型")
    findings: list[ReviewFinding] = Field(default_factory=list, description="评审发现列表")
    overall_assessment: str = Field(default="", description="总体评估")
    p1_count: int = Field(default=0, ge=0, description="P1 发现数量")
    p2_count: int = Field(default=0, ge=0, description="P2 发现数量")
    p3_count: int = Field(default=0, ge=0, description="P3 发现数量")
    verdict: str = Field(
        description="裁定：approve|request_changes|reject"
    )
    performative_agreement_check: bool = Field(
        default=True,
        description="是否通过'禁止表演性同意'检查（True=通过，无表演性同意）",
    )
    created_at: datetime = Field(default_factory=_utcnow, description="创建时间")

    def recount_severity(self) -> None:
        """重新统计 P1/P2/P3 数量。"""
        self.p1_count = sum(1 for f in self.findings if f.severity == SeverityLevel.P1)
        self.p2_count = sum(1 for f in self.findings if f.severity == SeverityLevel.P2)
        self.p3_count = sum(1 for f in self.findings if f.severity == SeverityLevel.P3)


class ReviewerInfo(BaseModel):
    """评审者信息 — 用于配对匹配。"""

    agent_name: str = Field(description="agent 名称（如 'devforge:reviewer'）")
    model_family: str = Field(
        description="模型家族：deepseek|doubao|qwen|glm|kimi|trae|openai|anthropic"
    )
    model_name: str = Field(description="具体模型名（如 'glm-4-plus'）")
    role: str = Field(
        default="peer_reviewer",
        description="角色：peer_reviewer|lead|guardian",
    )
    available: bool = Field(default=True, description="是否可用")
    active: bool = Field(default=True, description="是否活跃")


class ReviewProvenance(BaseModel):
    """评审溯源记录 — 记录每次评审的作者-评审者配对。"""

    request_id: str = Field(description="评审请求 ID")
    author_agent: str = Field(description="作者 agent")
    reviewer_agent: str = Field(description="评审者 agent")
    cross_family: bool = Field(description="是否跨 family 评审")
    review_round: int = Field(default=1, ge=1, description="第几轮评审")
    sha: str = Field(default="", description="代码 SHA")
    created_at: datetime = Field(default_factory=_utcnow, description="创建时间")
