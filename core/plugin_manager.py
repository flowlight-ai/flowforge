import importlib.metadata
import importlib
from typing import Dict, List, Callable
from core.tracing import get_logger
from core.errors import ConfigurationError

logger = get_logger("plugin_manager")

class PluginManager:
    def __init__(self):
        self._loaded: Dict[str, List[str]] = {
            "modes": [], "agents": [], "tools": [], "workflows": [],
        }
        self._config_results: Dict[str, List[Callable]] = {}

    def discover_entry_points(self, group: str) -> List[Callable]:
        factories = []
        try:
            eps = importlib.metadata.entry_points(group=group)
            for ep in eps:
                try:
                    factory = ep.load()
                    factories.append(factory)
                    self._loaded.setdefault(group, []).append(ep.name)
                    logger.info(f"插件发现: [{group}] {ep.name}")
                except Exception as e:
                    logger.warning(f"跳过加载失败的插件 {ep.name}: {e}")
        except Exception:
            pass
        return factories

    def load_from_config(self, config: dict) -> Dict[str, List[Callable]]:
        results = {}
        for plugin_type in ["modes", "agents", "tools", "workflows"]:
            plugins = config.get(plugin_type, [])
            results[plugin_type] = []
            for plugin_def in plugins:
                module_path = None
                if isinstance(plugin_def, str):
                    module_path = plugin_def
                elif isinstance(plugin_def, dict):
                    module_path = plugin_def.get("module")
                if module_path:
                    try:
                        factory = self._load_from_path(module_path)
                        results[plugin_type].append(factory)
                        self._loaded.setdefault(plugin_type, []).append(module_path)
                        logger.info(f"配置加载插件: [{plugin_type}] {module_path}")
                    except Exception as e:
                        logger.warning(f"配置加载插件失败 {module_path}: {e}")
        self._config_results = results
        return results

    def _load_from_path(self, module_path: str) -> Callable:
        if ":" in module_path:
            module_name, attr_name = module_path.split(":", 1)
            module = importlib.import_module(module_name)
            return getattr(module, attr_name)
        else:
            module = importlib.import_module(module_path)
            if hasattr(module, "register"):
                return module.register
            raise ConfigurationError(f"No callable found in {module_path}")

    def register_all(self, mode_registry, agent_registry, tool_registry):
        for mode_factory in self.discover_entry_points("flowforge.modes"):
            try:
                mode_registry.register(mode_factory())
            except Exception as e:
                logger.warning(f"注册模式插件失败: {e}")
        for mode_factory in self._config_results.get("modes", []):
            try:
                mode_registry.register(mode_factory())
            except Exception as e:
                logger.warning(f"注册配置模式插件失败: {e}")

        for tool_factory in self.discover_entry_points("flowforge.tools"):
            try:
                tool_registry.register(tool_factory())
            except Exception as e:
                logger.warning(f"注册工具插件失败: {e}")
        for tool_factory in self._config_results.get("tools", []):
            try:
                tool_registry.register(tool_factory())
            except Exception as e:
                logger.warning(f"注册配置工具插件失败: {e}")

        for agent_factory in self.discover_entry_points("flowforge.agents"):
            try:
                agent_inst = agent_factory()
                agent_registry.register_agent(agent_inst.name, agent_factory)
            except Exception as e:
                logger.warning(f"注册Agent插件失败: {e}")
        for agent_factory in self._config_results.get("agents", []):
            try:
                agent_inst = agent_factory()
                agent_registry.register_agent(agent_inst.name, agent_factory)
            except Exception as e:
                logger.warning(f"注册配置Agent插件失败: {e}")

    def get_status(self) -> dict:
        return {"loaded": self._loaded}
