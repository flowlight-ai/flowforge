"""FlowForge Plugin Protocol — abstract base class for business plugins.

Business projects subclass ``FlowForgePlugin`` and override the lifecycle
methods they need.  All methods are optional (no-op by default), so a
minimal plugin only needs to implement what it cares about.

The framework discovers plugins via the ``FLOWFORGE_DOMAIN_MODULE`` env var
(or ``system.domain_modules`` in config).  If the module exposes a ``Plugin``
class that inherits from ``FlowForgePlugin``, the framework instantiates it
and calls the lifecycle methods in a well-defined order.

Backward compatibility: modules that only define ``register_agents`` /
``register_tools`` top-level functions continue to work.
"""

from __future__ import annotations

import copy
from abc import ABC
from enum import Enum
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    pass


class PluginState(Enum):
    """Plugin lifecycle states.

    State transitions:
        UNINITIALIZED → STARTING → READY → STOPPING → STOPPED
        STARTING → ERROR
        READY → PAUSED → READY
        READY → STOPPING → STOPPED
    """

    UNINITIALIZED = "uninitialized"
    STARTING = "starting"
    READY = "ready"
    PAUSED = "paused"
    STOPPING = "stopping"
    STOPPED = "stopped"
    ERROR = "error"


class PluginManifest:
    """Unified plugin metadata — covers both business and tool plugins.

    Plugins can optionally define a ``manifest`` class attribute to declare
    their metadata, dependencies, and configuration schema.

    Event naming convention: use ``domain.action`` format, e.g.
    ``task.completed``, ``tool.start``, ``plugin.loaded``.
    """

    def __init__(
        self,
        # ── Basic metadata ──────────────────────────────────────────
        name: str = "",
        version: str = "0.1.0",
        description: str = "",
        author: str = "",
        license: str = "",
        homepage: str = "",
        # ── Dependencies and compatibility ───────────────────────────
        dependencies: list[str] | None = None,
        optional_dependencies: list[str] | None = None,
        min_framework_version: str = "",
        max_framework_version: str = "",
        # ── Configuration ────────────────────────────────────────────
        config_schema: dict[str, Any] | None = None,
        # ── Load control ─────────────────────────────────────────────
        priority: int = 100,
        # ── Tool plugin fields ───────────────────────────────────────
        transport: str = "local",  # local, mcp, openapi, graphql
        entry_point: str = "",
        endpoint: str = "",
        api_key_env: str = "",
        safety_level: str = "normal",  # readonly, normal, dangerous
        tags: list[str] | None = None,
        health_endpoint: str = "",
        health_interval: int = 300,
        # ── Frontend extension ───────────────────────────────────────
        frontend_entry: str = "",
        mount_points: list[str] | None = None,
        # ── V2 resource directories ──────────────────────────────────
        personas_dir: str | None = None,
        prompts_dir: str | None = None,
        tools_dir: str | None = None,
        # ── V3 ForgeMind / Forgekin (v7.0 Forge Nurturing体系) ───────────────────
        # Forgekin形态（ForgekinSpecies Forgekin Species）：bio / org / obj / virtual / hybrid
        # 详见 [doc:design/naming-contract.md#2.3]
        forgekin_species: str = "",
        # 进化阶 E1-E6（能力成熟度），详见 [doc:design/naming-contract.md#3]
        evolution_stage: str = "E1",
        # 觉醒阶 E1-E6（自主性等级），详见 [doc:design/naming-contract.md#4]
        awakening_stage: str = "E1",
        # ForgekinSpecies配置目录（forgemind 应用层专用）
        forgekins_dir: str | None = None,
        # 锻典（Mind Codex）目录
        codex_dir: str | None = None,
        # MindCouncil（Mind Council）配置目录
        council_dir: str | None = None,
        # 自我进化配置目录（F100 Mode A/B/C）
        auto_forge_dir: str | None = None,
    ):
        self.name = name
        self.version = version
        self.description = description
        self.author = author
        self.license = license
        self.homepage = homepage
        self.dependencies = dependencies or []
        self.optional_dependencies = optional_dependencies or []
        self.min_framework_version = min_framework_version
        self.max_framework_version = max_framework_version
        self.config_schema = config_schema or {}
        self.priority = priority  # Lower = loaded first
        self.transport = transport
        self.entry_point = entry_point
        self.endpoint = endpoint
        self.api_key_env = api_key_env
        self.safety_level = safety_level
        self.tags = tags or []
        self.health_endpoint = health_endpoint
        self.health_interval = health_interval
        self.frontend_entry = frontend_entry
        self.mount_points = mount_points or []
        self.personas_dir = personas_dir
        self.prompts_dir = prompts_dir
        self.tools_dir = tools_dir
        # V3 ForgeMind / Forgekin fields
        self.forgekin_species = forgekin_species
        self.evolution_stage = evolution_stage
        self.awakening_stage = awakening_stage
        self.forgekins_dir = forgekins_dir
        self.codex_dir = codex_dir
        self.council_dir = council_dir
        self.auto_forge_dir = auto_forge_dir


