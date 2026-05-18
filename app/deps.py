from typing import Optional
from flowforge.executor.hybrid_executor import HybridExecutor
from flowforge.tools.llm_client import LLMClient
from flowforge.tools.llm.model_service import ModelService
from flowforge.scheduler.scheduler import TaskScheduler
from flowforge.core.plugin_manager import PluginManager
from flowforge.core.tool_chain_executor import ToolChainExecutor

_executor_instance: HybridExecutor = None
_llm_client_instance: LLMClient = None
_model_service_instance: ModelService = None
_scheduler_instance: TaskScheduler = None
_plugin_manager_instance: PluginManager = None
_tool_chain_executor_instance: ToolChainExecutor = None


def set_executor_instance(executor: HybridExecutor):
    global _executor_instance
    _executor_instance = executor


def set_llm_client_instance(llm_client: LLMClient):
    global _llm_client_instance
    _llm_client_instance = llm_client


def set_model_service_instance(model_service: ModelService):
    global _model_service_instance
    _model_service_instance = model_service


def set_scheduler_instance(scheduler: TaskScheduler):
    global _scheduler_instance
    _scheduler_instance = scheduler


def set_plugin_manager_instance(plugin_manager: PluginManager):
    global _plugin_manager_instance
    _plugin_manager_instance = plugin_manager


def set_tool_chain_executor_instance(tool_chain_executor: ToolChainExecutor):
    global _tool_chain_executor_instance
    _tool_chain_executor_instance = tool_chain_executor


async def get_executor() -> HybridExecutor:
    return _executor_instance


async def get_container() -> Optional[HybridExecutor]:
    return _executor_instance


async def get_llm_client() -> LLMClient:
    if _llm_client_instance:
        return _llm_client_instance
    if _executor_instance and _executor_instance.tool_registry:
        tool = _executor_instance.tool_registry._tools.get("llm")
        if tool and isinstance(tool, LLMClient):
            return tool
    return None


async def get_model_service() -> ModelService:
    return _model_service_instance


async def get_scheduler() -> TaskScheduler:
    return _scheduler_instance


async def get_plugin_manager() -> PluginManager:
    if _plugin_manager_instance:
        return _plugin_manager_instance
    return None


def get_tool_chain_executor() -> Optional[ToolChainExecutor]:
    if _tool_chain_executor_instance:
        return _tool_chain_executor_instance
    if _executor_instance and _executor_instance.tool_registry:
        llm_client = _executor_instance.tool_registry._tools.get("llm")
        if llm_client:
            return ToolChainExecutor(llm_client, _executor_instance.tool_registry)
    return None
