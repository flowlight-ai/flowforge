"""Agent Handoff — Task delegation between agents.

Inspired by OpenAI Agents SDK's handoff pattern, agents can delegate
tasks to specialized agents. The LLM decides when to hand off based
on the agent's handoff configuration.

Usage:
    from flowforge.core.handoff import Handoff, HandoffManager

    # Define handoffs for an agent
    handoffs = [
        Handoff(target="topic_agent", condition="research and topic selection"),
        Handoff(target="writing_agent", condition="article writing and editing"),
        Handoff(target="review_agent", condition="content review and quality check"),
    ]

    # Register with HandoffManager
    hm = HandoffManager(agent_registry=agent_registry)
    hm.register_handoffs("coordinator_agent", handoffs)

    # Execute handoff (typically called by the agent during execution)
    result = await hm.execute_handoff(
        source_agent="coordinator_agent",
        target_agent="topic_agent",
        task="Research trending AI topics",
        context={"persona": "tech"}
    )
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.agent_registry import AgentRegistry
from flowforge.core.base_agent import AgentInput, AgentOutput
from flowforge.core.tracing import get_logger

logger = get_logger("handoff")


class Handoff(BaseModel):
    """Defines a delegation from one agent to another.

    Attributes:
        target: Name of the target agent to delegate to.
        condition: Description of when this handoff should be used.
        description: Optional longer description of the handoff purpose.
        metadata: Arbitrary metadata for the handoff.
    """

    target: str
    condition: str
    description: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class HandoffManager:
    """Manages handoff routing between agents.

    The HandoffManager validates target agents, transfers task context,
    executes the target agent, and returns the result to the caller.
    It also generates prompts that tell the LLM about available handoffs.
    """

    def __init__(self, agent_registry: AgentRegistry) -> None:
        self._agent_registry = agent_registry
        self._handoffs: dict[str, list[Handoff]] = {}

    def register_handoffs(self, agent_name: str, handoffs: list[Handoff]) -> None:
        """Register handoffs for a given agent.

        Args:
            agent_name: The name of the source agent.
            handoffs: List of Handoff configurations.
        """
        existing = self._handoffs.get(agent_name, [])
        # Merge: add new handoffs that don't duplicate existing targets
        existing_targets = {h.target for h in existing}
        for h in handoffs:
            if h.target not in existing_targets:
                existing.append(h)
                existing_targets.add(h.target)
                logger.info(f"Registered handoff: {agent_name} -> {h.target} ({h.condition})")
            else:
                logger.debug(f"Handoff to '{h.target}' already exists for '{agent_name}', skipping")
        self._handoffs[agent_name] = existing

    def get_handoffs(self, agent_name: str) -> list[Handoff]:
        """Get all handoffs registered for a given agent.

        Args:
            agent_name: The name of the source agent.

        Returns:
            A list of Handoff configurations. Empty list if none registered.
        """
        return list(self._handoffs.get(agent_name, []))

    async def execute_handoff(
        self,
        source_agent: str,
        target_agent: str,
        task: str,
        context: dict[str, Any] | None = None,
    ) -> AgentOutput:
        """Execute a handoff from one agent to another.

        Validates the target agent exists, constructs an AgentInput
        with the task and context, executes the target agent, and
        returns the result.

        Args:
            source_agent: Name of the agent initiating the handoff.
            target_agent: Name of the target agent to delegate to.
            task: The task description to hand off.
            context: Additional context to pass to the target agent.

        Returns:
            An AgentOutput from the target agent's execution.

        Raises:
            ValueError: If the target agent is not registered.
            ValueError: If no handoff is configured from source to target.
        """
        context = context or {}

        # Validate handoff is configured
        handoffs = self.get_handoffs(source_agent)
        valid_targets = {h.target for h in handoffs}
        if target_agent not in valid_targets:
            raise ValueError(
                f"No handoff configured from '{source_agent}' to '{target_agent}'. "
                f"Available targets: {sorted(valid_targets)}"
            )

        # Validate target agent exists
        agent = self._agent_registry.get(target_agent)
        if agent is None:
            raise ValueError(
                f"Target agent '{target_agent}' not found in registry. "
                f"Registered agents: {self._agent_registry.list_agents()}"
            )

        logger.info(f"Handoff: {source_agent} -> {target_agent} | task: {task[:100]}")

        # Build input with task and context
        params: dict[str, Any] = {"task": task, **context}
        agent_input = AgentInput(params=params, state=context.get("state"))

        # Execute the target agent
        try:
            result = await agent.execute(agent_input)
            logger.info(f"Handoff complete: {source_agent} -> {target_agent}")
            return result
        except Exception as e:
            logger.error(f"Handoff execution failed ({source_agent} -> {target_agent}): {e}")
            return AgentOutput(result={"error": str(e), "handoff_from": source_agent})

    def get_handoff_prompt(self, agent_name: str) -> str:
        """Generate a prompt that tells the LLM about available handoffs.

        This prompt is injected into the agent's system prompt so the
        LLM knows when it can delegate tasks to other agents.

        Args:
            agent_name: The name of the agent to generate the prompt for.

        Returns:
            A string describing available handoffs, or empty string
            if no handoffs are configured.
        """
        handoffs = self.get_handoffs(agent_name)
        if not handoffs:
            return ""

        lines = [
            "You can delegate tasks to the following specialized agents:",
            "",
        ]
        for h in handoffs:
            line = f"- {h.target}: {h.condition}"
            if h.description:
                line += f" ({h.description})"
            lines.append(line)

        lines.append("")
        lines.append(
            "To delegate a task, indicate which agent should handle it "
            "and provide the task description."
        )

        return "\n".join(lines)
