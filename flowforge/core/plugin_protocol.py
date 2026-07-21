"""Plugin Protocol V3 — four hooks for the self-evolution layer.

V3 hooks (additive over V2):
1. register_forgekins(forgekin_registry) — register forgekin (灵族) classes
2. register_forge_skills(skill_registry) — register forge skill (灵技) descriptors
3. register_council_channels(council_registry) — register council (灵议) channels
4. register_auto_forge_config(auto_forge_registry) — register auto-forge (灵锻) config

Per TIP-032 (see docs/TIPS.md): each V3 hook targets a DIFFERENT registry.
Previous versions incorrectly routed all four hooks to ForgekinRegistry —
that bug caused skill descriptors to masquerade as forgekins and vice versa.

Boundary铁律: flowforge defines this protocol but does NOT import any *forge.
*Forge plugins implement this protocol and register themselves at runtime.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from flowforge.core.errors import PluginError
from flowforge.core.tracing import get_logger

if TYPE_CHECKING:
    # Avoid runtime cycles — these are only for type hints.
    from flowforge.core.registries import (
        AutoForgeRegistry,
        CouncilRegistry,
        SkillRegistry,
    )
    from flowforge.forgemind.registry import ForgekinRegistry

logger = get_logger("flowforge.core.plugin_protocol")

__all__ = [
    "PluginProtocol",
    "PluginV3Hooks",
    "PluginContext",
    "PluginManager",
    "PluginV3Registries",
]


@runtime_checkable
class PluginV3Hooks(Protocol):
    """V3 hooks — implemented by *Forge plugins to participate in self-evolution.

    Each hook receives its OWN registry type (TIP-032 fix). Plugins MUST NOT
    assume all four registries are the same instance.
    """

    def register_forgekins(self, registry: "ForgekinRegistry") -> None: ...

    def register_forge_skills(self, registry: "SkillRegistry") -> None: ...

    def register_council_channels(self, registry: "CouncilRegistry") -> None: ...

    def register_auto_forge_config(self, registry: "AutoForgeRegistry") -> None: ...


class PluginProtocol(ABC):
    """Base class for plugin implementations.

    Subclasses MUST implement plugin_id and at least the four V3 hooks.
    V2 hooks (register_agents, register_tools) remain optional for back-compat.
    """

    plugin_id: str = ""
    plugin_version: str = "0.0.0"
    plugin_description: str = ""

    @abstractmethod
    def register_forgekins(self, registry: "ForgekinRegistry") -> None:
        """Register forgekin (灵族) classes that this plugin contributes.

        Targets ForgekinRegistry — never a SkillRegistry or CouncilRegistry.
        """

    @abstractmethod
    def register_forge_skills(self, registry: "SkillRegistry") -> None:
        """Register forge skill (灵技) descriptors.

        Targets SkillRegistry — NOT ForgekinRegistry. A skill is a reusable
        capability card, not a forgekin. (TIP-032 fix)
        """

    @abstractmethod
    def register_council_channels(self, registry: "CouncilRegistry") -> None:
        """Register council (灵议) channels for cross-vendor review.

        Targets CouncilRegistry — NOT ForgekinRegistry. A channel is a named
        review pathway (e.g. "security-review"), not a forgekin. (TIP-032 fix)
        """

    @abstractmethod
    def register_auto_forge_config(self, registry: "AutoForgeRegistry") -> None:
        """Register auto-forge (灵锻) configuration for self-evolution.

        Targets AutoForgeRegistry — NOT ForgekinRegistry. A config entry
        describes distillation policy for a domain, not a forgekin. (TIP-032 fix)
        """

    # V2 back-compat hooks (optional)
    def register_agents(self) -> list[dict[str, Any]]:
        return []

    def register_tools(self) -> list[dict[str, Any]]:
        return []

    def __repr__(self) -> str:
        return f"<Plugin {self.plugin_id} v{self.plugin_version}>"


class PluginContext:
    """Runtime context passed to plugins during initialization."""

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        container: Any | None = None,
    ) -> None:
        self.config = config or {}
        self.container = container


class PluginV3Registries:
    """Bundle of the four V3 registries — passed to invoke_v3_hooks.

    This bundle exists so PluginManager.invoke_v3_hooks() does not need to
    grow a four-argument signature; it receives one bundle and dispatches
    each hook with the correct registry.
    """

    def __init__(
        self,
        forgekin_registry: "ForgekinRegistry",
        skill_registry: "SkillRegistry",
        council_registry: "CouncilRegistry",
        auto_forge_registry: "AutoForgeRegistry",
    ) -> None:
        self.forgekin_registry = forgekin_registry
        self.skill_registry = skill_registry
        self.council_registry = council_registry
        self.auto_forge_registry = auto_forge_registry


class PluginManager:
    """Discovers and registers plugins implementing PluginProtocol."""

    def __init__(self) -> None:
        self._plugins: dict[str, PluginProtocol] = {}

    def register(self, plugin: PluginProtocol, context: PluginContext | None = None) -> None:
        if not plugin.plugin_id:
            raise PluginError("Plugin must declare a non-empty plugin_id")
        if plugin.plugin_id in self._plugins:
            raise PluginError(f"Plugin {plugin.plugin_id!r} already registered")
        self._plugins[plugin.plugin_id] = plugin
        logger.info(f"plugin registered: {plugin.plugin_id} v{plugin.plugin_version}")

    def get(self, plugin_id: str) -> PluginProtocol:
        if plugin_id not in self._plugins:
            raise PluginError(f"Plugin {plugin_id!r} not found")
        return self._plugins[plugin_id]

    def list_plugins(self) -> list[str]:
        return list(self._plugins.keys())

    def invoke_v3_hooks(self, registries: PluginV3Registries) -> None:
        """Invoke all four V3 hooks on every registered plugin.

        Each hook receives its OWN registry from the bundle (TIP-032 fix).
        """
        for plugin in self._plugins.values():
            try:
                plugin.register_forgekins(registries.forgekin_registry)
                plugin.register_forge_skills(registries.skill_registry)
                plugin.register_council_channels(registries.council_registry)
                plugin.register_auto_forge_config(registries.auto_forge_registry)
                logger.debug(f"v3 hooks invoked for {plugin.plugin_id}")
            except Exception as exc:  # noqa: BLE001
                logger.exception(f"v3 hook failed for {plugin.plugin_id}")
                raise PluginError(f"V3 hook failed for {plugin.plugin_id}", cause=exc) from exc
