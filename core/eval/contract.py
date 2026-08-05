"""Eval Contract 五问 —— Harness 自我代谢的契约层。

每块 harness 组件必须回答 Eval Contract 五问（roleagent.md §5.2）：
    1. 谁评估（agent 自己 / 跨 agent / operator / 自动探针）
    2. 评估什么（功能正确性 / 性能 / 协作贡献 / 愿景对齐）
    3. 何时评估（每次调用 / 每个任务 / 每天 / 每周）
    4. 评估信号（trace / 用户反馈 / 自动探针 / 三方信号交叉）
    5. 评估后做什么（通过 / 返工 / sunset / 升级 operator）

Benchmark 只测一个因子；Eval 测的是 harness 整体。
Contract 是 harness 组件接入 Eval 自代谢系统的入口契约。

设计依据：
    - features/F018-eval-contract.md
    - decisions/009-eval-self-metabolism.md
    - roleagent.md §5.1-§5.2（三层 eval + 五问）

铁律遵守：
    - 铁律 3：ContractRegistry 通过构造函数注入 logger，不直接实例化外部服务
    - 铁律 5：无硬编码路径/密钥
    - 编程红线 9：使用组合（Pydantic 字段）而非继承
    - 诚实成熟度标注：每个 contract 标注 maturity（experimental/stable/mature）

License: MIT
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum

from flowforge.core.tracing import TraceLogger, get_logger
from pydantic import BaseModel, Field

# ──────────────────────────────────────────────────────────────────────────────
# 枚举：五问的推荐取值（非强制约束，允许自由文本以适配自定义场景）
# ──────────────────────────────────────────────────────────────────────────────


class EvaluatorType(str, Enum):
    """谁评估——evaluator 身份类别。

    对应 roleagent.md §5.2 第一问"谁评估"。
    """

    SELF = "self"  # agent 自评
    CROSS_AGENT = "cross_agent"  # 跨 agent 评审
    OPERATOR = "operator"  # operator 人工评估
    AUTO_PROBE = "auto_probe"  # 自动探针


class EvaluationTarget(str, Enum):
    """评估什么——评估维度类别。

    对应 roleagent.md §5.2 第二问"评估什么"。
    """

    FUNCTIONAL_CORRECTNESS = "functional_correctness"
    PERFORMANCE = "performance"
    COLLABORATION_CONTRIBUTION = "collaboration_contribution"
    VISION_ALIGNMENT = "vision_alignment"


class EvaluationTiming(str, Enum):
    """何时评估——评估频率类别。

    对应 roleagent.md §5.2 第三问"何时评估"。
    """

    PER_CALL = "per_call"  # 每次调用
    PER_TASK = "per_task"  # 每个任务
    DAILY = "daily"  # 每天
    WEEKLY = "weekly"  # 每周


class PostEvaluationAction(str, Enum):
    """评估后做什么——评估后动作类别。

    对应 roleagent.md §5.2 第五问"评估后做什么"。
    """

    PASS = "pass"  # 通过
    REWORK = "rework"  # 返工
    SUNSET = "sunset"  # 退役（Build to Delete sunset 信号）
    ESCALATE_OPERATOR = "escalate_operator"  # 升级 operator


class EvalMaturity(str, Enum):
    """Eval 域成熟度——诚实标注。

    每块 harness 的 eval 能力必须诚实标注成熟度，禁止虚报。
    - experimental: 实验阶段，信号采集不稳定，归因规则未验证
    - stable: 稳定阶段，信号采集可靠，归因规则经过验证
    - mature: 成熟阶段，三方信号交叉稳定，归因规则经过长期验证
    """

    EXPERIMENTAL = "experimental"
    STABLE = "stable"
    MATURE = "mature"


# ──────────────────────────────────────────────────────────────────────────────
# 五问数据模型
# ──────────────────────────────────────────────────────────────────────────────


class FiveQuestions(BaseModel):
    """Eval Contract 五问——每块 harness 组件必须回答的五个问题。

    对应 roleagent.md §5.2。五问回答完毕，harness 组件才算接入 Eval 自代谢系统。

    字段使用自由文本（str）而非强制枚举，以适配自定义场景；
    推荐取值参见 EvaluatorType / EvaluationTarget / EvaluationTiming / PostEvaluationAction。

    Attributes:
        who_evaluates: 谁评估（推荐 EvaluatorType 取值）。
        what_to_evaluate: 评估什么（推荐 EvaluationTarget 取值）。
        when_to_evaluate: 何时评估（推荐 EvaluationTiming 取值）。
        evaluation_signals: 评估信号来源列表
            （推荐 "trace" / "human" / "auto" / "three_signal_cross"）。
        post_evaluation_action: 评估后做什么（推荐 PostEvaluationAction 取值）。
    """

    who_evaluates: str = Field(
        ..., description="谁评估（推荐 EvaluatorType 取值）"
    )
    what_to_evaluate: str = Field(
        ..., description="评估什么（推荐 EvaluationTarget 取值）"
    )
    when_to_evaluate: str = Field(
        ..., description="何时评估（推荐 EvaluationTiming 取值）"
    )
    evaluation_signals: list[str] = Field(
        default_factory=list,
        description="评估信号来源列表（trace / human / auto / three_signal_cross）",
    )
    post_evaluation_action: str = Field(
        ..., description="评估后做什么（推荐 PostEvaluationAction 取值）"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Eval Contract 主模型
# ──────────────────────────────────────────────────────────────────────────────


class EvalContract(BaseModel):
    """Eval Contract——harness 组件接入 Eval 自代谢系统的契约。

    每块 harness 组件（如 TeamAct 循环、Durable State Surfaces、Tool Mediation）
    必须声明一个 EvalContract，回答五问。Contract 是 Eval 控制面调度评估的依据。

    对应 roleagent.md §5.2 + F018。

    Attributes:
        contract_id: 契约唯一标识。
        component_ref: 被评估的 harness 组件引用
            （如 "teamact.loop" / "harness.durable_state" / "tool.mediation"）。
        five_questions: 五问回答。
        maturity: 该 eval 契约的成熟度（诚实标注）。
        created_at: 契约创建时间 ISO 8601。
        updated_at: 契约最后更新时间 ISO 8601。
    """

    contract_id: str = Field(..., description="契约唯一标识")
    component_ref: str = Field(
        ..., description="被评估的 harness 组件引用"
    )
    five_questions: FiveQuestions = Field(
        ..., description="五问回答"
    )
    maturity: EvalMaturity = Field(
        default=EvalMaturity.EXPERIMENTAL,
        description="该 eval 契约的成熟度（诚实标注）",
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(UTC).isoformat(),
        description="创建时间 ISO 8601",
    )
    updated_at: str = Field(
        default_factory=lambda: datetime.now(UTC).isoformat(),
        description="最后更新时间 ISO 8601",
    )

    def to_summary(self) -> str:
        """生成人类可读摘要（用于 trace 日志 / operator 展示）。"""
        fq = self.five_questions
        signals = "/".join(fq.evaluation_signals) or "(none)"
        return (
            f"EvalContract[{self.contract_id}] "
            f"component={self.component_ref} "
            f"maturity={self.maturity.value} "
            f"who={fq.who_evaluates} "
            f"what={fq.what_to_evaluate} "
            f"when={fq.when_to_evaluate} "
            f"signals=[{signals}] "
            f"action={fq.post_evaluation_action}"
        )


# ──────────────────────────────────────────────────────────────────────────────
# ContractRegistry —— 契约注册表
# ──────────────────────────────────────────────────────────────────────────────


class ContractRegistry:
    """Eval Contract 注册表——按 component_ref 索引。

    铁律 3：通过构造函数注入 logger，不直接实例化外部服务。
    铁律 4：不直接操作数据库，契约存储在内存 dict（控制面骨架）。
    所有注册/查询操作使用 async/await（铁律 6）。

    Args:
        logger: TraceLogger 实例。若未注入，使用默认 "eval.contract" logger。
    """

    def __init__(self, logger: TraceLogger | None = None) -> None:
        self._logger: TraceLogger = logger or get_logger("eval.contract")
        # 按 component_ref 索引（一个组件一个 contract）
        self._contracts: dict[str, EvalContract] = {}

    async def register(self, contract: EvalContract) -> None:
        """注册一个 Eval Contract。

        若 component_ref 已存在，覆盖旧契约并记录 warning
        （harness 组件升级时契约随之更新）。

        Args:
            contract: 要注册的 Eval Contract。
        """
        if contract.component_ref in self._contracts:
            self._logger.warning(
                f"Overwriting existing contract for component_ref="
                f"'{contract.component_ref}' (old={self._contracts[contract.component_ref].contract_id}, "
                f"new={contract.contract_id})"
            )
        self._contracts[contract.component_ref] = contract
        self._logger.info(
            f"Registered EvalContract '{contract.contract_id}' for "
            f"component '{contract.component_ref}' (maturity={contract.maturity.value})"
        )

    async def get(self, component_ref: str) -> EvalContract | None:
        """按 component_ref 查询契约。

        Args:
            component_ref: harness 组件引用。

        Returns:
            对应的 EvalContract，若不存在返回 None。
        """
        contract = self._contracts.get(component_ref)
        if contract is None:
            self._logger.debug(
                f"No EvalContract found for component_ref='{component_ref}'"
            )
        return contract

    async def list_components(self) -> list[str]:
        """列出所有已注册契约的 component_ref。"""
        return list(self._contracts.keys())

    async def all_contracts(self) -> list[EvalContract]:
        """返回所有已注册契约。"""
        return list(self._contracts.values())
