"""ForgeMind Engine — 统一管理三模式自我进化（v7.0 育灵体系主引擎）。

按 ADR-012 命名融合：SelfEvolutionEngine → ForgeMindEngine
（M18/M19/M20 三个 v4.0 自创术语合并为 v7.0 ForgeMindEngine）。

集成 Scope Guard (Mode A) + Process Evolution (Mode B) + Knowledge Evolution (Mode C)，
共享五级知识成熟度阶梯 (KnowledgeMaturityLadder) 和元认知路由 (MetacognitionRouter)。

三模式分工（详见 `hiclaw/rules.md#§0.10.1`）：
- Mode A (Scope Guard): 防御 — 偏离愿景时温柔提醒
- Mode B (Process Evolution): 防御→改进 — 同类错误反复出现时提流程改进
- Mode C (Knowledge Evolution): 进攻→成长 — 有价值知识沉淀为可复用资产

engine.evaluate() / engine.execute() 为 async I/O 入口（符合规范：所有 I/O 操作 async/await）。
"""

from __future__ import annotations

from datetime import datetime

from flowforge.core.tracing import get_logger
from flowforge.evolution.knowledge_evolution import KnowledgeEvolution
from flowforge.evolution.maturity import KnowledgeMaturityLadder
from flowforge.evolution.metacognition import MetacognitionRouter
from flowforge.evolution.models import KnowledgeMaturityLevel
from flowforge.evolution.process_evolution import ProcessEvolution
from flowforge.evolution.scope_guard import ScopeGuard

logger = get_logger("flowforge.evolution.engine")


