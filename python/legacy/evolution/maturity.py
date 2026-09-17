"""五级知识成熟度阶梯 (Knowledge Maturity Ladder)。

| Level | 形态 | 晋升条件 | 降级/冻结 |
|-------|------|----------|-----------|
| L0 Episode | 原始记录 | 模板完整，已分离可迁移/不可迁移 | 不降级 |
| L1 Pattern | 草稿 | ≥2 个相似 episode（180天内），或人类要求；5Q ≥ 7/10 | 一次性特例 → rejected |
| L2 Draft | Method Card / Skill Draft | smoke gate ≥3 cases（≥2/3 通过）；promotion gate ≥5 cases（≥3/5 通过，覆盖 3 类） | 最近 3 次 <50% → 退 L1 |
| L3 Validated | 正式 method/skill | ≥6 uses，≥2 agents，≥80%，无 critical breach | 最近 5 次 <60% → 退 L2 |
| L4 Standard | 团队标准 | ≥12 uses，最近 10 次 ≥90%，用户批准 | 1 次高风险越界 → freeze |

双车道：long_tail=True 允许长期停 L2/L3（高风险/低频域）
"""

from __future__ import annotations

from flowforge.core.tracing import get_logger
from flowforge.evolution.models import KnowledgeMaturityLevel

logger = get_logger("flowforge.evolution.maturity")

# 晋升条件阈值
_L1_PROMOTION_MIN_EPISODES = 2
_L1_EPISODE_WINDOW_DAYS = 180
_L1_FIVE_Q_THRESHOLD = 7  # 5Q ≥ 7/10

_L2_SMOKE_CASES = 3
_L2_SMOKE_PASS_THRESHOLD = 2
_L2_PROMOTION_CASES = 5
_L2_PROMOTION_PASS_THRESHOLD = 3
_L2_PROMOTION_CATEGORY_COVERAGE = 3

_L3_MIN_USES = 6
_L3_MIN_AGENTS = 2
_L3_MIN_SUCCESS_RATE = 0.80

_L4_MIN_USES = 12
_L4_RECENT_WINDOW = 10
_L4_RECENT_SUCCESS_RATE = 0.90

# 降级条件阈值
_L2_DEMOTION_WINDOW = 3
_L2_DEMOTION_SUCCESS_RATE = 0.50
_L3_DEMOTION_WINDOW = 5
_L3_DEMOTION_SUCCESS_RATE = 0.60


