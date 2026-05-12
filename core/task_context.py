from typing import Any, Dict, Optional
from datetime import datetime


class TaskContext:
    def __init__(self, task_id: str, input_data: dict, **kwargs):
        self.task_id = task_id
        self.input_data = input_data
        self.metadata = kwargs.pop('metadata', {})
        self.state = kwargs.pop('state', {})
        self.tools = kwargs.pop('tools', None)
        self.agents = kwargs.pop('agents', None)
        self.mode = kwargs.pop('mode', None)
        self.interaction_mode = kwargs.pop('interaction_mode', 'standard')
        self.checkpoint = kwargs.pop('checkpoint', None)
        self.event_bus = kwargs.pop('event_bus', None)
        self.memory = kwargs.pop('memory', None)
        self.executor = kwargs.pop('executor', None)
        self.persona = kwargs.pop('persona', None)
        self.created_at = datetime.utcnow().isoformat()

    @classmethod
    def from_parent(cls, parent: 'TaskContext', **overrides) -> 'TaskContext':
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
        )
        return child
