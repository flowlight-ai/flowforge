"""Test helm mode with real model call via WebSocket events."""
import asyncio
import json

import requests
import websockets

BASE = "http://127.0.0.1:8000/api/v1"
WS_EVENTS = "ws://127.0.0.1:8000/ws/events"
WS_HELM = "ws://127.0.0.1:8000/ws/helm"

async def test_helm_real_model():
    # First connect to events WebSocket
    events_received = []
    print("Connecting to events WebSocket...")

    async with websockets.connect(WS_EVENTS) as events_ws:
        print("Events WebSocket connected!")

        # Create task
        r = requests.post(f"{BASE}/tasks", json={
            "query": "你好，请用一句话介绍FlowForge",
            "mode": "helm",
            "persona": "default",
        })
        d = r.json()
        task_id = d["data"]["task_id"]
        print(f"Task created: {task_id}")

        # Connect to helm WebSocket
        helm_uri = f"{WS_HELM}/{task_id}"
        async with websockets.connect(helm_uri) as helm_ws:
            print(f"Helm WebSocket connected: {helm_uri}")

            # Listen for events from both channels
            async def listen_events():
                try:
                    while True:
                        msg = await asyncio.wait_for(events_ws.recv(), timeout=45)
                        data = json.loads(msg)
                        event_type = data.get("type", data.get("event", "unknown"))
                        events_received.append(event_type)

                        # Print key events
                        if event_type in ("llm_call", "tool_call", "stage", "draft_update",
                                          "gate", "thinking", "task_completed", "completed"):
                            payload = data.get("data", data.get("content", {}))
                            if isinstance(payload, dict):
                                # Extract key info
                                agent = payload.get("agent", payload.get("agent_name", ""))
                                content = str(payload.get("content", payload.get("response", "")))[:150]
                                model = payload.get("model", "")
                                print(f"  [{event_type}] agent={agent} model={model} content={content}")
                            else:
                                print(f"  [{event_type}] {str(payload)[:150]}")
                        else:
                            print(f"  [{event_type}]")

                except TimeoutError:
                    print("  (timeout - no more events)")

            await listen_events()

    # Check final task status
    try:
        r2 = requests.get(f"{BASE}/tasks/{task_id}")
        d2 = r2.json()
        status = d2.get("data", {}).get("status", "unknown")
        result = d2.get("data", {}).get("result", "")
        print(f"\nFinal status: {status}")
        if result:
            print(f"Result: {str(result)[:300]}")
    except Exception as e:
        print(f"Error getting task: {e}")

    print(f"\nTotal events received: {len(events_received)}")
    print(f"Event types: {set(events_received)}")

    # Verify key functionality
    print("\n--- Verification ---")
    has_llm = any("llm" in e.lower() for e in events_received)
    has_stage = any("stage" in e.lower() for e in events_received)
    has_completed = any("complet" in e.lower() for e in events_received)
    print(f"  LLM call events: {'YES' if has_llm else 'NO'}")
    print(f"  Stage events:    {'YES' if has_stage else 'NO'}")
    print(f"  Completion:      {'YES' if has_completed else 'NO'}")

if __name__ == "__main__":
    asyncio.run(test_helm_real_model())
