"""ExternalAgentBridge — 三方 Agent 统一桥接层。

灵智体通过 Bridge 调用三方 Agent，Bridge 负责：
    1. 查询 ProviderTransportRegistry 选择合适的三方 Agent
    2. 通过 HostInjector 注入安全配置
    3. 通过 ACPTransport 统一通信
    4. 失败时通过 ExternalAgentFallback 回退
    5. 成功时通过 ExternalAgentCapabilityFusion 融合能力

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-003/EX-004 三方 Agent 协议适配层 + 状态共享
    - [doc:decisions/006-external-agent-integration.md] §5 调用流程
    - [doc:design/naming-contract.md#2.2] 灵智体 / [doc:design/naming-contract.md#2.12] 能力画像

铁律遵守：
    - 铁律 3：依赖通过构造函数注入（registry / host_injector / transport / fallback / fusion / shared_state）
    - 编程红线 12：禁止绕过 DI 容器直接实例化
    - 编程红线 7：使用组合而非继承
    - 所有 I/O 操作使用 async/await

License: MIT
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field

from flowforge.core.external_agent.acp_transport import ACPTransport
from flowforge.core.external_agent.adapter import ExternalAgentAdapter, ExternalAgentResult
from flowforge.core.external_agent.capability_fusion import (
    ExternalAgentCapabilityFusion,
    FusionResult,
)
from flowforge.core.external_agent.fallback import (
    ExternalAgentFallback,
    FallbackResult,
)
from flowforge.core.external_agent.host_injection import HostInjector, SandboxConfig
from flowforge.core.external_agent.manifest import AgentProviderManifest
from flowforge.core.external_agent.registry import ProviderTransportRegistry
from flowforge.core.external_agent.shared_state import ExternalAgentSharedState
from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.bridge")


class BridgeInvokeRequest(BaseModel):
    """Bridge 调用请求（灵智体发起）。"""

    forgekin_id: str = Field(..., description="灵智体 ID")
    task: str = Field(..., description="任务描述")
    context: dict[str, Any] = Field(
        default_factory=dict, description="调用上下文"
    )
    preferred_providers: list[str] = Field(
        default_factory=list,
        description="首选 Provider 列表（空时使用默认 fallback 链）",
    )
    required_capability: Optional[str] = Field(
        default=None,
        description="所需能力（用于 discover，EX-008 能力发现）",
    )
    worktree_root: Optional[str] = Field(
        default=None, description="worktree 根目录（None 时无 worktree 隔离）"
    )


class BridgeInvokeResponse(BaseModel):
    """Bridge 调用响应（返回给灵智体）。"""

    success: bool = Field(..., description="最终是否成功")
    winning_provider: str = Field(default="", description="成功的 Provider")
    result: Any = Field(default=None, description="调用结果")
    fusion_result: Optional[FusionResult] = Field(
        default=None, description="能力融合结果（EX-010）"
    )
    fallback_attempts: list[dict[str, Any]] = Field(
        default_factory=list, description="fallback 尝试记录"
    )
    cost: dict[str, Any] = Field(
        default_factory=dict, description="总成本信息（EX-006）"
    )
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="响应时间戳",
    )


class ExternalAgentBridge:
    """三方 Agent 统一桥接层。

    灵智体通过 Bridge 调用三方 Agent，Bridge 负责：
    1. 查询 ProviderTransportRegistry 选择合适的三方 Agent
    2. 通过 HostInjector 注入安全配置
    3. 通过 ACPTransport 统一通信
    4. 失败时通过 ExternalAgentFallback 回退
    5. 成功时通过 ExternalAgentCapabilityFusion 融合能力

    详见 [doc:review/review.md#第九章§9.2] EX-003/EX-004

    调用流程（[doc:decisions/006-external-agent-integration.md] §5）：
        1. 灵智体发起 Bridge.invoke(forgekin_id, task)
        2. Bridge 查询 Registry 选择 Provider（或按 preferred_providers）
        3. HostInjector 注入 sandbox / credentials
        4. ACPTransport 调用三方 Agent
        5. 结果写入 SharedState
        6. CapabilityFusion 融合能力到灵智体画像
        7. 失败时 Fallback 链回退到下一个 Provider
        8. 全部失败回退到 FlowForge 内置能力
    """

    def __init__(
        self,
        registry: ProviderTransportRegistry,
        host_injector: HostInjector,
        transport: ACPTransport,
        fallback: ExternalAgentFallback,
        fusion: ExternalAgentCapabilityFusion,
        shared_state: ExternalAgentSharedState,
        adapter_factory: Optional[Any] = None,
    ) -> None:
        """注入所有依赖（铁律 3 + 编程红线 12）。

        Args:
            registry: Provider 传输注册表（F241 CL-014）。
            host_injector: host-owned 安全注入器（F241 CL-015）。
            transport: ACP 统一传输层（F241 CL-016）。
            fallback: 失败回退链（EX-007）。
            fusion: 能力融合机制（EX-010）。
            shared_state: 状态共享（EX-004）。
            adapter_factory: 可选的 Adapter 工厂函数
                (manifest) -> ExternalAgentAdapter。
                None 时使用 ACPTransport 直接调用。
        """
        self._registry = registry
        self._host_injector = host_injector
        self._transport = transport
        self._fallback = fallback
        self._fusion = fusion
        self._shared_state = shared_state
        self._adapter_factory = adapter_factory

    async def invoke(
        self,
        forgekin_id: str,
        task: str,
        context: Optional[dict[str, Any]] = None,
        preferred_providers: Optional[list[str]] = None,
        required_capability: Optional[str] = None,
    ) -> BridgeInvokeResponse:
        """灵智体调用三方 Agent 完成任务。

        Args:
            forgekin_id: 灵智体 ID。
            task: 任务描述。
            context: 调用上下文（含 shared_state history）。
            preferred_providers: 首选 Provider 列表（空时用默认 fallback 链）。
            required_capability: 所需能力（用于 discover）。

        Returns:
            BridgeInvokeResponse 调用响应。
        """
        context = context or {}
        # 1. 选择 Provider 列表
        providers = self._select_providers(
            preferred_providers, required_capability
        )
        if not providers:
            logger.error(
                "bridge.invoke no_providers forgekin=%s capability=%s",
                forgekin_id,
                required_capability,
            )
            return BridgeInvokeResponse(
                success=False,
                result=None,
                fallback_attempts=[],
            )

        # 2. 注入历史 shared_state 到 context（EX-004）
        history = await self._shared_state.list_history(forgekin_id)
        context["shared_state_history"] = history

        # 3. 通过 fallback 链调用
        async def _invoke_fn(
            provider_name: str,
            task_str: str,
            ctx: dict[str, Any],
        ) -> dict[str, Any]:
            return await self._invoke_single(provider_name, task_str, ctx)

        fallback_result: FallbackResult = await self._fallback.with_fallback(
            providers=providers,
            invoke_fn=_invoke_fn,
            task=task,
            context=context,
        )

        # 4. 成功时写入 shared_state + 触发能力融合
        fusion_result: Optional[FusionResult] = None
        if fallback_result.success:
            # 4a. 写入 shared_state（EX-004）
            await self._shared_state.write(
                forgekin_id=forgekin_id,
                key=f"task_result/{datetime.now(timezone.utc).isoformat()}",
                value={
                    "task": task,
                    "provider": fallback_result.winning_provider,
                    "result": fallback_result.result,
                },
                provider_name=fallback_result.winning_provider,
                decision_context={"task": task, "context_keys": list(context.keys())},
            )
            # 4b. 能力融合（EX-010）
            manifest = self._registry.get(fallback_result.winning_provider)
            if manifest is not None:
                external_profile = self._build_external_profile(manifest)
                # 从 context 读取历史统计（由调用方维护）
                invocation_count = int(context.get("invocation_count", 1))
                success_rate = float(context.get("success_rate", 1.0))
                forgekin_profile = context.get("forgekin_profile", {})
                fusion_result = self._fusion.fuse(
                    forgekin_profile=forgekin_profile,
                    external_agent_profile=external_profile,
                    invocation_count=invocation_count,
                    success_rate=success_rate,
                )

        # 5. 返回响应
        return BridgeInvokeResponse(
            success=fallback_result.success,
            winning_provider=fallback_result.winning_provider,
            result=fallback_result.result,
            fusion_result=fusion_result,
            fallback_attempts=[a.model_dump() for a in fallback_result.attempts],
            cost=self._aggregate_cost(fallback_result),
        )

    async def stream(
        self,
        provider_name: str,
        task: str,
        context: Optional[dict[str, Any]] = None,
    ):
        """流式调用三方 Agent（EX-009 流式语义）。

        Args:
            provider_name: 目标 Provider 名称。
            task: 任务描述。
            context: 调用上下文。

        Yields:
            响应片段字符串。
        """
        context = context or {}
        params = {"task": task, "context": context}
        async for chunk in self._transport.stream(
            provider=provider_name,
            method="stream",
            params=params,
        ):
            yield chunk

    def list_available_providers(self) -> list[dict[str, Any]]:
        """列出所有可用的三方 Agent（EX-008 能力发现）。"""
        return [
            {
                "provider_name": m.provider_name,
                "display_name": m.display_name,
                "capabilities": m.capabilities,
                "blind_spots": m.blind_spots,
                "safety_level": m.safety_level,
            }
            for m in self._registry.list_all()
        ]

    def discover_providers(self, capability: str) -> list[dict[str, Any]]:
        """按能力发现 Provider（EX-008 能力发现机制）。"""
        manifests = self._registry.discover(capability)
        return [
            {
                "provider_name": m.provider_name,
                "display_name": m.display_name,
                "capabilities": m.capabilities,
                "blind_spots": m.blind_spots,
            }
            for m in manifests
        ]

    # ── 内部方法 ──────────────────────────────────────────────────

    def _select_providers(
        self,
        preferred: Optional[list[str]],
        required_capability: Optional[str],
    ) -> list[str]:
        """选择 Provider 调用顺序。"""
        if preferred:
            return list(preferred)
        if required_capability:
            discovered = self._registry.discover(required_capability)
            if discovered:
                return [m.provider_name for m in discovered]
        # 默认 fallback 链
        return self._fallback.get_default_chain()

    async def _invoke_single(
        self,
        provider_name: str,
        task: str,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """调用单个 Provider（供 fallback 链使用）。

        优先使用 adapter_factory（如有），否则使用 ACPTransport。
        """
        manifest = self._registry.get(provider_name)
        if manifest is None:
            return {
                "success": False,
                "error": f"Provider not registered: {provider_name}",
            }

        # 优先使用 Adapter（如果配置了 adapter_factory）
        if self._adapter_factory is not None:
            try:
                adapter: ExternalAgentAdapter = self._adapter_factory(manifest)
                # 注入 sandbox（如配置了 worktree_root）
                sandbox: Optional[SandboxConfig] = None
                worktree_root = context.get("worktree_root")
                if worktree_root:
                    sandbox = self._host_injector.inject_sandbox(
                        provider_name=provider_name,
                        worktree_path=worktree_root,
                        network_allowlist=context.get("network_allowlist"),
                    )
                result: ExternalAgentResult = await adapter.invoke(
                    task=task, context=context, sandbox=sandbox
                )
                return {
                    "success": result.success,
                    "result": result.output,
                    "cost": result.cost,
                    "provider": result.provider_name,
                    "error": result.error,
                }
            except Exception as e:
                return {"success": False, "error": str(e)}

        # 否则使用 ACPTransport（F241 CL-016）
        try:
            response = await self._transport.call(
                provider=provider_name,
                method="invoke",
                params={"task": task, "context": context},
            )
            return {
                "success": True,
                "result": response.get("result"),
                "cost": response.get("cost", {}),
                "provider": provider_name,
            }
        except Exception as e:
            return {"success": False, "error": str(e), "provider": provider_name}

    @staticmethod
    def _build_external_profile(manifest: AgentProviderManifest) -> dict[str, Any]:
        """从 Manifest 构建外部 Agent 能力画像（供融合使用）。"""
        return {
            "provider_name": manifest.provider_name,
            "display_name": manifest.display_name,
            "capabilities": list(manifest.capabilities),
            "blind_spots": list(manifest.blind_spots),
        }

    @staticmethod
    def _aggregate_cost(fallback_result: FallbackResult) -> dict[str, Any]:
        """汇总 fallback 链的成本（EX-006）。"""
        total_tokens = 0
        total_calls = 0
        total_cost = 0.0
        if fallback_result.result and isinstance(fallback_result.result, dict):
            cost_info = fallback_result.result.get("cost", {})
            total_tokens = int(cost_info.get("total_tokens", 0))
            total_calls = int(cost_info.get("total_calls", 0))
            total_cost = float(cost_info.get("total_cost", 0.0))
        return {
            "total_tokens": total_tokens,
            "total_calls": total_calls,
            "total_cost": total_cost,
            "attempts": len(fallback_result.attempts),
            "total_duration_ms": fallback_result.total_duration_ms,
        }
