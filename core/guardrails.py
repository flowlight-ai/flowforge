"""Guardrails — Parallel safety checks for agent execution.

Inspired by OpenAI Agents SDK's guardrail pattern, guardrails run
in parallel with the main execution flow and can:
- PASS: Allow the execution to continue
- WARN: Log a warning but allow execution
- BLOCK: Stop execution immediately
- MODIFY: Transform the input/output before proceeding

Usage:
    from flowforge.core.guardrails import InputGuardrail, OutputGuardrail, GuardrailResult

    class ContentSafetyGuardrail(InputGuardrail):
        name = "content_safety"

        async def check(self, input_text: str, context: dict) -> GuardrailResult:
            if any(word in input_text for word in BANNED_WORDS):
                return GuardrailResult(status="blocked", message="Contains banned content")
            return GuardrailResult(status="passed")

    class QualityGuardrail(OutputGuardrail):
        name = "quality_check"

        async def check(self, output_text: str, context: dict) -> GuardrailResult:
            if len(output_text) < 100:
                return GuardrailResult(status="warned", message="Output too short")
            return GuardrailResult(status="passed")
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import Literal, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("guardrails")


class GuardrailResult(BaseModel):
    """Result of a guardrail check.

    Attributes:
        status: One of "passed", "warned", "blocked", "modified".
        message: Human-readable description of the result.
        modified_data: When status is "modified", contains the transformed data.
    """

    status: Literal["passed", "warned", "blocked", "modified"] = "passed"
    message: str = ""
    modified_data: Optional[str] = None


class InputGuardrail(ABC):
    """Base class for input guardrails.

    Subclasses must implement the ``check`` method which inspects
    the input text and returns a GuardrailResult.
    """

    name: str = "unnamed_input_guardrail"

    @abstractmethod
    async def check(self, input_text: str, context: dict) -> GuardrailResult:
        """Check the input text against this guardrail's rules.

        Args:
            input_text: The text to inspect.
            context: Additional context from the execution environment.

        Returns:
            A GuardrailResult indicating pass/warn/block/modify.
        """
        ...


class OutputGuardrail(ABC):
    """Base class for output guardrails.

    Subclasses must implement the ``check`` method which inspects
    the output text and returns a GuardrailResult.
    """

    name: str = "unnamed_output_guardrail"

    @abstractmethod
    async def check(self, output_text: str, context: dict) -> GuardrailResult:
        """Check the output text against this guardrail's rules.

        Args:
            output_text: The text to inspect.
            context: Additional context from the execution environment.

        Returns:
            A GuardrailResult indicating pass/warn/block/modify.
        """
        ...


class GuardrailRegistry:
    """Registry for managing input and output guardrails.

    Guardrails are registered separately as input or output checks
    and can be looked up by name.
    """

    def __init__(self) -> None:
        self._input_guardrails: dict[str, InputGuardrail] = {}
        self._output_guardrails: dict[str, OutputGuardrail] = {}

    def register(self, guardrail: InputGuardrail | OutputGuardrail) -> None:
        """Register a guardrail instance.

        InputGuardrail instances are stored in the input registry;
        OutputGuardrail instances are stored in the output registry.

        Args:
            guardrail: An InputGuardrail or OutputGuardrail instance.
        """
        if isinstance(guardrail, InputGuardrail):
            if guardrail.name in self._input_guardrails:
                logger.debug(f"Input guardrail '{guardrail.name}' already registered, skipping duplicate")
                return
            self._input_guardrails[guardrail.name] = guardrail
            logger.info(f"Registered input guardrail: {guardrail.name}")
        elif isinstance(guardrail, OutputGuardrail):
            if guardrail.name in self._output_guardrails:
                logger.debug(f"Output guardrail '{guardrail.name}' already registered, skipping duplicate")
                return
            self._output_guardrails[guardrail.name] = guardrail
            logger.info(f"Registered output guardrail: {guardrail.name}")
        else:
            raise TypeError(f"Expected InputGuardrail or OutputGuardrail, got {type(guardrail)}")

    def unregister(self, name: str) -> None:
        """Remove a guardrail by name from both input and output registries.

        Args:
            name: The guardrail name to unregister.

        Raises:
            KeyError: If the name is not found in either registry.
        """
        found = False
        if name in self._input_guardrails:
            del self._input_guardrails[name]
            found = True
        if name in self._output_guardrails:
            del self._output_guardrails[name]
            found = True
        if not found:
            raise KeyError(f"Guardrail '{name}' not registered")

    def get_input_guardrails(self) -> list[InputGuardrail]:
        """Return all registered input guardrails."""
        return list(self._input_guardrails.values())

    def get_output_guardrails(self) -> list[OutputGuardrail]:
        """Return all registered output guardrails."""
        return list(self._output_guardrails.values())


class GuardrailExecutor:
    """Executes guardrails in parallel using asyncio.gather.

    If any guardrail returns "blocked", execution stops immediately
    and the blocked result is returned along with results collected
    so far.
    """

    def __init__(self, registry: GuardrailRegistry) -> None:
        self._registry = registry

    async def run_input_guardrails(
        self, input_text: str, context: dict
    ) -> list[GuardrailResult]:
        """Run all input guardrails in parallel.

        Args:
            input_text: The input text to check.
            context: Additional execution context.

        Returns:
            A list of GuardrailResult from each guardrail.
            If any result is "blocked", returns immediately with
            results collected so far plus the blocked result.
        """
        guardrails = self._registry.get_input_guardrails()
        if not guardrails:
            return []

        tasks = [g.check(input_text, context) for g in guardrails]
        results = await self._run_parallel(tasks, guardrails)
        return results

    async def run_output_guardrails(
        self, output_text: str, context: dict
    ) -> list[GuardrailResult]:
        """Run all output guardrails in parallel.

        Args:
            output_text: The output text to check.
            context: Additional execution context.

        Returns:
            A list of GuardrailResult from each guardrail.
            If any result is "blocked", returns immediately with
            results collected so far plus the blocked result.
        """
        guardrails = self._registry.get_output_guardrails()
        if not guardrails:
            return []

        tasks = [g.check(output_text, context) for g in guardrails]
        results = await self._run_parallel(tasks, guardrails)
        return results

    async def _run_parallel(
        self,
        tasks: list,
        guardrails: list[InputGuardrail | OutputGuardrail],
    ) -> list[GuardrailResult]:
        """Run guardrail check tasks in parallel with early blocking.

        Uses asyncio.gather with return_exceptions=True so that one
        failing guardrail does not prevent others from completing.
        If any guardrail returns "blocked", we return immediately.
        """
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

        results: list[GuardrailResult] = []
        for i, raw in enumerate(raw_results):
            guardrail_name = guardrails[i].name
            if isinstance(raw, Exception):
                logger.error(f"Guardrail '{guardrail_name}' raised an error: {raw}")
                results.append(
                    GuardrailResult(
                        status="warned",
                        message=f"Guardrail '{guardrail_name}' error: {raw}",
                    )
                )
            elif isinstance(raw, GuardrailResult):
                results.append(raw)
                if raw.status == "blocked":
                    logger.warning(f"Guardrail '{guardrail_name}' blocked execution: {raw.message}")
                    return results
                elif raw.status == "warned":
                    logger.warning(f"Guardrail '{guardrail_name}' warning: {raw.message}")
                elif raw.status == "modified":
                    logger.info(f"Guardrail '{guardrail_name}' modified data: {raw.message}")
            else:
                logger.error(f"Guardrail '{guardrail_name}' returned unexpected type: {type(raw)}")
                results.append(
                    GuardrailResult(
                        status="warned",
                        message=f"Guardrail '{guardrail_name}' returned unexpected type",
                    )
                )

        return results
