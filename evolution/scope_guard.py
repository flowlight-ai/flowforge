"""Mode A: Scope Guard — 当讨论偏离当前 feat 愿景时温柔提醒。

触发信号（满足 2 个普通信号或 1 个强信号）：
- 新想法不直接服务当前愿景 (普通)
- 新想法引入新的用户旅程/新页面/新子系统 (强)
- 新想法需要新的外部依赖/API/数据模型 (强)
- 新想法导致"这次怎么验收"说不清了 (强)

行为：
- 同一 phase 最多两次提醒
- 第一次温柔，第二次明确说"建议碰头"
- 用户说"不拆" → 复述新验收边界，不再追问
- ≥3 次同一 feat 触发 → 建议拆 feat
"""

from __future__ import annotations

import re
from datetime import datetime

from flowforge.core.tracing import get_logger
from flowforge.evolution.models import ScopeGuardLog, ScopeGuardSignal

logger = get_logger("flowforge.evolution.scope_guard")

# 强信号关键词集合（启发式匹配，无 LLM 调用）
_NEW_JOURNEY_KEYWORDS = [
    "新页面", "新页面", "新旅程", "新子系统", "新模块", "新入口",
    "new page", "new journey", "new subsystem", "new module", "new screen",
    "新增页面", "新增入口", "新增流程",
]
_NEW_DEPENDENCY_KEYWORDS = [
    "新依赖", "新api", "新接口", "新数据模型", "新表", "新sdk", "新库",
    "new dependency", "new api", "new table", "new sdk", "new library",
    "接入", "集成第三方", "外部服务",
]
_AC_AMBIGUITY_KEYWORDS = [
    "再说", "看情况", "差不多", "到时候", "先这样", "可能", "或许",
    "maybe", "later", "todo", "tbd", "待定",
]


class ScopeGuard:
    """Mode A: Scope Guard — 偏离检测与温柔提醒。

    同一 feature_id 最多两次提醒，第三次触发建议拆 feat。
    """

    MAX_REMINDS_PER_PHASE = 2
    DIVERGENCE_THRESHOLD = 3  # ≥3 次同一 feat 触发 → 建议拆 feat

    def __init__(self) -> None:
        self._logs: list[ScopeGuardLog] = []
        self._phase_trigger_counts: dict[str, int] = {}  # feature_id -> count

    def detect_signals(
        self,
        current_vision: str,
        new_idea: str,
        current_ac: list[str],
    ) -> list[ScopeGuardSignal]:
        """检测偏离信号。

        启发式实现（无 LLM 调用）：
        - NOT_SERVING_VISION: 新想法与当前愿景关键词重叠度过低
        - NEW_JOURNEY: 新想法包含新旅程/页面/子系统关键词
        - NEW_DEPENDENCY: 新想法包含新依赖/API/数据模型关键词
        - UNCLEAR_VERIFICATION: 验收标准为空，或新想法含模糊措辞
        """
        signals: list[ScopeGuardSignal] = []
        idea_lower = new_idea.lower()
        vision_lower = current_vision.lower()

        # NOT_SERVING_VISION (普通): 关键词重叠度过低
        vision_tokens = {t for t in re.split(r"[\s,，。.;；、]+", vision_lower) if len(t) >= 2}
        idea_tokens = {t for t in re.split(r"[\s,，。.;；、]+", idea_lower) if len(t) >= 2}
        if vision_tokens:
            overlap = len(vision_tokens & idea_tokens) / len(vision_tokens)
            if overlap < 0.15:
                signals.append(ScopeGuardSignal.NOT_SERVING_VISION)

        # NEW_JOURNEY (强)
        if any(kw in idea_lower for kw in _NEW_JOURNEY_KEYWORDS):
            signals.append(ScopeGuardSignal.NEW_JOURNEY)

        # NEW_DEPENDENCY (强)
        if any(kw in idea_lower for kw in _NEW_DEPENDENCY_KEYWORDS):
            signals.append(ScopeGuardSignal.NEW_DEPENDENCY)

        # UNCLEAR_VERIFICATION (强): AC 为空 或 新想法含模糊措辞
        if not current_ac or any(kw in idea_lower for kw in _AC_AMBIGUITY_KEYWORDS):
            signals.append(ScopeGuardSignal.UNCLEAR_VERIFICATION)

        logger.debug(
            f"scope_guard detect_signals: vision_tokens={len(vision_tokens)}, "
            f"overlap={overlap if vision_tokens else 0:.2f}, signals={[s.value for s in signals]}"
        )
        return signals

    def should_remind(self, feature_id: str) -> bool:
        """是否应该提醒（同一 phase 最多两次）。"""
        return self._phase_trigger_counts.get(feature_id, 0) < self.MAX_REMINDS_PER_PHASE

    def generate_reminder(self, vision: str, new_direction: str, signal_count: int) -> str:
        """生成提醒文本。

        第一次温柔提醒，第二次明确建议碰头。
        """
        # signal_count 此处复用为该 phase 已触发次数（1-based）
        if signal_count <= 1:
            return (
                f"【温柔提醒】这个新方向（{new_direction[:40]}…）似乎不直接服务当前愿景"
                f"（{vision[:40]}…）。如果属于当前 feat 范围，请补一句验收标准；"
                f"如果不属于，建议记到 backlog，避免当前 feat 膨胀。"
            )
        return (
            f"【明确提醒】这是本 feat 第二次出现偏离信号（当前愿景：{vision[:40]}…）。"
            f"建议碰头确认：是拆 feat、调整愿景，还是明确新验收边界。"
            f"如确认不拆，请复述新的验收边界，后续不再追问。"
        )

    def log_trigger(
        self,
        feature_id: str,
        signal_type: str,
        action: str,
        outcome: str,
        agent: str,
    ) -> ScopeGuardLog:
        """记录触发到 Scope Guard Log，并递增 phase 计数。"""
        entry = ScopeGuardLog(
            date=datetime.utcnow(),
            feature_id=feature_id,
            signal_type=signal_type,
            action_taken=action,
            outcome=outcome,
            agent=agent,
        )
        self._logs.append(entry)
        self._phase_trigger_counts[feature_id] = self._phase_trigger_counts.get(feature_id, 0) + 1
        logger.info(
            f"scope_guard triggered: feature_id={feature_id}, signal={signal_type}, "
            f"count={self._phase_trigger_counts[feature_id]}"
        )
        return entry

    def get_log(self) -> list[ScopeGuardLog]:
        """获取 Scope Guard 日志。"""
        return list(self._logs)

    def check_divergence_pattern(self, feature_id: str) -> bool:
        """检查发散模式（≥3 次同一 feat 触发 → 建议拆 feat）。"""
        count = sum(1 for log in self._logs if log.feature_id == feature_id)
        return count >= self.DIVERGENCE_THRESHOLD

    def reset_phase(self, feature_id: str) -> None:
        """重置某个 feature 的 phase 计数（feat 拆分或结束后调用）。"""
        self._phase_trigger_counts.pop(feature_id, None)
