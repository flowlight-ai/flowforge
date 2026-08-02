"""LLM Route 路由层 — Protocol/Route/Provider 三层分离的 Route 层.

LLMRoute 定义路由规则（primary provider + fallback providers + failover 条件），
RouteResolver 根据路由规则和 Provider 健康状态选择最优 Provider。
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from flowforge.core.tracing import get_logger
from flowforge.llm.provider import LLMProvider, LLMResponse, get_provider

logger = get_logger("llm.route")


class FailoverCondition(str, Enum):
    """故障转移触发条件."""

    RATE_LIMITED = "rate_limited"  # 429 限流
    TIMEOUT = "timeout"  # 超时 >30s
    MODERATION_REJECTED = "moderation_rejected"  # 内容审核拒绝
    ERROR = "error"  # 通用错误
    UNHEALTHY = "unhealthy"  # Provider 不健康


@dataclass
class FailoverPolicy:
    """故障转移策略."""

    conditions: List[FailoverCondition] = field(
        default_factory=lambda: [
            FailoverCondition.RATE_LIMITED,
            FailoverCondition.TIMEOUT,
            FailoverCondition.MODERATION_REJECTED,
        ]
    )
    timeout_seconds: float = 30.0
    max_retries: int = 2
    retry_delay_seconds: float = 1.0


@dataclass
class LLMRoute:
    """LLM 路由定义.

    定义一条路由规则：primary provider + fallback providers + 故障转移策略。
    """

    route_name: str
    primary_provider: str  # provider name (e.g. "doubao")
    primary_model: str = ""  # specific model (e.g. "doubao-seed2")
    fallback_providers: List[str] = field(default_factory=list)
    fallback_models: List[str] = field(default_factory=list)
    failover_policy: FailoverPolicy = field(default_factory=FailoverPolicy)
    default_temperature: float = 0.7
    default_max_tokens: int = 4096
    metadata: Dict[str, Any] = field(default_factory=dict)

    def get_provider_chain(self) -> List[tuple]:
        """获取完整 Provider 链 [(provider_name, model), ...]."""
        chain = [(self.primary_provider, self.primary_model)]
        for i, provider in enumerate(self.fallback_providers):
            model = self.fallback_models[i] if i < len(self.fallback_models) else ""
            chain.append((provider, model))
        return chain


class RouteResolver:
    """路由解析器 — 根据路由规则和 Provider 健康状态选择最优 Provider.

    核心逻辑：
    1. 查找路由定义
    2. 遍历 Provider 链
    3. 跳过不健康的 Provider
    4. 返回第一个可用的 Provider
    """

    def __init__(self, providers: Optional[Dict[str, LLMProvider]] = None):
        self._providers: Dict[str, LLMProvider] = providers or {}
        self._routes: Dict[str, LLMRoute] = {}

    def register_provider(self, name: str, provider: LLMProvider):
        """注册 Provider 实例."""
        self._providers[name] = provider

    def register_route(self, route: LLMRoute):
        """注册路由定义."""
        self._routes[route.route_name] = route

    def resolve_provider(self, route_name: str) -> Optional[LLMProvider]:
        """根据路由名解析到最优 Provider.

        遍历 Provider 链，返回第一个健康的 Provider。
        """
        route = self._routes.get(route_name)
        if not route:
            logger.warning(f"RouteResolver: 路由 {route_name} 未定义")
            return None

        for provider_name, model in route.get_provider_chain():
            provider = self._providers.get(provider_name)
            if provider and provider.is_healthy():
                return provider
            if provider:
                logger.info(
                    f"RouteResolver: Provider {provider_name} 不健康，跳过"
                )
            else:
                logger.debug(
                    f"RouteResolver: Provider {provider_name} 未注册，跳过"
                )

        # 全部不可用，返回 primary（让调用方处理）
        logger.warning(
            f"RouteResolver: 路由 {route_name} 所有 Provider 不可用，"
            f"回退到 primary={route.primary_provider}"
        )
        return self._providers.get(route.primary_provider)

    def resolve_route(self, route_name: str) -> Optional[LLMRoute]:
        """获取路由定义."""
        return self._routes.get(route_name)

    def get_route_for_agent(self, agent_name: str) -> Optional[LLMRoute]:
        """根据 Agent 名称查找匹配的路由.

        优先查找 agent 专属路由（如 "contentforge:writer"），
        回退到项目路由（如 "contentforge"），
        最终回退到 "default" 路由。
        """
        # 1. 精确匹配 agent 路由
        if agent_name in self._routes:
            return self._routes[agent_name]

        # 2. 项目前缀匹配
        if ":" in agent_name:
            project = agent_name.split(":")[0]
            if project in self._routes:
                return self._routes[project]

        # 3. 默认路由
        return self._routes.get("default")

    def list_routes(self) -> Dict[str, LLMRoute]:
        """列出所有路由."""
        return dict(self._routes)

    def load_routes_from_config(self, config: Dict[str, Any]):
        """从配置加载路由定义.

        配置格式（llm_route.yaml）:
        routes:
          default:
            primary_provider: doubao
            primary_model: doubao-seed2
            fallback_providers: [qwen, deepseek]
            fallback_models: [qwen3.6-plus, deepseek-chat]
            failover_policy:
              conditions: [rate_limited, timeout, moderation_rejected]
              timeout_seconds: 30
        agent_routes:
          contentforge:writer: creative
        """
        routes_config = config.get("routes", {})
        for name, route_data in routes_config.items():
            failover_data = route_data.get("failover_policy", {})
            failover_policy = FailoverPolicy(
                conditions=[
                    FailoverCondition(c)
                    for c in failover_data.get("conditions", ["rate_limited", "timeout"])
                ],
                timeout_seconds=failover_data.get("timeout_seconds", 30.0),
                max_retries=failover_data.get("max_retries", 2),
                retry_delay_seconds=failover_data.get("retry_delay_seconds", 1.0),
            )
            route = LLMRoute(
                route_name=name,
                primary_provider=route_data.get("primary_provider", "doubao"),
                primary_model=route_data.get("primary_model", ""),
                fallback_providers=route_data.get("fallback_providers", []),
                fallback_models=route_data.get("fallback_models", []),
                failover_policy=failover_policy,
                default_temperature=route_data.get("default_temperature", 0.7),
                default_max_tokens=route_data.get("default_max_tokens", 4096),
                metadata=route_data.get("metadata", {}),
            )
            self.register_route(route)

        logger.info(f"RouteResolver: 加载 {len(self._routes)} 条路由")
