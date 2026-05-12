from typing import Dict
from core.base_mode_executor import BaseModeExecutor
from core.errors import ModeNotFoundError

class ModeRegistry:
    def __init__(self):
        self._modes: Dict[str, BaseModeExecutor] = {}

    def register(self, executor: BaseModeExecutor) -> None:
        if executor.mode_name in self._modes:
            raise ValueError(f"Mode '{executor.mode_name}' already registered")
        self._modes[executor.mode_name] = executor

    def get(self, mode_name: str) -> BaseModeExecutor:
        if mode_name not in self._modes:
            raise ModeNotFoundError(f"Mode '{mode_name}' not found")
        return self._modes[mode_name]

    def list_modes(self) -> list:
        return list(self._modes.keys())

    def suggest_mode(self, task_description: str) -> str:
        desc = task_description.lower()
        if any(w in desc for w in ["复杂", "推理", "数学", "证明"]):
            return "graph_of_thoughts"
        if any(w in desc for w in ["多步", "搜索", "查询"]):
            return "react"
        if any(w in desc for w in ["计划", "流程", "步骤"]):
            return "plan_execute"
        if any(w in desc for w in ["生成", "写作", "代码"]):
            return "reflexion"
        return "workflow"
