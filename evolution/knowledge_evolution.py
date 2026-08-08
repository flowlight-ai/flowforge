"""Mode C: Knowledge Evolution — 有价值的知识/方法论沉淀。

三机制闭环：Episode Card → Dual Distillation → Eval Ledger

触发条件（任一）：
1. Deep research 产出了跨场景可复用的知识或框架
2. 专业领域讨论形成了可迁移的分析方法论
3. 跨域协作中发现了可复用的协作模式
4. 用户说"这个值得记住"

判断标准（三问，满足 ≥2 个才沉淀）：
- 复用性：未来类似场景还会用到吗？
- 非显然性：不容易从头推导出来吗？
- 衰减性：不记下来，下次还能想起来吗？
"""

from __future__ import annotations

import uuid
from datetime import datetime

from flowforge.core.tracing import get_logger
from flowforge.evolution.models import EpisodeCard, EvalLedger, MethodCard

logger = get_logger("flowforge.evolution.knowledge_evolution")

# Smoke gate: 3 cases, ≥2/3 pass
SMOKE_GATE_CASES = 3
SMOKE_GATE_PASS_THRESHOLD = 2

# Promotion gate: 5 cases, ≥3/5 pass, 覆盖 3 类
PROMOTION_GATE_CASES = 5
PROMOTION_GATE_PASS_THRESHOLD = 3
PROMOTION_GATE_CATEGORY_COVERAGE = 3  # 标准成功/边界应升级/冲突反例

# 三问满足数量阈值
DISTILL_MIN_CRITERIA = 2

# Eval case 必需字段
_CASE_REQUIRED_FIELDS = {"case_id", "category", "passed"}


