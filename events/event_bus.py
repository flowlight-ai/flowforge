import asyncio
from typing import Callable, Dict, List
from datetime import datetime

class EventBus:
    def __init__(self):
        self._subscribers: Dict[str, List[Callable]] = {}

    def subscribe(self, event_type: str, callback: Callable):
        self._subscribers.setdefault(event_type, []).append(callback)

    def emit(self, task_id: str, event_type: str, payload: dict):
        event = {
            "type": event_type,
            "payload": payload,
            "task_id": task_id,
            "timestamp": datetime.utcnow().isoformat(),
        }
        for cb in self._subscribers.get(event_type, []):
            try:
                result = cb(event)
                if asyncio.iscoroutine(result):
                    asyncio.ensure_future(result)
            except Exception:
                pass
        for cb in self._subscribers.get('*', []):
            try:
                result = cb(event)
                if asyncio.iscoroutine(result):
                    asyncio.ensure_future(result)
            except Exception:
                pass
