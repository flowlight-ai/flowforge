"""F046 §2.4 SelfDev 闭环基础框架 — 五步循环 + 觉醒阶门控 + Scope Guard 前置.

本模块定义 SelfDev 三闭环（SelfDevDocLoop / SelfDevCodeLoop / SelfDevFrameworkLoop）
共享的抽象基类与数据模型，是 FlowForge "可进化智能体主导自主开发" 愿景的执行层入口.

分层架构（F046 §2.1）：
- 执行层（本模块）：SelfDev 三闭环，每个闭环执行 Discover→Plan→Act→Verify→Persist 五步循环
- 治理层（ForgeMindEngine 三模式）：Scope Guard 护栏 / Process Evolution 改进 / Knowledge Evolution 沉淀
- LLM 通道（F045 Trae 桥接）：通过 TraeLLMClient 调用 LLM 执行实际开发

关键不变量（F046 §2.6）：
- I1 觉醒阶门控：doc=E3 / code=E4 / framework=E5
- I2 Scope Guard 前置检查：所有 Act 操作前必须通过
- I3 Reflect 上限 3 次：Verify 失败后最多重试 3 次
- I4 LLM 审核必经（T7 铁律）：LLM 生成内容必须再调用 LLM 审核
- I5 不删除测试（红线 8）：子类 SelfDevCodeLoop 实现
- I6 不绕过 DI（红线 12）：所有依赖通过构造函数注入
- I7 不硬编码（红线 11）：路径/密钥/端口从 forgekin_config 读取
- I8 Framework 需 approval：SelfDevFrameworkLoop 的所有 Act 必须 operator 显式批准
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.evolution.self_dev_base")

# ── 觉醒阶顺序（spec.md §2.5）─────────────────────────────────────
# E1 哑役阶 / E2 役使阶 / E3 受限自主阶 / E4 自主阶 / E5 完全自主阶 / E6 超越阶
_AWAKENING_STAGE_ORDER: list[str] = ["E1", "E2", "E3", "E4", "E5", "E6"]

# ── Reflect 重试上限（I3）─────────────────────────────────────────
MAX_REFLECT_RETRIES: int = 3

# ── 受保护路径白名单（I2 Scope Guard 前置检查）────────────────────
# 任何 SelfDev 闭环都禁止修改这些路径（铁律：VISION/rules/核心 ADR 不可变）
_PROTECTED_PATH_PATTERNS: list[str] = [
    "VISION.md",
    "CONTRIBUTING.md",
    "SOP.md",
    "decisions/",  # 所有 ADR 不可变（新增 ADR 不在此限）
]


# ══════════════════════════════════════════════════════════════════
# §1 数据模型 — 五步循环各阶段的输入输出（F046 §2.4）
# ══════════════════════════════════════════════════════════════════


class DevTask(BaseModel):
    """开发任务 — Discover 阶段输出.

    标识一次需要执行的开发任务，含目标对象、修改类型、优先级.
    """

    task_id: str = Field(default_factory=lambda: f"task-{uuid.uuid4().hex[:12]}")
    loop_type: str  # "doc" | "code" | "framework"
    target_path: str  # 目标文件/目录路径（相对项目根，禁止绝对路径硬编码）
    modification_type: str  # "create" | "update" | "delete"
    description: str  # 任务描述（自然语言）
    priority: str = "normal"  # "low" | "normal" | "high" | "critical"
    context: dict[str, Any] = Field(default_factory=dict)  # 额外上下文（如来源 Eval Ledger ID）
    created_at: datetime = Field(default_factory=datetime.utcnow)


class DevPlan(BaseModel):
    """修改方案 — Plan 阶段输出.

    由 LLM 生成（通过 TraeLLMClient），含具体步骤、预期效果、风险评估.
    """

    plan_id: str = Field(default_factory=lambda: f"plan-{uuid.uuid4().hex[:12]}")
    task_id: str
    steps: list[dict[str, Any]]  # 具体步骤列表（每步含 action/params）
    expected_effect: str  # 预期效果
    risk_assessment: str  # 风险评估
    requires_approval: bool = False  # 是否需要 operator 显式批准（I8 Framework 必为 True）
    llm_model: str = ""  # 生成此方案的 LLM 模型（审计可追溯）
    created_at: datetime = Field(default_factory=datetime.utcnow)


class DevResult(BaseModel):
    """修改结果 — Act 阶段输出.

    记录实际变更的文件列表与 diff 摘要.
    """

    result_id: str = Field(default_factory=lambda: f"result-{uuid.uuid4().hex[:12]}")
    plan_id: str
    changed_files: list[str] = Field(default_factory=list)  # 变更文件列表
    diff_summary: str  # diff 摘要（自然语言描述）
    success: bool
    error_message: str = ""
    elapsed_ms: int = 0  # Act 阶段耗时（毫秒）
    created_at: datetime = Field(default_factory=datetime.utcnow)


class VerifyResult(BaseModel):
    """验证结果 — Verify 阶段输出.

    记录每个检查项的通过状态和失败原因.
    """

    verify_id: str = Field(default_factory=lambda: f"verify-{uuid.uuid4().hex[:12]}")
    result_id: str
    passed: bool
    checks: list[dict[str, Any]]  # 具体检查项 [{name, passed, detail}]
    failure_reasons: list[str] = Field(default_factory=list)
    llm_review_passed: bool = False  # T7 铁律：LLM 审核是否通过
    elapsed_ms: int = 0  # Verify 阶段耗时（毫秒）
    created_at: datetime = Field(default_factory=datetime.utcnow)


class LoopExecutionRecord(BaseModel):
    """单次循环执行记录 — 用于审计和 Persist 沉淀.

    记录完整的五步循环执行过程，包括 Reflect 重试历史.
    """

    record_id: str = Field(default_factory=lambda: f"rec-{uuid.uuid4().hex[:12]}")
    loop_type: str
    task: DevTask
    plans_history: list[DevPlan] = Field(default_factory=list)  # 含每次 Reflect 后的新 Plan
    results_history: list[DevResult] = Field(default_factory=list)
    verifies_history: list[VerifyResult] = Field(default_factory=list)
    final_passed: bool = False
    reflect_count: int = 0
    persisted: bool = False  # 是否已沉淀到治理层
    persist_payload: dict[str, Any] = Field(default_factory=dict)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: datetime | None = None


# ══════════════════════════════════════════════════════════════════
# §2 异常定义
# ══════════════════════════════════════════════════════════════════


class SelfDevError(Exception):
    """SelfDev 闭环基础异常."""


class AwakeningStageBlockedError(SelfDevError):
    """觉醒阶门控阻止（I1）— 当前可进化智能体觉醒阶低于闭环要求."""

    def __init__(self, loop_type: str, current_stage: str, required_stage: str) -> None:
        self.loop_type = loop_type
        self.current_stage = current_stage
        self.required_stage = required_stage
        super().__init__(
            f"觉醒阶门控阻止：{loop_type} 闭环要求 {required_stage}，当前可进化智能体为 {current_stage}"
        )


class ScopeGuardBlockedError(SelfDevError):
    """Scope Guard 前置检查阻止（I2）— 目标路径在受保护白名单中."""

    def __init__(self, target_path: str, reason: str = "") -> None:
        self.target_path = target_path
        self.reason = reason
        super().__init__(f"Scope Guard 阻止修改受保护路径：{target_path}（{reason}）")


class ApprovalRequiredError(SelfDevError):
    """需要 operator 显式批准（I8）— Framework 闭环的 Act 操作必须 approval."""

    def __init__(self, plan_id: str, target_path: str) -> None:
        self.plan_id = plan_id
        self.target_path = target_path
        super().__init__(f"Plan {plan_id} 修改 {target_path} 需要 operator 显式批准")


class LLMReviewFailedError(SelfDevError):
    """LLM 审核未通过（I4 / T7 铁律）."""

    def __init__(self, content_type: str, reason: str) -> None:
        self.content_type = content_type
        self.reason = reason
        super().__init__(f"LLM 审核未通过（{content_type}）：{reason}")


class ReflectRetryExhaustedError(SelfDevError):
    """Reflect 重试次数耗尽（I3）— 超过 3 次仍未通过 Verify."""

    def __init__(self, task_id: str, attempts: int) -> None:
        self.task_id = task_id
        self.attempts = attempts
        super().__init__(f"Task {task_id} Reflect 重试 {attempts} 次仍未通过 Verify")


# ══════════════════════════════════════════════════════════════════
# §3 SelfDevLoopBase 抽象基类（F046 §2.4）
# ══════════════════════════════════════════════════════════════════


class SelfDevLoopBase(ABC):
    """SelfDev 闭环抽象基类 — 三闭环共享的五步循环框架.

    子类必须实现：
    - discover(context): 识别需要修改的对象，返回 DevTask 列表
    - plan(task): 通过 TraeLLMClient 调用 LLM 生成 DevPlan
    - act(plan): 执行实际修改（文件 I/O，不操作数据库）
    - verify(result): 验证修改效果（运行测试 / 格式检查 / LLM 审核）

    通用实现：
    - check_awakening_stage(awakening_stage): I1 觉醒阶门控
    - pre_act_scope_guard_check(task, plan): I2 Scope Guard 前置检查
    - run_once(context): 五步循环 Discover→Plan→Act→Verify→Persist
    - reflect_and_replan(task, result, verify): I3 反思重规划（默认通过 LLM）
    - persist(record): 调用 ForgeMindEngine 治理层沉淀经验
    - llm_review_content(content, content_type): I4 LLM 审核（T7 铁律）

    遵守铁律：
    - 红线 9：禁止用继承替代组合（基类仅定义五步框架，子类按职责差异化实现）
    - 红线 11：路径不硬编码，从 forgekin_config 读取
    - 红线 12：依赖通过构造函数注入（trae_client / forgekin_config / evolution_engine）
    """

    # 子类必须覆盖的类属性
    loop_type: str = ""  # "doc" | "code" | "framework"
    min_awakening_stage: str = "E3"  # 默认 E3，子类按 F046 §2.2 覆盖

    def __init__(
        self,
        trae_client: Any,  # TraeLLMClient 实例（F045 桥接）
        forgekin_config: dict[str, Any],  # 可进化智能体配置（含 project_root / protected_paths 等）
        evolution_engine: Any,  # ForgeMindEngine 实例（治理层）
        *,
        awakening_stage: str = "E3",  # 当前可进化智能体觉醒阶
    ) -> None:
        """初始化 SelfDev 闭环.

        Args:
            trae_client: TraeLLMClient 实例，用于调用 LLM 执行 Plan/Reflect
            forgekin_config: 可进化智能体配置字典，必须包含 project_root
            evolution_engine: ForgeMindEngine 实例，用于 Persist 沉淀经验
            awakening_stage: 当前可进化智能体觉醒阶（E1-E6）

        Raises:
            ValueError: trae_client 或 evolution_engine 为 None / forgekin_config 缺 project_root
        """
        if trae_client is None:
            raise ValueError("trae_client 不能为 None（红线 12：依赖注入）")
        if evolution_engine is None:
            raise ValueError("evolution_engine 不能为 None（红线 12：依赖注入）")
        if not forgekin_config.get("project_root"):
            raise ValueError("forgekin_config 必须包含 project_root（红线 11：路径不硬编码）")

        self._trae_client = trae_client
        self._forgekin_config = forgekin_config
        self._engine = evolution_engine
        self._awakening_stage = awakening_stage

        # 受保护路径（可由 forgekin_config 覆盖默认白名单）
        self._protected_paths: list[str] = list(_PROTECTED_PATH_PATTERNS) + list(
            forgekin_config.get("protected_paths", [])
        )

        self._logger = get_logger(f"flowforge.evolution.self_dev.{self.loop_type}")

    # ── 类属性访问器 ────────────────────────────────────────────────

    @property
    def project_root(self) -> str:
        """项目根目录（从 forgekin_config 读取，不硬编码）."""
        return str(self._forgekin_config["project_root"])

    @property
    def awakening_stage(self) -> str:
        """当前可进化智能体觉醒阶."""
        return self._awakening_stage

    @property
    def protected_paths(self) -> list[str]:
        """受保护路径白名单（I2 Scope Guard 前置检查依据）."""
        return list(self._protected_paths)

    # ══════════════════════════════════════════════════════════════
    # §3.1 抽象方法 — 子类必须实现
    # ══════════════════════════════════════════════════════════════

    @abstractmethod
    async def discover(self, context: dict[str, Any]) -> list[DevTask]:
        """发现任务（子类实现）.

        Args:
            context: 发现上下文（含来源信号：eval_ledger_id / user_feedback / auto_detect 等）

        Returns:
            DevTask 列表（按优先级排序）
        """
        ...

    @abstractmethod
    async def plan(self, task: DevTask) -> DevPlan:
        """设计方案（子类实现，通常调用 LLM）.

        Args:
            task: 开发任务

        Returns:
            DevPlan 修改方案
        """
        ...

    @abstractmethod
    async def act(self, plan: DevPlan) -> DevResult:
        """执行修改（子类实现）.

        Args:
            plan: 修改方案

        Returns:
            DevResult 修改结果

        Raises:
            ApprovalRequiredError: 当 plan.requires_approval=True 且未获得批准时
        """
        ...

    @abstractmethod
    async def verify(self, result: DevResult) -> VerifyResult:
        """验证效果（子类实现）.

        Args:
            result: 修改结果

        Returns:
            VerifyResult 验证结果
        """
        ...

    # ══════════════════════════════════════════════════════════════
    # §3.2 通用实现 — 五步循环框架
    # ══════════════════════════════════════════════════════════════

    def check_awakening_stage(self, current_stage: str | None = None) -> None:
        """I1 觉醒阶门控 — 检查当前可进化智能体觉醒阶是否达到闭环要求.

        Args:
            current_stage: 当前觉醒阶（None 用 self._awakening_stage）

        Raises:
            AwakeningStageBlockedError: 当前觉醒阶低于 min_awakening_stage
        """
        stage = current_stage or self._awakening_stage
        try:
            current_idx = _AWAKENING_STAGE_ORDER.index(stage)
            required_idx = _AWAKENING_STAGE_ORDER.index(self.min_awakening_stage)
        except ValueError as e:
            raise AwakeningStageBlockedError(self.loop_type, stage, self.min_awakening_stage) from e

        if current_idx < required_idx:
            raise AwakeningStageBlockedError(self.loop_type, stage, self.min_awakening_stage)

    def pre_act_scope_guard_check(self, task: DevTask, plan: DevPlan) -> None:
        """I2 Scope Guard 前置检查 — 检查目标路径是否在受保护白名单中.

        特例（F046 §2.6 I2 注释"新增 ADR 不在此限"）：
        - `decisions/` pattern 允许 create 操作（新增 ADR）
        - `decisions/` pattern 阻止 update/delete 操作（修改已有 ADR）

        Args:
            task: 开发任务（含 target_path / modification_type）
            plan: 修改方案（含 steps，每步含 action / path）

        Raises:
            ScopeGuardBlockedError: 目标路径在受保护白名单中
        """
        # 检查 task.target_path
        target = task.target_path
        for pattern in self._protected_paths:
            # 特例：decisions/ 路径允许 create 新 ADR（注释：新增 ADR 不在此限）
            if pattern == "decisions/" and task.modification_type == "create":
                continue
            if pattern in target:
                raise ScopeGuardBlockedError(
                    target,
                    reason=f"匹配受保护模式 {pattern!r}（VISION/rules/ADR 不可变）",
                )

        # 检查 plan.steps 中的所有 path 字段
        for step in plan.steps:
            step_path = step.get("path", "") if isinstance(step, dict) else ""
            if step_path:
                step_action = step.get("action", "") if isinstance(step, dict) else ""
                for pattern in self._protected_paths:
                    # 特例：decisions/ 路径允许 create_adr action（新增 ADR）
                    if pattern == "decisions/" and step_action == "create_adr":
                        continue
                    if pattern in step_path:
                        raise ScopeGuardBlockedError(
                            step_path,
                            reason=f"step 匹配受保护模式 {pattern!r}",
                        )

    async def reflect_and_replan(
        self,
        task: DevTask,
        result: DevResult,
        verify: VerifyResult,
    ) -> DevPlan:
        """I3 反思并重新规划 — 基于真实执行反馈生成新方案.

        默认实现：通过 TraeLLMClient 调用 LLM 分析失败原因并生成新方案.
        子类可覆盖以定制反思提示词.

        Args:
            task: 原始任务
            result: 上次执行结果
            verify: 上次验证结果（含 failure_reasons）

        Returns:
            新的 DevPlan
        """
        from flowforge.llm.trae.models import BridgeRequestContext

        # 构造反思上下文（基于真实执行反馈，rules.md §10.3 Error-driven Reflection）
        failure_reasons = verify.failure_reasons or ["未提供具体失败原因"]
        reflect_prompt = (
            f"你是 FlowForge 自我演进的反思助手。请基于以下真实执行反馈重新设计修改方案.\n\n"
            f"【原始任务】\n类型: {task.loop_type}\n目标: {task.target_path}\n描述: {task.description}\n\n"
            f"【上次执行结果】\n成功: {result.success}\n变更文件: {result.changed_files}\n"
            f"diff 摘要: {result.diff_summary}\n错误: {result.error_message}\n\n"
            f"【验证失败原因】\n" + "\n".join(f"- {r}" for r in failure_reasons) + "\n\n"
            "【请输出】\n"
            "1. 失败根因分析（基于真实反馈，不臆测）\n"
            "2. 新的修改步骤（避免重复同类错误）\n"
            "3. 预期效果与风险评估\n\n"
            "以 JSON 格式返回: "
            '{"steps": [{"action": "...", "params": {...}}], '
            '"expected_effect": "...", "risk_assessment": "..."}'
        )

        ctx = BridgeRequestContext(
            forgekin_id=self._forgekin_config.get("forgekin_id", "unknown"),
            task_type="reflect_and_replan",
            task_summary=f"Reflect task {task.task_id}",
        )

        try:
            llm_result = await self._trae_client.chat(
                messages=[
                    {"role": "system", "content": "你是专业的代码反思与方案重构助手."},
                    {"role": "user", "content": reflect_prompt},
                ],
                context=ctx,
            )
            content = llm_result.get("content", "")
            model = llm_result.get("model", "")
        except Exception as e:
            self._logger.exception(f"reflect_and_replan LLM 调用失败: {e}")
            # LLM 失败时返回最小化的修复方案（避免阻塞循环）
            content = '{"steps": [], "expected_effect": "LLM 反思失败，待人工介入", "risk_assessment": "high"}'
            model = "fallback"

        # 解析 LLM 返回的 JSON 方案
        import json
        import re

        new_steps: list[dict[str, Any]] = []
        expected_effect = "反思后重新规划"
        risk_assessment = "待评估"

        try:
            cleaned = re.sub(r"^```(?:json)?\s*", "", content.strip(), flags=re.MULTILINE)
            cleaned = re.sub(r"\s*```$", "", cleaned.strip())
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                new_steps = parsed.get("steps", [])
                expected_effect = parsed.get("expected_effect", expected_effect)
                risk_assessment = parsed.get("risk_assessment", risk_assessment)
        except (json.JSONDecodeError, ValueError) as e:
            self._logger.warning(f"反思响应非 JSON 格式: {e}")

        return DevPlan(
            task_id=task.task_id,
            steps=new_steps,
            expected_effect=expected_effect,
            risk_assessment=risk_assessment,
            requires_approval=False,
            llm_model=model,
        )

    async def llm_review_content(
        self,
        content: str,
        content_type: str,
        *,
        review_criteria: str | None = None,
    ) -> dict[str, Any]:
        """I4 LLM 审核（T7 铁律）— LLM 生成内容必须再调用 LLM 审核通过.

        Args:
            content: 待审核内容
            content_type: 内容类型（"doc" / "code" / "config" / "adr_draft"）
            review_criteria: 审核标准（None 用默认）

        Returns:
            审核结果 {
                "passed": bool,
                "score": float,  # 0.0-1.0
                "issues": list[str],
                "suggestions": list[str],
            }
        """
        from flowforge.llm.trae.models import BridgeRequestContext

        criteria = review_criteria or (
            "1. 内容是否准确无误（无虚构信息）\n"
            "2. 是否符合项目规范（命名/格式/分层）\n"
            "3. 是否有安全风险（硬编码/越权/绕过 DI）\n"
            "4. 是否有可维护性问题"
        )

        review_prompt = (
            f"你是 FlowForge 的 LLM 审核员。请审核以下 {content_type} 内容是否符合标准.\n\n"
            f"【审核标准】\n{criteria}\n\n"
            f"【待审核内容】\n{content}\n\n"
            f"【请输出 JSON】\n"
            f'{{"passed": true|false, "score": 0.0-1.0, '
            f'"issues": ["问题1", "问题2"], "suggestions": ["建议1"]}}'
        )

        ctx = BridgeRequestContext(
            forgekin_id=self._forgekin_config.get("forgekin_id", "unknown"),
            task_type="llm_review",
            task_summary=f"Review {content_type} content",
        )

        try:
            llm_result = await self._trae_client.chat(
                messages=[
                    {"role": "system", "content": "你是严格的内容审核员."},
                    {"role": "user", "content": review_prompt},
                ],
                context=ctx,
                temperature=0.3,  # 审核需要确定性
            )
            review_content = llm_result.get("content", "")
        except Exception as e:
            self._logger.exception(f"llm_review_content LLM 调用失败: {e}")
            return {
                "passed": False,
                "score": 0.0,
                "issues": [f"LLM 审核调用失败: {e}"],
                "suggestions": [],
            }

        # 解析审核结果
        import json
        import re

        result: dict[str, Any] = {
            "passed": False,
            "score": 0.0,
            "issues": [],
            "suggestions": [],
        }
        try:
            cleaned = re.sub(r"^```(?:json)?\s*", "", review_content.strip(), flags=re.MULTILINE)
            cleaned = re.sub(r"\s*```$", "", cleaned.strip())
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                result["passed"] = bool(parsed.get("passed", False))
                result["score"] = float(parsed.get("score", 0.0))
                result["issues"] = list(parsed.get("issues", []))
                result["suggestions"] = list(parsed.get("suggestions", []))
        except (json.JSONDecodeError, ValueError) as e:
            self._logger.warning(f"LLM 审核响应非 JSON 格式: {e}")
            result["issues"].append(f"审核响应解析失败: {e}")

        return result

    async def persist(self, record: LoopExecutionRecord) -> dict[str, Any]:
        """沉淀经验到治理层（通用实现）.

        调用 ForgeMindEngine 三模式：
        - KnowledgeEvolution.create_episode_card: 创建 EpisodeCard（L0 原始记录）
        - KnowledgeEvolution.distill_episode: 蒸馏为 MethodCard（如有可复用方法）
        - ProcessEvolution.create_proposal: 提交流程改进提案（如发现 SOP 缺口）

        Args:
            record: 单次循环执行记录

        Returns:
            沉淀结果 {
                "episode_id": str,
                "method_id": str | None,
                "proposal_id": str | None,
            }
        """
        # 1. 创建 EpisodeCard（L0 原始记录）
        episode_data = {
            "task_snapshot": (
                f"[{record.loop_type}] {record.task.modification_type} "
                f"{record.task.target_path}: {record.task.description}"
            ),
            "evidence_map": {
                "verify_passed": record.final_passed,
                "reflect_count": record.reflect_count,
                "changed_files": record.results_history[-1].changed_files if record.results_history else [],
            },
            "decision_timeline": [
                {
                    "step": "plan",
                    "expected_effect": p.expected_effect,
                    "risk_assessment": p.risk_assessment,
                }
                for p in record.plans_history
            ],
            "collaboration_pivots": [],
            "transferable_method": self._extract_transferable_method(record),
            "non_transferable_facts": record.task.target_path,
            "safety_boundary": f"觉醒阶门控 {self.min_awakening_stage}；Scope Guard 前置检查通过",
            "distillation_direction": "method_card" if record.final_passed else "memory",
        }

        try:
            # 委托 ForgeMindEngine.execute 调用 KnowledgeEvolution
            ke_result = await self._engine.execute({
                "mode": "knowledge_evolution",
                "action": "create_episode_card",
                "payload": episode_data,
            })
            episode_id = ke_result.get("episode_id", "")
            self._logger.info(f"persist 创建 EpisodeCard: {episode_id}")

            method_id: str | None = None
            proposal_id: str | None = None

            # 仅在 Verify 通过时尝试蒸馏为 MethodCard
            if record.final_passed and episode_id:
                distill_result = await self._engine.execute({
                    "mode": "knowledge_evolution",
                    "action": "distill_episode",
                    "payload": {"episode_id": episode_id},
                })
                method_id = distill_result.get("method_id")

            # Reflect 次数 ≥ 2 时提交流程改进提案（同类错误反复出现）
            if record.reflect_count >= 2:
                pe_result = await self._engine.execute({
                    "mode": "process_evolution",
                    "action": "create_proposal",
                    "payload": {
                        "trigger_type": "repeated_error",
                        "trigger": f"{record.loop_type} 闭环 Reflect {record.reflect_count} 次才通过",
                        "evidence": [
                            f"task_id={record.task.task_id}",
                            f"failure_reasons={record.verifies_history[0].failure_reasons if record.verifies_history else []}",
                        ],
                        "root_cause": "Plan 阶段方案不够稳健，需改进提示词或上下文构造",
                        "lever": "memory",
                        "verify": "下次同类任务 Reflect 次数 ≤ 1",
                        "target": "sop",
                    },
                })
                proposal_id = pe_result.get("proposal_id")

            record.persisted = True
            record.persist_payload = {
                "episode_id": episode_id,
                "method_id": method_id,
                "proposal_id": proposal_id,
            }
            return record.persist_payload

        except Exception as e:
            self._logger.exception(f"persist 沉淀失败: {e}")
            record.persist_payload = {"error": str(e)}
            return record.persist_payload

    def _extract_transferable_method(self, record: LoopExecutionRecord) -> str:
        """从执行记录中提取可迁移方法（子类可覆盖）."""
        if not record.results_history:
            return ""
        last_result = record.results_history[-1]
        if record.final_passed:
            return (
                f"{record.loop_type} 闭环成功执行 {record.task.modification_type} 操作："
                f"{last_result.diff_summary[:200]}"
            )
        return f"{record.loop_type} 闭环失败：{last_result.error_message[:200]}"

    # ══════════════════════════════════════════════════════════════
    # §3.3 五步循环主入口
    # ══════════════════════════════════════════════════════════════

    async def run_once(self, context: dict[str, Any]) -> dict[str, Any]:
        """执行一次完整的五步循环（Discover→Plan→Act→Verify→Persist）.

        Args:
            context: 循环上下文，必须含：
                - awakening_stage: 当前觉醒阶（可选，默认用 self._awakening_stage）
                - 其他 discover 阶段需要的上下文

        Returns:
            {
                "loop_type": str,
                "records": List[LoopExecutionRecord 序列化 dict],
                "summary": {total, passed, failed, reflect_total},
            }

        Raises:
            AwakeningStageBlockedError: I1 觉醒阶门控未通过
        """
        # I1 觉醒阶门控前置检查
        stage_override = context.get("awakening_stage")
        self.check_awakening_stage(stage_override)

        self._logger.info(
            f"run_once 启动: loop_type={self.loop_type}, stage={self._awakening_stage}, "
            f"protected_paths={len(self._protected_paths)}"
        )

        # Step 1: Discover
        tasks = await self.discover(context)
        self._logger.info(f"Discover 完成: 发现 {len(tasks)} 个任务")

        records: list[LoopExecutionRecord] = []
        passed_count = 0
        failed_count = 0
        reflect_total = 0

        for task in tasks:
            # I2 Scope Guard 前置检查在 act 前调用（plan 后）
            plan = await self.plan(task)

            # 初次 Scope Guard 检查
            try:
                self.pre_act_scope_guard_check(task, plan)
            except ScopeGuardBlockedError as e:
                self._logger.warning(f"Scope Guard 阻止任务 {task.task_id}: {e}")
                record = LoopExecutionRecord(
                    loop_type=self.loop_type,
                    task=task,
                    plans_history=[plan],
                    final_passed=False,
                )
                record.finished_at = datetime.utcnow()
                records.append(record)
                failed_count += 1
                continue

            # Step 3-4: Act → Verify，含 Reflect 重试
            result = await self.act(plan)
            verify = await self.verify(result)

            record = LoopExecutionRecord(
                loop_type=self.loop_type,
                task=task,
                plans_history=[plan],
                results_history=[result],
                verifies_history=[verify],
            )

            # I3 Reflect 上限 3 次
            retries = 0
            while not verify.passed and retries < MAX_REFLECT_RETRIES:
                retries += 1
                self._logger.info(
                    f"Task {task.task_id} Reflect 第 {retries} 次: "
                    f"failure_reasons={verify.failure_reasons}"
                )
                new_plan = await self.reflect_and_replan(task, result, verify)

                # Reflect 后的新 plan 也要通过 Scope Guard
                try:
                    self.pre_act_scope_guard_check(task, new_plan)
                except ScopeGuardBlockedError as e:
                    self._logger.warning(f"Reflect 后 Scope Guard 阻止: {e}")
                    record.plans_history.append(new_plan)
                    record.final_passed = False
                    record.reflect_count = retries
                    record.finished_at = datetime.utcnow()
                    records.append(record)
                    failed_count += 1
                    reflect_total += retries
                    break

                new_result = await self.act(new_plan)
                new_verify = await self.verify(new_result)

                record.plans_history.append(new_plan)
                record.results_history.append(new_result)
                record.verifies_history.append(new_verify)

                result = new_result
                verify = new_verify

                if verify.passed:
                    break

            record.reflect_count = retries
            record.final_passed = verify.passed
            record.finished_at = datetime.utcnow()

            # Step 5: Persist 沉淀经验
            try:
                await self.persist(record)
            except Exception as e:
                self._logger.exception(f"Persist 失败: {e}")

            records.append(record)
            if verify.passed:
                passed_count += 1
            else:
                failed_count += 1
            reflect_total += retries

        summary = {
            "total": len(records),
            "passed": passed_count,
            "failed": failed_count,
            "reflect_total": reflect_total,
        }
        self._logger.info(f"run_once 完成: {summary}")

        return {
            "loop_type": self.loop_type,
            "records": [r.model_dump(mode="json") for r in records],
            "summary": summary,
        }


__all__ = [
    # 数据模型
    "DevTask",
    "DevPlan",
    "DevResult",
    "VerifyResult",
    "LoopExecutionRecord",
    # 异常
    "SelfDevError",
    "AwakeningStageBlockedError",
    "ScopeGuardBlockedError",
    "ApprovalRequiredError",
    "LLMReviewFailedError",
    "ReflectRetryExhaustedError",
    # 基类
    "SelfDevLoopBase",
    # 常量
    "MAX_REFLECT_RETRIES",
]
