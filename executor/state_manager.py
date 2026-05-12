import json
from typing import Any, Dict, Optional
from core.tracing import get_logger

logger = get_logger("state_manager")

class StateManager:
    def __init__(self, checkpointer_path: str = "data/checkpoints.db"):
        self.checkpointer_path = checkpointer_path
        self._states: Dict[str, Dict[str, Any]] = {}

    def save_state(self, task_id: str, state: Dict[str, Any]) -> None:
        self._states[task_id] = state.copy()

    def load_state(self, task_id: str) -> Optional[Dict[str, Any]]:
        return self._states.get(task_id)

    def delete_state(self, task_id: str) -> None:
        self._states.pop(task_id, None)

    def list_states(self) -> list:
        return list(self._states.keys())
