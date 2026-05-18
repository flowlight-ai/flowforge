from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_agent import AgentInput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.modes.default_llm_actors import DefaultLLMActor, DefaultLLMEvaluator, DefaultLLMReflector


class ReflexionExecutor(BaseModeExecutor):
    mode_name = "reflexion"
    capabilities = ["generation", "evaluation", "refinement"]
    MAX_ITERATIONS = 3
    QUALITY_THRESHOLD = 0.85

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")
        memory = []
        best_result = None
        best_score = 0.0
        iteration = 0

        for iteration in range(self.MAX_ITERATIONS):
            ctx.event_bus.emit(ctx.task_id, "reflexion.iteration_start", {"iteration": iteration + 1})

            actor = ctx.agents.get("reflexion_actor") or DefaultLLMActor()
            actor_input = AgentInput(params={"task": task, "memory": memory})
            if hasattr(actor, 'execute_with_context'):
                actor_output = await actor.execute_with_context(actor_input, ctx)
            else:
                actor_output = await actor.execute(actor_input)
            ctx.event_bus.emit(ctx.task_id, "reflexion.actor", {
                "iteration": iteration + 1,
                "output_preview": str(actor_output.result)[:300],
            })

            evaluator = ctx.agents.get("reflexion_evaluator") or DefaultLLMEvaluator()
            eval_input = AgentInput(params={"output": actor_output.result})
            if hasattr(evaluator, 'execute_with_context'):
                eval_output = await evaluator.execute_with_context(eval_input, ctx)
            else:
                eval_output = await evaluator.execute(eval_input)
            score = eval_output.result.get("score", 0)
            issues = eval_output.result.get("issues", [])
            ctx.event_bus.emit(ctx.task_id, "reflexion.evaluator", {
                "iteration": iteration + 1, "score": score, "issues": issues,
            })

            if score > best_score:
                best_result = actor_output.result
                best_score = score
            if score >= self.QUALITY_THRESHOLD:
                ctx.event_bus.emit(ctx.task_id, "reflexion.quality_passed", {
                    "iteration": iteration + 1, "score": score,
                })
                break

            reflector = ctx.agents.get("reflexion_reflector") or DefaultLLMReflector()
            reflect_input = AgentInput(params={"output": actor_output.result, "issues": issues})
            if hasattr(reflector, 'execute_with_context'):
                reflect_output = await reflector.execute_with_context(reflect_input, ctx)
            else:
                reflect_output = await reflector.execute(reflect_input)
            memory.append(reflect_output.result.get("reflection", ""))
            ctx.event_bus.emit(ctx.task_id, "reflexion.reflector", {
                "iteration": iteration + 1,
                "reflection_preview": str(reflect_output.result)[:300],
            })

        ctx.event_bus.emit(ctx.task_id, "reflexion.complete", {
            "iterations": iteration + 1, "best_score": best_score,
        })

        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": str(best_result) if best_result else "", "is_partial": False,
        })

        return {"result": best_result, "score": best_score, "iterations": iteration + 1}