class KnowledgeEvolution:
    """Mode C: Knowledge Evolution — 知识沉淀与验证。

    三机制：
    1. Episode Card — 高价值协作后的结构化事件快照（L0）
    2. Dual Distillation — 蒸馏为 Method Card 或 Skill Draft（L1→L2）
    3. Eval Ledger — Replay A/B 验证知识净增益（gate 通过才晋升）
    """

    def __init__(self) -> None:
        self._episodes: list[EpisodeCard] = []
        self._methods: list[MethodCard] = []
        self._evals: list[EvalLedger] = []

    def should_distill(
        self,
        reusability: bool,
        non_obviousness: bool,
        decay_risk: bool,
    ) -> bool:
        """三问判断（满足 ≥2 个才沉淀）。

        - reusability: 复用性 — 未来类似场景还会用到吗？
        - non_obviousness: 非显然性 — 不容易从头推导出来吗？
        - decay_risk: 衰减性 — 不记下来，下次还能想起来吗？
        """
        score = sum([bool(reusability), bool(non_obviousness), bool(decay_risk)])
        decision = score >= DISTILL_MIN_CRITERIA
        logger.debug(
            f"knowledge_evolution should_distill: reusability={reusability}, "
            f"non_obviousness={non_obviousness}, decay_risk={decay_risk}, "
            f"score={score}/{3}, distill={decision}"
        )
        return decision

    def create_episode_card(
        self,
        task_snapshot: str,
        evidence_map: dict,
        decision_timeline: list[dict],
        collaboration_pivots: list[dict],
        transferable_method: str,
        non_transferable_facts: str,
        safety_boundary: str,
        distillation_direction: str = "method_card",
    ) -> EpisodeCard:
        """创建 Episode Card（高价值协作后写结构化事件快照）。

        模板完整 + 分离可迁移/不可迁移 才能晋升 L1。
        """
        if distillation_direction not in {"method_card", "skill_draft", "memory"}:
            raise ValueError(
                f"Invalid distillation_direction {distillation_direction!r}, "
                f"must be one of: method_card | skill_draft | memory"
            )

        episode = EpisodeCard(
            episode_id=f"ep-{uuid.uuid4().hex[:12]}",
            task_snapshot=task_snapshot,
            evidence_map=dict(evidence_map),
            decision_timeline=list(decision_timeline),
            collaboration_pivots=list(collaboration_pivots),
            transferable_method=transferable_method,
            non_transferable_facts=non_transferable_facts,
            safety_boundary=safety_boundary,
            distillation_direction=distillation_direction,
        )
        self._episodes.append(episode)
        logger.info(
            f"knowledge_evolution episode created: id={episode.episode_id}, "
            f"direction={distillation_direction}, snapshot_len={len(task_snapshot)}"
        )
        return episode

    def distill_episode(self, episode_id: str) -> MethodCard | str:
        """Dual Distillation — 将 Episode 蒸馏成 Method Card 或 Skill Draft。

        返回：
        - MethodCard: 当 distillation_direction == "method_card" 时
        - str: 当方向为 "skill_draft" 或 "memory" 时，返回方向标识（由调用方后续处理）
        """
        episode = self._find_episode(episode_id)
        if episode is None:
            raise ValueError(f"Episode {episode_id!r} not found")

        if episode.distillation_direction == "method_card":
            method = MethodCard(
                method_id=f"mc-{uuid.uuid4().hex[:12]}",
                title=episode.transferable_method[:80],
                domain="general",
                knowledge_type="procedural",
                scope="agent_local",
                trust_level="experimental",
                lifecycle="draft",
                content=episode.transferable_method,
                source_refs=[episode.episode_id],
                maturity_level="L2",
            )
            self._methods.append(method)
            logger.info(
                f"knowledge_evolution distilled: episode={episode_id} -> method={method.method_id}"
            )
            return method

        # 非 method_card 方向：返回方向标识，由调用方决定后续路径
        logger.info(
            f"knowledge_evolution distill direction: episode={episode_id} -> {episode.distillation_direction}"
        )
        return episode.distillation_direction

    def create_eval_ledger(self, method_id: str, cases: list[dict]) -> EvalLedger:
        """创建 Eval Ledger（Replay A/B 验证知识净增益）。

        cases: A/B paired cases，每个 case 应含 case_id / category / passed 字段。
        """
        self._validate_cases(cases)
        ledger = EvalLedger(
            eval_id=f"ev-{uuid.uuid4().hex[:12]}",
            method_id=method_id,
            cases=list(cases),
        )
        self._evals.append(ledger)
        logger.info(
            f"knowledge_evolution eval ledger created: id={ledger.eval_id}, "
            f"method={method_id}, cases={len(cases)}"
        )
        return ledger

    def check_smoke_gate(self, eval_id: str) -> bool:
        """Smoke gate: 3 cases, ≥2/3 pass。

        通过后写入 ledger.smoke_gate_passed。
        """
        ledger = self._find_eval(eval_id)
        if ledger is None:
            raise ValueError(f"Eval {eval_id!r} not found")

        cases = ledger.cases
        if len(cases) < SMOKE_GATE_CASES:
            logger.warning(
                f"knowledge_evolution smoke gate: eval={eval_id} cases={len(cases)} "
                f"< required {SMOKE_GATE_CASES}"
            )
            return False

        passed = sum(1 for c in cases if c.get("passed", False))
        result = passed >= SMOKE_GATE_PASS_THRESHOLD
        ledger.smoke_gate_passed = result
        logger.info(
            f"knowledge_evolution smoke gate: eval={eval_id}, passed={passed}/{len(cases)}, "
            f"threshold={SMOKE_GATE_PASS_THRESHOLD}, result={result}"
        )
        return result

    def check_promotion_gate(self, eval_id: str) -> bool:
        """Promotion gate: 5 cases, ≥3/5 pass, 覆盖 3 类。

        3 类：标准成功 / 边界应升级 / 冲突反例
        通过后写入 ledger.promotion_gate_passed。
        """
        ledger = self._find_eval(eval_id)
        if ledger is None:
            raise ValueError(f"Eval {eval_id!r} not found")

        cases = ledger.cases
        if len(cases) < PROMOTION_GATE_CASES:
            logger.warning(
                f"knowledge_evolution promotion gate: eval={eval_id} cases={len(cases)} "
                f"< required {PROMOTION_GATE_CASES}"
            )
            return False

        passed = sum(1 for c in cases if c.get("passed", False))
        if passed < PROMOTION_GATE_PASS_THRESHOLD:
            logger.info(
                f"knowledge_evolution promotion gate: eval={eval_id}, passed={passed} "
                f"< threshold {PROMOTION_GATE_PASS_THRESHOLD}"
            )
            ledger.promotion_gate_passed = False
            return False

        # 检查类别覆盖（3 类）
        categories = {c.get("category") for c in cases if c.get("category")}
        if len(categories) < PROMOTION_GATE_CATEGORY_COVERAGE:
            logger.info(
                f"knowledge_evolution promotion gate: eval={eval_id}, categories={categories} "
                f"< required coverage {PROMOTION_GATE_CATEGORY_COVERAGE}"
            )
            ledger.promotion_gate_passed = False
            return False

        ledger.promotion_gate_passed = True
        logger.info(
            f"knowledge_evolution promotion gate PASSED: eval={eval_id}, passed={passed}/{len(cases)}, "
            f"categories={categories}"
        )
        return True

    def get_episodes(self) -> list[EpisodeCard]:
        return list(self._episodes)

    def get_methods(self) -> list[MethodCard]:
        return list(self._methods)

    def get_evals(self) -> list[EvalLedger]:
        return list(self._evals)

    # ---- 内部工具 ----

    def _find_episode(self, episode_id: str) -> EpisodeCard | None:
        for ep in self._episodes:
            if ep.episode_id == episode_id:
                return ep
        return None

    def _find_eval(self, eval_id: str) -> EvalLedger | None:
        for ev in self._evals:
            if ev.eval_id == eval_id:
                return ev
        return None

    def _validate_cases(self, cases: list[dict]) -> None:
        """校验 cases 必需字段。"""
        if not cases:
            raise ValueError("cases must not be empty")
        for idx, c in enumerate(cases):
            missing = _CASE_REQUIRED_FIELDS - set(c.keys())
            if missing:
                raise ValueError(
                    f"case[{idx}] missing required fields: {missing} "
                    f"(required: {_CASE_REQUIRED_FIELDS})"
                )
