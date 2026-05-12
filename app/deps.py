from core.di import DIContainer
from executor.hybrid_executor import HybridExecutor

_executor_instance: HybridExecutor = None

def set_executor_instance(executor: HybridExecutor):
    global _executor_instance
    _executor_instance = executor

async def get_executor() -> HybridExecutor:
    return _executor_instance

async def get_container() -> DIContainer:
    return _executor_instance.agent_registry if _executor_instance else None
