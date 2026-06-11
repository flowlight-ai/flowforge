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
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List, Optional

from flowforge.core.base_tool import ToolInput
from flowforge.core.config import ConfigLoader
from flowforge.core.tracing import get_logger
from flowforge.tools.llm.model_service import ModelService, get_model_service

logger = get_logger("model_capability")


class ModelCapability:
    """Zero-config model access for upper-level projects.

    Wraps LLMClient and ModelService into a simple, high-level API.
    Upper projects never need to configure providers, models, or API keys —
    everything is inherited from flowforge's models.yaml.

    This class is a singleton: repeated construction returns the same instance.
    """

    _instance: Optional[ModelCapability] = None

    def __new__(cls) -> ModelCapability:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if hasattr(self, "_initialized"):
            return
        self._initialized = True
        self._llm_client: Optional[Any] = None
        self._model_service: Optional[ModelService] = None

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
        max_tokens: int = 4000,
        task_id: str = "sdk",
        tools: Optional[list] = None,
    ) -> Dict[str, Any]:
        """Send a chat message and return the response dict.

        Args:
            prompt: The user message content.
            system: Optional system prompt.
            persona: Persona identifier for model routing.
            agent_name: Agent name for model routing.
            model: Specific model to use (provider/model_id format).
            temperature: Sampling temperature.
            max_tokens: Maximum tokens to generate.
            task_id: Task identifier for event tracking.
            tools: Optional OpenAI function-calling tools schema.

        Returns:
            Dict with keys: content, provider, model, tokens, tool_calls (optional).
        """
        llm = self._ensure_llm_client()
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        params: Dict[str, Any] = {
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "persona": persona,
            "agent_name": agent_name,
            "task_id": task_id,
            "stream": False,
        }
        if model:
            params["model"] = model
        if tools:
            params["tools"] = tools

        output = await llm.execute(ToolInput(params=params))
        return output.result

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
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        params: Dict[str, Any] = {
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "persona": persona,
            "agent_name": agent_name,
            "task_id": task_id,
            "stream": True,
        }
        if model:
            params["model"] = model

        async for chunk in llm.stream(ToolInput(params=params)):
            yield chunk

    # ── Model discovery & health ────────────────────────────────────

    def list_models(self) -> List[dict]:
        """List all available models with health status.

        Returns:
            List of model info dicts (id, provider, enabled, health_status, etc.).
        """
        svc = self._ensure_model_service()
        return svc.get_models()

    def list_assignments(self) -> Dict[str, dict]:
        """List all model assignments (persona → model chain).

        Returns:
            Dict mapping assignment keys to their primary/fallbacks config.
        """
        svc = self._ensure_model_service()
        return svc.get_assignments()

    async def check_health(self, force: bool = False) -> List[dict]:
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

    def get_candidate_chain(self, persona: str = "", agent_name: str = "") -> List[str]:
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
