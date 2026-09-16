"""Quick test: OpenSieve API direct + FlowForge plugin."""
import httpx, asyncio, json

import pytest

# P-118: 显式 asyncio 标记，不依赖 asyncio_mode="auto" 隐式行为
pytestmark = pytest.mark.asyncio

async def test_direct():
    """Test OpenSieve API directly."""
    print("=== Test 1: OpenSieve API Direct (8101) ===")
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "http://localhost:8101/api/v1/retrieve",
            json={"query": "python", "max_results": 3},
            headers={"Authorization": "Bearer or-local"},
        )
        print(f"Status: {resp.status_code}")
        data = resp.json()
        results = data.get("results", [])
        print(f"Results: {len(results)}")
        for r in results[:3]:
            title = r.get("title", "")[:50]
            score = r.get("score", 0)
            source = r.get("source_type", "")
            print(f"  [{source}] {title} (score={score:.3f})")

async def test_flowforge():
    """Test FlowForge OpenSieve plugin."""
    print("\n=== Test 2: FlowForge Plugin ===")
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "http://localhost:8002/api/v1/plugins/opensieve_search/execute",
            json={"params": {"query": "python"}},
        )
        print(f"Status: {resp.status_code}")
        data = resp.json()
        result = data.get("data", {}).get("result", {})
        if result.get("error"):
            print(f"Error: {result['error']}")
        else:
            results = result.get("results", [])
            print(f"Results: {len(results)}")
            for r in results[:3]:
                title = r.get("title", "")[:50]
                score = r.get("score", 0)
                print(f"  {title} (score={score:.3f})")

async def test_opensieve_health():
    """Test OpenSieve health endpoint."""
    print("=== Test 0: OpenSieve Health ===")
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(
                "http://localhost:8101/health",
                headers={"Authorization": "Bearer or-local"},
            )
            print(f"Status: {resp.status_code}")
            print(f"Body: {resp.text[:300]}")
        except Exception as e:
            print(f"Error: {e}")

async def main():
    await test_opensieve_health()
    await test_direct()
    await test_flowforge()


if __name__ == "__main__":
    # P-02: 模块级执行会污染 pytest 收集（导入即发起网络调用导致
    # 收集期 ConnectError/JSONDecodeError），改为仅在直接运行时执行。
    asyncio.run(main())
