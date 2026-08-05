from flowforge.core.base_agent import AgentInput
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("agent_judge_executor")


class AgentJudgeExecutor(BaseModeExecutor):
    mode_name = "agent_judge"
    capabilities = ["evaluation"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")

        # Actor阶段：使用primary模型生成内容
        ctx.event_bus.emit(ctx.task_id, "agent_judge.actor_start", {"task": task[:200]})
        actor_result = await self._run_actor(ctx, task)
        actor_text = self._extract_text(actor_result)
        ctx.event_bus.emit(ctx.task_id, "agent_judge.actor_complete", {
            "output_preview": actor_text[:300],
        })

        # Judge阶段：使用不同模型评审
        ctx.event_bus.emit(ctx.task_id, "agent_judge.judge_start", {})
        judge_result = await self._run_judge(ctx, actor_result)
        score = judge_result.get("score", 0)
        issues = judge_result.get("issues", [])
        ctx.event_bus.emit(ctx.task_id, "agent_judge.verdict", {
            "score": score, "issues": issues,
        })

        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": actor_text, "is_partial": False, "agent_name": "agent_judge",
        })

        return {"actor_result": actor_result, "judge_result": judge_result}

    async def _run_actor(self, ctx: TaskContext, task: str) -> dict:
        """Actor阶段：使用primary模型生成内容。"""
        actor = ctx.agents.get("judge_actor") if ctx.agents else None
        if actor is None:
            from flowforge.modes.default_llm_actors import DefaultLLMActor
            actor = DefaultLLMActor()

        actor_input = AgentInput(params={"task": task})
        if hasattr(actor, 'execute_with_context'):
            actor_output = await actor.execute_with_context(actor_input, ctx)
        else:
            actor_output = await actor.execute(actor_input)
        return actor_output.result

    async def _run_judge(self, ctx: TaskContext, actor_result) -> dict:
        """Judge阶段：使用不同模型（deepseek-web/chat作为评审LLM）评审。"""
        # 获取judge模型提示
        judge_model_hint = self._get_judge_model(ctx)

        judge = ctx.agents.get("judge_evaluator") if ctx.agents else None
        if judge is None:
            from flowforge.modes.default_llm_actors import DefaultLLMEvaluator
            judge = DefaultLLMEvaluator()

        judge_input = AgentInput(params={
            "output": actor_result,
            # 传入judge模型，让evaluator使用deepseek-web/chat
            "model": judge_model_hint,
            "persona": "judge",
        })
        if hasattr(judge, 'execute_with_context'):
            judge_output = await judge.execute_with_context(judge_input, ctx)
        else:
            judge_output = await judge.execute(judge_input)

        result = judge_output.result
        # 记录judge使用的模型
        if judge_model_hint:
            result["judge_model"] = judge_model_hint
        return result

    def _get_judge_model(self, ctx: TaskContext) -> str:
        """获取judge阶段应使用的不同模型（deepseek-web/chat作为评审LLM）。"""
        try:
            from pathlib import Path

            import yaml
            config_path = Path(__file__).parent.parent / "config" / "models.yaml"
            if config_path.exists():
                with open(config_path, encoding="utf-8") as f:
                    models_config = yaml.safe_load(f)
                assignments = models_config.get("assignments", {})
                judge_primary = assignments.get("judge", {}).get("primary", "")
                if judge_primary:
                    return judge_primary
                coding_primary = assignments.get("coding", {}).get("primary", "")
                if coding_primary:
                    return coding_primary
                lightweight_primary = assignments.get("lightweight", {}).get("primary", "")
                if lightweight_primary:
                    return lightweight_primary
        except Exception as e:
            logger.warning(f"Failed to load judge model from config: {e}")
        return ""

    @staticmethod
    def _extract_text(result) -> str:
        """从agent输出结果中提取纯文本内容。"""
        if not result:
            return ""
        if isinstance(result, str):
            return result
        if isinstance(result, dict):
            for key in ("output", "draft", "content", "text", "answer", "response"):
                val = result.get(key)
                if val and isinstance(val, str) and len(val.strip()) > 10:
                    return val
            import json
            return json.dumps(result, ensure_ascii=False)
        return str(result)
