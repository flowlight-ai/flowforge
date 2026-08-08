"""Core registry bootstrap helpers — extracted from app/main.py.

Provides the three registration helpers that wire built-in tools, agents,
and execution modes into their respective registries at startup.  These
were previously inline functions in ``app/main.py``; moving them into
``core/`` keeps ``app/`` free of implementation code (architecture rule:
``app/`` should only contain endpoint wiring).
"""

from __future__ import annotations

import os

from flowforge.core.agent_registry import AgentRegistry
from flowforge.core.plugin_registry import PluginRegistry
from flowforge.core.tracing import get_logger
from flowforge.modes.agent_judge import AgentJudgeExecutor
from flowforge.modes.graph_of_thoughts import GraphOfThoughtsExecutor
from flowforge.modes.multi_agent import MultiAgentExecutor
from flowforge.modes.plan_execute import PlanExecuteExecutor
from flowforge.modes.react import ReActExecutor
from flowforge.modes.reflexion import ReflexionExecutor
from flowforge.modes.registry import ModeRegistry
from flowforge.modes.rewoo import ReWOOExecutor
from flowforge.modes.self_discover import SelfDiscoverExecutor
from flowforge.modes.workflow import WorkflowExecutor
from flowforge.tools.registry import ToolRegistry

logger = get_logger("flowforge.core.bootstrap")


def register_core_tools(tool_registry: ToolRegistry, plugin_registry: PluginRegistry) -> None:
    """Register built-in tools (python/file/cache/workspace + optional)."""
    from flowforge.tools.cache import CacheTool
    from flowforge.tools.file_rw import FileReadWriteTool
    from flowforge.tools.python_executor import PythonExecutorTool
    from flowforge.tools.workspace_file import WorkspaceFileTool

    tool_registry.register(PythonExecutorTool())
    tool_registry.register(FileReadWriteTool())
    tool_registry.register(CacheTool())
    tool_registry.register(WorkspaceFileTool())

    try:
        from flowforge.tools.web_search import WebSearchTool
        tool_registry.register(WebSearchTool())
    except ImportError:
        logger.debug("WebSearchTool not available")

    _optional = []
    for mod_name, cls_name, env_key in [
        ("flowforge.tools.tavily_search", "TavilySearchTool", "TAVILY_API_KEY"),
        ("flowforge.tools.duckduckgo_search", "DuckDuckGoSearchTool", None),
        ("flowforge.tools.web_scraper", "WebScraperTool", None),
        ("flowforge.tools.sendgrid_mail", "SendGridMailTool", "SENDGRID_API_KEY"),
        ("flowforge.tools.local_publish", "LocalPublishTool", None),
        ("flowforge.tools.opensieve_client", "OpenSieveClient", None),
        ("flowforge.tools.git_tool", "GitTool", None),
        ("flowforge.tools.linter_tool", "LinterTool", None),
        ("flowforge.tools.test_runner", "TestRunnerTool", None),
        ("flowforge.tools.code_search", "CodeSearchTool", None),
        ("flowforge.tools.translation_tool", "TranslationTool", None),
    ]:
        try:
            mod = __import__(mod_name, fromlist=[cls_name])
            _optional.append((getattr(mod, cls_name), env_key))
        except ImportError:
            pass
    for _tool_cls, _env_key in _optional:
        try:
            if _env_key is None or os.getenv(_env_key, ""):
                tool_registry.register(_tool_cls())
        except Exception:
            pass


def register_core_agents(agent_registry: AgentRegistry) -> None:
    """Register built-in generic agents."""
    from flowforge.agents.generic import GENERIC_AGENTS
    for agent_cls in GENERIC_AGENTS:
        try:
            name = getattr(agent_cls, "name", None) or agent_cls.__name__.replace("Agent", "").lower()
            agent_registry.register_factory(name, agent_cls)
        except Exception as e:
            logger.debug(f"Skip agent {agent_cls.__name__}: {e}")


def register_all_modes(mode_registry: ModeRegistry) -> None:
    """Register all built-in execution mode executors."""
    for executor_cls in [
        WorkflowExecutor, ReflexionExecutor, ReActExecutor,
        PlanExecuteExecutor, MultiAgentExecutor, ReWOOExecutor,
        SelfDiscoverExecutor, AgentJudgeExecutor, GraphOfThoughtsExecutor,
    ]:
        mode_registry.register(executor_cls())
