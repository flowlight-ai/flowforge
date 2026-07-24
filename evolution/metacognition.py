"""元认知路由 (Metacognition Router) — 三信号路由 + Mode C 反思，不信单次口头自信度。

三信号：
1. domain_reliability: 滚动域内可靠度 (successes+1)/(trials+2) + Wilson 下界
2. evidence_completeness: 证据覆盖度评估
3. self_reported_confidence: 自报置信度（参考但不依赖）

高风险域 action_confidence < 0.85 → 只做结构化分析 + 明确升级

CL-006 三模式（Mode A/B/C）：
- Mode A "proceed": action_confidence ≥ 0.85 → 直接执行
- Mode B "structured_analysis_only" / "escalate": action_confidence < 0.85 → 拒绝/升级
- Mode C "reflective_review": 执行后回顾决策质量，更新元认知信号（CL-006 新增）
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.evolution.metacognition")

# 高风险域动作置信度阈值
HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD = 0.85

# 信号权重（domain_reliability 主导，self_reported 仅参考）
WEIGHT_DOMAIN_RELIABILITY = 0.5
WEIGHT_EVIDENCE_COMPLETENESS = 0.35
WEIGHT_SELF_REPORTED = 0.15


class MetacognitionRouter:
    """元认知路由 — 基于三信号的动作决策。

    高风险域采用更保守的 Wilson 下界作为 domain_reliability。
    """

    def compute_domain_reliability(self, successes: int, trials: int) -> float:
        """计算滚动域内可靠度 (successes+1)/(trials+2)。

        Laplace 平滑：避免 0/trials 或 successes/successes 的极端值。
        """
        if trials < 0:
            raise ValueError(f"trials must be >= 0, got {trials}")
        if successes < 0 or successes > trials:
            raise ValueError(f"successes {successes} out of range [0, {trials}]")
        return (successes + 1) / (trials + 2)

    def compute_wilson_lower_bound(
        self,
        successes: int,
        trials: int,
        z: float = 1.96,
    ) -> float:
        """计算 Wilson 下界（95% 置信区间下界，z=1.96）。

        Wilson score interval lower bound:
        p_hat = s/n
        center = (p_hat + z²/(2n)) / (1 + z²/n)
        margin = (z / (1 + z²/n)) * sqrt(p_hat*(1-p_hat)/n + z²/(4n²))
        lower = center - margin
        """
        if trials <= 0:
            return 0.0
        if successes < 0 or successes > trials:
            raise ValueError(f"successes {successes} out of range [0, {trials}]")
        if z <= 0:
            raise ValueError(f"z must be > 0, got {z}")

        n = trials
        p_hat = successes / n
        z2 = z * z
        denominator = 1 + z2 / n
        center = (p_hat + z2 / (2 * n)) / denominator
        margin = (z / denominator) * math.sqrt(
            p_hat * (1 - p_hat) / n + z2 / (4 * n * n)
        )
        lower = center - margin
        # 数值钳制到 [0, 1]
        return max(0.0, min(1.0, lower))

    def route_confidence(
        self,
        domain_reliability: float,
        evidence_completeness: float,
        self_reported: float,
        is_high_risk: bool = False,
    ) -> dict:
        """路由决策。

        返回 dict:
        - action_confidence: 加权置信度（高风险域用 Wilson 下界替代 domain_reliability）
        - route: "proceed" | "structured_analysis_only" | "escalate"
        - reason: 决策原因
        - signals: 三信号原值
        """
        # 输入钳制
        dr = max(0.0, min(1.0, float(domain_reliability)))
        ec = max(0.0, min(1.0, float(evidence_completeness)))
        sr = max(0.0, min(1.0, float(self_reported)))

        # 高风险域：domain_reliability 取保守值（已由调用方通过 Wilson 下界传入，
        # 此处不再二次计算，但降低 self_reported 权重至 0，更保守）
        if is_high_risk:
            weight_dr = WEIGHT_DOMAIN_RELIABILITY + WEIGHT_SELF_REPORTED / 2
            weight_ec = WEIGHT_EVIDENCE_COMPLETENESS + WEIGHT_SELF_REPORTED / 2
            weight_sr = 0.0
        else:
            weight_dr = WEIGHT_DOMAIN_RELIABILITY
            weight_ec = WEIGHT_EVIDENCE_COMPLETENESS
            weight_sr = WEIGHT_SELF_REPORTED

        action_confidence = dr * weight_dr + ec * weight_ec + sr * weight_sr

        # 路由决策
        if is_high_risk and action_confidence < HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD:
            route = "escalate"
            reason = (
                f"high-risk domain action_confidence={action_confidence:.4f} "
                f"< threshold {HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD} → 只做结构化分析 + 明确升级"
            )
        elif action_confidence < HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD:
            route = "structured_analysis_only"
            reason = (
                f"action_confidence={action_confidence:.4f} "
                f"< threshold {HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD} → 仅结构化分析"
            )
        else:
            route = "proceed"
            reason = f"action_confidence={action_confidence:.4f} >= threshold → 可执行"

        result = {
            "action_confidence": round(action_confidence, 4),
            "route": route,
            "reason": reason,
            "signals": {
                "domain_reliability": round(dr, 4),
                "evidence_completeness": round(ec, 4),
                "self_reported_confidence": round(sr, 4),
                "is_high_risk": is_high_risk,
            },
        }
        logger.debug(
            f"metacognition route: dr={dr:.3f} ec={ec:.3f} sr={sr:.3f} "
            f"high_risk={is_high_risk} -> confidence={action_confidence:.4f} route={route}"
        )
        return result


# ════════════════════════════════════════════════════════════════════
# §2 CL-006 Mode C 反思模式（reflective_review）
# ════════════════════════════════════════════════════════════════════


# Mode C 反思结果类型
ReflectionOutcome = Literal[
    "confirmed",  # 决策正确（结果符合预期）
    "corrected",  # 决策有偏差但已纠正
    "rejected",  # 决策错误被拒绝
    "escalated",  # 升级处理
]


class MetacognitionReflection(BaseModel):
    """CL-006 Mode C 元认知反思记录.

    在 Mode A/B 决策执行后，由系统或 operator 触发反思，
    回顾决策质量并更新元认知信号（domain_reliability）。
    """

    reflection_id: str  # 唯一 ID
    decision_id: str  # 关联的决策 ID（route_confidence 调用记录）
    domain: str  # 决策所属领域
    outcome: ReflectionOutcome  # 反思结果
    predicted_confidence: float = 0.0  # 预测的 action_confidence（事前）
    actual_success: bool = False  # 实际是否成功
    actual_quality_score: float = 0.0  # 实际质量分 0.0~1.0（如有）
    reflection_notes: str = ""  # 反思说明
    signal_updates: dict[str, float] = Field(
        default_factory=dict
    )  # 信号更新建议（如 {"domain_reliability_delta": -0.05}）
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class MetacognitionReflector:
    """CL-006 Mode C 反思执行器 — 事后回顾决策质量.

    工作流程：
    1. 决策执行后调用 reflect_on_decision 记录反思
    2. 根据反思结果计算 domain_reliability 更新建议
    3. 累积反思记录到 EchoStore（经验记忆存储）
    4. 下次 route_confidence 调用时使用更新后的 domain_reliability

    反思规则：
    - confirmed: 预测准确 → domain_reliability 微增 (+0.02)
    - corrected: 预测偏差但纠正 → 不变 (0.0)
    - rejected: 预测错误 → domain_reliability 显著降低 (-0.10)
    - escalated: 升级正确 → 不变 (0.0)，升级错误 → 微降 (-0.05)
    """

    # 反思结果 → domain_reliability 更新建议
    OUTCOME_TO_DELTA: dict[ReflectionOutcome, float] = {
        "confirmed": 0.02,
        "corrected": 0.0,
        "rejected": -0.10,
        "escalated": -0.05,
    }

    def __init__(self) -> None:
        self._reflections: list[MetacognitionReflection] = []
        self._logger = logger

    def reflect_on_decision(
        self,
        *,
        decision_id: str,
        domain: str,
        outcome: ReflectionOutcome,
        predicted_confidence: float = 0.0,
        actual_success: bool = False,
        actual_quality_score: float = 0.0,
        reflection_notes: str = "",
    ) -> MetacognitionReflection:
        """记录一次决策反思.

        Args:
            decision_id: 关联的决策 ID（route_confidence 调用记录）
            domain: 决策所属领域
            outcome: 反思结果（confirmed/corrected/rejected/escalated）
            predicted_confidence: 预测的 action_confidence（事前）
            actual_success: 实际是否成功
            actual_quality_score: 实际质量分 0.0~1.0（如有）
            reflection_notes: 反思说明

        Returns:
            MetacognitionReflection（含 signal_updates）
        """
        reflection_id = f"reflect-{decision_id}-{len(self._reflections):04d}"
        delta = self.OUTCOME_TO_DELTA.get(outcome, 0.0)

        reflection = MetacognitionReflection(
            reflection_id=reflection_id,
            decision_id=decision_id,
            domain=domain,
            outcome=outcome,
            predicted_confidence=predicted_confidence,
            actual_success=actual_success,
            actual_quality_score=actual_quality_score,
            reflection_notes=reflection_notes,
            signal_updates={"domain_reliability_delta": delta},
        )

        self._reflections.append(reflection)
        self._logger.info(
            f"Mode C 反思: decision={decision_id}, domain={domain}, "
            f"outcome={outcome}, delta={delta:+.2f}, "
            f"total_reflections={len(self._reflections)}"
        )
        return reflection

    def get_reflections_by_domain(self, domain: str) -> list[MetacognitionReflection]:
        """按领域查询反思记录."""
        return [r for r in self._reflections if r.domain == domain]

    def compute_reliability_adjustment(self, domain: str) -> float:
        """计算指定领域的累积 domain_reliability 调整量.

        用于在下次 route_confidence 调用时调整 domain_reliability 输入。

        Returns:
            累积调整量（可正可负）
        """
        domain_reflections = self.get_reflections_by_domain(domain)
        if not domain_reflections:
            return 0.0
        return sum(
            r.signal_updates.get("domain_reliability_delta", 0.0)
            for r in domain_reflections
        )

    def compute_calibration_score(self, domain: str | None = None) -> float:
        """计算校准分数（calibration score）— 预测准确度.

        校准分数 = (confirmed + corrected) / total
        - 1.0: 所有预测都准确
        - 0.0: 所有预测都错误

        Args:
            domain: 指定领域（None = 全部领域）
        """
        if domain:
            reflections = self.get_reflections_by_domain(domain)
        else:
            reflections = self._reflections

        if not reflections:
            return 0.0

        accurate = sum(
            1 for r in reflections if r.outcome in ("confirmed", "corrected")
        )
        return accurate / len(reflections)

    @property
    def total_reflections(self) -> int:
        """总反思记录数."""
        return len(self._reflections)

    def export_to_echo_store(self) -> list[dict]:
        """导出反思记录为 dict 列表（供 EchoStore 持久化）.

        CL-006 要求：反思记录必须累积到 EchoStore，
        下次 route_confidence 调用时使用更新后的 domain_reliability。
        """
        return [r.model_dump() for r in self._reflections]


__all__ = [
    # 常量
    "HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD",
    "WEIGHT_DOMAIN_RELIABILITY",
    "WEIGHT_EVIDENCE_COMPLETENESS",
    "WEIGHT_SELF_REPORTED",
    # Mode A/B
    "MetacognitionRouter",
    # Mode C
    "MetacognitionReflection",
    "MetacognitionReflector",
    "ReflectionOutcome",
]
