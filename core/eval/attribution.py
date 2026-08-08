"""七类归因矩阵——Eval 失败必须归因到具体根因类别。

归因不是"agent 没做好"（roleagent.md §5.4），而是定位到七类根因之一：
    1. harness 错位（HARNESS_MISALIGNMENT）—— harness 组件路由/调度/状态面错位
    2. 工具缺口（TOOL_GAP）—— 缺少必要工具或工具能力不足
    3. 模型盲点（MODEL_BLIND_SPOT）—— 模型固有认知盲点导致
    4. 数据缺失（DATA_MISSING）—— 上下文/记忆/检索数据缺失
    5. 愿景缺口（VISION_GAP）—— 与愿景/目标/spec 方向偏离
    6. 协作失败（COLLABORATION_FAILURE）—— 跨 agent 协作/交接/协议失败
    7. 资源耗尽（RESOURCE_EXHAUSTION）—— 超时/配额/内存/token 耗尽

关键设计原则：
    - 禁止归因到"agent 没做好"（过于笼统，无法指导修复）
    - 必须定位到七类之一，每类有对应的修复路径
    - 归因基于证据（evidence），不是猜测

设计依据：
    - features/F020-seven-attribution.md
    - decisions/009-eval-self-metabolism.md
    - roleagent.md §5.4（七类归因矩阵）

铁律遵守：
    - 铁律 3：通过构造函数注入 logger / prompts_path，不直接实例化外部服务
    - 铁律 5+P16：推荐文案模板外置到 config/prompts.yaml，禁止硬编码提示词
    - 编程红线 9：使用组合而非继承
    - 诚实成熟度：规则归因为 experimental，LLM 辅助归因为未来扩展

License: MIT
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any

import yaml
from flowforge.core.tracing import TraceLogger, get_logger
from pydantic import BaseModel, Field

# ──────────────────────────────────────────────────────────────────────────────
# 七类归因枚举
# ──────────────────────────────────────────────────────────────────────────────


class AttributionCategory(str, Enum):
    """七类归因类别——Eval 失败必须归因到其中之一。

    对应 roleagent.md §5.4 七类归因矩阵。
    每类有对应的修复路径，禁止笼统归因到"agent 没做好"。

    Attributes:
        HARNESS_MISALIGNMENT: harness 错位——组件路由/调度/状态面错位。
            修复路径：调整 harness 组件配置 / 路由规则 / 状态面映射。
        TOOL_GAP: 工具缺口——缺少必要工具或工具能力不足。
            修复路径：补充工具 / 升级工具能力 / 调整工具边界。
        MODEL_BLIND_SPOT: 模型盲点——模型固有认知盲点导致。
            修复路径：跨厂商 review 补偿 / 更换模型 / 加 guardrail。
        DATA_MISSING: 数据缺失——上下文/记忆/检索数据缺失。
            修复路径：补充数据 / 修复检索入口 / 加载知识包。
        VISION_GAP: 愿景缺口——与愿景/目标/spec 方向偏离。
            修复路径：对齐愿景 / 修正 spec / 升级 CVO 确认。
        COLLABORATION_FAILURE: 协作失败——跨 agent 协作/交接/协议失败。
            修复路径：修复交接胶囊 / 调整路由 / 修复协议。
        RESOURCE_EXHAUSTION: 资源耗尽——超时/配额/内存/token 耗尽。
            修复路径：提高配额 / 优化 token 账本 / 降级处理。
    """

    HARNESS_MISALIGNMENT = "harness_misalignment"
    TOOL_GAP = "tool_gap"
    MODEL_BLIND_SPOT = "model_blind_spot"
    DATA_MISSING = "data_missing"
    VISION_GAP = "vision_gap"
    COLLABORATION_FAILURE = "collaboration_failure"
    RESOURCE_EXHAUSTION = "resource_exhaustion"


# ──────────────────────────────────────────────────────────────────────────────
# 归因报告
# ──────────────────────────────────────────────────────────────────────────────


class AttributionReport(BaseModel):
    """归因报告——Eval 失败的根因定位结果。

    对应 roleagent.md §5.4：每类归因有对应的修复路径。

    Attributes:
        failure_id: 失败事件唯一标识。
        category: 七类归因类别之一。
        root_cause: 根因描述（人类可读，定位到具体根因而非"agent 没做好"）。
        evidence: 证据列表（匹配的关键词 / trace 片段 / 信号引用）。
        recommendation: 修复建议（对应归因类别的修复路径）。
        confidence: 归因置信度（0.0-1.0，基于证据强度）。
        attributed_at: 归因时间 ISO 8601。
    """

    failure_id: str = Field(
        default_factory=lambda: f"fail-{uuid.uuid4().hex[:12]}",
        description="失败事件唯一标识",
    )
    category: AttributionCategory = Field(..., description="七类归因类别")
    root_cause: str = Field(..., description="根因描述")
    evidence: list[str] = Field(
        default_factory=list, description="证据列表"
    )
    recommendation: str = Field(..., description="修复建议")
    confidence: float = Field(
        default=0.5, ge=0.0, le=1.0, description="归因置信度"
    )
    attributed_at: str = Field(
        default_factory=lambda: datetime.now(UTC).isoformat(),
        description="归因时间 ISO 8601",
    )


# ──────────────────────────────────────────────────────────────────────────────
# 默认归因规则（keyword-based，可被 prompts.yaml 中的规则覆盖）
# ──────────────────────────────────────────────────────────────────────────────


def _build_default_rules() -> dict[AttributionCategory, list[str]]:
    """构建默认归因关键词规则。

    每类归因关联一组关键词，在 failure_data 文本中匹配。
    匹配数最多的类别为归因结果。

    Returns:
        {category: [keyword, ...]} 字典。
    """
    return {
        AttributionCategory.HARNESS_MISALIGNMENT: [
            "harness", "route", "router", "dispatch", "ownership",
            "state surface", "durable state", "wrong agent",
            "component mismatch", "routing", "misalign",
            "state_updates", "canonical read",
        ],
        AttributionCategory.TOOL_GAP: [
            "tool", "missing tool", "tool not found", "tool unavailable",
            "no tool", "tool gap", "tool boundary", "tool forbidden",
            "tool registry", "tool_missing",
        ],
        AttributionCategory.MODEL_BLIND_SPOT: [
            "hallucinat", "blind spot", "blindspot", "model limitation",
            "reasoning failure", "model error", "cognitive",
            "self referential", "over confidence", "overconfidence",
            "context compression", "model blind",
        ],
        AttributionCategory.DATA_MISSING: [
            "data missing", "no data", "empty context", "retrieval fail",
            "memory empty", "context missing", "no context",
            "data not found", "retrieval empty", "memory missing",
            "rag fail", "no result",
        ],
        AttributionCategory.VISION_GAP: [
            "vision", "direction", "off track", "off-track",
            "goal mismatch", "spec drift", "spec mismatch",
            "requirements mismatch", "north star", "cvo",
            "vision misalign", "goal drift",
        ],
        AttributionCategory.COLLABORATION_FAILURE: [
            "handoff", "collaboration", "coordination", "protocol",
            "agent conflict", "deadlock", "pingpong", "ping-pong",
            "交接", "capsule", "ball custody", "push back",
            "teamact", "no response",
        ],
        AttributionCategory.RESOURCE_EXHAUSTION: [
            "timeout", "timed out", "quota", "rate limit", "ratelimit",
            "memory", "oom", "out of memory", "token",
            "exhausted", "capacity", "limit exceeded", "throttl",
        ],
    }


# ──────────────────────────────────────────────────────────────────────────────
# 提示词模板加载（铁律 5+P16：禁止硬编码提示词）
# ──────────────────────────────────────────────────────────────────────────────


def _load_attribution_templates(
    prompts_path: Path | None,
) -> dict[str, dict[str, str]]:
    """加载归因文案模板（root_cause / recommendation）。

    铁律 5+P16：禁止硬编码提示词。模板从 config/prompts.yaml 加载。
    若路径为 None 或加载失败，返回空 dict（调用方走 fallback 默认逻辑）。

    Args:
        prompts_path: prompts.yaml 绝对路径。None 表示未注入。

    Returns:
        模板字典 {"root_causes": {category: template}, "recommendations": {category: template}}。
    """
    if prompts_path is None:
        return {}
    try:
        path = Path(prompts_path)
        if not path.exists():
            return {}
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return {
            "root_causes": dict(data.get("attribution_root_causes", {})),
            "recommendations": dict(
                data.get("attribution_recommendations", {})
            ),
        }
    except Exception:  # noqa: BLE001
        return {}


# ──────────────────────────────────────────────────────────────────────────────
# 默认文案（fallback，当 prompts.yaml 未注入时使用）
# ──────────────────────────────────────────────────────────────────────────────


_DEFAULT_ROOT_CAUSES: dict[AttributionCategory, str] = {
    AttributionCategory.HARNESS_MISALIGNMENT:
        "harness 组件路由/调度/状态面错位，导致 agent 持球与任务不匹配",
    AttributionCategory.TOOL_GAP:
        "缺少必要工具或工具能力不足，agent 无法完成现实闭环",
    AttributionCategory.MODEL_BLIND_SPOT:
        "模型固有认知盲点导致错误，需跨厂商 review 补偿",
    AttributionCategory.DATA_MISSING:
        "上下文/记忆/检索数据缺失，agent 在信息不完整下决策",
    AttributionCategory.VISION_GAP:
        "产出与愿景/目标/spec 方向偏离，愿景收敛未达成",
    AttributionCategory.COLLABORATION_FAILURE:
        "跨 agent 协作/交接/协议失败，TeamAct 循环断裂",
    AttributionCategory.RESOURCE_EXHAUSTION:
        "超时/配额/内存/token 耗尽，资源约束导致中断",
}

_DEFAULT_RECOMMENDATIONS: dict[AttributionCategory, str] = {
    AttributionCategory.HARNESS_MISALIGNMENT:
        "调整 harness 组件配置/路由规则/状态面映射，确保 agent 持球与任务匹配",
    AttributionCategory.TOOL_GAP:
        "补充缺失工具/升级工具能力/调整工具边界授权",
    AttributionCategory.MODEL_BLIND_SPOT:
        "启用跨厂商 review 补偿/更换模型/加 guardrail 拦截盲点",
    AttributionCategory.DATA_MISSING:
        "补充数据/修复检索入口/加载所需知识包/修复记忆召回",
    AttributionCategory.VISION_GAP:
        "对齐愿景方向/修正 spec/升级 CVO 确认，禁止 proxy 替代愿景收敛",
    AttributionCategory.COLLABORATION_FAILURE:
        "修复交接胶囊/调整路由/修复协作协议，检查 TeamAct 终止条件",
    AttributionCategory.RESOURCE_EXHAUSTION:
        "提高配额/优化 token 账本/启用降级处理/调整超时阈值",
}


# ──────────────────────────────────────────────────────────────────────────────
# Attributor —— 七类归因器
# ──────────────────────────────────────────────────────────────────────────────


class Attributor:
    """七类归因器——将 Eval 失败定位到具体根因类别。

    核心原则（roleagent.md §5.4）：归因不是"agent 没做好"，
    而是定位到七类根因之一，每类有对应修复路径。

    归因策略（当前 maturity=experimental）：
        1. 将 failure_data 转为文本
        2. 按七类关键词规则扫描匹配
        3. 匹配数最多的类别为归因结果
        4. 若有 category_hint 字段，加权该类别
        5. 文案从 prompts.yaml 模板加载（铁律 5+P16）

    未来扩展：LLM 辅助归因（prompts.yaml 中已外置 LLM prompt，待接入真实 LLM）。

    铁律 3：通过构造函数注入 logger / prompts_path。
    铁律 5+P16：推荐文案模板外置到 config/prompts.yaml。

    Args:
        logger: TraceLogger 实例。若未注入，使用默认 "eval.attribution" logger。
        prompts_path: prompts.yaml 路径（外置文案模板）。None 表示未注入。
        rules: 自定义归因关键词规则。None 表示使用默认规则。
    """

    def __init__(
        self,
        logger: TraceLogger | None = None,
        prompts_path: Path | None = None,
        rules: dict[AttributionCategory, list[str]] | None = None,
    ) -> None:
        self._logger: TraceLogger = logger or get_logger("eval.attribution")
        self._prompts_path: Path | None = prompts_path
        self._rules: dict[AttributionCategory, list[str]] = (
            rules if rules is not None else _build_default_rules()
        )
        self._templates: dict[str, dict[str, str]] = _load_attribution_templates(
            prompts_path
        )

    async def attribute(
        self, failure_data: dict[str, Any]
    ) -> AttributionReport:
        """对 Eval 失败进行七类归因。

        归因流程：
            1. 从 failure_data 提取文本特征
            2. 按七类关键词规则扫描匹配
            3. 选取匹配数最多的类别（平票时优先 category_hint 或首类）
            4. 生成根因描述和修复建议（从 prompts.yaml 模板渲染）
            5. 基于匹配证据计算置信度

        Args:
            failure_data: 失败数据。推荐字段：
                - failure_id: 失败事件 ID（可选，默认自动生成）
                - component_ref: 失败发生的组件
                - error_message / error: 错误消息
                - trace: 执行轨迹片段
                - signals: 相关信号列表
                - category_hint: 归因提示（加权该类别）
                - context: 任意附加上下文

        Returns:
            AttributionReport 包含 category / root_cause / evidence / recommendation。
        """
        # 1. 提取文本特征（将整个 failure_data 转为小写文本扫描）
        text = self._extract_text(failure_data)

        # 2. 七类关键词匹配
        scores: dict[AttributionCategory, list[str]] = {}
        for category, keywords in self._rules.items():
            matched: list[str] = []
            for kw in keywords:
                if kw.lower() in text:
                    matched.append(kw)
            scores[category] = matched

        # 3. category_hint 加权（+1 匹配）
        hint = failure_data.get("category_hint")
        if hint:
            try:
                hint_cat = AttributionCategory(hint)
                if not scores[hint_cat]:
                    scores[hint_cat] = ["(category_hint)"]
                else:
                    scores[hint_cat].append("(category_hint)")
            except ValueError:
                self._logger.warning(
                    f"Invalid category_hint '{hint}', ignored"
                )

        # 4. 选取匹配数最多的类别
        best_category = self._select_best_category(scores)

        # 5. 生成文案（优先用 prompts.yaml 模板，回退到默认）
        root_cause = self._render_template(
            "root_causes",
            best_category,
            _DEFAULT_ROOT_CAUSES,
            failure_data=failure_data,
        )
        recommendation = self._render_template(
            "recommendations",
            best_category,
            _DEFAULT_RECOMMENDATIONS,
            failure_data=failure_data,
        )

        # 6. 证据 = 匹配到的关键词
        evidence = list(scores[best_category])

        # 7. 置信度 = min(1.0, 0.3 + 0.2 * 证据数)
        confidence = min(1.0, 0.3 + 0.2 * len(evidence))

        # 8. 失败 ID（优先用 failure_data 中的）
        failure_id = failure_data.get("failure_id") or f"fail-{uuid.uuid4().hex[:12]}"

        report = AttributionReport(
            failure_id=failure_id,
            category=best_category,
            root_cause=root_cause,
            evidence=evidence,
            recommendation=recommendation,
            confidence=round(confidence, 2),
        )

        self._logger.info(
            f"Attributed failure {report.failure_id} to "
            f"{best_category.value} (evidence_count={len(evidence)}, "
            f"confidence={report.confidence})"
        )
        return report

    # ── 内部辅助 ───────────────────────────────────────────────────

    def _extract_text(self, failure_data: dict[str, Any]) -> str:
        """将 failure_data 转为小写文本用于关键词扫描。

        递归展平嵌套 dict / list，拼接所有字符串值。
        """
        parts: list[str] = []

        def _flatten(obj: Any) -> None:
            if isinstance(obj, dict):
                for v in obj.values():
                    _flatten(v)
            elif isinstance(obj, list):
                for item in obj:
                    _flatten(item)
            elif isinstance(obj, str):
                parts.append(obj)
            else:
                parts.append(str(obj))

        _flatten(failure_data)
        return " ".join(parts).lower()

    def _select_best_category(
        self, scores: dict[AttributionCategory, list[str]]
    ) -> AttributionCategory:
        """选取匹配数最多的类别。平票时按枚举定义顺序选首个。"""
        best_cat = AttributionCategory.HARNESS_MISALIGNMENT
        best_count = -1
        for category in AttributionCategory:
            count = len(scores.get(category, []))
            if count > best_count:
                best_count = count
                best_cat = category
        # 若全部 0 匹配，默认归因到 HARNESS_MISALIGNMENT
        # （harness 是 eval 的评估对象，兜底合理）
        if best_count == 0:
            self._logger.debug(
                "No keyword matched, defaulting to HARNESS_MISALIGNMENT"
            )
        return best_cat

    def _render_template(
        self,
        template_group: str,
        category: AttributionCategory,
        defaults: dict[AttributionCategory, str],
        failure_data: dict[str, Any],
    ) -> str:
        """渲染文案——优先用 prompts.yaml 模板，回退到默认文案。

        铁律 5+P16：模板从外置 prompts.yaml 加载，禁止硬编码。
        """
        templates = self._templates.get(template_group, {})
        template = templates.get(category.value)
        fallback = defaults[category]
        if template:
            try:
                return template.format(
                    component_ref=failure_data.get("component_ref", "(unknown)"),
                    failure_id=failure_data.get("failure_id", "(unknown)"),
                    error=failure_data.get("error_message")
                    or failure_data.get("error", ""),
                )
            except (KeyError, ValueError, IndexError):
                pass
        return fallback