class KnowledgeMaturityLadder:
    """五级知识成熟度阶梯 — 晋升/降级/冻结判定。

    所有检查均为纯函数式判定，不直接修改知识对象，返回新 level 或 None。
    """

    def check_promotion(
        self,
        knowledge_id: str,
        current_level: KnowledgeMaturityLevel,
        usage_data: dict,
    ) -> KnowledgeMaturityLevel | None:
        """检查是否可以晋升。返回新 level 或 None（不可晋升）。

        usage_data 字段（按 level 需要）：
        - L0→L1: episodes_count, episode_window_days, five_q_score, is_one_off
        - L1→L2: smoke_cases, smoke_passed, promotion_cases, promotion_passed, promotion_categories
        - L2→L3: uses_count, agents_count, success_rate, has_critical_breach
        - L3→L4: uses_count, recent_success_count, recent_total, user_approved, long_tail
        """
        next_level = self._next_level(current_level)
        if next_level is None:
            logger.debug(f"maturity: {knowledge_id} at {current_level.value} (top), no promotion")
            return None

        promoted = self._check_promotion_rules(current_level, next_level, usage_data)
        if promoted:
            logger.info(
                f"maturity promotion: {knowledge_id} {current_level.value} -> {next_level.value}"
            )
            return next_level
        logger.debug(
            f"maturity: {knowledge_id} {current_level.value} -> {next_level.value} NOT met"
        )
        return None

    def check_demotion(
        self,
        knowledge_id: str,
        current_level: KnowledgeMaturityLevel,
        recent_performance: list[bool],
    ) -> KnowledgeMaturityLevel | None:
        """检查是否应该降级。返回新 level 或 None（不应降级）。

        recent_performance: 最近 N 次使用是否成功（True/False），按时间顺序。
        - L2: 最近 3 次 <50% → 退 L1
        - L3: 最近 5 次 <60% → 退 L2
        - L4: 1 次高风险越界 → freeze（由 freeze() 单独处理，此处不降级）
        - L0/L1: 不降级
        """
        prev_level = self._prev_level(current_level)
        if prev_level is None:
            logger.debug(f"maturity: {knowledge_id} at {current_level.value} (bottom), no demotion")
            return None

        demoted = self._check_demotion_rules(current_level, recent_performance)
        if demoted:
            logger.info(
                f"maturity demotion: {knowledge_id} {current_level.value} -> {prev_level.value}"
            )
            return prev_level
        return None

    def check_freeze(
        self,
        knowledge_id: str,
        current_level: KnowledgeMaturityLevel,
        high_risk_breach: bool,
    ) -> bool:
        """检查 L4 是否应冻结（1 次高风险越界 → freeze）。

        仅 L4 适用。返回 True 表示应冻结。
        """
        if current_level != KnowledgeMaturityLevel.L4_STANDARD:
            return False
        if high_risk_breach:
            logger.warning(
                f"maturity FREEZE: {knowledge_id} L4 high-risk breach -> freeze"
            )
            return True
        return False

    # ---- 晋升规则 ----

    def _check_promotion_rules(
        self,
        current: KnowledgeMaturityLevel,
        target: KnowledgeMaturityLevel,
        data: dict,
    ) -> bool:
        if current == KnowledgeMaturityLevel.L0_EPISODE:
            return self._check_l0_to_l1(data)
        if current == KnowledgeMaturityLevel.L1_PATTERN:
            return self._check_l1_to_l2(data)
        if current == KnowledgeMaturityLevel.L2_DRAFT:
            return self._check_l2_to_l3(data)
        if current == KnowledgeMaturityLevel.L3_VALIDATED:
            return self._check_l3_to_l4(data)
        return False

    def _check_l0_to_l1(self, data: dict) -> bool:
        """L0→L1: ≥2 个相似 episode（180天内），或人类要求；5Q ≥ 7/10。一次性特例 → rejected。"""
        if data.get("is_one_off", False):
            return False
        if data.get("human_requested", False):
            return True
        episodes = data.get("episodes_count", 0)
        window = data.get("episode_window_days", 0)
        five_q = data.get("five_q_score", 0)
        return (
            episodes >= _L1_PROMOTION_MIN_EPISODES
            and window <= _L1_EPISODE_WINDOW_DAYS
            and five_q >= _L1_FIVE_Q_THRESHOLD
        )

    def _check_l1_to_l2(self, data: dict) -> bool:
        """L1→L2: smoke gate ≥3 cases（≥2/3 通过）；promotion gate ≥5 cases（≥3/5 通过，覆盖 3 类）。"""
        smoke_cases = data.get("smoke_cases", 0)
        smoke_passed = data.get("smoke_passed", 0)
        promo_cases = data.get("promotion_cases", 0)
        promo_passed = data.get("promotion_passed", 0)
        promo_categories = data.get("promotion_categories", 0)
        return (
            smoke_cases >= _L2_SMOKE_CASES
            and smoke_passed >= _L2_SMOKE_PASS_THRESHOLD
            and promo_cases >= _L2_PROMOTION_CASES
            and promo_passed >= _L2_PROMOTION_PASS_THRESHOLD
            and promo_categories >= _L2_PROMOTION_CATEGORY_COVERAGE
        )

    def _check_l2_to_l3(self, data: dict) -> bool:
        """L2→L3: ≥6 uses，≥2 agents，≥80%，无 critical breach。"""
        uses = data.get("uses_count", 0)
        agents = data.get("agents_count", 0)
        success_rate = data.get("success_rate", 0.0)
        has_breach = data.get("has_critical_breach", False)
        return (
            uses >= _L3_MIN_USES
            and agents >= _L3_MIN_AGENTS
            and success_rate >= _L3_MIN_SUCCESS_RATE
            and not has_breach
        )

    def _check_l3_to_l4(self, data: dict) -> bool:
        """L3→L4: ≥12 uses，最近 10 次 ≥90%，用户批准。long_tail 允许停 L3。"""
        if data.get("long_tail", False):
            return False
        uses = data.get("uses_count", 0)
        recent_success = data.get("recent_success_count", 0)
        recent_total = data.get("recent_total", 0)
        user_approved = data.get("user_approved", False)
        recent_rate = recent_success / recent_total if recent_total > 0 else 0.0
        return (
            uses >= _L4_MIN_USES
            and recent_total >= _L4_RECENT_WINDOW
            and recent_rate >= _L4_RECENT_SUCCESS_RATE
            and user_approved
        )

    # ---- 降级规则 ----

    def _check_demotion_rules(
        self,
        current: KnowledgeMaturityLevel,
        recent_performance: list[bool],
    ) -> bool:
        if current == KnowledgeMaturityLevel.L2_DRAFT:
            return self._check_l2_demotion(recent_performance)
        if current == KnowledgeMaturityLevel.L3_VALIDATED:
            return self._check_l3_demotion(recent_performance)
        # L4 不走降级（走 freeze），L0/L1 不降级
        return False

    def _check_l2_demotion(self, recent: list[bool]) -> bool:
        """L2: 最近 3 次 <50% → 退 L1。"""
        window = recent[-_L2_DEMOTION_WINDOW:]
        if len(window) < _L2_DEMOTION_WINDOW:
            return False
        success_rate = sum(1 for x in window if x) / len(window)
        return success_rate < _L2_DEMOTION_SUCCESS_RATE

    def _check_l3_demotion(self, recent: list[bool]) -> bool:
        """L3: 最近 5 次 <60% → 退 L2。"""
        window = recent[-_L3_DEMOTION_WINDOW:]
        if len(window) < _L3_DEMOTION_WINDOW:
            return False
        success_rate = sum(1 for x in window if x) / len(window)
        return success_rate < _L3_DEMOTION_SUCCESS_RATE

    # ---- 阶梯导航 ----

    def _next_level(self, level: KnowledgeMaturityLevel) -> KnowledgeMaturityLevel | None:
        order = [
            KnowledgeMaturityLevel.L0_EPISODE,
            KnowledgeMaturityLevel.L1_PATTERN,
            KnowledgeMaturityLevel.L2_DRAFT,
            KnowledgeMaturityLevel.L3_VALIDATED,
            KnowledgeMaturityLevel.L4_STANDARD,
        ]
        try:
            idx = order.index(level)
        except ValueError:
            return None
        if idx + 1 >= len(order):
            return None
        return order[idx + 1]

    def _prev_level(self, level: KnowledgeMaturityLevel) -> KnowledgeMaturityLevel | None:
        order = [
            KnowledgeMaturityLevel.L0_EPISODE,
            KnowledgeMaturityLevel.L1_PATTERN,
            KnowledgeMaturityLevel.L2_DRAFT,
            KnowledgeMaturityLevel.L3_VALIDATED,
            KnowledgeMaturityLevel.L4_STANDARD,
        ]
        try:
            idx = order.index(level)
        except ValueError:
            return None
        if idx - 1 < 0:
            return None
        return order[idx - 1]
