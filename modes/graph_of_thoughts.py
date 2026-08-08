import json
import re

from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
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
        thoughts = []
        best_thought = None
        best_score = 0.0

        initial_prompt = get_prompt(
            "flowforge.mode.graph_of_thoughts.initial",
            "对以下问题进行深度思考，给出你的推理过程和结论。\n问题: {task}",
            task=task,
        )
        result = await ctx.tools.execute("llm", ToolInput(params={
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
                branch_prompt = get_prompt(
                    "flowforge.mode.graph_of_thoughts.branch",
                    "基于以下思考，从不同角度继续推理（角度{branch_num}）:\n{content}\n输出 JSON: {{\"reasoning\": \"...\", \"conclusion\": \"...\"}}",
                    branch_num=b+1,
                    content=best_at_depth['content'][:1000],
                )
                try:
                    b_result = await ctx.tools.execute("llm", ToolInput(params={
                        "messages": [{"role": "user", "content": branch_prompt}],
                        "stream": False, "task_id": ctx.task_id,
                        "agent_name": "got_branch", "persona": ctx.persona or "default",
                    }))
                    b_content = b_result.result.get("content", "")
                    if not b_content or not b_content.strip():
                        logger.warning(f"GoT branch {b} at depth {depth} returned empty content", task_id=ctx.task_id)
                        continue
                    match = re.search(r'\{.*\}', b_content, re.DOTALL)
                    if match:
                        try:
                            b_data = json.loads(match.group())
                            branches.append({"id": f"{depth}-{b}", "content": b_data.get("reasoning", b_content), "conclusion": b_data.get("conclusion", ""), "parent": best_at_depth["id"], "depth": depth + 1, "score": 0.0})
                        except json.JSONDecodeError:
                            branches.append({"id": f"{depth}-{b}", "content": b_content, "parent": best_at_depth["id"], "depth": depth + 1, "score": 0.0})
                    else:
                        branches.append({"id": f"{depth}-{b}", "content": b_content, "parent": best_at_depth["id"], "depth": depth + 1, "score": 0.0})
                except Exception as e:
                    logger.warning(f"GoT branch {b} at depth {depth} failed: {e}", task_id=ctx.task_id)

            for branch in branches:
                eval_prompt = get_prompt(
                    "flowforge.mode.graph_of_thoughts.evaluate",
                    "评估以下推理的质量，给出 0-1 分数。输出 JSON: {{\"score\": 0.85}}\n推理: {content}",
                    content=branch['content'][:500],
                )
                try:
                    eval_result = await ctx.tools.execute("llm", ToolInput(params={
                        "messages": [{"role": "user", "content": eval_prompt}],
                        "stream": False, "task_id": ctx.task_id,
                        "agent_name": "got_eval", "persona": "judge",
                    }))
                    eval_content = eval_result.result.get("content", "{}")
                    match = re.search(r'\{.*\}', eval_content, re.DOTALL)
                    if match:
                        try:
                            score_data = json.loads(match.group())
                            branch["score"] = score_data.get("score", 0.5)
                        except json.JSONDecodeError:
                            branch["score"] = 0.5
                except Exception as e:
                    logger.warning(f"GoT eval failed for branch {branch['id']}: {e}", task_id=ctx.task_id)
                    branch["score"] = 0.5

                if branch.get("score", 0.0) > best_score:
                    best_score = branch["score"]
                    best_thought = branch

            thoughts.extend(branches)

        if best_thought and len(thoughts) > 1:
            parts = [initial_thought]
            for t in thoughts:
                if t.get("depth", 0) > 0 and t.get("content"):
                    c = t["content"]
                    if t.get("conclusion"):
                        c += f"\n结论: {t['conclusion']}"
                    parts.append(c)
            final_content = "\n\n---\n\n".join(parts)
        elif best_thought:
            final_content = best_thought["content"]
        else:
            final_content = initial_thought
        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": final_content, "is_partial": False, "agent_name": "graph_of_thoughts",
        })

        return {"thoughts": thoughts, "best": best_thought, "best_score": best_score, "total_thoughts": len(thoughts), "content": final_content}
