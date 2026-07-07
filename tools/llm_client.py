"""Unified LLM client with automatic model discovery and cross-provider fallback.

Implements a candidate chain system inspired by hiclaw's model_manager:
- Auto mode: builds candidate chain from all available free models
- Cross-provider fallback: interleaves models from different providers
- Health-aware: skips recently failed models, auto-retries after cooldown
- Streaming support: SSE-compatible with real-time event emission

License: MIT
"""

import os
import json
import time
import asyncio
import httpx
from typing import List, Dict, Optional, AsyncIterator, TYPE_CHECKING
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.secret_store import get_secret_store
from flowforge.core.tracing import get_logger, get_trace_id
from flowforge.core import metrics
from flowforge.core.circuit_breaker import get_circuit_breaker
from flowforge.llm.call_event import LLMCallEvent, get_call_event_collector

if TYPE_CHECKING:
    from flowforge.llm.router import LLMRouter

logger = get_logger("llm_client")

DEFAULT_FREE_MODELS = {
    "openroute": [
        "Doubao-Seed2.0",
        "DeepSeek-V4-Pro",
        "Kimi-K2.6",
        "Qwen3.6-Plus",
        "HunYuan3",
        "GLM-5.1",
        "MiniMax-M3",
    ],
    "openrouter": [
        "moonshotai/kimi-k2.6:free",
        "minimax/minimax-m2.5:free",
        "z-ai/glm-4.5-air:free",
        "qwen/qwen3-coder:free",
        "qwen/qwen3-next-80b-a3b-instruct:free",
        "openai/gpt-oss-120b:free",
        "openai/gpt-oss-20b:free",
        "nousresearch/hermes-3-llama-3.1-405b:free",
        "google/gemma-4-31b-it:free",
        "google/gemma-4-26b-a4b-it:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "poolside/laguna-m.1:free",
    ],
}

PROVIDER_BASE_URLS = {
    "openrouter": "https://openrouter.ai/api/v1",
    # openroute base_url 从 models.yaml providers.openroute.base_url 动态读取
    # 此处仅作为 fallback，实际使用 _get_provider_base_url() 方法
    "openroute": "http://127.0.0.1:13001/v1",
}

# 冷却时间设计原则：参考老版本openclaw（从不永久禁用模型），所有冷却均可快速恢复
# 仅 model_not_found/no_permission 较长（模型确实不存在或无权限），其余快速恢复
ERROR_COOLDOWNS = {
    "rate_limit": 60,          # 限流：60s后重试（原300s过长）
    "no_permission": 600,      # 无权限：10分钟后重试（原3600s）
    "model_not_found": 600,    # 模型不存在：10分钟后重试（原86400s永久禁用）
    "no_quota": 300,           # 配额不足：5分钟后重试（原18000s=5小时）
    "timeout": 30,             # 超时：30s后重试（原120s）
    "server_error": 15,        # 服务器错误：15s后重试（原60s）
    "unknown": 30,             # 未知错误：30s后重试（原180s）
    "empty_response": 10,      # 空响应：10s后重试
    "invalid_response": 10,    # 无效响应：10s后重试
}

# 候选链容量：参考老版本17个候选全部尝试，不截断
MAX_CANDIDATES = 20
MAX_FALLBACK_CANDIDATES = 20
MAX_CALLS_PER_TASK = 200

# WebChat 轮询池：使用 openroute 的 proxy 模型
# openroute 的 proxy 模型已内置 round-robin 负载均衡和繁忙模型跳过
# FlowForge 不需要重复实现轮询逻辑，直接委托给 openroute
WEB_CHAT_ROTATION_POOL = [
    "openroute/proxy",
]

# 禁用模型列表改为配置驱动（从 models.yaml 的 disabled_models 段读取）
# 移除硬编码 DISABLED_MODELS（违反铁律5：禁止硬编码）
DISABLED_MODELS = set()  # 由 _load_disabled_models() 从配置加载


# 无效响应检测（参考老版本openclaw的llm_client.py）
# 这些响应虽然HTTP 200，但内容无效，应触发下一个候选模型
INVALID_RESPONSES = {
    "素材不足", "草稿无效", "无法创作", "素材不足。", "无法回答",
    "（API不可用", "（请求无法处理", "（网页版未返回内容",
    "（豆包未返回内容", "（网页版输入失败", "（网页版暂时不可用",
    "（页面崩溃", "（所有模型当前繁忙", "（所有模型当前不可用",
}
INVALID_RESPONSE_PREFIXES = ("草稿无效",)
INVALID_RESPONSE_PATTERNS = (
    "Hiclaw OpenRoute 内置命令", "hc ping", "hc help", "hc reset",
    "hc update", "上下文已重置", "页面已刷新", "浏览器页面不可用",
    # openroute app.py:1348 伪装 chat.completion 的 silent failure 标识
    # 当模型被禁用/不可用时,openroute 返回 HTTP 200 + "模型 X 当前不可用，请稍后重试"
    # 必须对所有 agent 识别(否则非创作类 agent 会把错误文案当正常响应返回)
    "当前不可用，请稍后重试",
    "当前不可用,请稍后重试",
)


def classify_error(error_msg: str) -> str:
    msg = error_msg.lower()
    if any(k in msg for k in ["rate limit", "too many requests", "429"]):
        return "rate_limit"
    # 模型被禁用/停用/不可用 → 永久错误，立即切换（不重试）
    if any(k in msg for k in ["model disabled", "deactivated", "all_backends_failed",
                                "not available", "not enabled", "model_not_allowed"]):
        return "model_not_found"
    if any(k in msg for k in ["unauthorized", "forbidden", "403", "401", "invalid api key",
                                "无权访问", "不存在或无权"]):
        return "no_permission"
    if any(k in msg for k in ["not found", "does not exist", "404"]):
        return "model_not_found"
    if any(k in msg for k in ["insufficient", "no quota", "no credits", "402"]):
        return "no_quota"
    # v3.8 性能优化: 连接错误单独分类（"All connection attempts failed" / "ConnectError"）
    # 原分类为 timeout 导致：1) 30s cooldown 2) 重试同一模型2次浪费15s
    # 连接错误特点：快速失败(3-6s)，服务器不可达，重试同一模型无意义
    # 改为 server_error：15s cooldown，仍重试1次（可能是瞬时网络抖动）
    if any(k in msg for k in ["all connection attempts failed", "connecterror",
                                "connection refused", "connection reset", "connection aborted",
                                "max retries exceeded", "pool", "socket"]):
        return "server_error"
    if any(k in msg for k in ["timeout", "timed out", "connection"]):
        return "timeout"
    if any(k in msg for k in ["500", "502", "503", "server error"]):
        return "server_error"
    return "unknown"


def is_invalid_response(content: str, agent_name: str = "", min_length: int = 50) -> bool:
    """检测LLM返回的无效响应（参考老版本openclaw的llm_client.py）.

    虽然HTTP 200，但内容无效的情况：
    1. 明确的失败标识（素材不足/草稿无效等）
    2. 系统命令泄露（hc ping/hc reset等）
    3. 网页代理失败标识（（API不可用/（页面崩溃等）
    4. 创作类agent响应过短（< min_length字符）

    Args:
        content: LLM返回的内容
        agent_name: agent名称（用于判断是否需要长度检查）
        min_length: 最小长度阈值（创作/润色类agent适用）

    Returns:
        True表示无效响应，应触发下一个候选模型
    """
    if not content or not content.strip():
        return True

    content_stripped = content.strip()

    # 1. 明确的失败标识
    if content_stripped in INVALID_RESPONSES:
        return True

    # 2. 失败前缀
    if any(content_stripped.startswith(p) for p in INVALID_RESPONSE_PREFIXES):
        return True

    # 3. 系统命令泄露 / 网页代理失败
    if any(pattern in content_stripped[:200] for pattern in INVALID_RESPONSE_PATTERNS):
        return True

    # 4. 素材不足（前20字符内且整体较短）
    if "素材不足" in content_stripped[:20] and len(content_stripped) < 50:
        return True

    # 5. 创作类agent响应过短检查
    # reviewer/审核类agent不需要长度限制（VERDICT: PASS仅13字符）
    # 评论/回复等短文本场景可通过 min_length=0 跳过
    if min_length > 0 and agent_name in ("creator", "polisher", "writer", "editor"):
        if len(content_stripped) < min_length:
            return True

    return False


def build_cross_fallback_chain(
    available_models: Dict[str, List[str]],
    health_status: Dict[str, dict],
) -> List[str]:
    """Build an interleaved candidate chain across providers.

    Inspired by hiclaw's cross_fallback() algorithm:
    1. Group models by provider
    2. Interleave across top providers for diversity
    3. Filter out models in cooldown
    4. OpenRoute models go first (as primary, unlimited tokens)
    5. Append openroute/free and openroute/auto as last-resort fallbacks

    兜底链构建原则（参考老版本content model_manager的100%成功率设计）：
    - 主路径应由 models.yaml assignments 提供，本函数仅作为最后兜底
    - 具体web chat模型优先（Doubao-Seed2.0/DeepSeek-V4-Pro等）
    - auto/free 是openroute的特殊入口，作为最末兜底追加到链尾
      （auto是智能路由按auto.order尝试所有一级模型，free是免费模型集合）
    - 这两个特殊入口是100%成功率的关键保障（老版本设计的核心理念）
    """
    # auto/free/proxy 不从常规分组中提取，而是作为最末兜底单独追加
    SPECIAL_FALLBACK_ENTRIES = {"auto", "free", "proxy"}

    provider_order = ["openroute", "openrouter"]
    grouped: Dict[str, List[str]] = {}
    for provider in provider_order:
        models = available_models.get(provider, [])
        healthy = []
        for m in models:
            # 特殊入口（auto/free/proxy）跳过常规分组，作为最末兜底追加
            if m in SPECIAL_FALLBACK_ENTRIES:
                continue
            key = f"{provider}/{m}"
            status = health_status.get(key, {})
            cooldown_until = status.get("cooldown_until", 0)
            if time.time() < cooldown_until:
                continue
            healthy.append(key)
        if healthy:
            grouped[provider] = healthy

    # 即使所有具体模型都在cooldown，也要构建特殊入口兜底链
    chain = []
    if grouped:
        sorted_providers = sorted(grouped.keys(), key=lambda p: len(grouped[p]), reverse=True)
        max_len = max(len(v) for v in grouped.values())
        for i in range(max_len):
            for provider in sorted_providers:
                models = grouped[provider]
                if i < len(models):
                    chain.append(models[i])

    # v3: 只追加 openroute/auto 作为最末兜底，不再追加 openroute/free。
    # 原因：openroute/free 会路由到 openrouter.ai 的 free 模型（kimi-k2.6:free 等），
    # 这些 free 模型大量返回 404/429/suspended，导致评委和 T7 审核质量分 0.0，
    # 浪费大量时间（17个free模型全部失败后才结束）。
    # openroute/auto 按 auto.order 智能路由尝试所有本地一级 webchat 模型，
    # 是更可靠的兜底方案（用户要求：创作/润色/评委只用 webchat 模型）。
    openroute_models = available_models.get("openroute", [])
    for special in ("auto",):  # 仅保留 auto，移除 free
        if special in openroute_models:
            chain.append(f"openroute/{special}")

    return chain


