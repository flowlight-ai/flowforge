"""Parallel Worker execution for Loop Engine."""
import asyncio
import copy
from typing import Any

from flowforge.core.task_context import TaskContext


class ParallelWorkerResult:
    """Result from parallel worker execution."""

    def __init__(self):
        self.results: dict[str, Any] = {}
        self.errors: dict[str, str] = {}

    @property
    def all_succeeded(self) -> bool:
        return len(self.errors) == 0

    def merge_results(self, strategy: str = "concat") -> dict:
        """Merge results from all workers."""
        if strategy == "concat":
            merged = {}
            for name, result in self.results.items():
                if isinstance(result, dict):
                    merged[name] = result
            return merged
        elif strategy == "reduce":
            # Flatten all results into one dict
            merged = {}
            for name, result in self.results.items():
                if isinstance(result, dict):
                    merged.update(result)
            return merged
        elif strategy == "vote":
            # Majority vote on key fields
            return self.results  # Return all for voter to decide
        return self.results


async def execute_parallel_workers(
    workers: list[dict],
    task: TaskContext,
    hybrid_executor,
    merge_strategy: str = "concat",
) -> ParallelWorkerResult:
    """Execute multiple workers in parallel using asyncio.gather.

    Each worker gets an independent copy of TaskContext to avoid
    shared state issues.
    """
    result = ParallelWorkerResult()

    async def _run_worker(worker_config: dict):
        name = worker_config.get("name", "unknown")
        mode = worker_config.get("mode", "workflow")
        try:
            # Create independent TaskContext copy
            task_copy = copy.deepcopy(task)
            task_copy.mode = mode

            worker_result = await hybrid_executor.run(task_copy, mode_hint=mode)
            result.results[name] = worker_result
        except Exception as e:
            result.errors[name] = str(e)

    # Run all workers concurrently
    await asyncio.gather(*[_run_worker(w) for w in workers])

    return result
