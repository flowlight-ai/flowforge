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
    "openrouter": [
        "baidu/cobuddy:free",
        "inclusionai/ring-2.6-1t:free",
        "z-ai/glm-4.5-air:free",
        "poolside/laguna-m.1:free",
        "minimax/minimax-m2.5:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
    ],
    "aliyuncs": [
        "glm-4.5-air",
        "qwen3.5-flash-2026-02-23",
        "qwen3.5-27b",
        "MiniMax-M2.5",
        "kimi-k2.5",
        "glm-4.5",
        "glm-4.6",
    ],
    "ark": [
        "glm-4-7-251222",
        "deepseek-v3-2-251201",
        "doubao-1-5-pro-32k-250115",
    ],
    "arkcode": [
        "ark-code-latest",
    ],
    "tencent": [
        "hunyuan-lite",
        "hunyuan-standard",
        "hunyuan-pro",
    ],
    "siliconflow": [
        "deepseek-ai/DeepSeek-V2.5",
    ],
    "kimi": [
        "kimi-k2.5",
    ],
    "zhipu": [
        "glm-4-flash",
    ],
    "webproxy": [
        "web/chat",
        "doubao-web/seed-2.0",
        "kimi-web/chat",
        "deepseek-web/chat",
        "yuanbao-web/chat",
        "qianwen-web/chat",
    ],
    "local": [],
}

PROVIDER_BASE_URLS = {
    "openrouter": "https://openrouter.ai/api/v1",
    "aliyuncs": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "ark": "https://ark.cn-beijing.volces.com/api/v3",
    "arkcode": "https://ark.cn-beijing.volces.com/api/coding/v3",
    "tencent": "https://hunyuan.tencentcloudapi.com/v1",
    "siliconflow": "https://api.siliconflow.cn/v1",
    "kimi": "https://api.moonshot.cn/v1",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4",
    "local": "http://localhost:11434/v1",
    "webproxy": "http://127.0.0.1:13000/v1",
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
    4. Webproxy models go last (as fallback)
    """
    provider_order = ["webproxy", "openrouter", "aliyuncs", "ark", "arkcode", "tencent", "siliconflow", "kimi", "zhipu", "local"]
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
        secret_store = get_secret_store()
        provider_config = self._providers.get(provider, {})
        api_key_env = provider_config.get("api_key_env", "")
        if api_key_env:
            key = secret_store.resolve(api_key_env)
            if key:
                return key
        key = secret_store.resolve(f"{provider.upper()}_API_KEY")
        if key:
            return key
        default = provider_config.get("api_key_default", "")
        if default:
            return default
        if provider == "webproxy":
            return "none"
        if provider == "local":
            return "local"
        return ""

    def _get_model_chain(self, persona: str = "", agent_name: str = "") -> List[str]:
        if persona and agent_name:
            persona_config = self._assignments.get(persona, {})
            agent_config = persona_config.get(agent_name, {})
            primary = agent_config.get("primary", "")
            fallbacks = agent_config.get("fallbacks", [])
            if primary:
                chain = [primary]
                chain.extend(fallbacks)
                return chain

        if persona:
            persona_config = self._assignments.get(persona, {})
            default_config = persona_config.get("default", {})
            primary = default_config.get("primary", "")
            fallbacks = default_config.get("fallbacks", [])
            if primary:
                chain = [primary]
                chain.extend(fallbacks)
                return chain

        default_assign = self._assignments.get("default", {})
        primary = default_assign.get("primary", "")
        fallbacks = default_assign.get("fallbacks", [])
        if primary:
            chain = [primary]
            chain.extend(fallbacks)
            return chain

        return build_cross_fallback_chain(self._available_models, self._health_status)

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

        if model:
            if "/" not in model:
                for provider, models in self._available_models.items():
                    if model in models:
                        model = f"{provider}/{model}"
                        break
            candidates = [model]
        else:
            candidates = self._get_model_chain(persona, agent_name)

        if not candidates:
            candidates = build_cross_fallback_chain(self._available_models, self._health_status)

        if len(candidates) > MAX_CANDIDATES:
            logger.info(f"Candidate chain truncated: {len(candidates)} → {MAX_CANDIDATES}")
            candidates = candidates[:MAX_CANDIDATES]

        logger.info(f"LLM candidate chain ({len(candidates)}): {candidates[:5]}...")

        last_error = None
        for candidate in candidates:
            if not candidate or "/" not in candidate:
                continue
            provider, model_id = candidate.split("/", 1)

            base_url = self._providers.get(provider, {}).get("base_url", PROVIDER_BASE_URLS.get(provider, ""))
            if not base_url:
                continue

            api_key = self._resolve_api_key(provider)
            if not api_key:
                logger.debug(f"Skipping {provider}/{model_id}: no API key")
                continue

            key = f"{provider}/{model_id}"
            status = self._health_status.get(key, {})
            cooldown_until = status.get("cooldown_until", 0)
            if time.time() < cooldown_until:
                logger.debug(f"Skipping {key}: cooldown until {cooldown_until}")
                continue

            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            if provider == "openrouter":
                headers["HTTP-Referer"] = "https://flowforge.dev"
                headers["X-Title"] = "FlowForge"

            payload = {
                "model": model_id, "messages": messages,
                "temperature": temperature, "max_tokens": max_tokens,
                "stream": stream,
            }
            if tools:
                payload["tools"] = tools
            url = base_url.rstrip("/") + "/chat/completions"

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

                result = {
                    "content": content_text if isinstance(content_text, str) else content_text,
                    "provider": provider, "model": model_id, "tokens": tokens,
                }
                if tool_calls_result:
                    result["tool_calls"] = tool_calls_result
                if raw_message:
                    result["raw_message"] = raw_message
                return ToolOutput(result=result)
            except Exception as e:
                duration = time.time() - start
                error_str = str(e)
                logger.warning(f"LLM call failed for {provider}/{model_id}: {error_str[:200]}")
                metrics.record_llm_error(provider, type(e).__name__)
                self._update_health(provider, model_id, False, error_str)
                self._record_model_result(f"{provider}/{model_id}", False, error_str)

                error_type = classify_error(error_str)
                if error_type in ("model_not_found", "no_permission"):
                    logger.info(f"  ❌ 永久性错误({error_type})，跳过 {provider}/{model_id}")
                else:
                    logger.info(f"  ⚠ 临时性错误({error_type})，尝试下一个候选")

                last_error = e
                continue

        return ToolOutput(result={"content": "", "error": str(last_error)}, error=str(last_error))

    async def _normal_call(self, url: str, headers: dict, payload: dict) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            message = data["choices"][0]["message"]
            content = message.get("content") or ""
            tokens = data.get("usage", {}).get("total_tokens", 0)
            tool_calls = message.get("tool_calls")
            return {"content": content, "tokens": tokens, "tool_calls": tool_calls, "raw_message": message}

    async def _stream_call(self, url: str, headers: dict, payload: dict,
                           task_id: str, agent_name: str, provider: str, model_id: str) -> str:
        full_content = []
        async with httpx.AsyncClient(timeout=120) as client:
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
                                "agent_name": agent_name or "unknown",
                                "delta_text": text,
                            })
                    except json.JSONDecodeError:
                        continue
        return "".join(full_content)

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
                async with httpx.AsyncClient(timeout=120) as client:
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
        else:
            current["error_count"] += 1
            current["last_error"] = error[:200]
            error_type = classify_error(error)
            cooldown = ERROR_COOLDOWNS.get(error_type, 180)
            current["cooldown_until"] = time.time() + cooldown
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
