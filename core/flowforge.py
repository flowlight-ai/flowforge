import yaml
from pathlib import Path
from typing import Optional
from core.config import SystemConfig, ConfigLoader, system_config
from core.di import DIContainer
from events.event_bus import EventBus
from modes.registry import ModeRegistry
from tools.registry import ToolRegistry
from tools.llm_client import LLMClient
from tools.helixrag_client import HelixRAGClient
from tools.web_search import WebSearchTool
from tools.python_executor import PythonExecutorTool
from tools.file_rw import FileReadWriteTool
from tools.cache import CacheTool
from memory.manager import MemoryManager
from executor.hybrid_executor import HybridExecutor
from core.plugin_manager import PluginManager
from core.tracing import get_logger

logger = get_logger("flowforge")

class FlowForge:
    def __init__(self, config_path: Optional[str] = None):
        self.config = system_config
        self.config_loader = ConfigLoader()
        if config_path:
            custom = self.config_loader.load_yaml(config_path)
            for k, v in custom.get("system", {}).items():
                if hasattr(self.config, k):
                    setattr(self.config, k, type(getattr(self.config, k))(v))

        self.container = DIContainer()
        self.event_bus = EventBus()
        self.tool_registry = ToolRegistry()
        self.mode_registry = ModeRegistry()
        self.plugin_manager = PluginManager()
        self.memory_manager = MemoryManager({"db_url": self.config.db_url})
        self._executor = None

    def _register_defaults(self):
        self.tool_registry.register(LLMClient())
        if self.config.helixrag_enabled:
            self.tool_registry.register(HelixRAGClient())
        self.tool_registry.register(WebSearchTool())
        self.tool_registry.register(PythonExecutorTool())
        self.tool_registry.register(FileReadWriteTool())
        self.tool_registry.register(CacheTool())

    def register_mode(self, executor):
        self.mode_registry.register(executor)

    def register_tool(self, tool):
        self.tool_registry.register(tool)

    def register_agent(self, name: str, agent_cls):
        self.container.register_agent(name, agent_cls)

    def build(self) -> HybridExecutor:
        self._register_defaults()
        plugin_config = self.config_loader.load_yaml("default.yaml")
        self.plugin_manager.load_from_config(plugin_config)
        self.plugin_manager.register_all(self.mode_registry, self.container, self.tool_registry)
        self._executor = HybridExecutor(
            self.mode_registry, self.container, self.tool_registry,
            self.event_bus, memory_manager=self.memory_manager
        )
        return self._executor

    @classmethod
    def from_config(cls, config_path: str) -> 'FlowForge':
        return cls(config_path=config_path)
