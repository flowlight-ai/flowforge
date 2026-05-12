from abc import ABC, abstractmethod
from typing import List
from core.task_context import TaskContext


class BaseModeExecutor(ABC):
    mode_name: str
    capabilities: List[str] = []

    async def _prepare(self, ctx: TaskContext) -> TaskContext:
        return ctx

    @abstractmethod
    async def _execute_core(self, ctx: TaskContext) -> dict:
        pass

    async def _postprocess(self, ctx: TaskContext, result: dict) -> dict:
        return result

    async def run(self, ctx: TaskContext) -> dict:
        ctx = await self._prepare(ctx)
        result = await self._execute_core(ctx)
        return await self._postprocess(ctx, result)
