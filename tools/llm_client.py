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
from typing import List, Dict, Optional, AsyncIterator
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.secret_store import get_secret_store
from flowforge.core.tracing import get_logger
from flowforge.core import metrics

logger = get_logger("llm_client")

DEFAULT_FREE_MODELS = {
    "openroute": [
        "auto",
        "proxy",
        "Doubao-Seed2.0",
        "MiniMax-M3",
        "GLM-5.1",
        "DeepSeek-V4-Pro",
        "Kimi-K2.6",
        "Qwen3.6-Plus",
        "HunYuan3",
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
    "openroute": "http://127.0.0.1:13000/v1",
}

ERROR_COOLDOWNS = {
    "rate_limit": 300,
    "no_permission": 3600,
    "model_not_found": 86400,
    "no_quota": 18000,
    "timeout": 120,
    "server_error": 60,
    "unknown": 180,
}

MAX_CANDIDATES = 3
MAX_FALLBACK_CANDIDATES = 3
MAX_CALLS_PER_TASK = 50

# WebChat 轮询池：使用 openroute 的 proxy 模型
# openroute 的 proxy 模型已内置 round-robin 负载均衡和繁忙模型跳过
# FlowForge 不需要重复实现轮询逻辑，直接委托给 openroute
WEB_CHAT_ROTATION_POOL = [
    "openroute/proxy",
]

DISABLED_MODELS = {
    "openroute/Doubao-Seed2.0",   # 豆包验证码问题
    "openroute/Qwen3.6-Plus",     # 千问不稳定
}


def classify_error(error_msg: str) -> str:
    msg = error_msg.lower()
    if any(k in msg for k in ["rate limit", "too many requests", "429"]):
        return "rate_limit"
    if any(k in msg for k in ["unauthorized", "forbidden", "403", "401", "invalid api key"]):
        return "no_permission"
    if any(k in msg for k in ["not found", "does not exist", "404"]):
        return "model_not_found"
    if any(k in msg for k in ["insufficient", "no quota", "no credits", "402"]):
        return "no_quota"
    if any(k in msg for k in ["timeout", "timed out", "connection"]):
        return "timeout"
    if any(k in msg for k in ["500", "502", "503", "server error"]):
        return "server_error"
    return "unknown"


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
    """
    provider_order = ["openroute", "openrouter"]
    grouped: Dict[str, List[str]] = {}
    for provider in provider_order:
        models = available_models.get(provider, [])
        healthy = []
        for m in models:
            key = f"{provider}/{m}"
            status = health_status.get(key, {})
            cooldown_until = status.get("cooldown_until", 0)
            if time.time() < cooldown_until:
                continue
            healthy.append(key)
        if healthy:
            grouped[provider] = healthy

    if not grouped:
        return []

    sorted_providers = sorted(grouped.keys(), key=lambda p: len(grouped[p]), reverse=True)

    chain = []
    max_len = max(len(v) for v in grouped.values())
    for i in range(max_len):
        for provider in sorted_providers:
            models = grouped[provider]
            if i < len(models):
                chain.append(models[i])

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
            "tools": {"type": "array", "description": "OpenAI function calling tools schema"},
        },
    }

    def __init__(self, models_config: dict = None, event_bus=None):
        self._models_config = models_config or {}
        self._providers = self._models_config.get("providers", {})
        self._assignments = self._models_config.get("assignments", {})
        self._event_bus = event_bus
        self._health_status: Dict[str, dict] = {}
        self._available_models: Dict[str, List[str]] = {}
        self._task_call_counts: Dict[str, int] = {}
        self._task_used_models: Dict[str, set] = {}
        self._webchat_rotation_index: int = 0
        self._build_available_models()

    def set_event_bus(self, event_bus):
        self._event_bus = event_bus

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

    def _get_model_chain(self, persona: str = "", agent_name: str = "", task_id: str = "") -> List[str]:
        if persona and agent_name:
            persona_config = self._assignments.get(persona, {})
            agent_config = persona_config.get(agent_name, {})
            primary = agent_config.get("primary", "") or persona_config.get("primary", "")
            fallbacks = agent_config.get("fallbacks", []) or persona_config.get("fallbacks", [])
            if primary:
                chain = [primary]
                chain.extend(fallbacks)
                return self._apply_rotation_and_cross_validation(chain, persona, task_id)

        if persona:
            persona_config = self._assignments.get(persona, {})
            default_config = persona_config.get("default", {})
            primary = default_config.get("primary", "") or persona_config.get("primary", "")
            fallbacks = default_config.get("fallbacks", []) or persona_config.get("fallbacks", [])
            if primary:
                chain = [primary]
                chain.extend(fallbacks)
                return self._apply_rotation_and_cross_validation(chain, persona, task_id)

        default_assign = self._assignments.get("default", {})
        primary = default_assign.get("primary", "")
        fallbacks = default_assign.get("fallbacks", [])
        if primary:
            chain = [primary]
            chain.extend(fallbacks)
            return self._apply_rotation_and_cross_validation(chain, persona, task_id)

        return build_cross_fallback_chain(self._available_models, self._health_status)

    def _apply_rotation_and_cross_validation(self, chain: List[str], persona: str, task_id: str) -> List[str]:
        chain = self._apply_webchat_rotation(chain, task_id)
        chain = self._filter_disabled_models(chain)
        chain = self._apply_cross_validation(chain, persona, task_id)
        return chain

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

    def _filter_disabled_models(self, chain: List[str]) -> List[str]:
        filtered = [m for m in chain if m not in DISABLED_MODELS]
        if len(filtered) < len(chain):
            removed = set(chain) - set(filtered)
            logger.info(f"Filtered disabled models: {removed}")
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
        temperature = input.params.get("temperature", 0.7)
        max_tokens = input.params.get("max_tokens", 4000)
        persona = input.params.get("persona")
        agent_name = input.params.get("agent_name")
        stream = input.params.get("stream", False)
        task_id = input.params.get("task_id", "unknown")
        tools = input.params.get("tools")

        logger.info(f"[LLM请求] agent={agent_name or 'N/A'} persona={persona or 'N/A'} "
                    f"model={model or 'auto'} task_id={task_id[:8] if task_id else 'N/A'} "
                    f"messages={len(messages)} has_tools={bool(tools)} stream={stream}")

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
            assignment_chain = self._get_model_chain(persona, agent_name, task_id)
            if resolved_model in assignment_chain:
                candidates = assignment_chain
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
            candidates = self._get_model_chain(persona, agent_name, task_id)

        if not candidates:
            candidates = build_cross_fallback_chain(self._available_models, self._health_status)

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
            if time.time() < cooldown_until:
                remaining = int(cooldown_until - time.time())
                logger.info(f"[候选链] #{idx+1} 跳过 {key}: cooldown中，剩余{remaining}秒")
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
            # openroute: pass X-Scene header for hiclaw openroute scene routing
            # - has tools → openroute_combine (OpenRoute handles prompt combination + tool parsing)
            # - auto/proxy model → auto (let hiclaw decide, proxy has built-in round-robin)
            # - no tools + specific model → caller_combine (FlowForge already composed the prompt)
            if provider == "openroute":
                if tools:
                    headers["X-Scene"] = "openroute_combine"
                elif model_id in ("auto", "proxy", "free"):
                    headers["X-Scene"] = "auto"
                else:
                    headers["X-Scene"] = "caller_combine"
                logger.info(f"🌐 [X-Scene] provider=openroute model={model_id} "
                            f"has_tools={bool(tools)} → X-Scene={headers['X-Scene']}")

            payload = {
                "model": model_id, "messages": messages,
                "temperature": temperature, "max_tokens": max_tokens,
                "stream": stream,
            }
            if tools:
                payload["tools"] = tools
            # openroute/auto 模型：让 hiclaw openroute 自动选择最优模型
            # 不传 tools 给 auto 模式，让 openroute 自行决定路由
            if provider == "openroute" and model_id == "auto" and tools:
                payload["tools"] = tools
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

            logger.info(f"🤖 [LLM调用] agent={agent_name or '?'} → provider={provider} model={model_id}")

            start = time.time()
            try:
                used_stream = stream
                if stream:
                    content = await self._stream_call(url, headers, payload, task_id, agent_name, provider, model_id)
                    if not content or (isinstance(content, str) and not content.strip()):
                        logger.info(f"Stream returned empty for {provider}/{model_id}, falling back to non-stream")
                        payload_fb = {**payload, "stream": False}
                        content = await self._normal_call(url, headers, payload_fb)
                        used_stream = False
                else:
                    content = await self._normal_call(url, headers, payload)

                duration = time.time() - start
                tokens = 0
                tool_calls_result = None
                raw_message = None
                if not used_stream and isinstance(content, dict):
                    tokens = content.get("tokens", 0)
                    content_text = content["content"]
                    tool_calls_result = content.get("tool_calls")
                    raw_message = content.get("raw_message")
                else:
                    content_text = content

                # 响应详情日志
                content_preview = content_text[:100] if isinstance(content_text, str) else str(content_text)[:100]
                content_len = len(content_text) if isinstance(content_text, str) else len(str(content_text))
                logger.info(f"[LLM响应] provider={provider} model={model_id} "
                            f"状态=成功 耗时={duration:.2f}s tokens={tokens}")
                logger.info(f"[LLM响应] 内容长度={content_len} 预览={content_preview!r}")

                metrics.record_tool_call("llm", duration)
                metrics.record_llm_tokens(provider, model_id, tokens)
                self._update_health(provider, model_id, True)
                self._record_model_result(f"{provider}/{model_id}", True)

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
                    continue

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

                # 发射 llm.end 事件（失败时也必须发射，否则指标追踪断裂）
                self._emit_event(task_id, "llm.end", {
                    "agent_name": agent_name or "unknown",
                    "full_response": "",
                    "tokens": 0,
                    "duration_ms": int(duration * 1000),
                    "error": error_str[:200],
                    "success": False,
                })

                error_type = classify_error(error_str)
                if error_type in ("model_not_found", "no_permission"):
                    logger.info(f"  ❌ 永久性错误({error_type})，跳过 {provider}/{model_id}")
                else:
                    logger.info(f"  ⚠ 临时性错误({error_type})，尝试下一个候选")

                last_error = e
                continue

        if not tried_any or (tried_any and last_error is not None):
            existing = set(candidates) if candidates else set()
            fallback_chain = build_cross_fallback_chain(self._available_models, self._health_status)
            fallback_chain = [c for c in fallback_chain if c not in existing]
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
                    if time.time() < cooldown_until:
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
                        else:
                            headers["X-Scene"] = "caller_combine"
                        logger.info(f"🌐 [X-Scene] fallback provider=openroute model={model_id} "
                                    f"has_tools={bool(tools)} → X-Scene={headers['X-Scene']}")
                    payload_fb = {"model": model_id, "messages": messages, "temperature": temperature, "max_tokens": max_tokens, "stream": stream}
                    if tools:
                        payload_fb["tools"] = tools
                    url = base_url.rstrip("/") + "/chat/completions"
                    self._emit_event(task_id, "llm.start", {"agent_name": agent_name or "unknown", "model": f"{provider}/{model_id}", "candidate_index": candidates.index(candidate) + 1, "total_candidates": len(candidates)})
                    logger.info(f"🤖 [LLM回退] agent={agent_name or '?'} → {provider}/{model_id}")
                    start = time.time()
                    try:
                        content = await self._stream_call(url, headers, payload_fb, task_id, agent_name, provider, model_id) if stream else await self._normal_call(url, headers, payload_fb)
                        duration = time.time() - start
                        tokens = 0
                        tool_calls_result = None
                        raw_message = None
                        if isinstance(content, dict):
                            tokens = content.get("tokens", 0)
                            content_text = content["content"]
                            tool_calls_result = content.get("tool_calls")
                            raw_message = content.get("raw_message")
                        else:
                            content_text = content
                        metrics.record_tool_call("llm", duration)
                        self._update_health(provider, model_id, True)
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
        self._emit_event(task_id, "llm.error", {
            "agent_name": agent_name or "unknown",
            "error": str(last_error)[:300] if last_error else "no candidates",
            "all_candidates_failed": True,
        })
        return ToolOutput(result={"content": "", "error": str(last_error)}, error=str(last_error))

    def cleanup_task(self, task_id: str):
        self._task_call_counts.pop(task_id, None)
        self._task_used_models.pop(task_id, None)

    async def _normal_call(self, url: str, headers: dict, payload: dict) -> dict:
        model_id = payload.get("model", "unknown")
        logger.info(f"[_normal_call] 请求开始 URL={url} model={model_id}")
        start = time.time()
        try:
            async with httpx.AsyncClient(timeout=300) as client:
                resp = await client.post(url, json=payload, headers=headers)
                duration = time.time() - start
                logger.info(f"[_normal_call] 响应返回 URL={url} model={model_id} "
                            f"状态码={resp.status_code} 耗时={duration:.2f}s")
                resp.raise_for_status()
                data = resp.json()
                message = data["choices"][0]["message"]
                content = message.get("content") or ""
                tokens = data.get("usage", {}).get("total_tokens", 0)
                tool_calls = message.get("tool_calls")
                return {"content": content, "tokens": tokens, "tool_calls": tool_calls, "raw_message": message}
        except Exception as e:
            duration = time.time() - start
            logger.warning(f"[_normal_call] 请求失败 URL={url} model={model_id} "
                           f"耗时={duration:.2f}s 错误={str(e)[:300]}")
            raise

    async def _stream_call(self, url: str, headers: dict, payload: dict,
                           task_id: str, agent_name: str, provider: str, model_id: str) -> str:
        logger.info(f"[_stream_call] 请求开始 URL={url} model={model_id} provider={provider}")
        full_content = []
        start = time.time()
        try:
            async with httpx.AsyncClient(timeout=300) as client:
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
            logger.info(f"[_stream_call] 流式完成 URL={url} model={model_id} "
                        f"总耗时={duration:.2f}s 内容长度={len(''.join(full_content))}")
            return "".join(full_content)
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
                else:
                    headers["X-Scene"] = "caller_combine"
                logger.info(f"🌐 [X-Scene] stream provider=openroute model={model_id} "
                            f"→ X-Scene={headers['X-Scene']}")

            payload = {
                "model": model_id, "messages": messages,
                "temperature": temperature, "max_tokens": max_tokens,
                "stream": True,
            }
            url = base_url.rstrip("/") + "/chat/completions"

            self._emit_event(task_id, "llm.start", {
                "agent_name": agent_name or "unknown", "model": f"{provider}/{model_id}",
            })

            start = time.time()
            full_content = []
            try:
                async with httpx.AsyncClient(timeout=300) as client:
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
                self._emit_event(task_id, "llm.end", {
                    "agent_name": agent_name or "unknown",
                    "full_response": "".join(full_content)[:500],
                    "tokens": 0,
                })
                return
            except Exception as e:
                logger.warning(f"LLM stream failed for {provider}/{model_id}: {e}")
                metrics.record_llm_error(provider, type(e).__name__)
                self._update_health(provider, model_id, False, str(e))
                continue

        raise RuntimeError("All LLM candidates failed for stream request")

    def _update_health(self, provider: str, model_id: str, success: bool, error: str = ""):
        key = f"{provider}/{model_id}"
        current = self._health_status.get(key, {
            "success_count": 0, "error_count": 0,
            "last_error": "", "last_check": "", "cooldown_until": 0,
        })
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