class LLMClient(BaseTool):
    """Unified LLM client with automatic model discovery and cross-provider fallback.

    Attributes:
        name: Tool identifier.
        _models_config: Raw models configuration from models.yaml.
        _providers: Provider configurations (base_url, api_key_env, etc.).
        _assignments: Per-persona/agent model assignments.
        _health_status: Runtime health tracking per model key.
        _event_bus: Event bus for emitting LLM lifecycle events.
    """

    name = "llm"
    description = "Unified LLM client with auto model chain and cross-provider fallback"
    parameters_schema = {
        "type": "object",
        "required": ["messages"],
        "properties": {
            "messages": {"type": "array", "description": "OpenAI format message list"},
            "model": {"type": "string", "description": "Specific model to use (provider/model_id)"},
            "temperature": {"type": "number", "default": 0.7},
            "max_tokens": {"type": "integer", "default": 4000},
            "stream": {"type": "boolean", "default": False},
            "persona": {"type": "string", "description": "Persona identifier for model routing"},
            "agent_name": {"type": "string", "description": "Agent name for model routing"},
            # assignment 参数：任务类型路由键（如 content_create/content_refine/judge），
            # 优先级高于 persona，让 models.yaml 中专用的 assignment 真正生效。
            # 例如 contentforge writer_engine 传 assignment="content_create" → primary=Doubao-Seed2.0
            #      contentforge editor_engine 传 assignment="content_refine" → primary=DeepSeek-V4-Pro
            "assignment": {"type": "string", "description": "Task type assignment key for model routing (overrides persona)"},
            "tools": {"type": "array", "description": "OpenAI function calling tools schema"},
            "skip_cooldown": {"type": "boolean", "default": False, "description": "Skip cooldown check for judge calls"},
            "prefer_api": {"type": "boolean", "default": False, "description": "Prefer API backend, exclude WebChat backend models from candidate chain"},
        },
    }

    def __init__(self, models_config: dict = None, event_bus=None, llm_router: Optional["LLMRouter"] = None):
        self._models_config = models_config or {}
        self._providers = self._models_config.get("providers", {})
        self._assignments = self._models_config.get("assignments", {})
        self._event_bus = event_bus
        self._llm_router = llm_router
        self._health_status: Dict[str, dict] = {}
        self._available_models: Dict[str, List[str]] = {}
        self._task_call_counts: Dict[str, int] = {}
        self._task_used_models: Dict[str, set] = {}
        self._webchat_rotation_index: int = 0
        # P0-1/P0-4: 从 llm_route.yaml 读取 timeout_seconds，禁止硬编码 300s
        # P0-4: 加载所有路由的超时配置和 agent_routes 映射，支持按 agent_name 查找超时
        self._route_timeouts, self._agent_routes = self._load_route_timeouts()
        # 默认超时：使用 default 路由的 timeout_seconds，回退到 30s
        self._request_timeout = self._route_timeouts.get("default", 30.0)
        # L3: 从 llm_route.yaml 加载 FailoverPolicy 的 max_retries 和 retry_delay_seconds
        # 关键修复：加载所有路由的 max_retries，让 judge 路由的 max_retries=0 生效
        self._max_retries, self._retry_delay_seconds, self._route_max_retries = self._load_failover_retries()
        self._build_available_models()
        # 从 models.yaml 的 disabled_models 段加载禁用模型列表（配置驱动，非硬编码）
        self._disabled_models = self._load_disabled_models()

    def _load_route_timeouts(self) -> tuple:
        """从 llm_route.yaml 加载所有路由的超时配置和 agent_routes 映射（P0-4 修复）.

        Returns:
            (route_timeouts, agent_routes) 元组:
            - route_timeouts: {route_name: timeout_seconds}
            - agent_routes: {agent_name: route_name}
        """
        route_timeouts: Dict[str, float] = {"default": 30.0}
        agent_routes: Dict[str, str] = {}
        try:
            import yaml
            from pathlib import Path
            config_path = Path(__file__).parent.parent / "config" / "llm_route.yaml"
            if config_path.exists():
                with open(config_path, "r", encoding="utf-8") as f:
                    cfg = yaml.safe_load(f) or {}
                routes = cfg.get("routes", {})
                for route_name, route_cfg in routes.items():
                    failover = route_cfg.get("failover_policy", {})
                    timeout = float(failover.get("timeout_seconds", 30.0))
                    route_timeouts[route_name] = timeout
                agent_routes = cfg.get("agent_routes", {}) or {}
                logger.info(f"[P0-4] 从 llm_route.yaml 加载路由超时: {route_timeouts}")
                logger.info(f"[P0-4] 从 llm_route.yaml 加载 agent_routes: {len(agent_routes)} 条映射")
        except Exception as e:
            logger.warning(f"[P0-4] 加载 llm_route.yaml 路由超时配置失败，使用默认 30s: {e}")
        return route_timeouts, agent_routes

    def _get_timeout_for_agent(self, agent_name: str = "") -> float:
        """根据 agent_name 查找对应路由的 timeout（P0-4 修复）.

        查找逻辑：
        1. 精确匹配: 从 agent_routes 映射查找 agent_name 对应的路由名
        2. 前缀匹配: 遍历 agent_routes,若 agent_name 以某个 key 开头则匹配(如 multi_judge_*)
        3. 从 route_timeouts 中获取该路由的 timeout_seconds
        4. 回退到 default 路由的 timeout，再回退到 30s

        例如: contentforge:writer → creative 路由 → 90s
        例如: multi_judge_doubao-seed2 → judge 路由 → 180s (前缀匹配 multi_judge_)
        """
        if not agent_name:
            return self._route_timeouts.get("default", 30.0)
        # 1. 精确匹配
        route_name = self._agent_routes.get(agent_name, "")
        # 2. 前缀匹配(如 multi_judge_ 匹配 multi_judge_doubao-seed2)
        if not route_name:
            for prefix_key, prefix_route in self._agent_routes.items():
                if prefix_key.endswith("_") and agent_name.startswith(prefix_key):
                    route_name = prefix_route
                    logger.info(f"[P0-4] agent='{agent_name}' 前缀匹配 '{prefix_key}' → route='{route_name}'")
                    break
        if route_name and route_name in self._route_timeouts:
            timeout = self._route_timeouts[route_name]
            logger.info(f"[P0-4] agent='{agent_name}' → route='{route_name}' → timeout={timeout}s")
            return timeout
        return self._route_timeouts.get("default", 30.0)

    def _load_failover_retries(self):
        """从 llm_route.yaml 加载 FailoverPolicy 的重试配置（L3 修复 + judge 路由修复）.

        读取所有路由的 failover_policy.max_retries 和 retry_delay_seconds。
        返回 (default_max_retries, retry_delay_seconds, route_max_retries_dict)。

        关键修复：judge 路由的 max_retries=0 必须生效！
        - default 路由: max_retries=2（创作/润色可以重试）
        - judge 路由: max_retries=0（评委失败立即切换到下一个候选模型，不重试）
        - creative 路由: max_retries=2（创作可以重试）

        老版本content的100%成功率设计：永不放弃，但失败后立即切换模型，不重试同一模型。
        """
        try:
            import yaml
            from pathlib import Path
            config_path = Path(__file__).parent.parent / "config" / "llm_route.yaml"
            if config_path.exists():
                with open(config_path, "r", encoding="utf-8") as f:
                    cfg = yaml.safe_load(f) or {}
                routes = cfg.get("routes", {})
                default_route = routes.get("default", {})
                default_failover = default_route.get("failover_policy", {})
                default_max_retries = int(default_failover.get("max_retries", 2))
                retry_delay = float(default_failover.get("retry_delay_seconds", 1.0))

                # 加载所有路由的 max_retries（关键修复：让 judge 路由的 max_retries=0 生效）
                route_max_retries = {}
                for route_name, route_cfg in routes.items():
                    failover = route_cfg.get("failover_policy", {})
                    route_max_retries[route_name] = int(failover.get("max_retries", default_max_retries))

                logger.info(f"[L3] 从 llm_route.yaml 加载重试配置: default_max_retries={default_max_retries}, "
                            f"retry_delay={retry_delay}s, route_max_retries={route_max_retries}")
                return default_max_retries, retry_delay, route_max_retries
        except Exception as e:
            logger.warning(f"[L3] 加载 llm_route.yaml 重试配置失败，使用默认值: {e}")
        return 2, 1.0, {}

    def _get_retries_for_agent(self, agent_name: str = "") -> int:
        """根据 agent_name 查找对应路由的 max_retries（关键修复）.

        查找逻辑（与 _get_timeout_for_agent 一致）：
        1. 精确匹配: 从 agent_routes 映射查找 agent_name 对应的路由名
        2. 前缀匹配: 遍历 agent_routes,若 agent_name 以某个 key 开头则匹配(如 multi_judge_*)
        3. 从 route_max_retries 中获取该路由的 max_retries
        4. 回退到 default 路由的 max_retries

        例如: multi_judge_doubao-seed2 → judge 路由 → max_retries=0（失败立即切换）
        例如: contentforge:writer → creative 路由 → max_retries=2（可以重试）
        """
        if not agent_name or not self._route_max_retries:
            return self._max_retries
        # 1. 精确匹配
        route_name = self._agent_routes.get(agent_name, "")
        # 2. 前缀匹配(如 multi_judge_ 匹配 multi_judge_doubao-seed2)
        if not route_name:
            for prefix_key, prefix_route in self._agent_routes.items():
                if prefix_key.endswith("_") and agent_name.startswith(prefix_key):
                    route_name = prefix_route
                    break
        if route_name and route_name in self._route_max_retries:
            return self._route_max_retries[route_name]
        return self._max_retries

    def set_event_bus(self, event_bus):
        self._event_bus = event_bus

    def set_llm_router(self, llm_router: "LLMRouter"):
        """设置 LLMRouter 实例，用于策略级模型路由.

        可在运行时动态注入，不影响已有代码。
        """
        self._llm_router = llm_router
        logger.info("LLMRouter已注入到LLMClient")

    async def _get_routed_model(self, strategy: str = "default") -> Optional[str]:
        """通过 LLMRouter 获取策略路由的模型ID.

        Args:
            strategy: 级联策略名称（default/content_writing/code_generation/fact_check等）

        Returns:
            路由选中的模型ID（provider/model_id格式），如果 LLMRouter 不可用则返回 None
        """
        if self._llm_router is None:
            return None
        try:
            model_id = await self._llm_router.route(strategy=strategy)
            if model_id:
                # LLMRouter 返回的是纯 model_id，需要转换为 provider/model_id 格式
                if "/" not in model_id:
                    for provider, models in self._available_models.items():
                        if model_id in models:
                            routed = f"{provider}/{model_id}"
                            logger.info(f"LLMRouter路由: strategy={strategy} → {routed}")
                            return routed
                    # 未在 available_models 中找到，默认使用 openroute
                    routed = f"openroute/{model_id}"
                    logger.info(f"LLMRouter路由: strategy={strategy} → {routed} (默认openroute)")
                    return routed
                return model_id
        except Exception as e:
            logger.warning(f"LLMRouter路由失败: strategy={strategy}, error={e}")
        return None

    def _build_available_models(self):
        yaml_models = self._models_config.get("models", [])
        for m in yaml_models:
            provider = m.get("provider", "")
            model_id = m.get("id", "")
            if provider and model_id:
                self._available_models.setdefault(provider, [])
                if model_id not in self._available_models[provider]:
                    self._available_models[provider].append(model_id)

        for provider, models in DEFAULT_FREE_MODELS.items():
            existing = self._available_models.get(provider, [])
            for m in models:
                if m not in existing:
                    existing.append(m)
            self._available_models[provider] = existing

    def _load_disabled_models(self) -> set:
        """从 models.yaml 的 disabled_models 段加载禁用模型列表（配置驱动）.

        替代原硬编码 DISABLED_MODELS，遵循铁律5（禁止硬编码）。
        models.yaml 中配置示例：
            disabled_models:
              - openroute/some-broken-model
              - openrouter/another-bad-model

        Returns:
            禁用模型集合（格式：provider/model_id）
        """
        disabled = set()
        disabled_list = self._models_config.get("disabled_models", [])
        for item in disabled_list:
            if isinstance(item, str) and item.strip():
                disabled.add(item.strip())
        if disabled:
            logger.info(f"[配置] 从 models.yaml 加载 {len(disabled)} 个禁用模型: {disabled}")
        return disabled

    def _resolve_api_key(self, provider: str) -> str:
        logger.info(f"[API Key] 正在解析 provider={provider} 的 API Key")
        secret_store = get_secret_store()
        provider_config = self._providers.get(provider, {})
        api_key_env = provider_config.get("api_key_env", "")
        if api_key_env:
            key = secret_store.resolve(api_key_env)
            if key:
                masked = self._mask_api_key(key)
                logger.info(f"[API Key] provider={provider} 从 api_key_env='{api_key_env}' 获取成功: {masked}")
                return key
            logger.info(f"[API Key] provider={provider} api_key_env='{api_key_env}' 未获取到值")
        env_name = f"{provider.upper()}_API_KEY"
        key = secret_store.resolve(env_name)
        if key:
            masked = self._mask_api_key(key)
            logger.info(f"[API Key] provider={provider} 从环境变量 '{env_name}' 获取成功: {masked}")
            return key
        logger.info(f"[API Key] provider={provider} 环境变量 '{env_name}' 未获取到值")
        default = provider_config.get("api_key_default", "")
        if default:
            masked = self._mask_api_key(default)
            logger.info(f"[API Key] provider={provider} 从 api_key_default 获取成功: {masked}")
            return default
        logger.warning(f"[API Key] provider={provider} 所有来源均未获取到 API Key，返回空字符串")
        # openroute: 从 models.yaml 的 api_key_default 获取，不再返回 "none"
        # 如果 provider_config 中有 api_key_default，上面已经返回了
        # 如果环境变量也没有，则返回空字符串让调用方跳过
        return ""

    @staticmethod
    def _mask_api_key(key: str) -> str:
        """脱敏显示 API Key：前8位+后4位，中间用...替代"""
        if not key:
            return "<empty>"
        if len(key) <= 12:
            return key[:4] + "..." + key[-4:] if len(key) > 8 else key[:3] + "..."
        return key[:8] + "..." + key[-4:]

    def _get_model_chain(self, persona: str = "", agent_name: str = "", task_id: str = "", assignment: str = "") -> List[str]:
        # assignment 优先：任务类型路由键（如 content_create/content_refine/judge），
        # 优先于 persona，让 models.yaml 中专用的 assignment 真正生效。
        # 这是修复"专用 assignment 从未生效"bug 的关键（参考审核报告缺陷 D3）。
        if assignment:
            return self._build_assignment_chain(persona, agent_name, task_id, assignment)

        # LLMRouter 优先路由：当 router 可用且无 assignment 时，根据 persona 映射到策略
        if self._llm_router is not None:
            strategy = self._map_persona_to_strategy(persona, agent_name)
            try:
                # 修复 async/sync 桥接 bug：使用 asyncio.run_coroutine_threadsafe 而非
                # concurrent.futures.ThreadPoolExecutor + asyncio.run（后者在已有事件循环中
                # 会抛 RuntimeError: asyncio.run() cannot be called from a running event loop）
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # 在异步上下文中，使用 threadsafe 方式调用 async 方法
                    future = asyncio.run_coroutine_threadsafe(
                        self._get_routed_model(strategy), loop
                    )
                    routed_model = future.result(timeout=5)
                else:
                    routed_model = loop.run_until_complete(self._get_routed_model(strategy))
                if routed_model:
                    chain = [routed_model]
                    # 将原有候选链作为 fallback 追加
                    original_chain = self._build_assignment_chain(persona, agent_name, task_id)
                    for c in original_chain:
                        if c not in chain:
                            chain.append(c)
                    return self._apply_rotation_and_cross_validation(chain, persona, task_id)
            except Exception as e:
                logger.warning(f"LLMRouter路由异常，回退到原有逻辑: {e}")

        return self._build_assignment_chain(persona, agent_name, task_id)

    def _map_persona_to_strategy(self, persona: str, agent_name: str) -> str:
        """将 persona/agent_name 映射到 LLMRouter 级联策略名称."""
        # 映射规则：persona → strategy
        persona_strategy_map = {
            "writer": "content_writing",
            "content_writing": "content_writing",
            "coder": "code_generation",
            "code_generation": "code_generation",
            "judge": "fact_check",
            "evaluator": "fact_check",
            "reviewer": "fact_check",
            "reflexion_evaluator": "fact_check",
            "fact_check": "fact_check",
        }
        # 优先匹配 agent_name
        if agent_name and agent_name in persona_strategy_map:
            return persona_strategy_map[agent_name]
        # 其次匹配 persona
        if persona and persona in persona_strategy_map:
            return persona_strategy_map[persona]
        return "default"

    def _build_assignment_chain(self, persona: str = "", agent_name: str = "", task_id: str = "", assignment: str = "") -> List[str]:
        """构建模型候选链（参考老版本content model_manager的17候选链设计）.

        查找优先级（从高到低）：
        1. assignment 参数：任务类型路由键（如 content_create/content_refine/judge），
           直接匹配 assignments[assignment]，让专用 assignment 真正生效
        2. persona + agent_name：精确匹配 assignments[persona][agent_name]
        3. persona：匹配 assignments[persona].default 或 assignments[persona]
        4. default：匹配 assignments.default
        5. 跨供应商兜底：build_cross_fallback_chain

        Args:
            assignment: 任务类型路由键（优先级最高，如 content_create/content_refine/judge）
            persona: persona 标识符
            agent_name: agent 名称
            task_id: 任务ID（用于cross-validation）
        """
        # 1. assignment 优先：直接匹配 assignments[assignment]
        #    让 content_create/content_refine/judge 等专用 assignment 真正生效
        if assignment:
            assign_config = self._assignments.get(assignment, {})
            primary = assign_config.get("primary", "")
            fallbacks = assign_config.get("fallbacks", [])
            if primary:
                chain = [primary]
                chain.extend(fallbacks)
                logger.info(f"[候选链] assignment='{assignment}' → primary={primary}, fallbacks={len(fallbacks)}个")
                return self._apply_rotation_and_cross_validation(chain, persona, task_id)

        # 1.5 agent_name 直接匹配 assignments（P0-25 新增）
        # 当 agent_name 本身作为 assignment key 时（如 "stockforge:stock_data"），
        # 直接匹配 assignments[agent_name]，无需 persona。
        # 这让 stockforge/contentforge/novelforge 等 *Forge agents 能在 models.yaml
        # 中独立配置 primary/fallbacks，而不必走 default → Doubao-Seed2.0。
        if agent_name:
            agent_assign = self._assignments.get(agent_name, {})
            primary = agent_assign.get("primary", "")
            fallbacks = agent_assign.get("fallbacks", [])
            if primary:
                chain = [primary]
                chain.extend(fallbacks)
                logger.info(f"[候选链] agent_name='{agent_name}' → primary={primary}, fallbacks={len(fallbacks)}个")
                return self._apply_rotation_and_cross_validation(chain, persona, task_id)

        # 2. persona + agent_name 精确匹配
        if persona and agent_name:
            persona_config = self._assignments.get(persona, {})
            agent_config = persona_config.get(agent_name, {})
            primary = agent_config.get("primary", "") or persona_config.get("primary", "")
            fallbacks = agent_config.get("fallbacks", []) or persona_config.get("fallbacks", [])
            if primary:
                chain = [primary]
                chain.extend(fallbacks)
                return self._apply_rotation_and_cross_validation(chain, persona, task_id)

        # 3. persona 匹配
        if persona:
            persona_config = self._assignments.get(persona, {})
            default_config = persona_config.get("default", {})
            primary = default_config.get("primary", "") or persona_config.get("primary", "")
            fallbacks = default_config.get("fallbacks", []) or persona_config.get("fallbacks", [])
            if primary:
                chain = [primary]
                chain.extend(fallbacks)
                return self._apply_rotation_and_cross_validation(chain, persona, task_id)

        # 4. default 匹配
        default_assign = self._assignments.get("default", {})
        primary = default_assign.get("primary", "")
        fallbacks = default_assign.get("fallbacks", [])
        if primary:
            chain = [primary]
            chain.extend(fallbacks)
            return self._apply_rotation_and_cross_validation(chain, persona, task_id)

        # 5. 跨供应商兜底
        return build_cross_fallback_chain(self._available_models, self._health_status)

    def _apply_rotation_and_cross_validation(self, chain: List[str], persona: str, task_id: str) -> List[str]:
        chain = self._resolve_model_candidates(chain)
        chain = self._apply_webchat_rotation(chain, task_id)
        chain = self._filter_disabled_models(chain)
        chain = self._apply_cross_validation(chain, persona, task_id)
        return chain

    def _resolve_model_candidates(self, chain: List[str]) -> List[str]:
        """Resolve raw model IDs to provider/model_id format.

        Handles three cases:
        1. Already in provider/model_id format with a known provider → keep as-is
        2. Bare model name (e.g., 'Doubao-Seed2.0') → prepend provider from _available_models
        3. Model ID containing '/' but prefix isn't a known provider
           (e.g., 'openai/gpt-oss-120b:free') → find full string in
           _available_models and prepend the actual provider (openrouter).
        """
        # Build reverse lookup: model_id → provider
        model_to_provider: dict[str, str] = {}
        for provider, models in self._available_models.items():
            for model_id in models:
                model_to_provider[model_id] = provider

        known_providers = set(self._providers.keys()) | set(PROVIDER_BASE_URLS.keys())

        resolved: list[str] = []
        for candidate in chain:
            if not candidate:
                continue
            # Case 1: already starts with a known provider prefix
            parts = candidate.split("/", 1)
            if len(parts) == 2 and parts[0] in known_providers:
                resolved.append(candidate)
                continue

            # Case 2 & 3: look up the full candidate string in the reverse map
            provider = model_to_provider.get(candidate)
            if provider:
                resolved_candidate = f"{provider}/{candidate}"
                if resolved_candidate != candidate:
                    logger.info(f"[候选链解析] '{candidate}' → '{resolved_candidate}'")
                resolved.append(resolved_candidate)
                continue

            # Fallback: keep as-is (will likely be skipped later with a warning)
            logger.debug(f"[候选链解析] '{candidate}' 未找到对应 provider，保留原值")
            resolved.append(candidate)

        return resolved

    def _apply_webchat_rotation(self, chain: List[str], task_id: str) -> List[str]:
        used = self._task_used_models.get(task_id, set())
        available = [m for m in WEB_CHAT_ROTATION_POOL
                     if m not in used and self._is_model_healthy(m)]
        if not available:
            available = [m for m in WEB_CHAT_ROTATION_POOL if self._is_model_healthy(m)]
        if not available:
            return chain
        rotated = []
        for m in chain:
            if m in ("proxy", "openroute/proxy", "web/chat", "openroute/web/chat"):
                chosen = available[self._webchat_rotation_index % len(available)]
                self._webchat_rotation_index += 1
                logger.info(f"WebChat rotation: {m} → {chosen} "
                            f"(task={task_id[:8] if task_id else 'N/A'}, "
                            f"used={len(used)}, pool={len(available)})")
                rotated.append(chosen)
            else:
                rotated.append(m)
        return rotated

    def _filter_disabled_models(self, models: List[str]) -> List[str]:
        """过滤已禁用的模型，同时匹配带前缀和不带前缀的名称。

        从 self._disabled_models（配置驱动）加载禁用列表，
        同时构建带前缀和不带前缀的名称集合，确保都能匹配。
        """
        if not self._disabled_models:
            return models
        disabled_names = set()
        for m in self._disabled_models:
            disabled_names.add(m)
            # 同时添加不带前缀的版本
            if "/" in m:
                disabled_names.add(m.split("/")[-1])
        filtered = [m for m in models if m not in disabled_names]
        if len(filtered) < len(models):
            removed = set(models) - set(filtered)
            logger.info(f"Filtered disabled models: {removed}")
        return filtered

    @staticmethod
    def _is_webchat_model(model_key: str) -> bool:
        """判断一个模型标识是否属于 WebChat backend。

        WebChat backend 模型特征：
        - model_id 为 proxy / openroute/proxy
        - model_id 包含 web/chat（如 deepseek-web/chat、doubao-web/chat）
        - model_id 包含 -web/（如 kimi-web/...）
        """
        if not model_key:
            return False
        # 去掉 provider 前缀，取 model_id 部分判断
        model_id = model_key.split("/", 1)[-1] if "/" in model_key else model_key
        if model_id in ("proxy", "openroute/proxy", "web/chat", "openroute/web/chat"):
            return True
        if "web/chat" in model_id or "-web/" in model_id:
            return True
        return False

    def _filter_webchat_models(self, chain: List[str]) -> List[str]:
        """过滤候选链中的 WebChat backend 模型，仅保留 API backend 模型。

        用于 prefer_api 场景（如评委调用），避免 WebChat backend 的
        8000 token 限制和 CoT 输出导致失败。
        """
        filtered = [m for m in chain if not self._is_webchat_model(m)]
        return filtered

    def _is_model_healthy(self, model_key: str) -> bool:
        status = self._health_status.get(model_key, {})
        if not status:
            return True
        cooldown_until = status.get("cooldown_until", 0)
        if time.time() < cooldown_until:
            return False
        return True

    def _apply_cross_validation(self, chain: List[str], persona: str, task_id: str) -> List[str]:
        if not task_id or persona not in ("judge", "evaluator", "reviewer", "reflexion_evaluator"):
            return chain
        used = self._task_used_models.get(task_id, set())
        if not used:
            return chain
        cross_validated = [m for m in chain if m not in used]
        if cross_validated:
            logger.info(f"Cross-validation: persona={persona} excluding used models {used}, "
                        f"choosing from {cross_validated[:3]}")
            return cross_validated
        logger.warning(f"Cross-validation: all models already used for task {task_id}, "
                       f"falling back to original chain")
        return chain


    def _emit_event(self, task_id: str, event_type: str, payload: dict):
        if self._event_bus:
            self._event_bus.emit(task_id, event_type, payload)

    async def execute(self, input: ToolInput) -> ToolOutput:
        messages = input.params.get("messages", [])
        model = input.params.get("model")
        # 修复：将 "auto"/"proxy"/"free" 视为无 hint（None），让候选链按 assignments 配置选模型
        # 原代码将 "auto" 当作具体模型传入，导致 openroute/auto 被加到候选链首位
        # 即使 disabled_models 配置了 openroute/auto 也不生效（因为它是被 model 参数直接指定的）
        # 用户反馈：创作/润色/5评委评审应使用web chat模型，auto/free/proxy 仅作备份
        if model in ("auto", "proxy", "free", ""):
            model = None
        temperature = input.params.get("temperature", 0.7)
        top_p = input.params.get("top_p")
        max_tokens = input.params.get("max_tokens", 4000)
        persona = input.params.get("persona")
        agent_name = input.params.get("agent_name")
        # assignment 参数：任务类型路由键（如 content_create/content_refine/judge）
        # 优先级高于 persona，让 models.yaml 中专用的 assignment 真正生效
        assignment = input.params.get("assignment")
        stream = input.params.get("stream", False)
        task_id = input.params.get("task_id", "unknown")
        tools = input.params.get("tools")
        skip_cooldown = input.params.get("skip_cooldown", False)
        prefer_api = input.params.get("prefer_api", False)
        # P0-4: 根据 agent_name 查找对应路由的 timeout（如 contentforge:writer → creative → 60s）
        agent_timeout = self._get_timeout_for_agent(agent_name or "")

        logger.info(f"[LLM请求] agent={agent_name or 'N/A'} persona={persona or 'N/A'} "
                    f"model={model or 'auto'} task_id={task_id[:8] if task_id else 'N/A'} "
                    f"messages={len(messages)} has_tools={bool(tools)} stream={stream} "
                    f"timeout={agent_timeout}s")

        # Call counter check
        call_count = self._task_call_counts.get(task_id, 0)
        if call_count >= MAX_CALLS_PER_TASK:
            self._emit_event(task_id, "llm.error", {
                "agent_name": agent_name or "unknown",
                "error": f"Max calls per task exceeded ({MAX_CALLS_PER_TASK})",
                "all_candidates_failed": True,
            })
            return ToolOutput(result={"content": "", "error": "max_calls_exceeded"}, error="max_calls_exceeded")

        if model:
            # Resolve model to provider/model_id format
            # Handle models like "deepseek-web/chat" or "doubao-web/chat" that contain "/"
            # but are NOT in "provider/model_id" format — they need "openroute/" prefix
            if "/" not in model:
                # Simple model ID without any slash — find which provider has it
                for provider, models in self._available_models.items():
                    if model in models:
                        model = f"{provider}/{model}"
                        break
            else:
                # Model contains slash — check if it's already in provider/model_id format
                # by checking if the part before first slash is a known provider
                first_part = model.split("/")[0]
                known_providers = set(self._providers.keys()) | set(PROVIDER_BASE_URLS.keys())
                if first_part not in known_providers:
                    # Not a provider prefix — this is a model ID like "deepseek-web/chat"
                    # that needs to be prefixed with the correct provider
                    found = False
                    for provider, models in self._available_models.items():
                        if model in models:
                            model = f"{provider}/{model}"
                            found = True
                            break
                    if not found:
                        # Default to openroute for web/chat models
                        if "-web/" in model or model.endswith("-web/chat"):
                            model = f"openroute/{model}"
            resolved_model = model
            assignment_chain = self._get_model_chain(persona, agent_name, task_id, assignment)
            if resolved_model in assignment_chain:
                # 修复：将调用方指定的模型排在候选链首位，其余作为 fallback。
                # 原代码 candidates = assignment_chain 导致所有评委都从路由 primary
                # (DeepSeek-V4-Pro) 开始尝试，5个评委中3个同时请求同一 provider，
                # 引发并发瓶颈全部超时。修复后每个评委从自己指定的模型开始。
                candidates = [resolved_model] + [c for c in assignment_chain if c != resolved_model]
            else:
                candidates = [resolved_model]
                seen = {resolved_model}
                for c in assignment_chain:
                    if c not in seen:
                        candidates.append(c)
                        seen.add(c)
                cross_chain = build_cross_fallback_chain(self._available_models, self._health_status)
                for c in cross_chain:
                    if c not in seen:
                        candidates.append(c)
                        seen.add(c)
        else:
            candidates = self._get_model_chain(persona, agent_name, task_id, assignment)

        if not candidates:
            candidates = build_cross_fallback_chain(self._available_models, self._health_status)

        # prefer_api: 过滤候选链中的 WebChat backend 模型，仅保留 API backend
        # WebChat backend 有 8000 token 限制且输出含 CoT，导致评委失败率高
        if prefer_api:
            filtered = self._filter_webchat_models(candidates)
            if len(filtered) < len(candidates):
                removed = set(candidates) - set(filtered)
                logger.info(f"[prefer_api] 过滤 WebChat backend 模型: {removed}")
            candidates = filtered if filtered else candidates

        if len(candidates) > MAX_CANDIDATES:
            logger.info(f"Candidate chain truncated: {len(candidates)} → {MAX_CANDIDATES}")
            candidates = candidates[:MAX_CANDIDATES]

        logger.info(f"[候选链] 完整列表 ({len(candidates)}): {candidates}")

        last_error = None
        tried_any = False
        for idx, candidate in enumerate(candidates):
            if not candidate or "/" not in candidate:
                logger.info(f"[候选链] #{idx+1} 跳过 '{candidate}': 格式无效（缺少provider前缀）")
                continue
            provider, model_id = candidate.split("/", 1)

            base_url = self._providers.get(provider, {}).get("base_url", PROVIDER_BASE_URLS.get(provider, ""))
            if not base_url:
                logger.info(f"[候选链] #{idx+1} 跳过 {provider}/{model_id}: 无 base_url")
                continue

            api_key = self._resolve_api_key(provider)
            if not api_key:
                logger.info(f"[候选链] #{idx+1} 跳过 {provider}/{model_id}: 无 API Key")
                continue

            tried_any = True
            key = f"{provider}/{model_id}"
            status = self._health_status.get(key, {})
            cooldown_until = status.get("cooldown_until", 0)
            if not skip_cooldown and time.time() < cooldown_until:
                remaining = int(cooldown_until - time.time())
                logger.info(f"[候选链] #{idx+1} 跳过 {key}: cooldown中，剩余{remaining}秒")
                continue

            # P0-2: CircuitBreaker 检查 — OPEN 状态直接跳过，防止雪崩
            breaker = get_circuit_breaker(key, failure_threshold=5, recovery_timeout=60.0)
            if not breaker.can_execute():
                logger.info(f"[候选链] #{idx+1} 跳过 {key}: 熔断器OPEN（连续失败≥5次）")
                continue

            # Increment call counter
            self._task_call_counts[task_id] = self._task_call_counts.get(task_id, 0) + 1
            if self._task_call_counts[task_id] > MAX_CALLS_PER_TASK:
                logger.warning(f"Task {task_id} exceeded max calls ({MAX_CALLS_PER_TASK})")
                break

            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            if provider == "openrouter":
                headers["HTTP-Referer"] = "https://flowforge.dev"
                headers["X-Title"] = "FlowForge"
            # openroute: 传 X-Scene header，让 openroute 网关正确路由
            if provider == "openroute":
                if tools:
                    headers["X-Scene"] = "openroute_combine"
                elif model_id in ("auto", "proxy", "free"):
                    headers["X-Scene"] = "auto"
                elif prefer_api:
                    # Phase 5.5: prefer_api=true 时使用 passthrough 场景
                    # 让 SceneRouter 走 API_FORWARD 通道，避免 caller_combine 强制走 WebChat
                    # 评委场景：caller_combine 会忽略 API 模型，强制用 WebChat 导致超时/截断
                    headers["X-Scene"] = "passthrough"
                else:
                    headers["X-Scene"] = "caller_combine"
                logger.debug(f"[X-Scene] provider=openroute model={model_id} has_tools={bool(tools)} prefer_api={prefer_api} → X-Scene={headers['X-Scene']}")

            payload = {
                "model": model_id, "messages": messages,
                "temperature": temperature, "max_tokens": max_tokens,
            }
            if top_p is not None:
                payload["top_p"] = top_p
            # 只有明确要求stream时才传stream参数
            # 老版本content不传stream，走非流式路径，从来没有英文CoT问题
            if stream:
                payload["stream"] = True
            if tools:
                payload["tools"] = tools
            # openroute/auto 模型：让 hiclaw openroute 自动选择最优模型
            # 不传 tools 给 auto 模式，让 openroute 自行决定路由
            if provider == "openroute" and model_id == "auto" and tools:
                payload["tools"] = tools
            # Phase 5.4: prefer_api 传递给 OpenRoute，让其在解析模型时跳过 web chat backend
            # 评委场景：web chat backend 会截断长 prompt 导致评委返回无效内容
            if prefer_api and provider == "openroute":
                payload["prefer_api"] = True
            url = base_url.rstrip("/") + "/chat/completions"

            # 请求详情日志
            masked_headers = dict(headers)
            if "Authorization" in masked_headers:
                auth_val = masked_headers["Authorization"]
                if auth_val.startswith("Bearer "):
                    token = auth_val[7:]
                    masked_headers["Authorization"] = f"Bearer {self._mask_api_key(token)}"
            messages_char_count = sum(len(json.dumps(m, ensure_ascii=False)) for m in messages)
            logger.info(f"[LLM请求详情] URL={url} model={model_id}")
            logger.info(f"[LLM请求详情] headers={masked_headers}")
            logger.info(f"[LLM请求详情] payload大小: messages字符数={messages_char_count} "
                        f"tools={len(tools) if tools else 0} stream={stream}")

            self._emit_event(task_id, "llm.start", {
                "agent_name": agent_name or "unknown",
                "model": f"{provider}/{model_id}",
                "candidate_index": candidates.index(candidate) + 1,
                "total_candidates": len(candidates),
            })

            logger.info(f"🤖 [LLM调用] agent={agent_name or '?'} → provider={provider} model={model_id} "
                        f"(候选 {idx+1}/{len(candidates)} timeout={agent_timeout}s)")

            # 🔍 关键诊断日志：记录喂给 LLM 的输入内容预览（用户反馈"喂给llm的内容有严重质量问题"）
            # 记录最后一条 user message 的前 800 字符，用于分析组合提示词是否有质量问题
            try:
                user_msgs = [m for m in messages if m.get("role") == "user"]
                if user_msgs:
                    last_user_msg = user_msgs[-1].get("content", "")
                    if isinstance(last_user_msg, list):
                        # multimodal content, extract text
                        last_user_msg = " ".join(
                            str(c.get("text", "")) for c in last_user_msg if isinstance(c, dict)
                        )
                    input_preview = str(last_user_msg)[:5000].replace("\n", "\\n")
                    input_len = len(str(last_user_msg))
                    system_msgs = [m for m in messages if m.get("role") == "system"]
                    system_len = sum(len(str(m.get("content", ""))) for m in system_msgs)
                    # v2.7: 增加 system prompt 预览（前2000字符），便于分析提示词组装质量
                    system_preview = ""
                    if system_msgs:
                        system_content = str(system_msgs[-1].get("content", ""))
                        system_preview = system_content[:2000].replace("\n", "\\n")
                    logger.info(f"[LLM输入] agent={agent_name or '?'} model={model_id} "
                                f"system_chars={system_len} user_chars={input_len} "
                                f"system_preview={system_preview!r} "
                                f"user_preview={input_preview!r}")
            except Exception as log_e:
                logger.warning(f"[LLM输入] 记录输入预览失败: {log_e}")

            retry_attempt = 0
            while True:
                start = time.time()
                try:
                    used_stream = stream
                    if stream:
                        content = await self._stream_call(url, headers, payload, task_id, agent_name, provider, model_id, timeout=agent_timeout)
                        if not content or (isinstance(content, str) and not content.strip()):
                            logger.info(f"Stream returned empty for {provider}/{model_id}, falling back to non-stream")
                            payload_fb = {**payload, "stream": False}
                            content = await self._normal_call(url, headers, payload_fb, timeout=agent_timeout)
                            used_stream = False
                    else:
                        content = await self._normal_call(url, headers, payload, timeout=agent_timeout)

                    duration = time.time() - start
                    tokens = 0
                    prompt_tokens = 0
                    completion_tokens = 0
                    tool_calls_result = None
                    raw_message = None
                    if not used_stream and isinstance(content, dict):
                        tokens = content.get("tokens", 0)
                        prompt_tokens = content.get("prompt_tokens", 0)
                        completion_tokens = content.get("completion_tokens", 0)
                        content_text = content["content"]
                        tool_calls_result = content.get("tool_calls")
                        raw_message = content.get("raw_message")
                    else:
                        content_text = content

                    # v2.7: 输出预览扩到3000字符（原300字符太短，无法分析 LLM 返回内容质量）
                    content_preview = content_text[:3000] if isinstance(content_text, str) else str(content_text)[:3000]
                    content_preview = content_preview.replace("\n", "\\n")
                    content_len = len(content_text) if isinstance(content_text, str) else len(str(content_text))
                    logger.info(f"[LLM响应] provider={provider} model={model_id} "
                                f"状态=成功 耗时={duration:.2f}s tokens={tokens} "
                                f"prompt_tokens={prompt_tokens} completion_tokens={completion_tokens} "
                                f"内容长度={content_len}")
                    logger.info(f"[LLM输出] agent={agent_name or '?'} model={model_id} "
                                f"preview={content_preview!r}")

                    metrics.record_tool_call("llm", duration)
                    metrics.record_llm_tokens(provider, model_id, tokens)
                    self._update_health(provider, model_id, True)
                    self._record_model_result(f"{provider}/{model_id}", True)
                    self._report_router_health(f"{provider}/{model_id}", True, duration)
                    # P0-2: 记录熔断器成功
                    breaker.record_success()

                    self._record_call_event(
                        provider=provider, model_id=model_id, status="success",
                        latency_ms=duration * 1000, input_tokens=prompt_tokens, output_tokens=tokens,
                        agent_name=agent_name or "", task_id=task_id,
                    )

                    self._emit_event(task_id, "llm.end", {
                        "agent_name": agent_name or "unknown",
                        "full_response": content_text[:500] if isinstance(content_text, str) else str(content_text)[:500],
                        "tokens": tokens,
                        "duration_ms": int(duration * 1000),
                        "has_tool_calls": tool_calls_result is not None and len(tool_calls_result) > 0,
                    })

                    if (not content_text or (isinstance(content_text, str) and not content_text.strip())) \
                            and not tool_calls_result:
                        logger.warning(f"LLM returned empty content for {provider}/{model_id}, trying next candidate")
                        self._update_health(provider, model_id, False, "empty_response")
                        self._record_model_result(f"{provider}/{model_id}", False, "empty_response")
                        last_error = Exception("empty_response")
                        break  # empty_response → next candidate, no retry

                    # 无效响应检测（参考老版本openclaw的llm_client.py）
                    # HTTP 200但内容无效（素材不足/系统命令泄露/响应过短等）
                    if isinstance(content_text, str) and not tool_calls_result:
                        # 创作类agent需要长度检查，审核类agent不需要
                        min_len = 50 if agent_name in ("creator", "polisher", "writer", "editor") else 0
                        if is_invalid_response(content_text, agent_name or "", min_length=min_len):
                            preview = content_text[:80].replace("\n", " ")
                            logger.warning(
                                f"[无效响应] {provider}/{model_id} 返回无效内容, "
                                f"agent={agent_name} 长度={len(content_text)} 预览='{preview}'"
                            )
                            self._update_health(provider, model_id, False, "invalid_response")
                            self._record_model_result(f"{provider}/{model_id}", False, "invalid_response")
                            last_error = Exception(f"invalid_response: {preview}")
                            break  # invalid_response → next candidate, no retry

                        # Echo响应检测：LLM返回user message内容而非生成内容（openroute网关bug）
                    # 日志特征：tokens很少（<50）但content长度很大（>500）
                    # 或content是user message的子串（被复制）
                    # Phase 5.5 修复: 移除 prompt_section_count 检测，因为正常 Markdown 文章
                    # 也包含多个 ### 标题，会导致误判。只有 content_in_user=True 才触发 Echo
                    # v3.4 修复: Doubao webchat后端将prompt中换行替换为空格,导致精确匹配失败
                    # 改用"移除空白后比较"识别变形echo响应
                    try:
                        user_msgs = [m for m in messages if m.get("role") == "user"]
                        is_echo = False
                        echo_reason = ""
                        if user_msgs:
                            last_user_msg = user_msgs[-1].get("content", "")
                            if isinstance(last_user_msg, list):
                                last_user_msg = " ".join(
                                    str(c.get("text", "")) for c in last_user_msg if isinstance(c, dict)
                                )
                            # 强检测1：tokens极少（<50）但content很长（>500）
                            # 正常长文生成tokens应>100，tokens<50且content>500基本是echo
                            # 注意：openroute webchat后端的token计数始终返回0（已知bug），
                            # 所以tokens==0不能单独作为echo_response判据，必须配合content_in_user检测
                            if tokens < 50 and len(content_text) > 500 and last_user_msg:
                                # v3.6: 多重检测 — 精确匹配 OR 移除空白后匹配 OR 模糊前缀匹配
                                # Doubao webchat会将prompt换行替换为空格,且可能产生"你是你是"等变形
                                content_in_user = content_text[:200] in last_user_msg
                                if not content_in_user:
                                    # 变形echo检测: 移除所有空白字符后比较前200字符
                                    import re as _re
                                    content_compact = _re.sub(r'\s+', '', content_text[:300])
                                    user_compact = _re.sub(r'\s+', '', last_user_msg)
                                    content_in_user = len(content_compact) > 50 and content_compact[:200] in user_compact
                                if not content_in_user:
                                    # v3.6 新增: 模糊前缀匹配 — 检测content前80字符是否与user message前80字符高度相似
                                    # 用于检测"你是你是"等变形echo（content开头与prompt开头相似但有重复/变形）
                                    content_head = _re.sub(r'\s+', '', content_text[:80])
                                    user_head = _re.sub(r'\s+', '', last_user_msg[:80])
                                    if len(content_head) > 30 and len(user_head) > 30:
                                        # 计算前缀相似度（前40字符的相同字符数）
                                        match_chars = sum(1 for c1, c2 in zip(content_head[:40], user_head[:40]) if c1 == c2)
                                        similarity = match_chars / 40.0
                                        if similarity > 0.7:  # 70%相似度
                                            content_in_user = True
                                if content_in_user:
                                    is_echo = True
                                    echo_reason = (f"strong_echo tokens={tokens} content_len={len(content_text)} "
                                                  f"content_in_user={content_in_user}")
                            # 弱检测2：tokens极少（<20）且content前100字符与user message前100字符完全匹配
                            elif (tokens < 20 and len(content_text) > 100
                                  and last_user_msg and len(last_user_msg) > 50):
                                content_head = content_text[:100]
                                user_head = last_user_msg[:100]
                                if content_head == user_head:
                                    is_echo = True
                                    echo_reason = (f"prefix_match tokens={tokens} "
                                                  f"content_len={len(content_text)} "
                                                  f"user_msg_len={len(last_user_msg)}")
                            # v3.4 新增检测3: tokens极少(<10)且content以prompt模板标题开头
                            # Doubao webchat返回"### 合规红线..."等prompt模板片段,tokens=2
                            # 这是最常见的echo变形,直接判定为echo
                            elif tokens < 10 and len(content_text) > 100:
                                _prompt_section_patterns = (
                                    "### 合规红线", "### 创作法则", "## 创作法则",
                                    "## 📊 创作法则", "## 🚫 反抄袭", "## 🔄 差异化",
                                    "## ⚡ 去AI味", "## 🎯 评委评分", "## 📊 质量评分",
                                    "## ⚠️ 时效性", "## 你的创作人格", "## 你的爆款方法论",
                                )
                                if any(content_text.startswith(p) for p in _prompt_section_patterns):
                                    is_echo = True
                                    echo_reason = (f"prompt_section_echo tokens={tokens} "
                                                  f"content_len={len(content_text)} "
                                                  f"preview='{content_text[:60]}'")
                        if is_echo:
                            logger.warning(
                                f"[Echo响应] {provider}/{model_id} 返回user message内容而非生成内容, "
                                f"agent={agent_name} {echo_reason} 预览='{content_text[:80]}'"
                            )
                            self._update_health(provider, model_id, False, "echo_response")
                            self._record_model_result(f"{provider}/{model_id}", False, "echo_response")
                            last_error = Exception(f"echo_response: LLM returned user message content")
                            break  # echo_response → next candidate, no retry
                    except Exception as echo_e:
                        logger.debug(f"[Echo响应] 检测失败: {echo_e}")

                    result = {
                        "content": content_text if isinstance(content_text, str) else content_text,
                        "provider": provider, "model": model_id, "tokens": tokens,
                    }
                    if tool_calls_result:
                        result["tool_calls"] = tool_calls_result
                    if raw_message:
                        result["raw_message"] = raw_message
                    used_key = f"{provider}/{model_id}"
                    if task_id not in self._task_used_models:
                        self._task_used_models[task_id] = set()
                    self._task_used_models[task_id].add(used_key)
                    return ToolOutput(result=result)
                except Exception as e:
                    duration = time.time() - start
                    error_str = str(e)
                    logger.warning(f"[LLM响应] provider={provider} model={model_id} "
                                   f"状态=失败 耗时={duration:.2f}s 错误={error_str[:300]}")
                    metrics.record_llm_error(provider, type(e).__name__)
                    self._update_health(provider, model_id, False, error_str)
                    self._record_model_result(f"{provider}/{model_id}", False, error_str)

                    error_type = classify_error(error_str)
                    self._report_router_health(f"{provider}/{model_id}", False, error_type=error_type)
                    # P0-2: 记录熔断器失败（连续失败≥5次将触发熔断）
                    breaker.record_failure()

                    self._record_call_event(
                        provider=provider, model_id=model_id, status="error",
                        latency_ms=duration * 1000,
                        error_message=error_str[:200],
                        agent_name=agent_name or "", task_id=task_id,
                    )

                    # 发射 llm.end 事件（失败时也必须发射，否则指标追踪断裂）
                    self._emit_event(task_id, "llm.end", {
                        "agent_name": agent_name or "unknown",
                        "full_response": "",
                        "tokens": 0,
                        "duration_ms": int(duration * 1000),
                        "error": error_str[:200],
                        "success": False,
                    })

                    if error_type in ("model_not_found", "no_permission"):
                        logger.info(f"  ❌ 永久性错误({error_type})，跳过 {provider}/{model_id}")
                        last_error = e
                        break  # exit while → next candidate
                    # L7: same-model retry with exponential backoff (L3: config from FailoverPolicy)
                    # 关键修复：按 agent_name 对应路由读取 max_retries
                    # judge 路由 max_retries=0 → 失败立即切换到下一个候选模型（不重试）
                    # default/creative 路由 max_retries=2 → 可以重试2次
                    agent_max_retries = self._get_retries_for_agent(agent_name or "")
                    if retry_attempt < agent_max_retries:
                        backoff = self._retry_delay_seconds * (2 ** retry_attempt)
                        logger.info(f"  ⚠ 临时性错误({error_type})，{backoff:.1f}s 后重试 "
                                    f"{provider}/{model_id} ({retry_attempt+1}/{agent_max_retries})")
                        await asyncio.sleep(backoff)
                        retry_attempt += 1
                        continue  # retry same model
                    logger.info(f"  ⚠ 重试 {agent_max_retries} 次后仍失败({error_type})，尝试下一个候选")
                    # 日志埋点：模型切换记录
                    logger.warning(
                        f"[模型切换] {provider}/{model_id} 失败({error_type}), "
                        f"切换到候选链下一个模型"
                    )
                    last_error = e
                    break  # exit while → next candidate

        if not tried_any or (tried_any and last_error is not None):
            # 断点B修复：构建候选链前同步 model_service 持久化健康状态
            self._sync_health_from_model_service()
            existing = set(candidates) if candidates else set()
            fallback_chain = build_cross_fallback_chain(self._available_models, self._health_status)
            fallback_chain = [c for c in fallback_chain if c not in existing]
            # 断点C修复：候选链耗尽时触发 force_update 自动重建
            if not fallback_chain:
                logger.info("[断点C] 跨供应商回退链为空，触发自动重建...")
                rebuilt_chain = await self._trigger_force_update_and_rebuild()
                fallback_chain = [c for c in rebuilt_chain if c not in existing]
            # prefer_api: 回退链也过滤 WebChat backend 模型
            if prefer_api:
                fallback_chain = self._filter_webchat_models(fallback_chain)
            if len(fallback_chain) > MAX_FALLBACK_CANDIDATES:
                fallback_chain = fallback_chain[:MAX_FALLBACK_CANDIDATES]
            if fallback_chain:
                logger.info(f"Primary candidates exhausted, retrying with cross-fallback chain ({len(fallback_chain)})")
                candidates = fallback_chain
                for candidate in candidates:
                    if not candidate or "/" not in candidate:
                        continue
                    provider, model_id = candidate.split("/", 1)
                    base_url = self._providers.get(provider, {}).get("base_url", PROVIDER_BASE_URLS.get(provider, ""))
                    if not base_url:
                        continue
                    api_key = self._resolve_api_key(provider)
                    if not api_key:
                        continue
                    key = f"{provider}/{model_id}"
                    status = self._health_status.get(key, {})
                    cooldown_until = status.get("cooldown_until", 0)
                    if not skip_cooldown and time.time() < cooldown_until:
                        continue
                    # Increment call counter for fallback calls
                    self._task_call_counts[task_id] = self._task_call_counts.get(task_id, 0) + 1
                    if self._task_call_counts[task_id] > MAX_CALLS_PER_TASK:
                        logger.warning(f"Task {task_id} exceeded max calls ({MAX_CALLS_PER_TASK})")
                        break
                    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                    if provider == "openrouter":
                        headers["HTTP-Referer"] = "https://flowforge.dev"
                        headers["X-Title"] = "FlowForge"
                    if provider == "openroute":
                        if tools:
                            headers["X-Scene"] = "openroute_combine"
                        elif model_id in ("auto", "proxy", "free"):
                            headers["X-Scene"] = "auto"
                        elif prefer_api:
                            # Phase 5.5: prefer_api=true 时使用 passthrough 场景（评委 fallback）
                            headers["X-Scene"] = "passthrough"
                        else:
                            headers["X-Scene"] = "caller_combine"
                        logger.info(f"🌐 [X-Scene] fallback provider=openroute model={model_id} "
                                    f"has_tools={bool(tools)} prefer_api={prefer_api} → X-Scene={headers['X-Scene']}")
                    payload_fb = {"model": model_id, "messages": messages, "temperature": temperature, "max_tokens": max_tokens, "stream": stream}
                    if top_p is not None:
                        payload_fb["top_p"] = top_p
                    if tools:
                        payload_fb["tools"] = tools
                    # Phase 5.4: fallback 路径也传递 prefer_api（评委场景）
                    if prefer_api and provider == "openroute":
                        payload_fb["prefer_api"] = True
                    url = base_url.rstrip("/") + "/chat/completions"
                    self._emit_event(task_id, "llm.start", {"agent_name": agent_name or "unknown", "model": f"{provider}/{model_id}", "candidate_index": candidates.index(candidate) + 1, "total_candidates": len(candidates)})
                    logger.info(f"🤖 [LLM回退] agent={agent_name or '?'} → {provider}/{model_id}")
                    start = time.time()
                    try:
                        content = await self._stream_call(url, headers, payload_fb, task_id, agent_name, provider, model_id, timeout=agent_timeout) if stream else await self._normal_call(url, headers, payload_fb, timeout=agent_timeout)
                        duration = time.time() - start
                        tokens = 0
                        prompt_tokens = 0
                        completion_tokens = 0
                        tool_calls_result = None
                        raw_message = None
                        if isinstance(content, dict):
                            tokens = content.get("tokens", 0)
                            prompt_tokens = content.get("prompt_tokens", 0)
                            completion_tokens = content.get("completion_tokens", 0)
                            content_text = content["content"]
                            tool_calls_result = content.get("tool_calls")
                            raw_message = content.get("raw_message")
                        else:
                            content_text = content
                        # v2.7: fallback 路径也记录输出预览（原缺失，无法分析 fallback 返回内容质量）
                        content_preview_fb = content_text[:3000] if isinstance(content_text, str) else str(content_text)[:3000]
                        content_preview_fb = content_preview_fb.replace("\n", "\\n")
                        content_len_fb = len(content_text) if isinstance(content_text, str) else len(str(content_text))
                        logger.info(f"[LLM回退响应] provider={provider} model={model_id} "
                                    f"状态=成功 耗时={duration:.2f}s prompt_tokens={prompt_tokens} "
                                    f"completion_tokens={completion_tokens} total_tokens={tokens} "
                                    f"内容长度={content_len_fb}")
                        logger.info(f"[LLM回退输出] agent={agent_name or '?'} model={model_id} "
                                    f"preview={content_preview_fb!r}")
                        metrics.record_tool_call("llm", duration)
                        self._update_health(provider, model_id, True)
                        self._record_call_event(
                            provider=provider, model_id=model_id, status="success",
                            latency_ms=duration * 1000, input_tokens=prompt_tokens, output_tokens=tokens,
                            agent_name=agent_name or "", task_id=task_id,
                        )
                        self._emit_event(task_id, "llm.end", {"agent_name": agent_name or "unknown", "full_response": content_text[:500] if isinstance(content_text, str) else str(content_text)[:500], "tokens": tokens, "duration_ms": int(duration * 1000), "has_tool_calls": tool_calls_result is not None and len(tool_calls_result) > 0})
                        if (not content_text or (isinstance(content_text, str) and not content_text.strip())) \
                                and not tool_calls_result:
                            self._update_health(provider, model_id, False, "empty_response")
                            last_error = Exception("empty_response")
                            continue
                        result = {"content": content_text if isinstance(content_text, str) else content_text, "provider": provider, "model": model_id, "tokens": tokens}
                        if tool_calls_result:
                            result["tool_calls"] = tool_calls_result
                        if raw_message:
                            result["raw_message"] = raw_message
                        used_key = f"{provider}/{model_id}"
                        if task_id not in self._task_used_models:
                            self._task_used_models[task_id] = set()
                        self._task_used_models[task_id].add(used_key)
                        return ToolOutput(result=result)
                    except Exception as e:
                        duration_fb = time.time() - start
                        logger.warning(f"LLM fallback failed for {provider}/{model_id}: {str(e)[:200]}")
                        self._update_health(provider, model_id, False, str(e))
                        self._record_call_event(
                            provider=provider, model_id=model_id, status="error",
                            latency_ms=duration_fb * 1000,
                            error_message=str(e)[:200],
                            agent_name=agent_name or "", task_id=task_id,
                        )
                        # 回退链失败时也发射 llm.end 事件
                        self._emit_event(task_id, "llm.end", {
                            "agent_name": agent_name or "unknown",
                            "full_response": "",
                            "tokens": 0,
                            "duration_ms": int(duration_fb * 1000),
                            "error": str(e)[:200],
                            "success": False,
                        })
                        last_error = e
                        continue

        # 所有候选模型都失败，发射最终错误事件
        # 日志埋点：所有候选模型耗尽
        logger.error(
            f"[全链失败] agent={agent_name or '?'} task={task_id} "
            f"所有候选模型耗尽, last_error={str(last_error)[:200] if last_error else 'no candidates'}"
        )
        self._emit_event(task_id, "llm.error", {
            "agent_name": agent_name or "unknown",
            "error": str(last_error)[:300] if last_error else "no candidates",
            "all_candidates_failed": True,
        })
        return ToolOutput(result={"content": "", "error": str(last_error)}, error=str(last_error))

    def cleanup_task(self, task_id: str):
        self._task_call_counts.pop(task_id, None)
        self._task_used_models.pop(task_id, None)

    async def _normal_call(self, url: str, headers: dict, payload: dict, timeout: float = None) -> dict:
        model_id = payload.get("model", "unknown")
        # P0-4: 使用 agent 专用超时（如果传入），否则回退到默认超时
        req_timeout = timeout if timeout is not None else self._request_timeout
        # v2: 使用精细超时配置，避免 chunked encoding 响应导致单一 timeout 不生效
        # connect=10s (连接建立), read=req_timeout (读取响应), write=30s (发送请求), pool=30s (连接池)
        timeout_config = httpx.Timeout(
            connect=10.0,
            read=float(req_timeout),
            write=30.0,
            pool=30.0,
        )
        logger.info(f"[_normal_call] 请求开始 URL={url} model={model_id} timeout={req_timeout}s")
        start = time.time()
        try:
            async with httpx.AsyncClient(timeout=timeout_config) as client:
                resp = await client.post(url, json=payload, headers=headers)
                duration = time.time() - start
                logger.info(f"[_normal_call] 响应返回 URL={url} model={model_id} "
                            f"状态码={resp.status_code} 耗时={duration:.2f}s")
                resp.raise_for_status()
                data = resp.json()
                # OpenRoute 可能在 HTTP 200 下返回 error body（如 all_backends_failed）
                # 或返回伪装的 chat.completion 但 content 是错误文案
                if "error" in data and "choices" not in data:
                    err_info = data["error"]
                    err_msg = err_info.get("message", str(err_info)) if isinstance(err_info, dict) else str(err_info)
                    raise RuntimeError(f"openroute_error: {err_msg}")
                if "choices" not in data:
                    raise RuntimeError(f"openroute_error: invalid response (no choices key): {str(data)[:200]}")
                message = data["choices"][0]["message"]
                content = message.get("content") or ""
                # openroute app.py:1342-1353 silent failure 检测:
                # 当模型被禁用/不可用时,openroute 返回 HTTP 200 + 伪装 chat.completion
                # content = "模型 X 当前不可用，请稍后重试"
                # 必须主动检测并抛错,否则业务侧会把错误文案当正常响应
                # 抛出含 "model disabled" 的错误,让 classify_error 识别为 model_not_found
                # (永久错误,立即切换到下一个候选,冷却 600s 避免频繁重试被禁用的模型)
                if content and isinstance(content, str) and "当前不可用" in content and "请稍后重试" in content:
                    raise RuntimeError(
                        f"openroute_silent_failure: model disabled - {content[:120]}"
                    )
                usage = data.get("usage", {}) or {}
                tokens = usage.get("total_tokens", 0)
                prompt_tokens = usage.get("prompt_tokens", 0)
                completion_tokens = usage.get("completion_tokens", 0)
                tool_calls = message.get("tool_calls")
                return {"content": content, "tokens": tokens, "tool_calls": tool_calls,
                        "raw_message": message, "prompt_tokens": prompt_tokens,
                        "completion_tokens": completion_tokens}
        except httpx.TimeoutException as e:
            duration = time.time() - start
            logger.warning(f"[_normal_call] 请求超时 URL={url} model={model_id} "
                           f"耗时={duration:.2f}s (timeout={req_timeout}s) 错误={str(e)[:300]}")
            raise
        except Exception as e:
            duration = time.time() - start
            logger.warning(f"[_normal_call] 请求失败 URL={url} model={model_id} "
                           f"耗时={duration:.2f}s 错误={str(e)[:300]}")
            raise

    async def _stream_call(self, url: str, headers: dict, payload: dict,
                           task_id: str, agent_name: str, provider: str, model_id: str,
                           timeout: float = None) -> str:
        # P0-4: 使用 agent 专用超时（如果传入），否则回退到默认超时
        req_timeout = timeout if timeout is not None else self._request_timeout
        # v2: 使用精细超时配置，避免 chunked encoding 响应导致单一 timeout 不生效
        timeout_config = httpx.Timeout(
            connect=10.0,
            read=float(req_timeout),
            write=30.0,
            pool=30.0,
        )
        logger.info(f"[_stream_call] 请求开始 URL={url} model={model_id} provider={provider} timeout={req_timeout}s")
        full_content = []
        start = time.time()
        try:
            async with httpx.AsyncClient(timeout=timeout_config) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as resp:
                    duration = time.time() - start
                    logger.info(f"[_stream_call] 响应返回 URL={url} model={model_id} "
                                f"状态码={resp.status_code} 耗时={duration:.2f}s")
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data_str = line[6:]
                        if data_str.strip() == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            text = delta.get("content", "")
                            if text:
                                full_content.append(text)
                                self._emit_event(task_id, "llm.stream", {
                                    "agent_name": agent_name or "unknown",
                                    "delta_text": text,
                                })
                        except json.JSONDecodeError:
                            continue
            duration = time.time() - start
            full_text = "".join(full_content)
            logger.info(f"[_stream_call] 流式完成 URL={url} model={model_id} "
                        f"总耗时={duration:.2f}s 内容长度={len(full_text)}")
            # openroute silent failure 检测(同 _normal_call)
            if full_text and "当前不可用" in full_text and "请稍后重试" in full_text:
                raise RuntimeError(
                    f"openroute_silent_failure: model disabled - {full_text[:120]}"
                )
            return full_text
        except Exception as e:
            duration = time.time() - start
            logger.warning(f"[_stream_call] 请求失败 URL={url} model={model_id} "
                           f"耗时={duration:.2f}s 错误={str(e)[:300]}")
            raise

    async def stream(self, input: ToolInput) -> AsyncIterator[str]:
        messages = input.params.get("messages", [])
        model = input.params.get("model")
        temperature = input.params.get("temperature", 0.7)
        max_tokens = input.params.get("max_tokens", 4000)
        persona = input.params.get("persona")
        agent_name = input.params.get("agent_name")
        task_id = input.params.get("task_id", "unknown")
        prefer_api = input.params.get("prefer_api", False)
        # P0-4: 根据 agent_name 查找对应路由的 timeout
        agent_timeout = self._get_timeout_for_agent(agent_name or "")

        if model:
            candidates = [model]
        else:
            candidates = self._get_model_chain(persona, agent_name)

        if not candidates:
            candidates = build_cross_fallback_chain(self._available_models, self._health_status)

        if len(candidates) > MAX_CANDIDATES:
            candidates = candidates[:MAX_CANDIDATES]

        for candidate in candidates:
            if not candidate or "/" not in candidate:
                continue
            provider, model_id = candidate.split("/", 1)
            base_url = self._providers.get(provider, {}).get("base_url", PROVIDER_BASE_URLS.get(provider, ""))
            if not base_url:
                continue
            api_key = self._resolve_api_key(provider)
            if not api_key:
                continue

            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            if provider == "openrouter":
                headers["HTTP-Referer"] = "https://flowforge.dev"
                headers["X-Title"] = "FlowForge"
            if provider == "openroute":
                if model_id in ("auto", "proxy", "free"):
                    headers["X-Scene"] = "auto"
                elif prefer_api:
                    # Phase 5.5: prefer_api=true 时使用 passthrough 场景（评委 stream）
                    headers["X-Scene"] = "passthrough"
                else:
                    headers["X-Scene"] = "caller_combine"
                logger.info(f"🌐 [X-Scene] stream provider=openroute model={model_id} "
                            f"prefer_api={prefer_api} → X-Scene={headers['X-Scene']}")

            payload = {
                "model": model_id, "messages": messages,
                "temperature": temperature, "max_tokens": max_tokens,
                "stream": True,
            }
            if top_p is not None:
                payload["top_p"] = top_p
            url = base_url.rstrip("/") + "/chat/completions"

            self._emit_event(task_id, "llm.start", {
                "agent_name": agent_name or "unknown", "model": f"{provider}/{model_id}",
            })

            start = time.time()
            full_content = []
            try:
                async with httpx.AsyncClient(timeout=agent_timeout) as client:
                    async with client.stream("POST", url, json=payload, headers=headers) as resp:
                        resp.raise_for_status()
                        async for line in resp.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data_str = line[6:]
                            if data_str.strip() == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data_str)
                                delta = chunk.get("choices", [{}])[0].get("delta", {})
                                text = delta.get("content", "")
                                if text:
                                    full_content.append(text)
                                    self._emit_event(task_id, "llm.stream", {
                                        "agent_name": agent_name or "unknown", "delta_text": text,
                                    })
                                    yield text
                            except json.JSONDecodeError:
                                continue

                duration = time.time() - start
                metrics.record_tool_call("llm", duration)
                self._update_health(provider, model_id, True)
                self._record_call_event(
                    provider=provider, model_id=model_id, status="success",
                    latency_ms=duration * 1000,
                    agent_name=agent_name or "", task_id=task_id,
                )
                self._emit_event(task_id, "llm.end", {
                    "agent_name": agent_name or "unknown",
                    "full_response": "".join(full_content)[:500],
                    "tokens": 0,
                })
                return
            except Exception as e:
                duration = time.time() - start
                logger.warning(f"LLM stream failed for {provider}/{model_id}: {e}")
                metrics.record_llm_error(provider, type(e).__name__)
                self._update_health(provider, model_id, False, str(e))
                self._record_call_event(
                    provider=provider, model_id=model_id, status="error",
                    latency_ms=duration * 1000,
                    error_message=str(e)[:200],
                    agent_name=agent_name or "", task_id=task_id,
                )
                continue

        raise RuntimeError("All LLM candidates failed for stream request")

    def _update_health(self, provider: str, model_id: str, success: bool, error: str = ""):
        key = f"{provider}/{model_id}"
        # v3.4 修复 + P0-32/P0-33 FIX: 用 setdefault 确保 key 存在并初始化完整 dict
        # 原bug: _sync_health_from_model_service 只设置 cooldown_until/error_count，
        # 不设置 success_count，导致 current["success_count"] += 1 抛 KeyError('success_count')
        # 被外层 except 捕获，把成功响应误标记为失败（错误='success_count'）
        # 使用 setdefault 确保所有必需字段存在（防御 _sync_health_from_model_service 的部分 dict 问题）
        current = self._health_status.setdefault(key, {
            "success_count": 0, "error_count": 0,
            "last_error": "", "last_check": "", "cooldown_until": 0,
        })
        current.setdefault("success_count", 0)
        current.setdefault("error_count", 0)
        current.setdefault("last_error", "")
        current.setdefault("last_check", "")
        current.setdefault("cooldown_until", 0)
        if success:
            current["success_count"] += 1
            current["last_error"] = ""
            current["cooldown_until"] = 0
            logger.info(f"[健康状态] {key} 调用成功 "
                        f"累计成功={current['success_count']} 累计失败={current['error_count']}")
        else:
            current["error_count"] += 1
            current["last_error"] = error[:200]
            error_type = classify_error(error)
            cooldown = ERROR_COOLDOWNS.get(error_type, 180)
            current["cooldown_until"] = time.time() + cooldown
            logger.warning(f"[健康状态] {key} 调用失败 "
                           f"错误类型={error_type} cooldown={cooldown}s "
                           f"累计成功={current['success_count']} 累计失败={current['error_count']} "
                           f"错误信息={error[:100]}")
        current["last_check"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self._health_status[key] = current

    def _record_model_result(self, model_key: str, success: bool, error: str = ""):
        try:
            from flowforge.tools.llm.model_service import get_model_service
            svc = get_model_service()
            if success:
                svc.record_call_success(model_key)
            else:
                svc.record_call_failure(model_key, error)
        except Exception:
            pass

    def _sync_health_from_model_service(self):
        """从 model_service 同步持久化健康状态到内存（断点B修复）.

        LLMClient 的候选链构建只读 self._health_status（纯内存，重启丢失），
        而 model_service 的 record_call_failure 写入 _health_data（持久化）。
        此方法在候选链构建前同步两者，确保：
        1. 持久化的 disabled 状态被尊重（不重试永久禁用的模型）
        2. 持久化的 suspended 状态被同步（挂起期内不尝试）
        3. openrouter/:free 的"永远可用"兜底状态被继承
        """
        try:
            from flowforge.tools.llm.model_service import get_model_service
            svc = get_model_service()
            if not svc:
                return
            for model_key, persistent_state in svc._health_data.items():
                status = persistent_state.get("status", "unknown")
                if status == "disabled":
                    # 永久禁用：设长 cooldown 避免重试
                    # P0-32 FIX: 使用 setdefault + 完整字段初始化，避免创建不完整 dict
                    # 导致后续 _update_health 的 KeyError('success_count') 崩溃
                    current = self._health_status.setdefault(model_key, {
                        "success_count": 0, "error_count": 0,
                        "last_error": "", "last_check": "", "cooldown_until": 0,
                    })
                    current.setdefault("success_count", 0)
                    current.setdefault("error_count", 0)
                    current["cooldown_until"] = time.time() + 86400
                    current["error_count"] = 999
                elif status == "suspended":
                    # 挂起：同步 cooldown
                    suspended_until = persistent_state.get("suspended_until_ts", 0)
                    if suspended_until > time.time():
                        current = self._health_status.setdefault(model_key, {
                            "success_count": 0, "error_count": 0,
                            "last_error": "", "last_check": "", "cooldown_until": 0,
                        })
                        current.setdefault("success_count", 0)
                        current.setdefault("error_count", 0)
                        current["cooldown_until"] = suspended_until
                elif status == "available":
                    # 永远可用（openrouter/:free 兜底）：清除 cooldown
                    current = self._health_status.setdefault(model_key, {
                        "success_count": 0, "error_count": 0,
                        "last_error": "", "last_check": "", "cooldown_until": 0,
                    })
                    current.setdefault("success_count", 0)
                    current.setdefault("error_count", 0)
                    current["cooldown_until"] = 0
                    current["error_count"] = 0
        except Exception as e:
            logger.debug(f"[断点B] 同步 model_service 健康状态失败: {e}")

    async def _trigger_force_update_and_rebuild(self) -> List[str]:
        """候选链耗尽时触发 force_update 并重建（断点C修复）.

        当 build_cross_fallback_chain 返回空链时，说明所有模型都在 cooldown。
        此时触发 model_service 的 force_update_models 并发健康检查，
        重建后重新同步状态并构建新的候选链。

        Returns:
            重建后的候选链（可能仍为空，但此时已有兜底保证）
        """
        try:
            from flowforge.tools.llm.model_service import get_model_service
            svc = get_model_service()
            if not svc:
                return []
            logger.info("[断点C] 候选链耗尽，触发 force_update_models 重建...")
            try:
                await asyncio.wait_for(svc.force_update_models(), timeout=30)
            except asyncio.TimeoutError:
                logger.warning("[断点C] force_update 超时(30s)，使用当前状态重建")
            except Exception as e:
                logger.warning(f"[断点C] force_update 失败: {e}")
            # 同步重建后的状态
            self._sync_health_from_model_service()
            # 重建候选链
            new_chain = build_cross_fallback_chain(self._available_models, self._health_status)
            if new_chain:
                logger.info(f"[断点C] force_update 后重建候选链: {len(new_chain)} 个模型")
                return new_chain
            # 最终兜底：确保至少有 openrouter/:free 模型
            free_models = [
                f"openrouter/{m}"
                for m in self._available_models.get("openrouter", [])
                if ":free" in m
            ][:3]
            if free_models:
                logger.info(f"[断点C] 使用 openrouter/:free 兜底: {free_models}")
                return free_models
            logger.error("[断点C] 无任何可用模型（包括兜底），返回空链")
            return []
        except Exception as e:
            logger.error(f"[断点C] 自动重建失败: {e}")
            return []

    def get_health_report(self) -> dict:
        models = []
        healthy = 0
        unhealthy = 0
        degraded = 0
        for key, status in self._health_status.items():
            provider, model_id = key.split("/", 1) if "/" in key else (key, "")
            error_count = status.get("error_count", 0)
            success_count = status.get("success_count", 0)
            if error_count == 0:
                model_status = "healthy"
                healthy += 1
            elif success_count > error_count:
                model_status = "degraded"
                degraded += 1
            else:
                model_status = "unhealthy"
                unhealthy += 1
            models.append({
                "model_key": key, "provider": provider, "model_id": model_id,
                "status": model_status, "last_check": status.get("last_check", ""),
                "error_count": error_count, "success_count": success_count,
                "last_error": status.get("last_error", ""),
            })
        return {
            "models": models,
            "summary": {"total": len(models), "healthy": healthy, "unhealthy": unhealthy, "degraded": degraded},
        }

    def get_assignments(self) -> dict:
        return dict(self._assignments)

    def update_assignment(self, persona: str, agent_name: str, primary_model: str, fallback_models: list = None):
        if persona not in self._assignments:
            self._assignments[persona] = {}
        self._assignments[persona][agent_name] = {
            "primary": primary_model,
            "fallbacks": fallback_models or [],
        }

    def get_available_models(self) -> Dict[str, List[str]]:
        return dict(self._available_models)

    def get_candidate_chain(self, persona: str = "", agent_name: str = "") -> List[str]:
        return self._get_model_chain(persona, agent_name)

    def _report_router_health(
        self,
        model_key: str,
        success: bool,
        latency: float = 0.0,
        error_type: str = "",
    ):
        """向 LLMRouter 报告模型调用健康状态.

        LLMRouter 不可用时静默跳过，不影响主流程。
        """
        if self._llm_router is None:
            return
        try:
            # LLMRouter 使用纯 model_id（不含 provider 前缀）
            model_id = model_key.split("/", 1)[-1] if "/" in model_key else model_key
            if success:
                # record_success 是 async，使用 fire-and-forget 方式
                asyncio.ensure_future(self._llm_router.record_success(model_id, latency))
            else:
                asyncio.ensure_future(self._llm_router.record_error(model_id, error_type))
        except Exception as e:
            logger.debug(f"LLMRouter健康报告失败（可忽略）: {e}")

    def _record_call_event(
        self,
        provider: str,
        model_id: str,
        status: str,
        latency_ms: float,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost: float = 0.0,
        error_message: str = "",
        agent_name: str = "",
        task_id: str = "",
    ) -> None:
        """Record an LLMCallEvent to the global collector (fire-and-forget)."""
        try:
            event = LLMCallEvent(
                trace_id=get_trace_id(),
                timestamp=time.time(),
                model=model_id,
                provider=provider,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                latency_ms=latency_ms,
                cost=cost,
                status=status,
                error_message=error_message,
                agent_name=agent_name,
                task_id=task_id,
            )
            collector = get_call_event_collector()
            asyncio.ensure_future(collector.record(event))
        except Exception as e:
            logger.debug(f"LLMCallEvent记录失败（可忽略）: {e}")
