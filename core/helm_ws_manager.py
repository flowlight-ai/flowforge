"""
HelmWSManager - Concrete implementation of HelmEventEmitter backed by WebSocket.

Provides:
- Per-task WebSocket connections (one connection per Helm task)
- Event buffering for disconnection replay (up to EVENT_BUFFER_SIZE events)
- Auto-cleanup on task completion
"""
from datetime import datetime
import json
import asyncio
from typing import Dict, Optional

from fastapi import WebSocket, WebSocketDisconnect

from flowforge.core.interfaces.helm_emitter import HelmEventEmitter
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.helm_ws_manager")

EVENT_BUFFER_SIZE = 2000


class HelmWSManager(HelmEventEmitter):

    def __init__(self):
        self._connections: Dict[str, WebSocket] = {}
        self._event_buffers: Dict[str, list] = {}
        self._seq_counters: Dict[str, int] = {}

    async def connect(self, task_id: str, ws: WebSocket):
        await ws.accept()
        self._connections[task_id] = ws
        self._event_buffers.setdefault(task_id, [])
        self._seq_counters.setdefault(task_id, 0)
        logger.info("helm_ws_connected", task_id=task_id)

    def disconnect(self, task_id: str):
        self._connections.pop(task_id, None)

    async def emit_event(self, task_id: str, event_type: str, payload: dict):
        seq = self._seq_counters.get(task_id, 0) + 1
        self._seq_counters[task_id] = seq

        event = {
            "type": event_type,
            "payload": payload,
            "timestamp": datetime.utcnow().isoformat(),
            "seq": seq
        }

        buffer = self._event_buffers.get(task_id)
        if buffer is not None:
            buffer.append(event)
            if len(buffer) > EVENT_BUFFER_SIZE:
                buffer.pop(0)

        ws = self._connections.get(task_id)
        if ws:
            try:
                await ws.send_text(json.dumps(event, ensure_ascii=False))
            except Exception:
                self.disconnect(task_id)

    async def handle_client_message(self, task_id: str, raw: str):
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return

        msg_type = msg.get("type")

        if msg_type == "replay":
            from_seq = msg.get("from_seq", 0)
            await self._send_replay(task_id, from_seq)
        elif msg_type == "ping":
            ws = self._connections.get(task_id)
            if ws:
                await ws.send_text(json.dumps({"type": "pong", "seq": -1}))

    async def _send_replay(self, task_id: str, from_seq: int):
        ws = self._connections.get(task_id)
        if not ws:
            return
        buffer = self._event_buffers.get(task_id, [])
        count = 0
        for event in buffer:
            if event["seq"] >= from_seq:
                await ws.send_text(json.dumps(event, ensure_ascii=False))
                count += 1
        logger.debug("helm_replay_sent", task_id=task_id, from_seq=from_seq, count=count)

    async def handle_connection(self, task_id: str, ws: WebSocket):
        await self.connect(task_id, ws)
        try:
            while True:
                raw = await ws.receive_text()
                await self.handle_client_message(task_id, raw)
        except WebSocketDisconnect:
            self.disconnect(task_id)
            logger.info("helm_ws_disconnected", task_id=task_id)
        except Exception as e:
            self.disconnect(task_id)
            logger.error("helm_ws_error", task_id=task_id, error=str(e))

    def cleanup_task(self, task_id: str):
        self._connections.pop(task_id, None)
        self._event_buffers.pop(task_id, None)
        self._seq_counters.pop(task_id, None)
