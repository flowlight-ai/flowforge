import pytest
import asyncio
from flowforge.events.event_bus import EventBus
from flowforge.events.helm_adapter import EventBusHelmAdapter

def test_event_bus_subscribe_emit():
    bus = EventBus()
    received = []
    bus.subscribe("test.event", lambda e: received.append(e))
    bus.emit("t1", "test.event", {"data": "hello"})
    assert len(received) == 1
    assert received[0]["payload"]["data"] == "hello"

def test_event_bus_wildcard():
    bus = EventBus()
    received = []
    bus.subscribe("*", lambda e: received.append(e))
    bus.emit("t1", "any.event", {})
    assert len(received) == 1

@pytest.mark.asyncio
async def test_event_bus_async_callback():
    bus = EventBus()
    received = []
    async def callback(event):
        received.append(event)
    bus.subscribe("async.event", callback)
    bus.emit("t1", "async.event", {"data": "async"})
    await asyncio.sleep(0.1)
    assert len(received) == 1

def test_helm_adapter_bridge():
    bus = EventBus()
    class MockHelmManager:
        def __init__(self):
            self.events = []
        async def emit_event(self, task_id, event_type, payload):
            self.events.append((task_id, event_type, payload))
    manager = MockHelmManager()
    adapter = EventBusHelmAdapter(bus, manager)
    adapter.bridge()
    assert adapter._bridged is True
    adapter.bridge()
    assert len([cb for cbs in bus._subscribers.values() for cb in cbs]) >= 17
