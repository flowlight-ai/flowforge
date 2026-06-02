"""WebSocket endpoints and connection manager for FlowForge real-time streaming.

Provides the ``ConnectionManager`` class that tracks active WebSocket
connections per task and broadcasts events, as well as three WebSocket
endpoints: Solo interaction, global event streaming, and log tailing.

License: MIT
"""

import asyncio
import json
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from flowforge.app.deps import get_executor
from flowforge.core.tracing import get_logger

logger = get_logger("api.websocket")

router = APIRouter(tags=["websocket"])

class ConnectionManager:
    """Manages active WebSocket connections grouped by task identifier.

    The manager handles connection lifecycle (accept, register, disconnect)
    and provides broadcast and event emission utilities that serialize
    messages to JSON and deliver them to all connections subscribed to a
    given task.

    Events emitted before any WebSocket client connects are buffered
    per task_id and replayed automatically when the first client connects,
    preventing the race condition where the backend starts a task before
    the frontend has established the WebSocket connection.

    Attributes:
        active_connections: Mapping from task ID to a list of active
            WebSocket connections for that task.
    """

    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}
        self._event_buffers: dict[str, list[dict]] = {}
        self._seq_counter: int = 0

    def _next_seq(self) -> int:
        self._seq_counter += 1
        return self._seq_counter

    def get_buffered_events(self, task_id: str, from_seq: int = 0) -> list:
        events = self._event_buffers.get(task_id, [])
        return [e for e in events if e.get("seq", 0) >= from_seq]

    async def connect(self, task_id: str, websocket: WebSocket):
        """Accept and register a WebSocket connection for a task.

        After accepting the connection, any buffered events for the task
        are replayed to the new connection so that events emitted before
        the client connected are not lost.

        Args:
            task_id: The task identifier to associate the connection with.
            websocket: The incoming WebSocket connection to accept.
        """
        await websocket.accept()
        self.active_connections.setdefault(task_id, []).append(websocket)
        buffered = self._event_buffers.pop(task_id, None)
        if buffered:
            for event in buffered:
                try:
                    await websocket.send_json(event)
                except Exception as e:
                    logger.debug(f"Failed to replay buffered event to websocket: {e}")

    def disconnect(self, task_id: str, websocket: WebSocket):
        """Remove a WebSocket connection from the manager.

        Cleans up the task's connection list and removes the task entry
        entirely if no connections remain.

        Args:
            task_id: The task identifier the connection belongs to.
            websocket: The WebSocket connection to remove.
        """
        if task_id in self.active_connections:
            self.active_connections[task_id].remove(websocket)
            if not self.active_connections[task_id]:
                del self.active_connections[task_id]

    async def broadcast(self, task_id: str, message: dict):
        dead = []
        delivered = False
        for ws in list(self.active_connections.get(task_id, [])):
            try:
                await ws.send_json(message)
                delivered = True
            except Exception as e:
                logger.debug(f"Failed to broadcast to websocket for task {task_id}: {e}")
                dead.append(ws)
        for ws in dead:
            self.disconnect(task_id, ws)
        if not delivered and not dead:
            self._event_buffers.setdefault(task_id, []).append(message)

    async def emit_event(self, task_id: str, event_type: str, payload: dict):
        """Construct and broadcast a structured event message.

        Wraps the payload with ``type``, ``seq``, and ``timestamp``
        metadata, then broadcasts it to all connections for the task.
        If no connections are active for the task, the event is buffered
        and will be replayed when a client connects.

        Args:
            task_id: The task identifier to broadcast to.
            event_type: The event type string (e.g. ``"solo.llm.stream"``).
            payload: The event payload dictionary.
        """
        message = {
            "type": event_type,
            "seq": self._next_seq(),
            "timestamp": datetime.now(timezone.utc).isoformat() + "Z",
            "payload": payload or {},
        }
        if not self.active_connections.get(task_id):
            self._event_buffers.setdefault(task_id, []).append(message)
            return
        await self.broadcast(task_id, message)

manager = ConnectionManager()

@router.websocket("/ws/solo/{task_id}")
async def solo_websocket(websocket: WebSocket, task_id: str):
    await manager.connect(task_id, websocket)
    last_ping = asyncio.get_event_loop().time()

    async def send_server_pings():
        nonlocal last_ping
        while True:
            await asyncio.sleep(25)
            try:
                await websocket.send_json({"type": "server_ping"})
                last_ping = asyncio.get_event_loop().time()
            except Exception as e:
                logger.debug(f"Server ping failed for solo websocket {task_id}: {e}")
                break

    ping_task = asyncio.create_task(send_server_pings())
    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                elif msg.get("type") == "pong":
                    pass
                elif msg.get("type") == "review_submit":
                    executor = await get_executor()
                    if executor:
                        await executor.submit_review(
                            task_id, msg.get("verdict", "pass"),
                            msg.get("feedback", ""), msg.get("edited_content", "")
                        )
                elif msg.get("type") == "replay":
                    from_seq = msg.get("from_seq", 0)
                    buffered = manager.get_buffered_events(task_id, from_seq)
                    for event in buffered:
                        try:
                            await websocket.send_json(event)
                        except Exception:
                            break
            except asyncio.TimeoutError:
                continue
    except WebSocketDisconnect:
        manager.disconnect(task_id, websocket)
    except Exception as e:
        logger.debug(f"Solo websocket disconnected with error for task {task_id}: {e}")
        manager.disconnect(task_id, websocket)
    finally:
        ping_task.cancel()
        try:
            await ping_task
        except asyncio.CancelledError:
            pass

@router.websocket("/ws/events")
async def events_websocket(websocket: WebSocket):
    await websocket.accept()
    event_bus = None
    try:
        from flowforge.events.event_bus import EventBus
        from flowforge.app.main import event_bus as global_event_bus
        event_bus = global_event_bus
    except Exception as e:
        logger.debug(f"Failed to import EventBus for events websocket: {e}")

    received_events = []

    if event_bus:
        event_bus.subscribe("*", lambda e: received_events.append(e))

    try:
        while True:
            while received_events:
                event = received_events.pop(0)
                try:
                    await websocket.send_json(event)
                except Exception as e:
                    logger.debug(f"Failed to send event to events websocket: {e}")
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"Events websocket disconnected with error: {e}")

@router.websocket("/ws/logs")
async def logs_websocket(websocket: WebSocket):
    await websocket.accept()
    level_filter = websocket.query_params.get("level", None)

    from flowforge.core.tracing import get_log_file_path
    log_file = get_log_file_path()

    pos = 0
    if log_file.exists():
        with open(log_file, "r", encoding="utf-8") as f:
            f.seek(0, 2)
            pos = f.tell()

    try:
        while True:
            await asyncio.sleep(0.5)
            if not log_file.exists():
                continue
            try:
                current_size = log_file.stat().st_size
                if current_size < pos:
                    pos = 0
                if current_size == pos:
                    continue
                with open(log_file, "r", encoding="utf-8") as f:
                    f.seek(pos)
                    new_lines = f.readlines()
                    pos = f.tell()
                for line in new_lines:
                    stripped = line.rstrip("\n")
                    if not stripped:
                        continue
                    if level_filter and f"[{level_filter.upper()}]" not in stripped:
                        continue
                    await websocket.send_json({
                        "type": "log",
                        "line": stripped,
                        "timestamp": datetime.now(timezone.utc).isoformat() + "Z",
                    })
            except Exception as e:
                logger.debug(f"Failed to read/send log line: {e}")
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"Logs websocket disconnected with error: {e}")
