"""FlowForge 门禁编排器 — 通用的门控评估、投票、重试和人工审批编排。

各 *Forge 项目通过注入配置、事件回调和审计服务来使用此编排器，
无需自行实现门控逻辑。
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

import yaml

from flowforge.core.gate.models import (
    GateStatus,
    GateVerdict,
    Score,
)
from flowforge.core.gate.timeout import GateTimer, create_timer_from_config
from flowforge.core.gate.voting import VotingStrategy, resolve_gate
from flowforge.core.tracing import get_logger

logger = get_logger("gate_orchestrator")


class GateOrchestrator:
    """通用门禁编排器。

    Args:
        event_emitter: 可选的异步事件发射函数 (task_id, event_type, payload) -> None
        audit_service: 可选的审计服务，需提供 log_event 方法
        agent_registry: 可选的 Agent 注册表，用于查找评估者 Agent
    """

    def __init__(
        self,
        event_emitter: Callable[[str, str, dict[str, Any]], Any] | None = None,
        audit_service: Any = None,
        agent_registry: Any = None,
    ) -> None:
        self._event_emitter = event_emitter
        self._audit_service = audit_service
        self._agent_registry = agent_registry
        self._gate_configs: dict[str, dict[str, Any]] = {}
        self._gate_retry_counts: dict[str, dict[str, int]] = {}

    def load_gate_configs(self, gates_dir: Path | str) -> None:
        gates_path = Path(gates_dir)
        logger.info(f"GateOrchestrator: loading gate configs from {gates_dir}")
        if not gates_path.exists():
            logger.info(f"GateOrchestrator: gates directory does not exist, skipping")
            return
        for yaml_file in gates_path.glob("*.yaml"):
            with open(yaml_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            if data and "name" in data:
                self._gate_configs[data["name"]] = data
        logger.info(f"GateOrchestrator: loaded {len(self._gate_configs)} gate configs")

    def get_gate_config(self, gate_name: str) -> Optional[dict[str, Any]]:
        return self._gate_configs.get(gate_name)

    async def _emit(self, task_id: str, event_type: str, payload: dict[str, Any]) -> None:
        if self._event_emitter is not None:
            result = self._event_emitter(task_id, event_type, payload)
            if asyncio.iscoroutine(result):
                await result

    async def conduct_gate(
        self,
        ctx: Any,
        gate_name: str,
        submission: dict[str, Any],
    ) -> GateVerdict:
        gate_config = self._gate_configs.get(gate_name)
        if gate_config is None:
            logger.info(f"GateOrchestrator: no config found for gate '{gate_name}', auto-passing")
            return GateVerdict(
                gate_id=gate_name,
                gate_name=gate_name,
                task_id=ctx.task_id if hasattr(ctx, "task_id") else "",
                status=GateStatus.PASSED,
                overall_score=1.0,
                pass_threshold=0.0,
                decision="pass_no_config",
                decided_at=datetime.now(),
            )

        task_id = ctx.task_id if hasattr(ctx, "task_id") else "unknown"
        logger.info(f"GateOrchestrator: starting gate '{gate_name}' for task '{task_id}'")
        if task_id not in self._gate_retry_counts:
            self._gate_retry_counts[task_id] = {}
        retry_count = self._gate_retry_counts[task_id].get(gate_name, 0)

        # 创建并启动超时计时器
        gate_timer = create_timer_from_config(gate_config)
        gate_timer.start()

        dimension_scores: list[Score] = []
        dimensions = gate_config.get("dimensions", [])

        tasks = []
        for dim in dimensions:
            evaluator_name = dim.get("evaluator_agent", "")
            agent = None
            if hasattr(ctx, "agents") and ctx.agents is not None:
                agent = ctx.agents.get(evaluator_name)
            if agent is None and self._agent_registry is not None:
                agent = self._agent_registry.get(evaluator_name)
            if agent is not None:
                from flowforge.core.base_agent import AgentInput
                inp = AgentInput(params={
                    "submission": submission,
                    "dimension_config": dim,
                })
                tasks.append((dim, agent, inp))
            else:
                dimension_scores.append(Score(
                    dimension=dim.get("name", "unknown"),
                    value=0.0,
                    weight=dim.get("weight", 1.0),
                    rationale=f"Evaluator agent '{evaluator_name}' not found",
                    confidence=0.0,
                ))
                logger.info(f"GateOrchestrator: evaluator agent '{evaluator_name}' not found for dimension '{dim.get('name', 'unknown')}', defaulting score to 0.0")

        if tasks:
            coros = [agent.execute_with_context(inp, ctx) for _, agent, inp in tasks]
            results = await asyncio.gather(*coros, return_exceptions=True)

            for i, result in enumerate(results):
                # 第一个评估者完成时触发计时器回调
                gate_timer.on_first_evaluator_done()

                dim = tasks[i][0]
                if isinstance(result, Exception):
                    dimension_scores.append(Score(
                        dimension=dim.get("name", "unknown"),
                        value=0.0,
                        weight=dim.get("weight", 1.0),
                        rationale=f"Evaluator failed: {result}",
                        confidence=0.0,
                    ))
                    logger.info(f"GateOrchestrator: evaluating dimension '{dim.get('name', 'unknown')}' score=0.00 threshold={gate_config.get('pass_threshold', 0.7):.2f} — evaluator failed: {result}")
                else:
                    score_data = result.result if hasattr(result, "result") else {}
                    score_val = score_data.get("score", {}).get("value", 0.0)
                    clamped_score = min(1.0, max(0.0, float(score_val)))
                    dimension_scores.append(Score(
                        dimension=dim.get("name", "unknown"),
                        value=clamped_score,
                        weight=dim.get("weight", 1.0),
                        rationale=score_data.get("score", {}).get("rationale", ""),
                        suggestions=score_data.get("score", {}).get("suggestions", []),
                        confidence=score_data.get("score", {}).get("confidence", 1.0),
                    ))
                    logger.info(f"GateOrchestrator: evaluating dimension '{dim.get('name', 'unknown')}' score={clamped_score:.2f} threshold={gate_config.get('pass_threshold', 0.7):.2f}")

        # 所有评估者完成后触发 review_ready 回调
        gate_timer.on_review_ready()

        # 超时检查
        if gate_timer.is_timed_out():
            logger.info(f"GateOrchestrator: timeout triggered for gate '{gate_name}'")
            return gate_timer.timeout_verdict(gate_name, task_id, dimension_scores)

        # 使用投票策略解析门禁结果
        voting_strategy_str = gate_config.get("voting_strategy", "weighted")
        try:
            voting_strategy = VotingStrategy(voting_strategy_str)
        except ValueError:
            voting_strategy = VotingStrategy.WEIGHTED

        voting_weights = gate_config.get("voting_weights", None)
        veto_dims = gate_config.get("veto_dimensions", [])

        voting_verdict = resolve_gate(
            strategy=voting_strategy,
            scores=dimension_scores,
            pass_threshold=gate_config.get("pass_threshold", 0.7),
            weights=voting_weights,
            veto_dimensions=veto_dims,
        )

        overall_score = voting_verdict.overall_score
        pass_threshold = voting_verdict.pass_threshold
        veto_triggered = voting_verdict.veto_dimensions_triggered
        passed = voting_verdict.status == GateStatus.PASSED

        individual_votes = [f"{s.dimension}={s.value:.2f}" for s in dimension_scores]
        logger.info(f"GateOrchestrator: voting strategy='{voting_strategy_str}' individual_votes=[{', '.join(individual_votes)}] final_result={'pass' if passed else 'fail'}")
        logger.info(f"GateOrchestrator: gate '{gate_name}' verdict={'PASSED' if passed else 'FAILED'} score={overall_score:.2f}")

        if not passed:
            logger.info(f"GateOrchestrator: gate '{gate_name}' FAILED — score={overall_score:.2f} below threshold={pass_threshold:.2f}")
            on_reject = gate_config.get("on_reject", {})
            action = on_reject.get("action", "terminate")
            max_retries = on_reject.get("max_retries", 2)
            fallback = on_reject.get("fallback", "terminate")

            if self._audit_service is not None:
                await self._audit_service.log_event(
                    task_id=task_id,
                    event_type="gate_decision",
                    event_data={
                        "gate_name": gate_name,
                        "status": "failed",
                        "overall_score": overall_score,
                        "pass_threshold": pass_threshold,
                        "veto_dimensions_triggered": veto_triggered,
                    },
                )

            if action == "retry" and retry_count < max_retries:
                self._gate_retry_counts[task_id][gate_name] = retry_count + 1
                retry_strategy = on_reject.get("retry_strategy", "reflexion")
                logger.info(f"GateOrchestrator: gate '{gate_name}' retrying (attempt {retry_count + 1}/{max_retries}) with strategy '{retry_strategy}'")
                previous_steps = self._find_previous_agent_steps(
                    ctx, gate_name
                )

                if retry_strategy == "reflexion" and previous_steps:
                    feedback = self._build_reflexion_feedback(dimension_scores, gate_config)
                    for prev in previous_steps:
                        prev_meta = prev.setdefault("metadata", {})
                        prev_meta["reflexion_feedback"] = feedback
                        prev_meta["reflexion_round"] = retry_count + 1

                if previous_steps:
                    return GateVerdict(
                        gate_id=gate_name,
                        gate_name=gate_config.get("name", gate_name),
                        task_id=task_id,
                        status=GateStatus.FAILED,
                        scores=dimension_scores,
                        overall_score=overall_score,
                        pass_threshold=pass_threshold,
                        veto_dimensions_triggered=veto_triggered,
                        decision="goto",
                        retry_count=retry_count + 1,
                        goto_step=previous_steps[0].get("name", ""),
                        decided_at=datetime.now(),
                    )

            if fallback == "escalate_to_human":
                logger.info(f"GateOrchestrator: human approval requested for gate '{gate_name}' (escalation)")
                return GateVerdict(
                    gate_id=gate_name,
                    gate_name=gate_config.get("name", gate_name),
                    task_id=task_id,
                    status=GateStatus.FAILED,
                    scores=dimension_scores,
                    overall_score=overall_score,
                    pass_threshold=pass_threshold,
                    veto_dimensions_triggered=veto_triggered,
                    decision="escalate_to_human",
                    retry_count=retry_count,
                    decided_at=datetime.now(),
                )

            return GateVerdict(
                gate_id=gate_name,
                gate_name=gate_config.get("name", gate_name),
                task_id=task_id,
                status=GateStatus.FAILED,
                scores=dimension_scores,
                overall_score=overall_score,
                pass_threshold=pass_threshold,
                veto_dimensions_triggered=veto_triggered,
                decision="terminate",
                retry_count=retry_count,
                decided_at=datetime.now(),
            )

        human_required = gate_config.get("human_required", False)
        if human_required:
            logger.info(f"GateOrchestrator: human approval requested for gate '{gate_name}' (human_required=True)")
            await self._emit(task_id, "gate_review_ready", {
                "gate_name": gate_name,
                "overall_score": overall_score,
                "pass_threshold": pass_threshold,
                "decision": "pending_human",
            })
            if self._audit_service is not None:
                await self._audit_service.log_event(
                    task_id=task_id,
                    event_type="gate_decision",
                    event_data={
                        "gate_name": gate_name,
                        "status": "passed",
                        "overall_score": overall_score,
                        "pass_threshold": pass_threshold,
                        "decision": "pending_human",
                    },
                )
            return GateVerdict(
                gate_id=gate_name,
                gate_name=gate_config.get("name", gate_name),
                task_id=task_id,
                status=GateStatus.PASSED,
                scores=dimension_scores,
                overall_score=overall_score,
                pass_threshold=pass_threshold,
                decision="pending_human",
                decided_at=datetime.now(),
            )

        if self._audit_service is not None:
            await self._audit_service.log_event(
                task_id=task_id,
                event_type="gate_decision",
                event_data={
                    "gate_name": gate_name,
                    "status": "passed",
                    "overall_score": overall_score,
                    "pass_threshold": pass_threshold,
                    "decision": "pass",
                },
            )

        logger.info(f"GateOrchestrator: gate '{gate_name}' PASSED — score={overall_score:.2f}")

        await self._emit(task_id, "gate_completed", {
            "gate_name": gate_name,
            "status": GateStatus.PASSED.value,
            "overall_score": overall_score,
            "decision": "pass",
        })

        return GateVerdict(
            gate_id=gate_name,
            gate_name=gate_config.get("name", gate_name),
            task_id=task_id,
            status=GateStatus.PASSED,
            scores=dimension_scores,
            overall_score=overall_score,
            pass_threshold=pass_threshold,
            decision="pass",
            decided_at=datetime.now(),
        )

    def _find_previous_agent_steps(
        self, ctx: Any, gate_name: str
    ) -> list[dict[str, Any]]:
        sop_steps = []
        if hasattr(ctx, "metadata") and isinstance(ctx.metadata, dict):
            sop_steps = ctx.metadata.get("sop_steps", [])
        if not sop_steps and hasattr(ctx, "input_data") and isinstance(ctx.input_data, dict):
            sop_steps = ctx.input_data.get("sop_steps", [])

        all_steps: list[dict[str, Any]] = []
        for stage in sop_steps:
            if isinstance(stage, dict) and "steps" in stage:
                all_steps.extend(stage["steps"])
            elif isinstance(stage, dict) and "agent" in stage:
                all_steps.append(stage)

        gate_index = -1
        for i, s in enumerate(all_steps):
            s_name = s.get("name", "")
            s_type = s.get("type", "")
            if s_name == gate_name or (s_type == "gate" and s_name == gate_name):
                gate_index = i
                break

        if gate_index < 0:
            return []

        return [
            s for s in all_steps[:gate_index]
            if "agent" in s and s.get("type", "agent") != "gate"
        ]

    def _build_reflexion_feedback(
        self,
        dimension_scores: list[Score],
        gate_config: dict[str, Any],
    ) -> dict[str, Any]:
        failed_dimensions = [
            {
                "dimension": s.dimension,
                "score": s.value,
                "threshold": 0.0,
                "rationale": s.rationale,
                "suggestions": s.suggestions,
            }
            for s in dimension_scores
            if s.value < gate_config.get("pass_threshold", 0.7)
        ]
        return {
            "gate_name": gate_config.get("name", ""),
            "failed_dimensions": failed_dimensions,
            "overall_score": sum(s.weighted_value for s in dimension_scores) / max(sum(s.weight for s in dimension_scores), 0.001),
            "pass_threshold": gate_config.get("pass_threshold", 0.7),
        }

    async def waive_gate(
        self, gate_id: str, task_id: str, reason: str
    ) -> GateVerdict:
        logger.info(f"GateOrchestrator: gate '{gate_id}' waived for task '{task_id}' — reason: {reason}")
        await self._emit(task_id, "gate_completed", {
            "gate_name": gate_id,
            "status": GateStatus.WAIVED.value,
            "decision": "waived",
            "reason": reason,
        })
        if self._audit_service is not None:
            await self._audit_service.log_event(
                task_id=task_id,
                event_type="human_intervention",
                event_data={
                    "gate_id": gate_id,
                    "action": "waive",
                    "reason": reason,
                },
                operator="human",
            )
        return GateVerdict(
            gate_id=gate_id,
            gate_name=gate_id,
            task_id=task_id,
            status=GateStatus.WAIVED,
            overall_score=1.0,
            pass_threshold=0.0,
            decision="waived",
            reviewer_feedback=reason,
            decided_at=datetime.now(),
        )

    def _compute_overall_score(self, scores: list[Score]) -> float:
        if not scores:
            return 0.0
        total_weight = sum(s.weight for s in scores)
        if total_weight == 0:
            return 0.0
        return sum(s.weighted_value for s in scores) / total_weight
