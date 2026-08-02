"""三方信号交叉验证——trace + 人 + 自动探针。

只看 trace 不够，必须三方信号交叉（roleagent.md §5.3）：
    - trace 信号：执行轨迹（agent 做了什么）
    - 用户信号：用户反馈 / 摩擦信号（用户感受到了什么）
    - 探针信号：自动探针（如定期跑 benchmark，客观指标）

三方交叉的价值：
    - 三方一致 → 高置信度共识
    - 两方一致 → 多数共识，记录分歧
    - 三方分歧 → 无共识，升级 operator

轨迹经济学（roleagent.md §5.5）：trace 采集有成本，
三方信号交叉的目的是用最低成本获得最高置信度判断。

设计依据：
    - features/F019-three-signal-cross.md
    - decisions/009-eval-self-metabolism.md
    - roleagent.md §5.3（三方信号交叉）

铁律遵守：
    - 铁律 3：通过构造函数注入 logger
    - 铁律 5：无硬编码路径/密钥
    - 编程红线 9：使用组合而非继承

License: MIT
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import TraceLogger, get_logger


# ──────────────────────────────────────────────────────────────────────────────
# 信号类型枚举
# ──────────────────────────────────────────────────────────────────────────────


class SignalType(str, Enum):
    """三方信号类型——对应 roleagent.md §5.3 的三个信号来源。

    Attributes:
        TRACE: 执行轨迹信号（agent 做了什么）。
        HUMAN: 用户反馈信号（用户感受到了什么，含摩擦信号）。
        AUTO: 自动探针信号（客观指标，如 benchmark / 定期探针）。
    """

    TRACE = "trace"
    HUMAN = "human"
    AUTO = "auto"


# ──────────────────────────────────────────────────────────────────────────────
# 信号数据模型
# ──────────────────────────────────────────────────────────────────────────────


class Signal(BaseModel):
    """三方信号——单条信号数据模型。

    一条信号描述某个来源在某个时间点对某个组件的观察。

    Attributes:
        signal_id: 信号唯一标识。
        signal_type: 信号类型（TRACE / HUMAN / AUTO）。
        source: 信号来源标识（如 "trace_collector" / "user_feedback" / "benchmark_probe"）。
        content: 信号内容（任意结构，推荐 dict 含 verdict/score 字段）。
        timestamp: 信号采集时间 ISO 8601。
        confidence: 信号置信度（0.0-1.0）。
        component_ref: 关联的 harness 组件引用（可选，便于按组件聚合）。
    """

    signal_id: str = Field(
        default_factory=lambda: f"sig-{uuid.uuid4().hex[:12]}",
        description="信号唯一标识",
    )
    signal_type: SignalType = Field(..., description="信号类型")
    source: str = Field(..., description="信号来源标识")
    content: Any = Field(
        default=None, description="信号内容（推荐 dict 含 verdict/score 字段）"
    )
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="采集时间 ISO 8601",
    )
    confidence: float = Field(
        default=0.5, ge=0.0, le=1.0, description="信号置信度"
    )
    component_ref: Optional[str] = Field(
        default=None, description="关联的 harness 组件引用"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 交叉验证结果
# ──────────────────────────────────────────────────────────────────────────────


class CrossValidationResult(BaseModel):
    """三方信号交叉验证结果。

    对应 roleagent.md §5.3：三方信号交叉的输出。

    Attributes:
        consensus: 是否达成共识（True 表示至少两方一致）。
        consensus_value: 共识值（"pass" / "fail" / None）。
        disagreements: 分歧描述列表（记录哪方与多数不一致）。
        recommendation: 基于交叉结果的建议
            （"proceed" / "proceed_with_caution" / "escalate_operator"）。
        confidence: 交叉验证综合置信度（0.0-1.0）。
        signal_count: 参与交叉的信号数。
    """

    consensus: bool = Field(..., description="是否达成共识")
    consensus_value: Optional[str] = Field(
        default=None, description="共识值（pass / fail / None）"
    )
    disagreements: list[str] = Field(
        default_factory=list, description="分歧描述列表"
    )
    recommendation: str = Field(
        ..., description="建议（proceed / proceed_with_caution / escalate_operator）"
    )
    confidence: float = Field(
        default=0.5, ge=0.0, le=1.0, description="交叉验证综合置信度"
    )
    signal_count: int = Field(
        default=0, ge=0, description="参与交叉的信号数"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 三方信号交叉验证器
# ──────────────────────────────────────────────────────────────────────────────


# 共识判定阈值：信号置信度 >= 此值视为 "pass"，否则 "fail"
_CONFIDENCE_PASS_THRESHOLD: float = 0.5


def _extract_verdict(signal: Signal) -> str:
    """从信号中提取归一化判定值（"pass" / "fail"）。

    提取优先级：
        1. content 为 dict 且含 "verdict" 键 → 直接使用
        2. content 为 dict 且含 "score" 键 → score >= 0.85 → "pass"，否则 "fail"
        3. 否则 → 按 confidence 判定（>= 0.5 → "pass"）

    Args:
        signal: 三方信号。

    Returns:
        "pass" 或 "fail"。
    """
    content = signal.content
    if isinstance(content, dict):
        verdict = content.get("verdict")
        if verdict in ("pass", "fail", "warn"):
            # warn 归入 fail（需要关注）
            return "fail" if verdict == "warn" else verdict  # type: ignore[return-value]
        score = content.get("score")
        if isinstance(score, (int, float)):
            return "pass" if float(score) >= 0.85 else "fail"
    # 回退到 confidence
    return "pass" if signal.confidence >= _CONFIDENCE_PASS_THRESHOLD else "fail"


class ThreeSignalCrossValidator:
    """三方信号交叉验证器——采集 + 交叉验证。

    铁律 3：通过构造函数注入 logger，不直接实例化外部服务。
    所有采集和验证操作使用 async/await（铁律 6）。

    Args:
        logger: TraceLogger 实例。若未注入，使用默认 "eval.three_signals" logger。
    """

    def __init__(self, logger: Optional[TraceLogger] = None) -> None:
        self._logger: TraceLogger = logger or get_logger("eval.three_signals")

    # ── 信号采集 ──────────────────────────────────────────────────

    async def collect_trace_signal(
        self, trace_data: dict[str, Any]
    ) -> Signal:
        """采集 trace 信号——执行轨迹。

        trace 信号描述 agent 实际做了什么（步骤、工具调用、耗时、错误）。
        轨迹经济学：trace 采集有成本，调用方需权衡采集粒度。

        Args:
            trace_data: 执行轨迹数据。推荐字段：
                - source: 轨迹采集器标识
                - component_ref: 关联组件
                - steps: 执行步骤列表
                - verdict: "pass" / "fail" / "warn"
                - errors: 错误列表
                - confidence: 置信度

        Returns:
            构建的 TRACE 类型 Signal。
        """
        signal = Signal(
            signal_type=SignalType.TRACE,
            source=trace_data.get("source", "trace_collector"),
            content=trace_data,
            confidence=float(trace_data.get("confidence", 0.5)),
            component_ref=trace_data.get("component_ref"),
        )
        self._logger.debug(
            f"Collected trace signal {signal.signal_id} "
            f"from '{signal.source}' (verdict={_extract_verdict(signal)})"
        )
        return signal

    async def collect_human_signal(
        self, human_feedback: dict[str, Any]
    ) -> Signal:
        """采集用户信号——用户反馈 / 摩擦信号。

        用户信号描述用户感受到了什么（评分、反馈文本、摩擦事件）。
        摩擦信号是 harness eval 的关键输入（roleagent.md §5.1 L3）。

        Args:
            human_feedback: 用户反馈数据。推荐字段：
                - source: 反馈来源（如 "user_feedback" / "friction_monitor"）
                - component_ref: 关联组件
                - rating: 评分（1-5）
                - feedback: 反馈文本
                - verdict: "pass" / "fail"
                - friction: 摩擦事件描述
                - confidence: 置信度

        Returns:
            构建的 HUMAN 类型 Signal。
        """
        signal = Signal(
            signal_type=SignalType.HUMAN,
            source=human_feedback.get("source", "user_feedback"),
            content=human_feedback,
            confidence=float(human_feedback.get("confidence", 0.5)),
            component_ref=human_feedback.get("component_ref"),
        )
        self._logger.debug(
            f"Collected human signal {signal.signal_id} "
            f"from '{signal.source}' (verdict={_extract_verdict(signal)})"
        )
        return signal

    async def collect_auto_signal(
        self, auto_metric: dict[str, Any]
    ) -> Signal:
        """采集自动探针信号——客观指标。

        探针信号描述自动探针的客观测量结果（benchmark 分数、延迟、成功率）。

        Args:
            auto_metric: 自动探针指标数据。推荐字段：
                - source: 探针标识（如 "benchmark_probe" / "latency_monitor"）
                - component_ref: 关联组件
                - metric: 指标名
                - value: 指标值
                - threshold: 通过阈值
                - verdict: "pass" / "fail"
                - confidence: 置信度

        Returns:
            构建的 AUTO 类型 Signal。
        """
        signal = Signal(
            signal_type=SignalType.AUTO,
            source=auto_metric.get("source", "benchmark_probe"),
            content=auto_metric,
            confidence=float(auto_metric.get("confidence", 0.5)),
            component_ref=auto_metric.get("component_ref"),
        )
        self._logger.debug(
            f"Collected auto signal {signal.signal_id} "
            f"from '{signal.source}' (verdict={_extract_verdict(signal)})"
        )
        return signal

    # ── 交叉验证 ──────────────────────────────────────────────────

    async def cross_validate(
        self, signals: list[Signal]
    ) -> CrossValidationResult:
        """三方信号交叉验证。

        验证逻辑（roleagent.md §5.3）：
            - 三方一致 → consensus=True，recommendation="proceed"
            - 两方一致 → consensus=True（多数），recommendation="proceed_with_caution"
            - 三方分歧 → consensus=False，recommendation="escalate_operator"
            - 不足两方 → consensus=False，recommendation="escalate_operator"

        综合置信度 = 平均置信度 × (共识信号数 / 总信号数)。

        Args:
            signals: 参与交叉的信号列表（推荐 3 方各 1 条）。

        Returns:
            CrossValidationResult 包含共识判定、分歧、建议。
        """
        if not signals:
            self._logger.warning("cross_validate called with empty signals")
            return CrossValidationResult(
                consensus=False,
                consensus_value=None,
                disagreements=["无信号输入"],
                recommendation="escalate_operator",
                confidence=0.0,
                signal_count=0,
            )

        # 提取每条信号的判定值
        verdicts = [_extract_verdict(s) for s in signals]
        signal_count = len(signals)

        # 统计 pass / fail 票数
        pass_count = sum(1 for v in verdicts if v == "pass")
        fail_count = signal_count - pass_count

        # 多数投票
        majority_verdict: Optional[str]
        majority_count: int
        if pass_count > fail_count:
            majority_verdict = "pass"
            majority_count = pass_count
        elif fail_count > pass_count:
            majority_verdict = "fail"
            majority_count = fail_count
        else:
            # 平票（如 1 pass 1 fail，或 0 信号）→ 无共识
            majority_verdict = None
            majority_count = pass_count  # 等于 fail_count

        # 共识判定
        consensus = majority_verdict is not None and majority_count >= 2

        # 分歧记录
        disagreements: list[str] = []
        if signal_count >= 2 and majority_verdict is not None:
            for i, (sig, v) in enumerate(zip(signals, verdicts)):
                if v != majority_verdict:
                    disagreements.append(
                        f"信号 {sig.signal_id}（{sig.signal_type.value}/{sig.source}）"
                        f"判定为 '{v}'，与多数 '{majority_verdict}' 不一致"
                    )

        # 建议生成
        if not consensus or majority_verdict is None:
            recommendation = "escalate_operator"
        elif majority_verdict == "fail":
            recommendation = "escalate_operator"
        elif disagreements:
            recommendation = "proceed_with_caution"
        else:
            recommendation = "proceed"

        # 综合置信度 = 平均置信度 × (共识信号数 / 总信号数)
        avg_conf = sum(s.confidence for s in signals) / signal_count
        if majority_verdict is not None:
            agreement_ratio = majority_count / signal_count
        else:
            agreement_ratio = 0.0
        combined_confidence = avg_conf * agreement_ratio

        self._logger.info(
            f"Cross-validated {signal_count} signals: "
            f"consensus={consensus} verdict={majority_verdict} "
            f"pass={pass_count} fail={fail_count} "
            f"recommendation={recommendation} "
            f"confidence={combined_confidence:.3f}"
        )

        return CrossValidationResult(
            consensus=consensus,
            consensus_value=majority_verdict,
            disagreements=disagreements,
            recommendation=recommendation,
            confidence=round(combined_confidence, 4),
            signal_count=signal_count,
        )
