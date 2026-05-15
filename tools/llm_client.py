import os
import json
import httpx
import time
import asyncio
from typing import List, Dict, Optional, AsyncIterator
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger
from flowforge.core.config import system_config
from flowforge.core import metrics

logger = get_logger("llm_client")


class LLMClient(BaseTool):
    name = "llm"
    description = "统一 LLM 调用客户端，支持多供应商、自动故障转移和流式输出"
    parameters_schema = {
        "type": "object",
        "required": ["messages"],
        "properties": {
            "messages": {"type": "array", "description": "OpenAI 格式消息列表"},
            "model": {"type": "string", "description": "指定模型"},
            "temperature": {"type": "number", "default": 0.7},
            "max_tokens": {"type": "integer", "default": 4000},
            "stream": {"type": "boolean", "default": False, "description": "是否启用流式输出"},
            "persona": {"type": "string", "description": "专栏标识，用于模型路由"},
            "agent_name": {"type": "string", "description": "Agent名称，用于模型路由"},
        }
    }

    def __init__(self, models_config: dict = None, event_bus=None):
        self._models_config = models_config or {}
        self._providers = self._models_config.get("providers", {})
        self._assignments = self._models_config.get("assignments", {})
        self._api_keys = {
            "openrouter": os.getenv("OPENROUTER_API_KEY", ""),
            "aliyuncs": os.getenv("ALIYUNCS_API_KEY", ""),
            "ark": os.getenv("ARK_API_KEY", ""),
            "local": os.getenv("LOCAL_LLM_API_KEY", "local"),
            "webproxy": os.getenv("WEBPROXY_API_KEY", "none"),
        }
        self._event_bus = event_bus
        self._health_status: Dict[str, dict] = {}

    def set_event_bus(self, event_bus):
        self._event_bus = event_bus

    def _get_model_chain(self, persona: str, agent_name: str) -> List[str]:
        persona_config = self._assignments.get(persona, {})
        agent_config = persona_config.get(agent_name, {})
        primary = agent_config.get("primary", "")
        fallbacks = agent_config.get("fallbacks", [])
        chain = [primary] if primary else []
        chain.extend(fallbacks)
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

        if model:
            candidates = [model]
        elif persona and agent_name:
            candidates = self._get_model_chain(persona, agent_name)
        else:
            default_provider = os.getenv("LLM_DEFAULT_PROVIDER", "webproxy")
            default_model = os.getenv("LLM_DEFAULT_MODEL", "doubao-web/seed-2.0")
            candidates = [f"{default_provider}/{default_model}"]

        last_error = None
        for candidate in candidates:
            if not candidate or "/" not in candidate:
                continue
            provider, model_id = candidate.split("/", 1)
            base_url = self._providers.get(provider, {}).get("base_url", self._default_base_url(provider))
            api_key = self._api_keys.get(provider, "")
            if not api_key:
                continue

            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {
                "model": model_id, "messages": messages,
                "temperature": temperature, "max_tokens": max_tokens,
                "stream": stream,
            }
            url = base_url.rstrip("/") + "/chat/completions"

            self._emit_event(task_id, "llm.start", {
                "agent_name": agent_name or "unknown",
                "model": f"{provider}/{model_id}",
            })

            start = time.time()
            try:
                if stream:
                    content = await self._stream_call(url, headers, payload, task_id, agent_name, provider, model_id)
                else:
                    content = await self._normal_call(url, headers, payload)

                duration = time.time() - start
                tokens = 0
                if not stream and isinstance(content, dict):
                    tokens = content.get("tokens", 0)
                    content_text = content["content"]
                else:
                    content_text = content

                metrics.record_tool_call("llm", duration)
                metrics.record_llm_tokens(provider, model_id, tokens)
                self._update_health(provider, model_id, True)

                self._emit_event(task_id, "llm.end", {
                    "agent_name": agent_name or "unknown",
                    "full_response": content_text[:500] if isinstance(content_text, str) else str(content_text)[:500],
                    "tokens": tokens,
                })

                return ToolOutput(result={
                    "content": content_text if isinstance(content_text, str) else content_text,
                    "provider": provider, "model": model_id, "tokens": tokens,
                })
            except Exception as e:
                duration = time.time() - start
                logger.warning(f"LLM call failed for {provider}/{model_id}: {e}")
                metrics.record_llm_error(provider, type(e).__name__)
                self._update_health(provider, model_id, False, str(e))
                last_error = e
                continue

        return ToolOutput(result={"content": "", "error": str(last_error)}, error=str(last_error))

    async def _normal_call(self, url: str, headers: dict, payload: dict) -> dict:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            tokens = data.get("usage", {}).get("total_tokens", 0)
            return {"content": content, "tokens": tokens}

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
        elif persona and agent_name:
            candidates = self._get_model_chain(persona, agent_name)
        else:
            default_provider = os.getenv("LLM_DEFAULT_PROVIDER", "webproxy")
            default_model = os.getenv("LLM_DEFAULT_MODEL", "doubao-web/seed-2.0")
            candidates = [f"{default_provider}/{default_model}"]

        for candidate in candidates:
            if not candidate or "/" not in candidate:
                continue
            provider, model_id = candidate.split("/", 1)
            base_url = self._providers.get(provider, {}).get("base_url", self._default_base_url(provider))
            api_key = self._api_keys.get(provider, "")
            if not api_key:
                continue

            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
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

        raise RuntimeError(f"All LLM candidates failed for stream request")

    def _update_health(self, provider: str, model_id: str, success: bool, error: str = ""):
        key = f"{provider}/{model_id}"
        current = self._health_status.get(key, {"success_count": 0, "error_count": 0, "last_error": "", "last_check": ""})
        if success:
            current["success_count"] += 1
            current["last_error"] = ""
        else:
            current["error_count"] += 1
            current["last_error"] = error
        current["last_check"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self._health_status[key] = current

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

    def _default_base_url(self, provider: str) -> str:
        urls = {
            "openrouter": "https://openrouter.ai/api/v1",
            "aliyuncs": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "ark": "https://ark.cn-beijing.volces.com/api/v3",
            "local": os.getenv("LOCAL_LLM_BASE_URL", "http://localhost:11434/v1"),
            "webproxy": os.getenv("WEBPROXY_BASE_URL", "http://127.0.0.1:13000/v1"),
        }
        return urls.get(provider, "")