class PluginContext:
    """Dependency injection container for plugins — typed access to framework services.

    Provides access to framework services and the plugin's own configuration.
    Passed to all registration and lifecycle hooks.
    """

    def __init__(
        self,
        agent_registry: Any,
        tool_registry: Any,
        mode_registry: Any,
        event_bus: Any,
        scheduler: Any,
        app: Any,
        llm_client: Any = None,
        config: Any = None,
        plugin_config: dict[str, Any] | None = None,
        memory_manager: Any | None = None,
        model_service: Any | None = None,
        plugin_registry: Any | None = None,
        event_store: Any | None = None,
        # V3 ForgeMind / Forgekin registries (v7.0 Forge Nurturing体系)
        # 详见 [doc:decisions/005-forgemind-application-layer.md]
        forgekin_registry: Any | None = None,
        council_registry: Any | None = None,
        auto_forge_engine: Any | None = None,
        codex_registry: Any | None = None,
        pack_registry: Any | None = None,
    ):
        self._agent_registry = agent_registry
        self._tool_registry = tool_registry
        self._mode_registry = mode_registry
        self._event_bus = event_bus
        self._scheduler = scheduler
        self._app = app
        self._llm_client = llm_client
        self._config = config
        self._plugin_config = plugin_config or {}
        self._memory_manager = memory_manager
        self._model_service = model_service
        self._plugin_registry = plugin_registry
        self._event_store = event_store
        # V3 ForgeMind / Forgekin registries
        self._forgekin_registry = forgekin_registry
        self._council_registry = council_registry
        self._auto_forge_engine = auto_forge_engine
        self._codex_registry = codex_registry
        self._pack_registry = pack_registry
        self._services: dict[str, Any] = {}

    @property
    def agent_registry(self) -> Any:
        """Access the agent registry to register/discover agents."""
        return self._agent_registry

    @property
    def tool_registry(self) -> Any:
        """Access the tool registry to register/discover tools."""
        return self._tool_registry

    @property
    def mode_registry(self) -> Any:
        """Access the mode registry to register/discover execution modes."""
        return self._mode_registry

    @property
    def event_bus(self) -> Any:
        """Access the event bus to subscribe/publish events."""
        return self._event_bus

    @property
    def scheduler(self) -> Any:
        """Access the task scheduler to register cron jobs."""
        return self._scheduler

    @property
    def app(self) -> Any:
        """Access the FastAPI app instance to mount routes/middleware."""
        return self._app

    @property
    def llm_client(self) -> Any:
        """Access the shared LLM client for making LLM calls."""
        return self._llm_client

    @property
    def config(self) -> Any:
        """Access the system configuration."""
        return self._config

    @property
    def plugin_config(self) -> dict[str, Any]:
        """Access this plugin's own configuration section.

        Loaded from the plugin's section in default.yaml, e.g.:

            contentforge:
              default_persona: "education"
              ...
        """
        return self._plugin_config

    @property
    def memory_manager(self) -> Any | None:
        """Access the memory manager for persistent storage."""
        return self._memory_manager

    @property
    def model_service(self) -> Any | None:
        """Access the model service for health checks and model routing."""
        return self._model_service

    @property
    def plugin_registry(self) -> Any | None:
        """Access the plugin registry for tool plugin management."""
        return self._plugin_registry

    @property
    def event_store(self) -> Any | None:
        """Access the event store for WAL-mode event persistence and replay."""
        return self._event_store

    # ── V3 ForgeMind / Forgekin accessors (v7.0 Forge Nurturing体系) ───────────

    @property
    def forgekin_registry(self) -> Any | None:
        """Access the forgekin registry (Forgekin注册表) for registering/discovering Forgekin.

        详见 [doc:decisions/005-forgemind-application-layer.md] 和
        [doc:design/naming-contract.md#2.2]
        """
        return self._forgekin_registry

    @property
    def council_registry(self) -> Any | None:
        """Access the council registry (MindCouncil注册表) for multi-forgekin deliberation.

        详见 [doc:design/naming-contract.md#2.9]
        """
        return self._council_registry

    @property
    def auto_forge_engine(self) -> Any | None:
        """Access the auto-forge engine (自我进化引擎) for Mode A/B/C self-evolution.

        详见 [doc:review/review.md#13.1] F100 自我进化三模式
        """
        return self._auto_forge_engine

    @property
    def codex_registry(self) -> Any | None:
        """Access the codex registry (锻典注册表) for distilled knowledge base.

        详见 [doc:design/naming-contract.md#2.8]
        """
        return self._codex_registry

    @property
    def pack_registry(self) -> Any | None:
        """Access the pack registry (Pack 共享注册表) for portable experience units.

        详见 [doc:review/review.md#13.4] ADR-021 Pack 系统
        """
        return self._pack_registry

    def register_service(self, name: str, service: Any) -> None:
        """Register a named service for plugin access."""
        self._services[name] = service

    def get_service(self, name: str) -> Any | None:
        """Get a named service — checks registered services first, then built-in."""
        if name in self._services:
            return self._services[name]
        return getattr(self, f"_{name}", None)


