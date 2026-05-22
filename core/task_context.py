"""Task context management for FlowForge workflows.

Provides the TaskContext data container that carries all runtime state,
configuration, and service references needed by executors and agents
throughout the lifecycle of a workflow task.

License: MIT
"""

from typing import Any, Dict, Optional
from datetime import datetime, timezone


class TaskContext:
    """Runtime context object that travels with a task through the execution pipeline.

    TaskContext aggregates all the information an executor or agent needs to
    perform its work: the task identifier, input payload, shared state,
    tool/agent registries, event bus reference, checkpoint manager, and more.
    It also supports spawning child contexts for sub-step execution via the
    ``from_parent`` class method.

    Attributes:
        task_id: Unique identifier for the task.
        input_data: The original input payload for the task.
        metadata: Arbitrary key-value metadata attached to the task.
        state: Mutable shared state dictionary used during execution.
        tools: Tool registry instance available to the task.
        agents: Agent registry instance available to the task.
        mode: The execution mode name (e.g. ``"react"``, ``"workflow"``).
        interaction_mode: Interaction style (``"normal"``, ``"solo"``, or ``"auto"``).
        checkpoint: Checkpoint manager for persistence and recovery.
        event_bus: Event bus for emitting task lifecycle events.
        memory: Memory manager for long-term recall.
        executor: Reference back to the HybridExecutor running this task.
        persona: The persona identifier this task is bound to.
        created_at: ISO-8601 timestamp of when the context was created.
    """

    def __init__(self, task_id: str, input_data: dict, **kwargs):
        """Initialize a TaskContext.

        Args:
            task_id: Unique identifier for the task.
            input_data: The input payload dictionary for the task.
            **kwargs: Optional keyword arguments consumed as context fields.
                Supported keys: ``metadata``, ``state``, ``tools``, ``agents``,
                ``mode``, ``interaction_mode``, ``checkpoint``, ``event_bus``,
                ``memory``, ``executor``, ``persona``.
        """
        self.task_id = task_id
        self.input_data = input_data
        self.metadata = kwargs.pop('metadata', {})
        self.state = kwargs.pop('state', {})
        self.tools = kwargs.pop('tools', None)
        self.agents = kwargs.pop('agents', None)
        self.mode = kwargs.pop('mode', None)
        self.interaction_mode = kwargs.pop('interaction_mode', 'solo')
        self.checkpoint = kwargs.pop('checkpoint', None)
        self.event_bus = kwargs.pop('event_bus', None)
        self.memory = kwargs.pop('memory', None)
        self.executor = kwargs.pop('executor', None)
        self.persona = kwargs.pop('persona', None)
        self.harness_enabled = kwargs.pop('harness_enabled', True)
        self.created_at = datetime.now(timezone.utc).isoformat()

    @classmethod
    def from_parent(cls, parent: 'TaskContext', **overrides) -> 'TaskContext':
        """Create a child context that inherits most fields from a parent.

        The child receives a derived ``task_id`` (appending ``"/sub"``) and
        shallow-copies of the parent's state and metadata.  Any field can be
        overridden via keyword arguments.

        Args:
            parent: The parent TaskContext to inherit from.
            **overrides: Optional keyword overrides.  Supported keys:
                ``input_data``, ``metadata``, ``state``.

        Returns:
            A new TaskContext instance with inherited and overridden fields.
        """
        child = cls(
            task_id=parent.task_id + "/sub",
            input_data=overrides.get('input_data', parent.input_data),
            metadata={**parent.metadata, **overrides.get('metadata', {})},
            state=overrides.get('state', parent.state.copy()),
            tools=parent.tools,
            agents=parent.agents,
            mode=parent.mode,
            interaction_mode=parent.interaction_mode,
            checkpoint=parent.checkpoint,
            event_bus=parent.event_bus,
            memory=parent.memory,
            executor=parent.executor,
            persona=parent.persona,
            harness_enabled=parent.harness_enabled,
        )
        return child
