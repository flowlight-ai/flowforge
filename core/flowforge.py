from pathlib import Path
from typing import Optional
from flowforge.core.config import SystemConfig, ConfigLoader, system_config
from flowforge.core.agent_registry import AgentRegistry
from flowforge.core.di import DIContainer
from flowforge.events.event_bus import EventBus
from flowforge.modes.registry import ModeRegistry
from flowforge.tools.registry import ToolRegistry
from flowforge.tools.llm_client import LLMClient
from flowforge.tools.opensieve_client import OpenSieveClient
from flowforge.tools.web_search import WebSearchTool
from flowforge.tools.python_executor import PythonExecutorTool
from flowforge.tools.file_rw import FileReadWriteTool
from flowforge.tools.cache import CacheTool
from flowforge.tools.duckduckgo_search import DuckDuckGoSearchTool
from flowforge.tools.web_scraper import WebScraperTool
from flowforge.tools.toutiao_publisher import ToutiaoPublisherTool
from flowforge.tools.wechat_publisher import WeChatPublisherTool
from flowforge.tools.pexels_image import PexelsImageTool
from flowforge.tools.sendgrid_mail import SendGridMailTool
from flowforge.tools.webhook import WebhookTool
from flowforge.memory.manager import MemoryManager
from flowforge.executor.hybrid_executor import HybridExecutor
from flowforge.core.plugin_manager import PluginManager
from flowforge.core.tracing import get_logger
import os

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
        self.agent_registry = AgentRegistry()
        self.event_bus = EventBus()
        self.tool_registry = ToolRegistry()
        self.mode_registry = ModeRegistry()
        self.plugin_manager = PluginManager()
        self.memory_manager = MemoryManager({"db_url": self.config.db_url})
        self._executor = None

    def _register_defaults(self):
        models_config = self.config_loader.get_models_config()
        llm_client = LLMClient(models_config=models_config, event_bus=self.event_bus)
        self.tool_registry.register(llm_client)
        if self.config.opensieve_enabled:
            self.tool_registry.register(OpenSieveClient())
        self.tool_registry.register(WebSearchTool())
        self.tool_registry.register(PythonExecutorTool())
        self.tool_registry.register(FileReadWriteTool())
        self.tool_registry.register(CacheTool())

        _optional_tools = [
            (DuckDuckGoSearchTool, None),
            (WebScraperTool, None),
            (ToutiaoPublisherTool, "TOUTIAO_ACCESS_TOKEN"),
            (WeChatPublisherTool, "WECHAT_APP_ID"),
            (PexelsImageTool, "PEXELS_API_KEY"),
            (SendGridMailTool, "SENDGRID_API_KEY"),
            (WebhookTool, None),
        ]
        for tool_cls, env_key in _optional_tools:
            try:
                if env_key is None or os.getenv(env_key, ""):
                    self.tool_registry.register(tool_cls())
            except Exception as e:
                logger.debug(f"Skip tool {tool_cls.__name__}: {e}")

    def register_mode(self, executor):
        self.mode_registry.register(executor)

    def register_tool(self, tool):
        self.tool_registry.register(tool)

    def register_agent(self, name: str, agent_cls):
        self.agent_registry.register_factory(name, agent_cls)
        self.container.register_agent(name, agent_cls)

    def build(self) -> HybridExecutor:
        self._register_defaults()
        plugin_config = self.config_loader.load_yaml("default.yaml")
        self.plugin_manager.load_from_config(plugin_config)
        self.plugin_manager.register_all(self.mode_registry, self.agent_registry, self.tool_registry)
        self._executor = HybridExecutor(
            self.mode_registry, self.agent_registry, self.tool_registry,
            self.event_bus, memory_manager=self.memory_manager
        )
        return self._executor

    @classmethod
    def from_config(cls, config_path: str) -> 'FlowForge':
        return cls(config_path=config_path)