class FlowForgePlugin(ABC):
    """Base class for FlowForge business plugins.

    Business projects subclass this and override the methods they need.
    All methods are optional (no-op by default).

    Plugins can declare a ``manifest`` class attribute for metadata:

        class Plugin(FlowForgePlugin):
            manifest = PluginManifest(
                name="my_project",
                version="1.0.0",
                dependencies=["other_plugin"],
                priority=50,
            )
    """

    manifest: PluginManifest = PluginManifest()

    def __init__(self):
        self._state = PluginState.UNINITIALIZED
        self._registered_agents: list[str] = []
        self._registered_tools: list[str] = []
        self._registered_routes: list[str] = []
        self._registered_event_handlers: list[tuple[str, Any]] = []
        self._registered_schedules: list[str] = []
        # V2 tracking
        self._registered_workflows: list[str] = []
        self._registered_gates: list[str] = []
        self._registered_evaluators: list[str] = []
        self._registered_sops: list[str] = []
        self._registered_quality_gates: list[str] = []
        self._registered_context_layers: list[str] = []
        self._registered_step_handlers: list[str] = []
        self._registered_loops: list[str] = []
        # V3 tracking (v7.0 Forge Nurturing体系)
        self._registered_forgekins: list[str] = []
        self._registered_forge_skills: list[str] = []
        self._registered_council_channels: list[str] = []
        self._registered_auto_forge_configs: list[str] = []

    @property
    def state(self) -> PluginState:
        """Current lifecycle state of the plugin."""
        return self._state

    @state.setter
    def state(self, value: PluginState) -> None:
        self._state = value

    def _track_agent(self, name: str) -> None:
        """Track a registered agent for later cleanup."""
        self._registered_agents.append(name)

    def _track_tool(self, name: str) -> None:
        """Track a registered tool for later cleanup."""
        self._registered_tools.append(name)

    def _track_event_handler(self, event_type: str, handler: Any) -> None:
        """Track a registered event handler for later cleanup."""
        self._registered_event_handlers.append((event_type, handler))

    def _track_schedule(self, job_id: str) -> None:
        """Track a registered scheduled job for later cleanup."""
        self._registered_schedules.append(job_id)

    @property
    def name(self) -> str:
        """Plugin name, from manifest or derived from module path."""
        if self.manifest.name:
            return self.manifest.name
        return self.__class__.__module__.split(".")[0]

    @property
    def version(self) -> str:
        """Plugin version string, from manifest or default."""
        return self.manifest.version

    # ── Registration hooks ──────────────────────────────────────────

    def register_middleware(self, app: Any) -> None:
        """Add custom middleware to the FastAPI app.

        Called **before** the app starts handling requests.
        """
        pass

    def register_agents(self, agent_registry: Any) -> None:
        """Register business-specific agents into the agent registry."""
        pass

    def register_tools(self, tool_registry: Any) -> None:
        """Register business-specific tools into the tool registry."""
        pass

    def register_modes(self, mode_registry: Any) -> None:
        """Register custom execution modes into the mode registry."""
        pass

    def register_routes(self, app: Any) -> None:
        """Register custom API routes on the FastAPI app."""
        pass

    def register_event_handlers(self, event_bus: Any) -> None:
        """Subscribe to framework events on the event bus."""
        pass

    def register_schedules(self, scheduler: Any) -> None:
        """Register scheduled / cron tasks on the scheduler."""
        pass

    # ── V2 Registration hooks ───────────────────────────────────────

    def register_workflows(self, workflow_registry: Any) -> None:
        """Register Workflow YAML definitions into the workflow registry.

        Plugins can define workflow YAML configurations and register them
        for the framework to discover and execute.
        """
        pass

    def register_gates(self, gate_registry: Any) -> None:
        """Register gate / access-control configurations.

        Gates control whether a workflow step or agent execution is
        allowed to proceed based on runtime conditions.
        """
        pass

    def register_evaluators(self, registry: Any) -> None:
        """Register evaluator agents into the evaluator registry.

        Evaluators assess the quality or correctness of agent outputs,
        workflow results, or other artifacts.
        """
        pass

    def register_sops(self, sop_registry: Any) -> None:
        """Register SOP (Standard Operating Procedure) definitions.

        SOPs define ordered sequences of steps that must be followed
        for a particular business process.
        """
        pass

    def register_quality_gates(self, quality_gate_registry: Any) -> None:
        """Register quality gate configurations.

        Quality gates define pass/fail criteria that must be satisfied
        before a workflow can transition to the next phase.
        """
        pass

    def register_context_layers(self, context_registry: Any) -> None:
        """Register context layers.

        Context layers provide additional contextual information
        (e.g., persona, domain knowledge) that agents can access
        during execution.
        """
        pass

    def register_workflow_step_handler(self, handler_registry: Any) -> None:
        """Register custom workflow step handlers.

        Step handlers define how specific workflow step types are
        executed, allowing plugins to extend the workflow engine
        with custom step logic.
        """
        pass

    def register_loops(self, loop_registry: Any) -> None:
        """Register loop configurations.

        Loops define iterative execution patterns that repeat
        a set of steps until a condition is met.
        """
        pass

    def register_personas(self, persona_registry: Any) -> None:
        """注册Persona配置"""
        pass

    def register_prompts(self, prompt_manager: Any) -> None:
        """注册Prompt模板"""
        pass

    def register_declarative_tools(self, tool_registry: Any) -> None:
        """注册声明式Tool"""
        pass

    # ── V3 Registration hooks (v7.0 Forge Nurturing体系 / ForgeMind) ───────────
    #
    # 这四个钩子是 v7.0 自进化层的 Plugin V3 协议入口。
    # 详见 [doc:review/review.md#13.1] F100 自我进化三模式
    # 详见 [doc:decisions/005-forgemind-application-layer.md]
    # 详见 [doc:design/naming-contract.md] 12 核心概念

    def register_forgekins(self, forgekin_registry: Any) -> None:
        """注册Forgekin（Forgekin / Spirit Agent）到Forgekin注册表。

        v7.0 Forge Nurturing体系的核心钩子之一。业务项目（如 contentforge、novelforge）
        和 forgemind 应用层通过此钩子注册自己锻造的Forgekin。

        Forgekin是"赋予灵魂和感情的智能体"——灵魂（Soul）= 持久身份 + 价值锚点
        + 长期记忆；感情（Emotion）= 用户偏好 + 协作风格 + 行为画像。

        详见:
        - [doc:design/naming-contract.md#2.2] Forgekin定义
        - [doc:decisions/005-forgemind-application-layer.md]
        - [doc:review/review.md#第九章] forgemind 应用层补审

        示例::

            def register_forgekins(self, forgekin_registry):
                forgekin_registry.register(
                    name="contentforge:writer",
                    species=ForgekinSpecies.VIRTUAL,  # ForgekinSpecies分类
                    evolution_stage=EvolutionStage.E3,  # 进化阶
                    awakening_stage=AwakeningStage.E2,  # 觉醒阶
                    capability_profile=self._build_writer_profile(),
                    soul_imprint=self._compute_soul_imprint(),
                )
                self._track_forgekin("contentforge:writer")
        """
        pass

    def register_forge_skills(self, skill_registry: Any) -> None:
        """注册Forgekin技能（Forge Skills）到技能注册表。

        Forgekin技能是可被Forgekin加载的能力包，包括：
        - 内置技能（来自 FlowForge 核心框架）
        - 三方 Agent 技能（如 claude code / codex / opencode / trae）
        - 自蒸馏技能（来自SpiritForge SpiritForge 产出的锻典条目）

        详见:
        - [doc:design/naming-contract.md#2.7] SpiritForge定义
        - [doc:design/naming-contract.md#2.8] 锻典定义
        - [doc:decisions/006-external-agent-integration.md] 三方 Agent 集成
        - [doc:review/review.md#13.3] F241 Agent Provider Plugin

        示例::

            def register_forge_skills(self, skill_registry):
                skill_registry.register(
                    name="contentforge:seo_optimization",
                    forgekin_id="contentforge:writer",
                    skill_type="distilled",  # native / external / distilled
                    manifest={...},
                )
                self._track_forge_skill("contentforge:seo_optimization")
        """
        pass

    def register_council_channels(self, council_registry: Any) -> None:
        """注册MindCouncil（Mind Council）渠道到MindCouncil注册表。

        MindCouncil是多Forgekin议事机制，用于解决跨Forgekin冲突、复杂决策、愿景方向校准。
        任何Forgekin可发起MindCouncil，主持Forgekin收集各方立场 + 能力画像盲点，
        跨厂商 review 后达成共识或升级给 operator。

        详见:
        - [doc:design/naming-contract.md#2.9] MindCouncil定义
        - [doc:review/review.md#13.1] F100 自我进化三模式（Mode A Scope Guard）
        - [doc:roleagent.md#第7章] 伙伴系统数学

        示例::

            def register_council_channels(self, council_registry):
                council_registry.register_channel(
                    name="contentforge:quality_review",
                    channel_type="cross_vendor_review",  # 跨厂商审核
                    participants=["contentforge:writer", "contentforge:reviewer"],
                    scope_guard=ScopeGuard(readonly_paths=["VISION.md#7"]),
                )
                self._track_council_channel("contentforge:quality_review")
        """
        pass

    def register_auto_forge_config(self, auto_forge_engine: Any) -> None:
        """注册自动锻造配置（Auto Forge Config）到自我进化引擎。

        自我进化引擎是 v7.0 Forge Nurturing体系的核心组件，支持 F100 三模式自我进化：
        - Mode A — Scope Guard（范围守卫）：防止Forgekin越权修改愿景/规范/架构
        - Mode B — Process Evolution（流程进化）：改进Forgekin自身工作方式
        - Mode C — Knowledge Evolution（知识进化）：蒸馏新知识到锻典

        每个Forgekin通过此钩子声明自己的自我进化配置：可修改范围、可进化维度、
        Eval Ledger 验证策略、五级知识成熟度阶梯晋升规则等。

        详见:
        - [doc:review/review.md#13.1] F100 自我进化三模式（CL-001~CL-006）
        - [doc:decisions/009-eval-self-metabolism.md]
        - [doc:design/naming-contract.md#2.10] 进化阶定义
        - [doc:design/naming-contract.md#2.11] 觉醒阶定义

        示例::

            def register_auto_forge_config(self, auto_forge_engine):
                auto_forge_engine.register_config(
                    forgekin_id="contentforge:writer",
                    scope_guard=ScopeGuard(
                        readonly_paths=["VISION.md#7", "rules.md#红线"],
                        writable_paths=["contentforge/config/prompts.yaml"],
                    ),
                    evolution_modes=[SelfEvolutionMode.ModeB_Process,
                                     SelfEvolutionMode.ModeC_Knowledge],
                    eval_ledger_policy=EvalLedgerPolicy(
                        replay_ab_required=True,
                        min_net_gain=0.05,
                    ),
                )
                self._track_auto_forge_config("contentforge:writer")
        """
        pass

    def _track_forgekin(self, name: str) -> None:
        """Track a registered forgekin (Forgekin) for later cleanup."""
        self._registered_forgekins.append(name)

    def _track_forge_skill(self, name: str) -> None:
        """Track a registered forge skill for later cleanup."""
        self._registered_forge_skills.append(name)

    def _track_council_channel(self, name: str) -> None:
        """Track a registered council channel (MindCouncil渠道) for later cleanup."""
        self._registered_council_channels.append(name)

    def _track_auto_forge_config(self, name: str) -> None:
        """Track a registered auto-forge config for later cleanup."""
        self._registered_auto_forge_configs.append(name)

    # ── Lifecycle hooks ─────────────────────────────────────────────

    def on_startup(self, context: dict) -> None:
        """Called after all registrations are complete."""
        pass

    def on_shutdown(self, context: dict) -> None:
        """Called on application shutdown."""
        pass

    # ── P2-019 Plugin 启停 transactional 钩子（CL-024） ────────────
    #
    # 启停事务性钩子：保证 plugin 启用/禁用操作的原子性。
    # on_activate 在 plugin 从 PAUSED/STOPPED 切换到 READY 前调用，
    # 若抛出异常则状态不切换；on_disable 在 READY 切换到 PAUSED 前调用，
    # 若抛出异常则状态不切换。
    # 详见 [doc:review/review.md#CL-024] Plugin 启停 transactional

    def on_activate(self, context: dict) -> None:
        """Called before plugin transitions to READY (activate).

        P2-019 / CL-024: 启用事务性钩子。

        抛出异常将阻止状态切换，调用方必须回滚已完成的副作用。
        默认实现为 no-op，子类按需覆盖。

        典型用途：
        - 建立数据库连接 / 加载热配置
        - 启动后台任务 / 调度器
        - 订阅事件总线
        - 注册健康检查

        Args:
            context: 含 'plugin_config' / 'services' / 'prev_state' 等键
        """
        pass

    def on_disable(self, context: dict) -> None:
        """Called before plugin transitions to PAUSED/STOPPED (disable).

        P2-019 / CL-024: 禁用事务性钩子。

        抛出异常将阻止状态切换。默认实现为 no-op，子类按需覆盖。

        典型用途：
        - 取消事件订阅
        - 停止后台任务 / 调度器
        - 刷新缓冲区 / 释放连接
        - 持久化内部状态

        Args:
            context: 含 'reason' / 'target_state' / 'services' 等键
        """
        pass

    def rollback_activate(self, context: dict) -> None:
        """回滚 on_activate 已完成的副作用（CL-024 事务性）.

        在 on_activate 抛出异常后由调用方调用，确保 plugin 状态一致。
        默认实现为 no-op，子类按需覆盖。
        """
        pass

    def rollback_disable(self, context: dict) -> None:
        """回滚 on_disable 已完成的副作用（CL-024 事务性）.

        在 on_disable 抛出异常后由调用方调用，确保 plugin 状态一致。
        默认实现为 no-op，子类按需覆盖。
        """
        pass

    def on_error(self, context: dict, error: Exception) -> None:
        """Called when an error occurs during plugin execution.

        Default implementation logs the error. Override to implement
        custom error handling (e.g., circuit breaker, fallback logic).
        """
        import logging
        logging.getLogger(self.name).error(
            f"[{self.name}] Plugin error: {error}", exc_info=True
        )

    def on_config_reload(self, config: dict) -> None:
        """Called when the plugin's configuration is reloaded.

        Override to respond to configuration changes without restart.
        """
        pass

    def on_plugin_loaded(self, plugin_name: str) -> None:
        """Called when another plugin has finished loading.

        Use this for cross-plugin initialization that depends on
        another plugin being available.
        """
        pass

    def health_check(self) -> dict:
        """Return plugin health status.

        Override to implement custom health checks.
        Returns a dict with at least 'status' key ('healthy'/'degraded'/'unhealthy').
        """
        return {"status": "healthy", "name": self.name, "version": self.version}


