"""Model Capability Provider — Zero-config model access for upper projects.

Upper-level projects (contentforge, devforge, etc.) should use this module
to access all model capabilities. No need to configure models.yaml,
providers, or API keys — everything is inherited from flowforge.

Usage in upper projects:
    from flowforge.core.model_capability import ModelCapability

    mc = ModelCapability()

    # Simple LLM call
    result = await mc.chat("Write an article about AI")

    # Call with specific persona/agent routing
    result = await mc.chat("Write an article", persona="judge")

    # Get available models
    models = mc.list_models()

    # Check model health
    health = await mc.check_health()

    # Access the internal provider for advanced routing
    provider = mc.provider
    best_model = provider.get_model(capability="chat", preferred="deepseek-v4")
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from typing import Any

from flowforge.core.base_tool import ToolInput
from flowforge.core.config import ConfigLoader
from flowforge.core.tracing import get_logger
from flowforge.tools.llm.model_capability_provider import ModelCapabilityProvider
from flowforge.tools.llm.model_service import ModelService, get_model_service

logger = get_logger("model_capability")


class ModelCapability:
    """Zero-config model access for upper-level projects.

    Wraps LLMClient and ModelService into a simple, high-level API.
    Upper projects never need to configure providers, models, or API keys —
    everything is inherited from flowforge's models.yaml.

    Internally delegates model selection and health tracking to
    :class:`ModelCapabilityProvider`, which provides smart routing
    and degradation fallback.

    This class is a singleton: repeated construction returns the same instance.
    """

    _instance: ModelCapability | None = None

    def __new__(cls) -> ModelCapability:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if hasattr(self, "_initialized"):
            return
        self._initialized = True
        self._llm_client: Any | None = None
        self._model_service: ModelService | None = None
        self._provider: ModelCapabilityProvider | None = None

    # ── Lazy initialization ─────────────────────────────────────────

    def _ensure_llm_client(self) -> Any:
        """Lazily create the LLMClient on first access."""
        if self._llm_client is None:
            from flowforge.tools.llm_client import LLMClient
            config_loader = ConfigLoader()
            models_config = config_loader.get_models_config()
            self._llm_client = LLMClient(models_config=models_config)
        return self._llm_client

    def _ensure_model_service(self) -> ModelService:
        """Lazily obtain the ModelService singleton."""
        if self._model_service is None:
            self._model_service = get_model_service()
        return self._model_service

    def _ensure_provider(self) -> ModelCapabilityProvider:
        """Lazily create the ModelCapabilityProvider on first access.

        The provider is initialized from the same models config that
        LLMClient uses, ensuring consistent model discovery.
        """
        if self._provider is None:
            config_loader = ConfigLoader()
            models_config = config_loader.get_models_config()
            self._provider = ModelCapabilityProvider(config=models_config)
        return self._provider

    @property
    def provider(self) -> ModelCapabilityProvider:
        """Access the internal ModelCapabilityProvider for advanced routing.

        Use this to:
        - Query best model for a capability
        - Register custom models
        - Check per-model health status
        - Report success/failure for health tracking
        """
        return self._ensure_provider()

    # ── High-level chat API ─────────────────────────────────────────

    async def chat(
        self,
        prompt: str,
        *,
        system: str = "",
        persona: str = "",
        agent_name: str = "",
        model: str = "",
        temperature: float = 0.7,
        top_p: float | None = None,
        max_tokens: int = 4000,
        task_id: str = "sdk",
        tools: list | None = None,
        prefer_api: bool = False,
    ) -> dict[str, Any]:
        """Send a chat message and return the response dict.

        When no explicit model is specified, uses ModelCapabilityProvider
        to select the best available model based on capability and health.
        After the call, reports success/failure to the provider for
        ongoing health tracking.

        Args:
            prompt: The user message content.
            system: Optional system prompt.
            persona: Persona identifier for model routing.
            agent_name: Agent name for model routing.
            model: Specific model to use (provider/model_id format).
            temperature: Sampling temperature.
            top_p: Nucleus sampling parameter (optional).
            max_tokens: Maximum tokens to generate.
            task_id: Task identifier for event tracking.
            tools: Optional OpenAI function-calling tools schema.

        Returns:
            Dict with keys: content, provider, model, tokens, tool_calls (optional).
        """
        llm = self._ensure_llm_client()
        provider = self._ensure_provider()

        # Use provider to select best model if not explicitly specified
        selected_model = model
        if not selected_model:
            capability = None
            if persona:
                capability = f"persona:{persona}"
            elif agent_name:
                capability = f"agent:{agent_name}"
            selected_model = provider.get_model(
                capability=capability,
                preferred=model or None,
            ) or ""

        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        params: dict[str, Any] = {
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "persona": persona,
            "agent_name": agent_name,
            "task_id": task_id,
            "stream": False,
        }
        if top_p is not None:
            params["top_p"] = top_p
        if selected_model:
            params["model"] = selected_model
        if tools:
            params["tools"] = tools
        if prefer_api:
            params["prefer_api"] = True

        start_time = time.monotonic()
        try:
            output = await llm.execute(ToolInput(params=params))
            result = output.result

            # Report success to provider for health tracking
            latency_ms = (time.monotonic() - start_time) * 1000
            used_model = result.get("model", selected_model)
            if used_model:
                provider.report_success(used_model, latency_ms)

            return result
        except Exception as e:
            # Report failure to provider for degradation tracking
            if selected_model:
                provider.report_failure(selected_model, str(e))
            raise

    async def chat_stream(
        self,
        prompt: str,
        *,
        system: str = "",
        persona: str = "",
        agent_name: str = "",
        model: str = "",
        temperature: float = 0.7,
        max_tokens: int = 4000,
        task_id: str = "sdk",
    ) -> AsyncIterator[str]:
        """Stream a chat response, yielding text chunks.

        When no explicit model is specified, uses ModelCapabilityProvider
        to select the best available model.

        Args:
            prompt: The user message content.
            system: Optional system prompt.
            persona: Persona identifier for model routing.
            agent_name: Agent name for model routing.
            model: Specific model to use (provider/model_id format).
            temperature: Sampling temperature.
            max_tokens: Maximum tokens to generate.
            task_id: Task identifier for event tracking.

        Yields:
            Text chunks as they arrive from the LLM.
        """
        llm = self._ensure_llm_client()
        provider = self._ensure_provider()

        # Use provider to select best model if not explicitly specified
        selected_model = model
        if not selected_model:
            capability = None
            if persona:
                capability = f"persona:{persona}"
            elif agent_name:
                capability = f"agent:{agent_name}"
            selected_model = provider.get_model(
                capability=capability,
                preferred=model or None,
            ) or ""

        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        params: dict[str, Any] = {
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "persona": persona,
            "agent_name": agent_name,
            "task_id": task_id,
            "stream": True,
        }
        if selected_model:
            params["model"] = selected_model

        start_time = time.monotonic()
        try:
            async for chunk in llm.stream(ToolInput(params=params)):
                yield chunk
            # Report success after stream completes
            latency_ms = (time.monotonic() - start_time) * 1000
            if selected_model:
                provider.report_success(selected_model, latency_ms)
        except Exception as e:
            if selected_model:
                provider.report_failure(selected_model, str(e))
            raise

    # ── JSON-mode chat ──────────────────────────────────────────────

    async def chat_json(
        self,
        prompt: str,
        *,
        system: str = "",
        persona: str = "",
        agent_name: str = "",
        model: str = "",
        temperature: float = 0.3,
        max_tokens: int = 4096,
        task_id: str = "sdk",
    ) -> dict[str, Any]:
        """Send a chat message and parse the response as JSON.

        Convenience wrapper around :meth:`chat` that strips markdown
        code fences and parses the content as a JSON object. Useful for
        structured-output prompts (e.g. multi-actor debates, predictions).

        Args:
            prompt: The user message content (should instruct JSON output).
            system: Optional system prompt.
            persona: Persona identifier for model routing.
            agent_name: Agent name for model routing.
            model: Specific model to use (provider/model_id format).
            temperature: Sampling temperature (defaults to 0.3 for determinism).
            max_tokens: Maximum tokens to generate.
            task_id: Task identifier for event tracking.

        Returns:
            Parsed JSON object as a dict.

        Raises:
            ValueError: If the response cannot be parsed as JSON.
        """
        import json
        import re

        result = await self.chat(
            prompt=prompt,
            system=system,
            persona=persona,
            agent_name=agent_name,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            task_id=task_id,
        )
        content = result.get("content", "") if isinstance(result, dict) else str(result)
        if not content:
            raise ValueError("LLM 返回空内容，无法解析 JSON")

        # 去除 markdown 代码块包装
        cleaned = re.sub(r"^```(?:json)?\s*", "", content.strip(), flags=re.MULTILINE)
        cleaned = re.sub(r"\s*```$", "", cleaned.strip())
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as e:
            raise ValueError(
                f"LLM 输出 JSON 解析失败: {e}. 原始内容前 500 字符: {content[:500]}"
            ) from e

    # ── Model discovery & health ────────────────────────────────────

    def list_models(self) -> list[dict]:
        """List all available models with health status.

        Returns:
            List of model info dicts (id, provider, enabled, health_status, etc.).
        """
        svc = self._ensure_model_service()
        return svc.get_models()

    def list_assignments(self) -> dict[str, dict]:
        """List all model assignments (persona → model chain).

        Returns:
            Dict mapping assignment keys to their primary/fallbacks config.
        """
        svc = self._ensure_model_service()
        return svc.get_assignments()

    async def check_health(self, force: bool = False) -> list[dict]:
        """Run health checks on all models.

        Args:
            force: If True, re-check even cached results.

        Returns:
            List of health check result dicts.
        """
        svc = self._ensure_model_service()
        return await svc.health_check_all(force=force)

    def get_health_report(self) -> dict:
        """Get the current health report without re-checking.

        Returns:
            Dict with 'models' list and 'summary' counts.
        """
        svc = self._ensure_model_service()
        return svc.get_health_report()

    def get_candidate_chain(self, persona: str = "", agent_name: str = "") -> list[str]:
        """Get the model candidate chain for a persona/agent.

        Args:
            persona: Persona identifier.
            agent_name: Agent name.

        Returns:
            Ordered list of model keys (provider/model_id).
        """
        llm = self._ensure_llm_client()
        return llm.get_candidate_chain(persona=persona, agent_name=agent_name)

    # ── Reset singleton (for testing) ──────────────────────────────

    @classmethod
    def _reset(cls) -> None:
        """Reset the singleton instance. For testing only."""
        cls._instance = None
