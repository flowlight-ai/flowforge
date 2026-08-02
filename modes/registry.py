"""Registry for FlowForge execution modes.

Provides a central registry where mode executors can be registered by name
and later retrieved.  Includes a heuristic-based mode suggestion function
that maps task descriptions to the most appropriate execution mode.

License: MIT
"""

import logging
from typing import Dict
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.errors import ModeNotFoundError

_logger = logging.getLogger(__name__)

class ModeRegistry:
    """Central registry for execution mode executors.

    Mode executors (subclasses of ``BaseModeExecutor``) are registered by
    their ``mode_name`` attribute.  The registry provides lookup, listing,
    and heuristic mode suggestion capabilities.

    Attributes:
        _modes: Internal mapping from mode name to executor instance.
    """

    def __init__(self):
        """Initialize the ModeRegistry with an empty mode map."""
        self._modes: Dict[str, BaseModeExecutor] = {}

    def register(self, executor: BaseModeExecutor) -> None:
        """Register a mode executor.

        If a mode with the same name is already registered, the new
        registration is silently skipped and a DEBUG message is logged.
        This allows plugins to safely register modes that may already
        be provided by the core framework.

        Args:
            executor: A ``BaseModeExecutor`` instance whose ``mode_name``
                will be used as the registry key.
        """
        if executor.mode_name in self._modes:
            _logger.debug(
                "Mode '%s' already registered, skipping duplicate", executor.mode_name
            )
            return
        self._modes[executor.mode_name] = executor

    def get(self, mode_name: str) -> BaseModeExecutor:
        """Retrieve a mode executor by name.

        Args:
            mode_name: The registered name of the mode.

        Returns:
            The ``BaseModeExecutor`` instance associated with the name.

        Raises:
            ModeNotFoundError: If no mode with the given name is registered.
        """
        if mode_name not in self._modes:
            raise ModeNotFoundError(f"Mode '{mode_name}' not found")
        return self._modes[mode_name]

    def unregister(self, mode_name: str) -> None:
        """Remove a registered mode by name.

        Raises:
            ModeNotFoundError: If no mode with the given name is registered.
        """
        if mode_name not in self._modes:
            raise ModeNotFoundError(f"Mode '{mode_name}' not found")
        del self._modes[mode_name]

    def list_modes(self) -> list:
        """List all registered mode names.

        Returns:
            A list of mode name strings.
        """
        return list(self._modes.keys())

    def suggest_mode(self, task_description: str) -> str:
        """Heuristically suggest an execution mode based on a task description.

        Inspects the task description for keyword patterns and returns the
        most suitable mode name.  Falls back to ``"workflow"`` when no
        keywords match.

        Args:
            task_description: A natural-language description of the task.

        Returns:
            The suggested mode name string.
        """
        desc = task_description.lower()
        # NOTE: "loop" keywords removed — Loop is NOT a mode, it is the
        # "upper-level manager" of modes (design doc loop.md §5.3).
        # Loop should be triggered via loop_config in TaskContext.metadata,
        # not via mode suggestion.
        if any(w in desc for w in ["复杂", "推理", "数学", "证明"]):
            return "graph_of_thoughts"
        if any(w in desc for w in ["多步", "搜索", "查询"]):
            return "react"
        if any(w in desc for w in ["计划", "流程", "步骤"]):
            return "plan_execute"
        if any(w in desc for w in ["生成", "写作", "代码"]):
            return "reflexion"
        return "workflow"