def validate_plugin_config(
    config: dict[str, Any], schema: dict[str, Any]
) -> tuple[bool, list[str]]:
    """Validate plugin config against its declared schema.

    Uses simple type checking (not full JSON Schema) for lightweight validation.

    Schema format::

        {
            "field_name": {"type": "string", "required": True, "default": "value"},
            "another_field": {"type": "integer", "required": False, "default": 10},
        }

    Returns (is_valid, list_of_errors).
    """
    errors: list[str] = []
    type_map: dict[str, type | tuple[type, ...]] = {
        "string": str,
        "integer": int,
        "number": (int, float),
        "boolean": bool,
        "array": list,
        "object": dict,
    }

    for field_name, field_spec in schema.items():
        field_type = field_spec.get("type", "string")
        required = field_spec.get("required", False)
        default = field_spec.get("default")

        if field_name not in config:
            if required and default is None:
                errors.append(f"Missing required field: {field_name}")
            elif default is not None:
                config[field_name] = default
            continue

        value = config[field_name]
        expected_type = type_map.get(field_type, str)
        if not isinstance(value, expected_type):
            errors.append(
                f"Field '{field_name}' expected type {field_type}, "
                f"got {type(value).__name__}"
            )

    return len(errors) == 0, errors


def fill_config_defaults(
    config: dict[str, Any], schema: dict[str, Any]
) -> dict[str, Any]:
    """Fill missing config values with defaults from schema.

    Returns a new dict with defaults applied; does not mutate *config*.
    """
    result = copy.deepcopy(config)
    for field_name, field_spec in schema.items():
        if field_name not in result:
            default = field_spec.get("default")
            if default is not None:
                result[field_name] = default
    return result
