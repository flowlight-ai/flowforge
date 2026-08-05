"""Enhanced Plugin Manager — supports entry_points discovery and package management.

Extends the original PluginManager with:
- Discovery of plugins registered via setuptools entry_points (``flowforge.plugins`` group)
- Installation of plugin packages from PyPI
- Uninstallation of plugin packages
- Listing of all discovered plugins with metadata
"""

import importlib
import importlib.metadata
import subprocess
import sys
from collections.abc import Callable

from flowforge.core.errors import ConfigurationError
from flowforge.core.tracing import get_logger

logger = get_logger("plugin_manager")


class PluginManager:
    """Manages plugin discovery, installation, and lifecycle.

    Combines two discovery mechanisms:
    1. **Config-based**: plugins declared in YAML config (legacy)
    2. **Entry-points**: plugins registered via ``flowforge.plugins`` group

    Also supports installing/uninstalling plugin packages from PyPI.
    """

    ENTRY_POINT_GROUP = "flowforge.plugins"

    def __init__(self):
        self._loaded: dict[str, list[str]] = {
            "modes": [], "agents": [], "tools": [], "workflows": [],
        }
        self._config_results: dict[str, list[Callable]] = {}
        self._installed_plugins: dict[str, dict] = {}
        self._discover_entry_points()

    # ── Entry-points discovery ─────────────────────────────────────

    def _discover_entry_points(self):
        """Discover plugins registered via setuptools entry_points."""
        try:
            eps = importlib.metadata.entry_points()
            if hasattr(eps, 'select'):
                plugin_eps = eps.select(group=self.ENTRY_POINT_GROUP)
            else:
                plugin_eps = eps.get(self.ENTRY_POINT_GROUP, [])

            for ep in plugin_eps:
                self._installed_plugins[ep.name] = {
                    "name": ep.name,
                    "entry_point": f"{ep.module}:{ep.attr}",
                    "module": ep.module,
                    "attr": ep.attr,
                    "source": "entry_point",
                }
                logger.info(f"Discovered plugin via entry_point: {ep.name} -> {ep.module}:{ep.attr}")
        except Exception as e:
            logger.warning(f"Failed to discover entry_points: {e}")

    def list_available_plugins(self) -> list[dict]:
        """List all discovered plugins (from entry_points)."""
        return list(self._installed_plugins.values())

    def get_plugin_class(self, name: str) -> type | None:
        """Load and return the plugin class for a given name.

        Args:
            name: Plugin name as registered via entry_point.

        Returns:
            The plugin class, or None if not found / failed to load.
        """
        info = self._installed_plugins.get(name)
        if not info:
            return None

        try:
            module = importlib.import_module(info["module"])
            cls = getattr(module, info["attr"])
            return cls
        except Exception as e:
            logger.error(f"Failed to load plugin class for {name}: {e}")
            return None

    # ── Package management ─────────────────────────────────────────

    def install_plugin(self, package_name: str) -> dict:
        """Install a plugin package from PyPI.

        Args:
            package_name: PyPI package name (e.g., 'flowforge-plugin-weather')

        Returns:
            dict with installation status and details.
        """
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "install", package_name],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode == 0:
                # Re-discover entry points after install
                self._discover_entry_points()
                return {"status": "success", "package": package_name, "output": result.stdout}
            else:
                return {"status": "error", "package": package_name, "error": result.stderr}
        except subprocess.TimeoutExpired:
            return {"status": "error", "package": package_name, "error": "Installation timed out"}
        except Exception as e:
            return {"status": "error", "package": package_name, "error": str(e)}

    def uninstall_plugin(self, package_name: str) -> dict:
        """Uninstall a plugin package.

        Args:
            package_name: PyPI package name to uninstall.

        Returns:
            dict with uninstallation status.
        """
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "uninstall", "-y", package_name],
                capture_output=True, text=True, timeout=60,
            )
            if result.returncode == 0:
                # Remove from discovered plugins
                to_remove = [
                    name for name, info in self._installed_plugins.items()
                    if package_name in info.get("module", "")
                ]
                for name in to_remove:
                    del self._installed_plugins[name]
                return {"status": "success", "package": package_name}
            else:
                return {"status": "error", "package": package_name, "error": result.stderr}
        except Exception as e:
            return {"status": "error", "package": package_name, "error": str(e)}

    # ── Legacy: entry_points discovery for modes/agents/tools ──────

    def discover_entry_points(self, group: str) -> list[Callable]:
        """Discover and load entry_points for a given group (legacy)."""
        factories = []
        try:
            eps = importlib.metadata.entry_points()
            if hasattr(eps, 'select'):
                eps = eps.select(group=group)
            else:
                eps = eps.get(group, [])
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

    # ── Legacy: config-based loading ───────────────────────────────

    def load_from_config(self, config: dict) -> dict[str, list[Callable]]:
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
                        logger.debug(f"配置加载插件失败 {module_path}: {e}")
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

    # ── Legacy: register_all ───────────────────────────────────────

    def register_all(self, mode_registry, agent_registry, tool_registry):
        for mode_factory in self.discover_entry_points("flowforge.modes"):
            try:
                mode_registry.register(mode_factory())
            except Exception as e:
                logger.debug(f"注册模式插件失败: {e}")
        for mode_factory in self._config_results.get("modes", []):
            try:
                mode_registry.register(mode_factory())
            except Exception as e:
                logger.debug(f"注册配置模式插件失败: {e}")

        for tool_factory in self.discover_entry_points("flowforge.tools"):
            try:
                tool_registry.register(tool_factory())
            except Exception as e:
                logger.debug(f"Skip tool from entry_points: {e}")
        for tool_factory in self._config_results.get("tools", []):
            try:
                tool_registry.register(tool_factory())
            except Exception as e:
                logger.debug(f"Skip tool from config: {e}")

        for agent_factory in self.discover_entry_points("flowforge.agents"):
            try:
                agent_inst = agent_factory()
                agent_registry.register_factory(agent_inst.name, agent_factory)
            except Exception as e:
                logger.debug(f"Skip agent from entry_points: {e}")
        for agent_factory in self._config_results.get("agents", []):
            try:
                agent_inst = agent_factory()
                agent_registry.register_factory(agent_inst.name, agent_factory)
            except Exception as e:
                logger.debug(f"Skip agent from config: {e}")

    def get_status(self) -> dict:
        return {"loaded": self._loaded}
