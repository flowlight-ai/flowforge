"""Plugin lifecycle manager — hot load, unload, pause, resume, reload.

Manages the full lifecycle of protocol-based plugins:
- Track registered entries per plugin (agents, tools, routes, events, schedules)
- Unload: remove all registered entries, call on_shutdown
- Reload: unload then load
- Pause: stop event handlers and schedules, keep agents/tools/routes
- Resume: restart event handlers and schedules
"""

from __future__ import annotations

from typing import Any

from flowforge.core.plugin_protocol import FlowForgePlugin, PluginContext, PluginState
from flowforge.core.tracing import get_logger

logger = get_logger("plugin_lifecycle")


class PluginRegistrationRecord:
    """Tracks what a plugin has registered, for clean unloading."""

    def __init__(self, plugin_name: str):
        self.plugin_name = plugin_name
        self.agent_names: list[str] = []
        self.tool_names: list[str] = []
        self.mode_names: list[str] = []
        self.route_prefixes: list[str] = []
        self.event_subscriptions: list[tuple] = []  # (event_type, handler)
        self.schedule_ids: list[str] = []
        self.middleware_added: bool = False
        # V2 tracking
        self.workflow_names: list[str] = []
        self.gate_names: list[str] = []
        self.evaluator_names: list[str] = []
        self.sop_names: list[str] = []
        self.quality_gate_names: list[str] = []
        self.context_layer_names: list[str] = []
        self.step_handler_names: list[str] = []

    def summary(self) -> dict[str, Any]:
        return {
            "plugin": self.plugin_name,
            "agents": len(self.agent_names),
            "tools": len(self.tool_names),
            "modes": len(self.mode_names),
            "routes": len(self.route_prefixes),
            "event_subscriptions": len(self.event_subscriptions),
            "schedules": len(self.schedule_ids),
            "workflows": len(self.workflow_names),
            "gates": len(self.gate_names),
            "evaluators": len(self.evaluator_names),
            "sops": len(self.sop_names),
            "quality_gates": len(self.quality_gate_names),
            "context_layers": len(self.context_layer_names),
            "step_handlers": len(self.step_handler_names),
        }


