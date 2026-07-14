"""元认知路由 (Metacognition Router) — 三信号路由，不信单次口头自信度。

三信号：
1. domain_reliability: 滚动域内可靠度 (successes+1)/(trials+2) + Wilson 下界
2. evidence_completeness: 证据覆盖度评估
3. self_reported_confidence: 自报置信度（参考但不依赖）

高风险域 action_confidence < 0.85 → 只做结构化分析 + 明确升级
"""

from __future__ import annotations

import math

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
