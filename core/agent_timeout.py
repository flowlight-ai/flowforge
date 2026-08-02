from __future__ import annotations

import asyncio
from typing import Any

from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput


class AgentTimeoutError(Exception):
    def __init__(self, agent_name: str, timeout: float) -> None:
        super().__init__(f"Agent '{agent_name}' timed out after {timeout}s")
        self.agent_name = agent_name
        self.timeout = timeout


class TimeoutAgentWrapper(BaseAgent):
    def __init__(self, agent: BaseAgent, timeout: float = 300.0) -> None:
        self._agent = agent
        self._timeout = timeout
        self.name = agent.name
        self.description = agent.description
        self.default_mode = agent.default_mode

    async def execute(self, input: AgentInput) -> AgentOutput:
        try:
            return await asyncio.wait_for(self._agent.execute(input), timeout=self._timeout)
        except asyncio.TimeoutError:
            raise AgentTimeoutError(self.name, self._timeout)

    async def execute_with_context(self, input: AgentInput, context: Any) -> AgentOutput:
        try:
            return await asyncio.wait_for(
                self._agent.execute_with_context(input, context), timeout=self._timeout
            )
        except asyncio.TimeoutError:
            raise AgentTimeoutError(self.name, self._timeout)
