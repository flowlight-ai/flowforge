import json
import re
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("graph_of_thoughts_executor")


class GraphOfThoughtsExecutor(BaseModeExecutor):
    mode_name = "graph_of_thoughts"
    capabilities = ["reasoning", "branching"]

    MAX_DEPTH = 2
    MAX_BRANCHES = 2
    MAX_TOTAL_THOUGHTS = 6

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")
        llm_tool = ctx.tools.get_tool("llm")
        thoughts = []
        best_thought = None
        best_score = 0.0

        initial_prompt = f"对以下问题进行深度思考，给出你的推理过程和结论。\n问题: {task}"
        result = await llm_tool.execute(ToolInput(params={
            "messages": [{"role": "user", "content": initial_prompt}],
            "stream": False, "task_id": ctx.task_id,
            "agent_name": "got_initial", "persona": ctx.persona or "default",
        }))
        initial_thought = result.result.get("content", "")
        thoughts.append({"id": "0", "content": initial_thought, "parent": None, "score": 0.0, "depth": 0})

        for depth in range(self.MAX_DEPTH):
            if len(thoughts) >= self.MAX_TOTAL_THOUGHTS:
                break

            branches = []
            candidates = [t for t in thoughts if t.get("depth", 0) == depth]
            if not candidates:
                break

            best_at_depth = max(candidates, key=lambda t: t.get("score", 0.0)) if candidates else candidates[0]

            for b in range(self.MAX_BRANCHES):
                if len(thoughts) + len(branches) >= self.MAX_TOTAL_THOUGHTS:
                    break
                branch_prompt = f"基于以下思考，从不同角度继续推理（角度{b+1}）:\n{best_at_depth['content'][:1000]}\n输出 JSON: {{\"reasoning\": \"...\", \"conclusion\": \"...\"}}"
                try:
                    b_result = await llm_tool.execute(ToolInput(params={
                        "messages": [{"role": "user", "content": branch_prompt}],
                        "stream": False, "task_id": ctx.task_id,
                        "agent_name": "got_branch", "persona": ctx.persona or "default",
                    }))
                    b_content = b_result.result.get("content", "")
                    match = re.search(r'\{.*\}', b_content, re.DOTALL)
                    if match:
                        try:
                            b_data = json.loads(match.group())
                            branches.append({"id": f"{depth}-{b}", "content": b_data.get("reasoning", b_content), "conclusion": b_data.get("conclusion", ""), "parent": best_at_depth["id"], "depth": depth + 1})
                        except json.JSONDecodeError:
                            branches.append({"id": f"{depth}-{b}", "content": b_content, "parent": best_at_depth["id"], "depth": depth + 1})
                except Exception:
                    pass

            for branch in branches:
                eval_prompt = f"评估以下推理的质量，给出 0-1 分数。输出 JSON: {{\"score\": 0.85}}\n推理: {branch['content'][:500]}"
                try:
                    eval_result = await llm_tool.execute(ToolInput(params={
                        "messages": [{"role": "user", "content": eval_prompt}],
                        "stream": False, "task_id": ctx.task_id,
                        "agent_name": "got_eval", "persona": ctx.persona or "default",
                    }))
                    eval_content = eval_result.result.get("content", "{}")
                    match = re.search(r'\{.*\}', eval_content, re.DOTALL)
                    if match:
                        try:
                            score_data = json.loads(match.group())
                            branch["score"] = score_data.get("score", 0.5)
                        except json.JSONDecodeError:
                            branch["score"] = 0.5
                except Exception:
                    branch["score"] = 0.5

                if branch["score"] > best_score:
                    best_score = branch["score"]
                    best_thought = branch

            thoughts.extend(branches)

        final_content = best_thought["content"] if best_thought else initial_thought
        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": final_content, "is_partial": False, "agent_name": "graph_of_thoughts",
        })

        return {"thoughts": thoughts, "best": best_thought, "best_score": best_score, "total_thoughts": len(thoughts)}