class PluginLifecycleManager:
    """Manages plugin lifecycle: load, unload, reload, pause, resume."""

    def __init__(
        self,
        agent_registry=None,
        tool_registry=None,
        mode_registry=None,
        event_bus=None,
        scheduler=None,
        app=None,
        llm_client=None,
        config=None,
        memory_manager=None,
        model_service=None,
        plugin_registry=None,
        event_store=None,
    ):
        self._agent_registry = agent_registry
        self._tool_registry = tool_registry
        self._mode_registry = mode_registry
        self._event_bus = event_bus
        self._scheduler = scheduler
        self._app = app
        self._llm_client = llm_client
        self._config = config
        self._memory_manager = memory_manager
        self._model_service = model_service
        self._plugin_registry = plugin_registry
        self._event_store = event_store

        self._plugins: dict[str, FlowForgePlugin] = {}
        self._states: dict[str, PluginState] = {}
        self._records: dict[str, PluginRegistrationRecord] = {}
        self._contexts: dict[str, PluginContext] = {}

    def register_plugin(self, plugin: FlowForgePlugin) -> None:
        """Register a loaded plugin and track its state."""
        self._plugins[plugin.name] = plugin
        self._states[plugin.name] = PluginState.READY
        # Build a record from the plugin's own tracking lists
        record = PluginRegistrationRecord(plugin.name)
        record.agent_names = list(plugin._registered_agents)
        record.tool_names = list(plugin._registered_tools)
        record.event_subscriptions = list(plugin._registered_event_handlers)
        record.schedule_ids = list(plugin._registered_schedules)
        self._records[plugin.name] = record

    def store_context(self, plugin_name: str, context: PluginContext) -> None:
        """Store a plugin's context for later use (reload, shutdown)."""
        self._contexts[plugin_name] = context

    def get_plugin(self, name: str) -> FlowForgePlugin | None:
        return self._plugins.get(name)

    def get_state(self, name: str) -> PluginState | None:
        return self._states.get(name)

    def get_record(self, name: str) -> PluginRegistrationRecord | None:
        return self._records.get(name)

    def list_plugins(self) -> list[dict[str, Any]]:
        """List all managed plugins with their state."""
        result = []
        for name, plugin in self._plugins.items():
            state = self._states.get(name, PluginState.UNINITIALIZED)
            record = self._records.get(name)
            entry = {
                "name": name,
                "version": plugin.version,
                "state": state.value,
                "health": plugin.health_check(),
            }
            if record:
                entry["registrations"] = record.summary()
            result.append(entry)
        return result

    async def unload_plugin(self, name: str) -> dict[str, Any]:
        """Unload a plugin: call on_shutdown, remove all registrations."""
        plugin = self._plugins.get(name)
        if not plugin:
            return {"status": "error", "error": f"Plugin '{name}' not found"}

        state = self._states.get(name)
        if state not in (PluginState.READY, PluginState.PAUSED, PluginState.ERROR):
            return {"status": "error", "error": f"Plugin '{name}' is in state {state.value}, cannot unload"}

        self._states[name] = PluginState.STOPPING
        record = self._records.get(name, PluginRegistrationRecord(name))
        removed: dict[str, Any] = {}

        try:
            # 1. Call on_shutdown
            ctx = self._contexts.get(name, {})
            plugin.on_shutdown(ctx if isinstance(ctx, dict) else {"context": ctx})

            # 2. Remove agents
            if self._agent_registry and record.agent_names:
                for agent_name in record.agent_names:
                    try:
                        self._agent_registry.unregister(agent_name)
                        removed.setdefault("agents", []).append(agent_name)
                    except Exception as e:
                        logger.warning(f"Failed to unregister agent '{agent_name}': {e}")

            # 3. Remove tools
            if self._tool_registry and record.tool_names:
                for tool_name in record.tool_names:
                    try:
                        self._tool_registry.unregister(tool_name)
                        removed.setdefault("tools", []).append(tool_name)
                    except Exception as e:
                        logger.warning(f"Failed to unregister tool '{tool_name}': {e}")

            # 4. Remove modes
            if self._mode_registry and record.mode_names:
                for mode_name in record.mode_names:
                    try:
                        self._mode_registry.unregister(mode_name)
                        removed.setdefault("modes", []).append(mode_name)
                    except Exception as e:
                        logger.warning(f"Failed to unregister mode '{mode_name}': {e}")

            # 5. Remove event subscriptions
            if self._event_bus and record.event_subscriptions:
                for event_type, handler in record.event_subscriptions:
                    try:
                        self._event_bus.unsubscribe(event_type, handler)
                        removed.setdefault("events", []).append(event_type)
                    except Exception as e:
                        logger.warning(f"Failed to unsubscribe from '{event_type}': {e}")

            # 6. Remove schedules
            if self._scheduler and record.schedule_ids:
                for schedule_id in record.schedule_ids:
                    try:
                        self._scheduler.remove_job(schedule_id)
                        removed.setdefault("schedules", []).append(schedule_id)
                    except Exception as e:
                        logger.warning(f"Failed to remove schedule '{schedule_id}': {e}")

            # 7. Remove routes — FastAPI doesn't support easy route removal,
            #    but we can mark them as disabled via middleware.
            #    For now, log a warning.
            if record.route_prefixes:
                logger.warning(
                    f"Routes registered by '{name}' ({record.route_prefixes}) "
                    f"cannot be fully removed at runtime. Restart recommended."
                )

            self._states[name] = PluginState.STOPPED
            logger.info(f"Plugin '{name}' unloaded successfully. Removed: {removed}")

            return {"status": "success", "plugin": name, "removed": removed}

        except Exception as e:
            self._states[name] = PluginState.ERROR
            logger.error(f"Failed to unload plugin '{name}': {e}", exc_info=True)
            return {"status": "error", "error": str(e)}

    async def reload_plugin(self, name: str) -> dict[str, Any]:
        """Reload a plugin: unload then load."""
        plugin = self._plugins.get(name)
        if not plugin:
            return {"status": "error", "error": f"Plugin '{name}' not found"}

        # Unload
        unload_result = await self.unload_plugin(name)
        if unload_result.get("status") != "success":
            return unload_result

        # Re-register
        try:
            self._register_plugin(plugin)
            self._states[name] = PluginState.READY
            # Update the record from plugin's own tracking
            record = PluginRegistrationRecord(name)
            record.agent_names = list(plugin._registered_agents)
            record.tool_names = list(plugin._registered_tools)
            record.event_subscriptions = list(plugin._registered_event_handlers)
            record.schedule_ids = list(plugin._registered_schedules)
            self._records[name] = record
            logger.info(f"Plugin '{name}' reloaded successfully")
            return {"status": "success", "plugin": name, "action": "reloaded"}
        except Exception as e:
            self._states[name] = PluginState.ERROR
            logger.error(f"Failed to reload plugin '{name}': {e}", exc_info=True)
            return {"status": "error", "error": str(e)}

    async def pause_plugin(self, name: str) -> dict[str, Any]:
        """Pause a plugin: stop event handlers and schedules, keep agents/tools."""
        plugin = self._plugins.get(name)
        if not plugin:
            return {"status": "error", "error": f"Plugin '{name}' not found"}

        state = self._states.get(name)
        if state != PluginState.READY:
            return {"status": "error", "error": f"Plugin '{name}' is in state {state.value}, cannot pause"}

        record = self._records.get(name, PluginRegistrationRecord(name))

        # Remove event subscriptions temporarily
        if self._event_bus and record.event_subscriptions:
            for event_type, handler in record.event_subscriptions:
                try:
                    self._event_bus.unsubscribe(event_type, handler)
                except Exception as e:
                    logger.warning(f"Failed to unsubscribe from '{event_type}': {e}")

        # Pause schedules
        if self._scheduler and record.schedule_ids:
            for schedule_id in record.schedule_ids:
                try:
                    self._scheduler.pause_job(schedule_id)
                except Exception as e:
                    logger.warning(f"Failed to pause schedule '{schedule_id}': {e}")

        self._states[name] = PluginState.PAUSED
        logger.info(f"Plugin '{name}' paused (agents/tools/routes still active)")
        return {"status": "success", "plugin": name, "state": "paused"}

    async def resume_plugin(self, name: str) -> dict[str, Any]:
        """Resume a paused plugin: restart event handlers and schedules."""
        plugin = self._plugins.get(name)
        if not plugin:
            return {"status": "error", "error": f"Plugin '{name}' not found"}

        state = self._states.get(name)
        if state != PluginState.PAUSED:
            return {"status": "error", "error": f"Plugin '{name}' is in state {state.value}, cannot resume"}

        # Re-register event handlers
        if self._event_bus:
            plugin.register_event_handlers(self._event_bus)

        # Resume schedules
        record = self._records.get(name, PluginRegistrationRecord(name))
        if self._scheduler and record.schedule_ids:
            for schedule_id in record.schedule_ids:
                try:
                    self._scheduler.resume_job(schedule_id)
                except Exception as e:
                    logger.warning(f"Failed to resume schedule '{schedule_id}': {e}")

        self._states[name] = PluginState.READY
        logger.info(f"Plugin '{name}' resumed")
        return {"status": "success", "plugin": name, "state": "ready"}

    def _register_plugin(self, plugin: FlowForgePlugin) -> None:
        """Re-register a plugin's entries (used during reload)."""
        if self._app:
            plugin.register_middleware(self._app)
        if self._agent_registry:
            plugin.register_agents(self._agent_registry)
        if self._tool_registry:
            plugin.register_tools(self._tool_registry)
        if self._mode_registry:
            plugin.register_modes(self._mode_registry)
        if self._app:
            plugin.register_routes(self._app)
        if self._event_bus:
            plugin.register_event_handlers(self._event_bus)
        if self._scheduler:
            plugin.register_schedules(self._scheduler)

        # V2 hooks
        try:
            from flowforge.sdk import (
                ContextLayerRegistry,
                EvaluatorRegistry,
                GateRegistry,
                QualityGateRegistry,
                SOPRegistry,
                WorkflowRegistry,
                WorkflowStepHandlerRegistry,
            )
            # Use SDK shared instances to avoid isolation from SDK's lazy-loaded registries
            try:
                from flowforge.sdk import FlowForgeSDK as _FFSDK
                _sdk = _FFSDK._current_instance if hasattr(_FFSDK, '_current_instance') else None
            except Exception:
                _sdk = None
            plugin.register_workflows(_sdk.workflows if _sdk else WorkflowRegistry())
            plugin.register_gates(_sdk.gates if _sdk else GateRegistry())
            plugin.register_evaluators(_sdk.evaluators if _sdk else EvaluatorRegistry())
            plugin.register_sops(_sdk.sops if _sdk else SOPRegistry())
            plugin.register_quality_gates(_sdk.quality_gates if _sdk else QualityGateRegistry())
            plugin.register_context_layers(_sdk.context_layers if _sdk else ContextLayerRegistry())
            plugin.register_workflow_step_handler(_sdk.step_handlers if _sdk else WorkflowStepHandlerRegistry())
        except ImportError:
            pass

        # V2 Persona/Prompt/DeclarativeTool hooks
        try:
            from flowforge.sdk import PersonaRegistry, PromptManager
            plugin.register_personas(PersonaRegistry())
            plugin.register_prompts(PromptManager())
        except ImportError:
            pass

        # Declarative tools use the same tool_registry
        if self._tool_registry:
            plugin.register_declarative_tools(self._tool_registry)
