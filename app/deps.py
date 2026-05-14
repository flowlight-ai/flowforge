from flowforge.core.di import DIContainer
from flowforge.executor.hybrid_executor import HybridExecutor
from flowforge.tools.llm_client import LLMClient
from flowforge.scheduler.scheduler import TaskScheduler
from flowforge.core.plugin_manager import PluginManager

_executor_instance: HybridExecutor = None
_llm_client_instance: LLMClient = None
_scheduler_instance: TaskScheduler = None
_plugin_manager_instance: PluginManager = None


def set_executor_instance(executor: HybridExecutor):
    global _executor_instance
    _executor_instance = executor


def set_llm_client_instance(llm_client: LLMClient):
    global _llm_client_instance
    _llm_client_instance = llm_client


def set_scheduler_instance(scheduler: TaskScheduler):
    global _scheduler_instance
    _scheduler_instance = scheduler


def set_plugin_manager_instance(plugin_manager: PluginManager):
    global _plugin_manager_instance
    _plugin_manager_instance = plugin_manager


async def get_executor() -> HybridExecutor:
    return _executor_instance


async def get_container() -> DIContainer:
    return _executor_instance.agent_registry if _executor_instance else None


async def get_llm_client() -> LLMClient:
    if _llm_client_instance:
        return _llm_client_instance
    if _executor_instance and _executor_instance.tool_registry:
        tool = _executor_instance.tool_registry._tools.get("llm")
        if tool and isinstance(tool, LLMClient):
            return tool
    return None


async def get_scheduler() -> TaskScheduler:
    return _scheduler_instance


async def get_plugin_manager() -> PluginManager:
    if _plugin_manager_instance:
        return _plugin_manager_instance
    return None