class ForgeMindEngine:
    """ForgeMind Engine — 统一管理三模式自我进化（v7.0 育灵体系主引擎）。

    按 ADR-012 命名融合：原 SelfEvolutionEngine（M18）已废弃，合并 M18/M19/M20 为 ForgeMindEngine。

    集成三模式 + 共享成熟度阶梯 + 元认知路由。
    evaluate(context) 评估上下文返回建议动作；execute(action) 执行动作。
    """

    def __init__(self) -> None:
        self.scope_guard = ScopeGuard()
        self.process_evolution = ProcessEvolution()
        self.knowledge_evolution = KnowledgeEvolution()
        self.maturity_ladder = KnowledgeMaturityLadder()
        self.metacognition = MetacognitionRouter()

    async def evaluate(self, context: dict) -> dict:
        """评估当前上下文，返回建议动作。

        context 字段（按需）：
        - mode: "scope_guard" | "process_evolution" | "knowledge_evolution" | "auto"
        - scope_guard: {current_vision, new_idea, current_ac, feature_id, agent}
        - process_evolution: {error_history, user_corrections, sop_gaps, review_findings}
        - knowledge_evolution: {reusability, non_obviousness, decay_risk, episode_data}
        - metacognition: {successes, trials, evidence_completeness, self_reported, is_high_risk}

        返回 dict:
        - suggested_actions: list[dict] 每个含 {mode, action, payload}
        - meta: 评估元信息
        """
        mode = context.get("mode", "auto")
        actions: list[dict] = []

        if mode in ("scope_guard", "auto"):
            actions.extend(await self._evaluate_scope_guard(context))

        if mode in ("process_evolution", "auto"):
            actions.extend(await self._evaluate_process_evolution(context))

        if mode in ("knowledge_evolution", "auto"):
            actions.extend(await self._evaluate_knowledge_evolution(context))

        # 元认知路由（auto 模式下附加）
        meta_route = None
        mc_ctx = context.get("metacognition")
        if mc_ctx:
            meta_route = await self._evaluate_metacognition(mc_ctx)

        result = {
            "suggested_actions": actions,
            "meta": {
                "mode": mode,
                "evaluated_at": datetime.utcnow().isoformat(),
                "actions_count": len(actions),
                "metacognition_route": meta_route,
            },
        }
        logger.info(
            f"evolution evaluate: mode={mode}, actions={len(actions)}, "
            f"meta_route={'set' if meta_route else 'none'}"
        )
        return result

    async def execute(self, action: dict) -> dict:
        """执行建议动作。

        action 字段：
        - mode: "scope_guard" | "process_evolution" | "knowledge_evolution"
        - action: 具体动作名
        - payload: 动作参数
        """
        mode = action.get("mode")
        action_name = action.get("action")
        payload = action.get("payload", {})

        if mode == "scope_guard":
            return await self._execute_scope_guard(action_name, payload)
        if mode == "process_evolution":
            return await self._execute_process_evolution(action_name, payload)
        if mode == "knowledge_evolution":
            return await self._execute_knowledge_evolution(action_name, payload)

        logger.warning(f"evolution execute: unknown mode {mode!r}")
        return {"status": "error", "reason": f"unknown mode {mode!r}"}

    # ---- Scope Guard ----

    async def _evaluate_scope_guard(self, context: dict) -> list[dict]:
        sg_ctx = context.get("scope_guard")
        if not sg_ctx:
            return []
        vision = sg_ctx.get("current_vision", "")
        new_idea = sg_ctx.get("new_idea", "")
        current_ac = sg_ctx.get("current_ac", [])
        feature_id = sg_ctx.get("feature_id", "")

        signals = self.scope_guard.detect_signals(vision, new_idea, current_ac)
        # 触发条件：2 个普通信号或 1 个强信号
        strong = [s for s in signals if s.value != "not_serving_vision"]
        normal = [s for s in signals if s.value == "not_serving_vision"]
        triggered = len(strong) >= 1 or len(normal) >= 2

        if not triggered:
            return []

        actions: list[dict] = [{
            "mode": "scope_guard",
            "action": "remind",
            "payload": {
                "feature_id": feature_id,
                "signals": [s.value for s in signals],
                "vision": vision,
                "new_direction": new_idea,
            },
        }]
        if self.scope_guard.check_divergence_pattern(feature_id):
            actions.append({
                "mode": "scope_guard",
                "action": "suggest_split_feat",
                "payload": {"feature_id": feature_id},
            })
        return actions

    async def _execute_scope_guard(self, action_name: str, payload: dict) -> dict:
        if action_name == "remind":
            feature_id = payload.get("feature_id", "")
            if not self.scope_guard.should_remind(feature_id):
                return {"status": "skipped", "reason": "max reminds reached for phase"}
            count = self.scope_guard._phase_trigger_counts.get(feature_id, 0) + 1
            reminder = self.scope_guard.generate_reminder(
                payload.get("vision", ""),
                payload.get("new_direction", ""),
                count,
            )
            self.scope_guard.log_trigger(
                feature_id=feature_id,
                signal_type=",".join(payload.get("signals", [])),
                action="remind",
                outcome=reminder,
                agent="scope_guard",
            )
            return {"status": "ok", "reminder": reminder}
        if action_name == "suggest_split_feat":
            return {
                "status": "ok",
                "suggestion": f"feat {payload.get('feature_id')} 触发 ≥3 次偏离，建议拆分",
            }
        return {"status": "error", "reason": f"unknown scope_guard action {action_name!r}"}

    # ---- Process Evolution ----

    async def _evaluate_process_evolution(self, context: dict) -> list[dict]:
        pe_ctx = context.get("process_evolution")
        if not pe_ctx:
            return []
        trigger_type = self.process_evolution.detect_trigger(
            error_history=pe_ctx.get("error_history", []),
            user_corrections=pe_ctx.get("user_corrections", []),
            sop_gaps=pe_ctx.get("sop_gaps", []),
            review_findings=pe_ctx.get("review_findings", []),
        )
        if trigger_type is None:
            return []
        return [{
            "mode": "process_evolution",
            "action": "create_proposal",
            "payload": {"trigger_type": trigger_type},
        }]

    async def _execute_process_evolution(self, action_name: str, payload: dict) -> dict:
        if action_name == "create_proposal":
            proposal = self.process_evolution.create_proposal(
                trigger_type=payload["trigger_type"],
                trigger=payload.get("trigger", ""),
                evidence=payload.get("evidence", []),
                root_cause=payload.get("root_cause", ""),
                lever=payload.get("lever", "memory"),
                verify=payload.get("verify", ""),
                target=payload.get("target", ""),
            )
            valid, errors = self.process_evolution.validate_proposal(proposal)
            return {
                "status": "ok" if valid else "validation_failed",
                "proposal_id": proposal.proposal_id,
                "validation_errors": errors,
            }
        if action_name == "accept_proposal":
            proposal = self.process_evolution.accept_proposal(
                payload["proposal_id"], payload["commit_ref"]
            )
            if proposal is None:
                return {"status": "error", "reason": "proposal not found or not in proposed status"}
            self.process_evolution.schedule_replay_check(payload["proposal_id"])
            return {"status": "ok", "proposal_id": proposal.proposal_id}
        return {"status": "error", "reason": f"unknown process_evolution action {action_name!r}"}

    # ---- Knowledge Evolution ----

    async def _evaluate_knowledge_evolution(self, context: dict) -> list[dict]:
        ke_ctx = context.get("knowledge_evolution")
        if not ke_ctx:
            return []
        should = self.knowledge_evolution.should_distill(
            ke_ctx.get("reusability", False),
            ke_ctx.get("non_obviousness", False),
            ke_ctx.get("decay_risk", False),
        )
        if not should:
            return []
        return [{
            "mode": "knowledge_evolution",
            "action": "create_episode_card",
            "payload": ke_ctx.get("episode_data", {}),
        }]

    async def _execute_knowledge_evolution(self, action_name: str, payload: dict) -> dict:
        if action_name == "create_episode_card":
            episode = self.knowledge_evolution.create_episode_card(
                task_snapshot=payload.get("task_snapshot", ""),
                evidence_map=payload.get("evidence_map", {}),
                decision_timeline=payload.get("decision_timeline", []),
                collaboration_pivots=payload.get("collaboration_pivots", []),
                transferable_method=payload.get("transferable_method", ""),
                non_transferable_facts=payload.get("non_transferable_facts", ""),
                safety_boundary=payload.get("safety_boundary", ""),
                distillation_direction=payload.get("distillation_direction", "method_card"),
            )
            return {"status": "ok", "episode_id": episode.episode_id}
        if action_name == "distill_episode":
            result = self.knowledge_evolution.distill_episode(payload["episode_id"])
            if isinstance(result, str):
                return {"status": "ok", "direction": result}
            return {"status": "ok", "method_id": result.method_id}
        return {"status": "error", "reason": f"unknown knowledge_evolution action {action_name!r}"}

    # ---- Metacognition ----

    async def _evaluate_metacognition(self, mc_ctx: dict) -> dict:
        successes = mc_ctx.get("successes", 0)
        trials = mc_ctx.get("trials", 0)
        is_high_risk = mc_ctx.get("is_high_risk", False)

        # 高风险域用 Wilson 下界，否则用 Laplace 平滑可靠度
        if is_high_risk:
            dr = self.metacognition.compute_wilson_lower_bound(successes, trials)
        else:
            dr = self.metacognition.compute_domain_reliability(successes, trials)

        return self.metacognition.route_confidence(
            domain_reliability=dr,
            evidence_completeness=mc_ctx.get("evidence_completeness", 0.0),
            self_reported=mc_ctx.get("self_reported", 0.0),
            is_high_risk=is_high_risk,
        )

    # ---- 成熟度辅助 ----

    def check_maturity_promotion(
        self,
        knowledge_id: str,
        current_level: KnowledgeMaturityLevel,
        usage_data: dict,
    ) -> KnowledgeMaturityLevel | None:
        """检查知识对象的成熟度晋升（同步，无 I/O）。"""
        return self.maturity_ladder.check_promotion(knowledge_id, current_level, usage_data)

    def check_maturity_demotion(
        self,
        knowledge_id: str,
        current_level: KnowledgeMaturityLevel,
        recent_performance: list[bool],
    ) -> KnowledgeMaturityLevel | None:
        """检查知识对象的成熟度降级（同步，无 I/O）。"""
        return self.maturity_ladder.check_demotion(knowledge_id, current_level, recent_performance)
