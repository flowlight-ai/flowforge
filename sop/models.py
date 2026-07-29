"""SOP 数据模型 — 阶段、硬规则、陷阱、谓词配置与执行状态。

此模块定义 SOP（Standard Operating Procedure）执行引擎的核心数据结构。
SOP 用于管控多智能体自开发方法论的阶段流转，与 FlowForge LoopExecutor 配合：
- SOPExecutor 管控阶段门禁（hard_rules / pitfalls）
- LoopExecutor 管控阶段内的实际任务执行

设计原则：
- SOPExecutor 只做门禁检查和阶段推进，不直接执行任务
- 所有配置从 YAML 加载（铁律5）
- 不直接操作数据库（铁律4）
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class Severity(str, Enum):
    """规则严重程度。

    - blocker: 阻断规则，未通过则禁止进入下一阶段
    - warn: 警告级别，记录但不阻断
    """

    BLOCKER = "blocker"
    WARN = "warn"


class PredicateType(str, Enum):
    """谓词检查器类型。

    每种类型对应 predicate.py 中的一个 async 检查函数：
    - manual_only: 手动检查（返回 passed=True，附 reason 说明）
    - git_state_predicate: 检查 git 仓库状态（ahead/behind/clean）
    - env_check: 检查环境变量
    - command_pattern: 检查命令模式匹配（正则）
    - command_sequence: 检查命令序列（must_include / anti_pattern）
    - handle_check: 检查 handle 约束（reviewer_not_author / guardian_handoff_present）
    - sha_dedup: SHA 去重检查
    - feature_doc_readiness_check: feature doc 准备就绪检查
    """

    MANUAL_ONLY = "manual_only"
    GIT_STATE_PREDICATE = "git_state_predicate"
    ENV_CHECK = "env_check"
    COMMAND_PATTERN = "command_pattern"
    COMMAND_SEQUENCE = "command_sequence"
    HANDLE_CHECK = "handle_check"
    SHA_DEDUP = "sha_dedup"
    FEATURE_DOC_READINESS_CHECK = "feature_doc_readiness_check"


class PredicateConfig(BaseModel):
    """谓词配置 — 描述如何检查一条规则。

    通过 type 字段路由到对应的检查器，其余字段作为检查器参数。
    这种设计允许 YAML 配置灵活扩展新的检查类型。

    常用字段（按 type 不同而异）：
    - reason: manual_only 的说明文本
    - repository / branch / checks / before_command: git_state_predicate
    - env_vars: env_check
    - must_match / must_not_match: command_pattern
    - must_include / anti_pattern / cwd_contains: command_sequence
    - constraint: handle_check (reviewer_not_author / guardian_handoff_present)
    """

    type: PredicateType = Field(description="谓词检查器类型")
    reason: str = Field(default="", description="手动检查说明，仅 manual_only 使用")
    repository: str = Field(default="current", description="git 仓库标识")
    branch: str = Field(default="main", description="git 分支名")
    checks: list[str] = Field(default_factory=list, description="git 状态检查项")
    before_command: str = Field(default="", description="触发检查的前置命令")
    env_vars: list[str] = Field(default_factory=list, description="需要检查的环境变量名")
    must_match: str = Field(default="", description="命令必须匹配的正则")
    must_not_match: str = Field(default="", description="命令禁止匹配的正则")
    must_include: list[str] = Field(default_factory=list, description="命令序列必须包含的命令")
    anti_pattern: list[str] = Field(default_factory=list, description="命令序列禁止出现的命令")
    cwd_contains: str = Field(default="", description="工作目录需包含的子串")
    constraint: str = Field(default="", description="handle 约束名")


class PredicateResult(BaseModel):
    """谓词检查结果。

    Attributes:
        passed: 是否通过
        message: 人类可读的检查结果说明
        evidence: 检查过程中收集的证据（命令输出、状态等）
    """

    passed: bool = Field(description="是否通过")
    message: str = Field(default="", description="检查结果说明")
    evidence: dict[str, Any] = Field(default_factory=dict, description="检查证据")


class HardRule(BaseModel):
    """硬规则 — 阻断性或警告性的强制规则。

    severity=blocker 的规则未通过时，禁止推进到下一阶段。
    """

    id: str = Field(description="规则唯一标识")
    text: str = Field(description="规则文本描述")
    severity: Severity = Field(default=Severity.BLOCKER, description="严重程度")
    predicate: PredicateConfig = Field(description="谓词配置")


class Pitfall(BaseModel):
    """陷阱 — 阶段执行过程中需要警惕的常见错误。

    与 HardRule 结构相同，但语义上表示"易犯的错"而非"必须遵守的规则"。
    """

    id: str = Field(description="陷阱唯一标识")
    text: str = Field(description="陷阱文本描述")
    severity: Severity = Field(default=Severity.WARN, description="严重程度")
    predicate: PredicateConfig = Field(description="谓词配置")


class SOPStage(BaseModel):
    """SOP 阶段定义。

    Attributes:
        id: 阶段唯一标识（如 kickoff / impl / review）
        label: 阶段显示名称
        suggested_skill: 建议使用的 skill 名称（用于路由到 LoopExecutor）
        hard_rules: 硬规则列表（blocker 未通过则阻断）
        pitfalls: 陷阱列表（警告级别为主）
        optional: 是否可选阶段（可选阶段失败不阻断主流程）
    """

    id: str = Field(description="阶段唯一标识")
    label: str = Field(default="", description="阶段显示名称")
    suggested_skill: str = Field(default="", description="建议使用的 skill 名称")
    hard_rules: list[HardRule] = Field(default_factory=list, description="硬规则列表")
    pitfalls: list[Pitfall] = Field(default_factory=list, description="陷阱列表")
    optional: bool = Field(default=False, description="是否可选阶段")


class SOPDefinition(BaseModel):
    """SOP 完整定义 — 一个完整的标准作业流程。

    Attributes:
        id: SOP 唯一标识（如 development）
        domain: 所属领域（如 engineering / content / novel）
        label: SOP 显示名称
        description: SOP 描述
        stages: 阶段列表（按执行顺序）
    """

    id: str = Field(description="SOP 唯一标识")
    domain: str = Field(default="engineering", description="所属领域")
    label: str = Field(default="", description="SOP 显示名称")
    description: str = Field(default="", description="SOP 描述")
    stages: list[SOPStage] = Field(default_factory=list, description="阶段列表")


class SOPStageResult(BaseModel):
    """单个阶段的执行结果。

    Attributes:
        stage_id: 阶段标识
        stage_label: 阶段显示名称
        passed: 阶段是否通过（所有 blocker hard_rules 通过）
        hard_rule_results: 各 hard_rule 的检查结果
        pitfall_results: 各 pitfall 的检查结果
        blocker_messages: 阻断消息列表
        warning_messages: 警告消息列表
        executed_at: 执行时间
    """

    stage_id: str = Field(description="阶段标识")
    stage_label: str = Field(default="", description="阶段显示名称")
    passed: bool = Field(default=False, description="阶段是否通过")
    hard_rule_results: list[dict[str, Any]] = Field(
        default_factory=list, description="硬规则检查结果"
    )
    pitfall_results: list[dict[str, Any]] = Field(
        default_factory=list, description="陷阱检查结果"
    )
    blocker_messages: list[str] = Field(default_factory=list, description="阻断消息")
    warning_messages: list[str] = Field(default_factory=list, description="警告消息")
    executed_at: datetime = Field(default_factory=datetime.utcnow, description="执行时间")


class SOPExecutionState(BaseModel):
    """SOP 执行状态 — 跨阶段持久化的执行上下文。

    通过 stage_index 跟踪当前阶段，stage_results 记录历史。
    可由 CheckpointManager 持久化以支持断点续跑（P35 长程任务执行规范）。

    Attributes:
        sop_id: 关联的 SOP 定义 ID
        feature_id: 当前 feature 标识（用于关联 feature doc）
        stage_index: 当前阶段索引（0-based）
        stage_results: 各阶段的执行结果（key 为 stage_id）
        started_at: SOP 开始时间
        completed: SOP 是否已完成
    """

    sop_id: str = Field(description="关联的 SOP 定义 ID")
    feature_id: str = Field(default="", description="当前 feature 标识")
    stage_index: int = Field(default=0, description="当前阶段索引")
    stage_results: dict[str, Any] = Field(
        default_factory=dict, description="各阶段执行结果"
    )
    started_at: datetime = Field(default_factory=datetime.utcnow, description="开始时间")
    completed: bool = Field(default=False, description="是否已完成")


class SOPExecutionResult(BaseModel):
    """SOP 完整执行结果。

    Attributes:
        sop_id: SOP 标识
        feature_id: feature 标识
        success: 是否成功完成所有阶段
        stage_results: 各阶段执行结果
        final_stage_id: 最终到达的阶段
        blocker_messages: 全部阻断消息
        warning_messages: 全部警告消息
        started_at: 开始时间
        completed_at: 完成时间
    """

    sop_id: str = Field(description="SOP 标识")
    feature_id: str = Field(default="", description="feature 标识")
    success: bool = Field(default=False, description="是否成功完成")
    stage_results: list[SOPStageResult] = Field(
        default_factory=list, description="各阶段执行结果"
    )
    final_stage_id: str = Field(default="", description="最终到达的阶段")
    blocker_messages: list[str] = Field(default_factory=list, description="全部阻断消息")
    warning_messages: list[str] = Field(default_factory=list, description="全部警告消息")
    started_at: datetime = Field(default_factory=datetime.utcnow, description="开始时间")
    completed_at: Optional[datetime] = Field(default=None, description="完成时间")
