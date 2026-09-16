"""统一状态输出语法。

所有Agent输出统一为 state_updates: {key: expression} 格式。
StateUpdateMapper 自动映射到工作流状态。
从 DevForge 迁移至 FlowForge 通用框架。
"""

from __future__ import annotations

from typing import Any


class StateUpdateMapper:
    """状态更新映射器。

    将Agent的 state_updates 输出映射到工作流状态。
    支持表达式求值和嵌套路径设置。
    """

    @staticmethod
    def apply(state: dict, updates: dict[str, Any]) -> dict:
        """将 state_updates 应用到工作流状态。

        Args:
            state: 当前工作流状态
            updates: Agent输出的 state_updates 字典

        Returns:
            更新后的状态（原地修改并返回）

        Examples:
            state = {"stage": "coding", "artifacts": {}}
            updates = {"stage": "review", "artifacts.code": "main.py"}
            StateUpdateMapper.apply(state, updates)
            # state = {"stage": "review", "artifacts": {"code": "main.py"}}
        """
        for key, value in updates.items():
            if "." in key:
                # 嵌套路径设置，如 "artifacts.code"
                StateUpdateMapper._set_nested(state, key, value)
            else:
                state[key] = value
        return state

    @staticmethod
    def _set_nested(state: dict, path: str, value: Any) -> None:
        """设置嵌套字典值。"""
        keys = path.split(".")
        current = state
        for key in keys[:-1]:
            if key not in current or not isinstance(current[key], dict):
                current[key] = {}
            current = current[key]
        current[keys[-1]] = value

    @staticmethod
    def extract_outputs(agent_result: dict) -> dict[str, Any]:
        """从Agent结果中提取 state_updates。

        兼容旧格式（output/output_mapping）和新格式（state_updates）。
        """
        if "state_updates" in agent_result:
            return agent_result["state_updates"]

        # 兼容旧格式
        updates = {}
        if "output" in agent_result:
            updates["output"] = agent_result["output"]
        if "output_mapping" in agent_result:
            for target_key, source_path in agent_result["output_mapping"].items():
                value = agent_result
                for key in source_path.split("."):
                    if isinstance(value, dict):
                        value = value.get(key)
                    else:
                        value = None
                        break
                if value is not None:
                    updates[target_key] = value

        return updates
