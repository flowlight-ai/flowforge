import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from flowforge.app.deps import get_executor

router = APIRouter(tags=["websocket"])

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, task_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.setdefault(task_id, []).append(websocket)

    def disconnect(self, task_id: str, websocket: WebSocket):
        if task_id in self.active_connections:
            self.active_connections[task_id].remove(websocket)
            if not self.active_connections[task_id]:
                del self.active_connections[task_id]

    async def broadcast(self, task_id: str, message: dict):
        for ws in self.active_connections.get(task_id, []):
            try:
                await ws.send_json(message)
            except Exception:
                pass

manager = ConnectionManager()

@router.websocket("/ws/solo/{task_id}")
async def solo_websocket(websocket: WebSocket, task_id: str):
    await manager.connect(task_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            elif msg.get("type") == "review_submit":
                executor = await get_executor()
                if executor:
                    await executor.submit_review(
                        task_id, msg.get("verdict", "pass"),
                        msg.get("feedback", ""), msg.get("edited_content", "")
                    )
    except WebSocketDisconnect:
        manager.disconnect(task_id, websocket)
    except Exception:
        manager.disconnect(task_id, websocket)

@router.websocket("/ws/events")
async def events_websocket(websocket: WebSocket):
    await websocket.accept()
    event_bus = None
    try:
        from flowforge.events.event_bus import EventBus
        from flowforge.app.main import event_bus as global_event_bus
        event_bus = global_event_bus
    except Exception:
        pass

    received_events = []
    def on_event(event):
        received_events.append(event)

    if event_bus:
        event_bus.subscribe("*", lambda e: received_events.append(e))

    try:
        while True:
            while received_events:
                event = received_events.pop(0)
                try:
                    await websocket.send_json(event)
                except Exception:
                    pass
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
