"""Loop Reflector — analyzes failures and generates improvements."""

from abc import ABC, abstractmethod
from flowforge.core.task_context import TaskContext
from flowforge.loop.state import LoopState, Reflection


class LoopReflector(ABC):
    """Loop 复盘器接口。"""

    @abstractmethod
    async def reflect(self, errors: list[str], task: TaskContext, state: LoopState) -> Reflection:
        """分析失败原因，生成改进建议。"""


class ReflexionReflector(LoopReflector):
    """Uses reflexion pattern for self-correction."""

    def __init__(self, llm_client=None):
        self.llm_client = llm_client

    async def reflect(self, errors: list[str], task: TaskContext, state: LoopState) -> Reflection:
        suggestions = [f"Address: {err}" for err in errors]
        root_cause = "; ".join(errors[:3])

        return Reflection(
            suggestions=suggestions,
            root_cause=root_cause,
            plan_adjustments=[],
        )
