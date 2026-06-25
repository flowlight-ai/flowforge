"""门禁投票策略 — 支持加权、共识、多数三种投票方式。

加权(weighted): 每个评估者有权重，最终分数 = 加权平均（原有逻辑）
共识(consensus): 所有评估者必须一致通过，任何异议则失败
多数(majority): 简单多数投票决定结果
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from flowforge.core.gate.models import GateStatus, GateVerdict, Score
from flowforge.core.tracing import get_logger

logger = get_logger("gate_voting")


class VotingStrategy(str, Enum):
    """门禁投票策略。"""
    WEIGHTED = "weighted"
    CONSENSUS = "consensus"
    MAJORITY = "majority"


def vote_weighted(
    scores: list[Score],
    pass_threshold: float = 0.7,
    weights: dict[str, float] | None = None,
    veto_dimensions: list[str] | None = None,
) -> GateVerdict:
    """加权投票：每个评估者有权重，最终分数 = 加权平均。

    Args:
        scores: 各维度评分列表
        pass_threshold: 通过阈值
        weights: 可选的维度权重覆盖（key=维度名, value=权重）
        veto_dimensions: 一票否决维度列表

    Returns:
        GateVerdict 包含投票结果
    """
    if not scores:
        return _empty_verdict("weighted", pass_threshold)

    # 如果提供了权重覆盖，应用到 scores
    effective_scores = scores
    if weights:
        effective_scores = []
        for s in scores:
            override_weight = weights.get(s.dimension)
            if override_weight is not None:
                effective_scores.append(
                    Score(
                        dimension=s.dimension,
                        value=s.value,
                        weight=override_weight,
                        rationale=s.rationale,
                        suggestions=s.suggestions,
                        confidence=s.confidence,
                    )
                )
            else:
                effective_scores.append(s)

    total_weight = sum(s.weight for s in effective_scores)
    weighted_sum = sum(s.weighted_value for s in effective_scores)
    overall_score = weighted_sum / total_weight if total_weight > 0 else 0.0

    # 一票否决检查
    veto_triggered: list[str] = []
    if veto_dimensions:
        for s in effective_scores:
            if s.dimension in veto_dimensions and s.value < pass_threshold * 0.5:
                veto_triggered.append(s.dimension)

    passed = overall_score >= pass_threshold and len(veto_triggered) == 0

    return GateVerdict(
        gate_id="",
        gate_name="",
        task_id="",
        status=GateStatus.PASSED if passed else GateStatus.FAILED,
        scores=effective_scores,
        overall_score=overall_score,
        pass_threshold=pass_threshold,
        veto_dimensions_triggered=veto_triggered,
        decision="pass" if passed else "fail",
    )


def vote_consensus(
    scores: list[Score],
    pass_threshold: float = 0.7,
    veto_dimensions: list[str] | None = None,
) -> GateVerdict:
    """共识投票：所有评估者必须一致通过，任何异议则失败。

    每个维度的评分必须 >= pass_threshold 才算通过。
    只要有一个维度不通过，整个门禁就失败。

    Args:
        scores: 各维度评分列表
        pass_threshold: 通过阈值
        veto_dimensions: 一票否决维度列表（在共识模式下同样适用）

    Returns:
        GateVerdict 包含投票结果
    """
    if not scores:
        return _empty_verdict("consensus", pass_threshold)

    # 一票否决检查
    veto_triggered: list[str] = []
    if veto_dimensions:
        for s in scores:
            if s.dimension in veto_dimensions and s.value < pass_threshold * 0.5:
                veto_triggered.append(s.dimension)

    # 共识检查：所有维度都必须通过
    dissenting: list[str] = []
    for s in scores:
        if s.value < pass_threshold:
            dissenting.append(s.dimension)

    passed = len(dissenting) == 0 and len(veto_triggered) == 0

    # 计算加权平均分作为 overall_score（保持信息性）
    total_weight = sum(s.weight for s in scores)
    overall_score = sum(s.weighted_value for s in scores) / total_weight if total_weight > 0 else 0.0

    return GateVerdict(
        gate_id="",
        gate_name="",
        task_id="",
        status=GateStatus.PASSED if passed else GateStatus.FAILED,
        scores=scores,
        overall_score=overall_score,
        pass_threshold=pass_threshold,
        veto_dimensions_triggered=veto_triggered,
        decision="pass" if passed else "fail",
        reviewer_feedback=f"Consensus failed: dimensions below threshold: {dissenting}" if dissenting else "",
    )


def vote_majority(
    scores: list[Score],
    pass_threshold: float = 0.7,
    veto_dimensions: list[str] | None = None,
) -> GateVerdict:
    """多数投票：简单多数投票决定结果。

    每个维度的评分 >= pass_threshold 算一票赞成，否则算一票反对。
    赞成票 > 反对票则通过。

    Args:
        scores: 各维度评分列表
        pass_threshold: 通过阈值
        veto_dimensions: 一票否决维度列表（即使多数通过，否决维度触发也失败）

    Returns:
        GateVerdict 包含投票结果
    """
    if not scores:
        return _empty_verdict("majority", pass_threshold)

    # 一票否决检查（优先级最高）
    veto_triggered: list[str] = []
    if veto_dimensions:
        for s in scores:
            if s.dimension in veto_dimensions and s.value < pass_threshold * 0.5:
                veto_triggered.append(s.dimension)

    # 多数投票
    approve_count = sum(1 for s in scores if s.value >= pass_threshold)
    reject_count = len(scores) - approve_count

    majority_passed = approve_count > reject_count
    passed = majority_passed and len(veto_triggered) == 0

    # 计算加权平均分作为 overall_score
    total_weight = sum(s.weight for s in scores)
    overall_score = sum(s.weighted_value for s in scores) / total_weight if total_weight > 0 else 0.0

    return GateVerdict(
        gate_id="",
        gate_name="",
        task_id="",
        status=GateStatus.PASSED if passed else GateStatus.FAILED,
        scores=scores,
        overall_score=overall_score,
        pass_threshold=pass_threshold,
        veto_dimensions_triggered=veto_triggered,
        decision="pass" if passed else "fail",
        reviewer_feedback=(
            f"Majority vote: {approve_count} approve, {reject_count} reject"
            + (f"; veto triggered: {veto_triggered}" if veto_triggered else "")
        ),
    )


def resolve_gate(
    strategy: VotingStrategy,
    scores: list[Score],
    pass_threshold: float = 0.7,
    weights: dict[str, float] | None = None,
    veto_dimensions: list[str] | None = None,
) -> GateVerdict:
    """根据策略解析门禁结果。

    Args:
        strategy: 投票策略
        scores: 各维度评分列表
        pass_threshold: 通过阈值
        weights: 维度权重覆盖（仅 weighted 策略使用）
        veto_dimensions: 一票否决维度列表

    Returns:
        GateVerdict 包含投票结果
    """
    logger.info(
        f"[gate_voting] resolving gate with strategy={strategy.value}, "
        f"scores_count={len(scores)}, threshold={pass_threshold}"
    )

    if strategy == VotingStrategy.WEIGHTED:
        verdict = vote_weighted(scores, pass_threshold, weights, veto_dimensions)
    elif strategy == VotingStrategy.CONSENSUS:
        verdict = vote_consensus(scores, pass_threshold, veto_dimensions)
    elif strategy == VotingStrategy.MAJORITY:
        verdict = vote_majority(scores, pass_threshold, veto_dimensions)
    else:
        logger.warning(f"[gate_voting] unknown strategy {strategy}, falling back to weighted")
        verdict = vote_weighted(scores, pass_threshold, weights, veto_dimensions)

    logger.info(
        f"[gate_voting] resolved: strategy={strategy.value}, "
        f"decision={verdict.decision}, overall_score={verdict.overall_score:.4f}"
    )
    return verdict


def _empty_verdict(strategy_name: str, pass_threshold: float) -> GateVerdict:
    """无评分时的默认裁决。"""
    return GateVerdict(
        gate_id="",
        gate_name="",
        task_id="",
        status=GateStatus.FAILED,
        overall_score=0.0,
        pass_threshold=pass_threshold,
        decision="fail",
        reviewer_feedback=f"No scores provided for {strategy_name} voting",
    )
