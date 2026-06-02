import httpx, json, time, asyncio, sys

# Test direct API models through OpenRoute proxy
models = [
    "zhipu/glm-4-flash",
    "kimi/moonshot-v1-8k",
]

for model in models:
    print(f"\n--- Testing model: {model} ---")
    start = time.time()
    try:
        resp = httpx.post("http://127.0.0.1:13000/v1/chat/completions", json={
            "model": model,
            "messages": [{"role": "user", "content": "说一句话"}],
            "max_tokens": 50,
            "stream": False,
        }, timeout=30)
        elapsed = time.time() - start
        print(f"  Status: {resp.status_code}, Time: {elapsed:.1f}s")
        if resp.status_code == 200:
            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            print(f"  Content: {content[:100]}")
        else:
            print(f"  Error: {resp.text[:200]}")
    except Exception as e:
        elapsed = time.time() - start
        print(f"  Failed after {elapsed:.1f}s: {type(e).__name__}: {e}")

# Test FlowForge LLMClient directly
print("\n\n--- Testing FlowForge LLMClient ---")
sys.path.insert(0, "d:/software/openclaw")
from flowforge.tools.llm_client import LLMClient
from flowforge.events.event_bus import EventBus
from flowforge.core.base_tool import ToolInput

async def test_llm_client():
    event_bus = EventBus()
    llm = LLMClient(event_bus=event_bus)
    start = time.time()
    try:
        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "user", "content": "说一句话"}],
            "stream": False,
            "max_tokens": 50,
        }))
        elapsed = time.time() - start
        content = result.result.get("content", "")
        print(f"  Time: {elapsed:.1f}s, Content: {content[:100]}")
    except Exception as e:
        elapsed = time.time() - start
        print(f"  Failed after {elapsed:.1f}s: {type(e).__name__}: {e}")

asyncio.run(test_llm_client())
