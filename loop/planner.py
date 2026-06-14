"""Loop Planner — decomposes tasks into executable steps."""

import json
import logging

from abc import ABC, abstractmethod
from flowforge.core.task_context import TaskContext
from flowforge.loop.state import LoopState, Reflection

logger = logging.getLogger(__name__)


class LoopPlanner(ABC):
    """Loop 规划器接口。"""

    @abstractmethod
    async def plan(self, task: TaskContext, config: dict) -> list[dict]:
        """根据任务生成执行计划。"""

    @abstractmethod
    async def replan(self, plan: list[dict], reflection: Reflection, past_errors: list[str]) -> list[dict]:
        """根据复盘结果和过往错误调整计划。"""


class LLMPlanner(LoopPlanner):
    """Uses LLM to generate and adjust plans."""

    def __init__(self, llm_client=None):
        self.llm_client = llm_client

    async def plan(self, task: TaskContext, config: dict) -> list[dict]:
        mode = config.get("mode", "plan_execute")

        if self.llm_client is not None:
            try:
                prompt = (
                    "You are a task planning assistant. Given the following task, "
                    "generate an execution plan as a JSON array of step objects.\n"
                    "Each step should have: \"step\" (integer), \"action\" (string), "
                    "and optional \"params\" (object).\n\n"
                    f"Task ID: {task.task_id}\n"
                    f"Input data: {json.dumps(task.input_data, ensure_ascii=False, default=str)}\n"
                    f"Metadata: {json.dumps(task.metadata, ensure_ascii=False, default=str)}\n"
                    f"Execution mode: {mode}\n\n"
                    "Output ONLY the JSON array, no other text. Example:\n"
                    '[{"step": 1, "action": "analyze", "params": {}}, '
                    '{"step": 2, "action": "execute", "params": {}}]'
                )
                response = await self.llm_client.chat(prompt)
                plan = self._parse_plan_response(response)
                if plan:
                    return plan
                logger.warning("LLM plan response could not be parsed, falling back to default plan")
            except Exception as e:
                logger.warning("LLM plan generation failed: %s, falling back to default plan", e)

        return self._default_plan(task, mode)

    async def replan(self, plan: list[dict], reflection: Reflection, past_errors: list[str]) -> list[dict]:
        if self.llm_client is not None:
            try:
                prompt = (
                    "You are a task replanning assistant. Given the current plan, "
                    "reflection results, and past errors, generate an adjusted execution plan "
                    "as a JSON array of step objects.\n"
                    "Each step should have: \"step\" (integer), \"action\" (string), "
                    "and optional \"params\" (object).\n\n"
                    f"Current plan: {json.dumps(plan, ensure_ascii=False, default=str)}\n"
                    f"Root cause: {reflection.root_cause}\n"
                    f"Suggestions: {json.dumps(reflection.suggestions, ensure_ascii=False)}\n"
                    f"Past errors: {json.dumps(past_errors[-5:], ensure_ascii=False)}\n\n"
                    "Output ONLY the JSON array, no other text."
                )
                response = await self.llm_client.chat(prompt)
                new_plan = self._parse_plan_response(response)
                if new_plan:
                    return new_plan
                logger.warning("LLM replan response could not be parsed, falling back to adjustment")
            except Exception as e:
                logger.warning("LLM replan generation failed: %s, falling back to adjustment", e)

        adjusted = list(plan)
        if reflection.plan_adjustments:
            adjusted.extend(reflection.plan_adjustments)
        return adjusted

    def _default_plan(self, task: TaskContext, mode: str) -> list[dict]:
        """Generate a reasonable default plan based on task input."""
        steps = [{"step": 1, "action": "execute_task", "mode": mode}]

        input_data = task.input_data or {}
        if isinstance(input_data, dict):
            if input_data.get("research_required") or input_data.get("need_research"):
                steps.insert(1, {"step": 2, "action": "verify_result", "mode": mode})
                steps.insert(0, {"step": 1, "action": "research", "mode": mode})
                steps[-1]["step"] = 3
            elif input_data.get("review_required") or input_data.get("need_review"):
                steps.append({"step": 2, "action": "review", "mode": mode})

        return steps

    def _parse_plan_response(self, response: str) -> list[dict] | None:
        """Parse LLM response into a plan list. Returns None on failure."""
        if not response:
            return None

        text = response.strip()
        # Try to extract JSON array from markdown code block
        if "```" in text:
            lines = text.split("\n")
            json_lines = []
            inside = False
            for line in lines:
                if line.strip().startswith("```"):
                    if inside:
                        break
                    inside = True
                    continue
                if inside:
                    json_lines.append(line)
            text = "\n".join(json_lines).strip()

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            # Try to find the first [ and last ]
            start = text.find("[")
            end = text.rfind("]")
            if start == -1 or end == -1:
                return None
            try:
                parsed = json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return None

        if not isinstance(parsed, list):
            return None

        # Validate and normalize steps
        plan = []
        for i, item in enumerate(parsed):
            if isinstance(item, dict) and "action" in item:
                step = dict(item)
                step.setdefault("step", i + 1)
                plan.append(step)

        return plan if plan else None
