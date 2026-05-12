import json
import re
from core.base_mode_executor import BaseModeExecutor
from core.base_agent import AgentInput
from core.base_tool import ToolInput
from core.task_context import TaskContext

class GraphOfThoughtsExecutor(BaseModeExecutor):
    mode_name = "graph_of_thoughts"
    capabilities = ["reasoning", "branching"]

    MAX_DEPTH = 4
    MAX_BRANCHES = 3

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")
        llm_tool = ctx.tools.get_tool("llm")
        thoughts = []
        best_thought = None
        best_score = 0.0

        initial_prompt = f"对以下问题进行深度思考，给出你的推理过程和结论。\n问题: {task}"
        result = await llm_tool.execute(ToolInput(params={"messages": [{"role": "user", "content": initial_prompt}]}))
        initial_thought = result.result.get("content", "")
        thoughts.append({"id": "0", "content": initial_thought, "parent": None, "score": 0.0})

        for depth in range(self.MAX_DEPTH):
            branches = []
            for thought in thoughts:
                if thought.get("depth", 0) == depth:
                    for b in range(self.MAX_BRANCHES):
                        branch_prompt = f"基于以下思考，从不同角度继续推理（角度{b+1}）:\n{thought['content']}\n输出 JSON: {{\"reasoning\": \"...\", \"conclusion\": \"...\"}}"
                        try:
                            b_result = await llm_tool.execute(ToolInput(params={"messages": [{"role": "user", "content": branch_prompt}]}))
                            b_content = b_result.result.get("content", "")
                            match = re.search(r'\{.*\}', b_content, re.DOTALL)
                            if match:
                                try:
                                    b_data = json.loads(match.group())
                                    branches.append({"id": f"{depth}-{b}", "content": b_data.get("reasoning", b_content), "conclusion": b_data.get("conclusion", ""), "parent": thought["id"], "depth": depth + 1})
                                except json.JSONDecodeError:
                                    branches.append({"id": f"{depth}-{b}", "content": b_content, "parent": thought["id"], "depth": depth + 1})
                        except Exception:
                            pass

            eval_prompt = f"评估以下推理的质量，给出 0-1 分数。输出 JSON: {{\"score\": 0.85}}\n推理: {[b['content'][:200] for b in branches]}"
            for branch in branches:
                try:
                    eval_result = await llm_tool.execute(ToolInput(params={"messages": [{"role": "user", "content": eval_prompt}]}))
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

        return {"thoughts": thoughts, "best": best_thought, "best_score": best_score, "total_thoughts": len(thoughts)}
