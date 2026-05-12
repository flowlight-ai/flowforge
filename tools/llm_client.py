import os
import httpx
import time
from typing import List, Dict, Optional
from core.base_tool import BaseTool, ToolInput, ToolOutput
from core.tracing import get_logger
from core.config import system_config
from core import metrics

logger = get_logger("llm_client")


class LLMClient(BaseTool):
    name = "llm"
    description = "统一 LLM 调用客户端，支持多供应商和自动故障转移"
    parameters_schema = {
        "type": "object",
        "required": ["messages"],
        "properties": {
            "messages": {"type": "array", "description": "OpenAI 格式消息列表"},
            "model": {"type": "string", "description": "指定模型"},
            "temperature": {"type": "number", "default": 0.7},
            "max_tokens": {"type": "integer", "default": 4000},
        }
    }

    def __init__(self, models_config: dict = None):
        self._models_config = models_config or {}
        self._providers = self._models_config.get("providers", {})
        self._assignments = self._models_config.get("assignments", {})
        self._api_keys = {
            "openrouter": os.getenv("OPENROUTER_API_KEY", ""),
            "aliyuncs": os.getenv("ALIYUNCS_API_KEY", ""),
            "ark": os.getenv("ARK_API_KEY", ""),
        }

    def _get_model_chain(self, persona: str, agent_name: str) -> List[str]:
        persona_config = self._assignments.get(persona, {})
        agent_config = persona_config.get(agent_name, {})
        primary = agent_config.get("primary", "")
        fallbacks = agent_config.get("fallbacks", [])
        chain = [primary] if primary else []
        chain.extend(fallbacks)
        return chain

    async def execute(self, input: ToolInput) -> ToolOutput:
        messages = input.params.get("messages", [])
        model = input.params.get("model")
        temperature = input.params.get("temperature", 0.7)
        max_tokens = input.params.get("max_tokens", 4000)
        persona = input.params.get("persona")
        agent_name = input.params.get("agent_name")

        if model:
            candidates = [model]
        elif persona and agent_name:
            candidates = self._get_model_chain(persona, agent_name)
        else:
            default_provider = os.getenv("LLM_DEFAULT_PROVIDER", "openrouter")
            default_model = os.getenv("LLM_DEFAULT_MODEL", "anthropic/claude-3.5-sonnet")
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
            payload = {"model": model_id, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
            url = base_url.rstrip("/") + "/chat/completions"

            start = time.time()
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(url, json=payload, headers=headers)
                    resp.raise_for_status()
                    data = resp.json()
                    content = data["choices"][0]["message"]["content"]
                    tokens = data.get("usage", {}).get("total_tokens", 0)
                    duration = time.time() - start
                    metrics.record_tool_call("llm", duration)
                    metrics.record_llm_tokens(provider, model_id, tokens)
                    return ToolOutput(result={"content": content, "provider": provider, "model": model_id, "tokens": tokens})
            except Exception as e:
                logger.warning(f"LLM call failed for {provider}/{model_id}: {e}")
                last_error = e
                continue

        return ToolOutput(result={"content": "", "error": str(last_error)}, error=str(last_error))

    def _default_base_url(self, provider: str) -> str:
        urls = {
            "openrouter": "https://openrouter.ai/api/v1",
            "aliyuncs": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "ark": "https://ark.cn-beijing.volces.com/api/v3",
        }
        return urls.get(provider, "")
