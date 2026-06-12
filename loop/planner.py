"""Loop Planner — decomposes tasks into executable steps."""

from abc import ABC, abstractmethod
from flowforge.core.task_context import TaskContext
from flowforge.loop.state import LoopState, Reflection


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
        return [{"step": 1, "action": "execute_task", "mode": mode}]

    async def replan(self, plan: list[dict], reflection: Reflection, past_errors: list[str]) -> list[dict]:
        if reflection.plan_adjustments:
            plan.extend(reflection.plan_adjustments)
        return plan
