"""OpenSieve comprehensive verification test."""
import httpx
import json
import asyncio

BASE = "http://localhost:8002/api/v1/plugins/opensieve_search"
DIRECT = "http://localhost:8101/api/v1/retrieve"

async def main():
    async with httpx.AsyncClient(timeout=60) as c:
        # 1. Health check
        print("=== Health Check ===")
        try:
            r = await c.get(f"{BASE}/health")
            print(f"Status: {r.status_code}")
            print(json.dumps(r.json(), ensure_ascii=False, indent=2)[:500])
        except Exception as e:
            print(f"Error: {e}")

        # 2. Multiple search queries via FlowForge plugin
        queries = ["AI人工智能发展", "教育改革政策", "深度学习框架对比", "Python数据分析"]
        for q in queries:
            print(f"\n=== Plugin Query: {q} ===")
            try:
                r = await c.post(f"{BASE}/execute",
                    json={"params": {"query": q, "max_results": 3, "min_score": 0.2}})
                d = r.json()
                results = d.get("data", {}).get("result", {}).get("results", [])
                error = d.get("data", {}).get("result", {}).get("error")
                print(f"Error: {error}")
                print(f"Results: {len(results)}")
                for i, item in enumerate(results[:2]):
                    title = item.get("title", "?")[:50]
                    score = item.get("score", 0)
                    print(f"  [{i+1}] {title} (score={score:.3f})")
            except Exception as e:
                print(f"Error: {e}")

        # 3. Direct OpenSieve API comparison
        print(f"\n=== Direct API (8101) ===")
        try:
            r = await c.post(DIRECT,
                json={"query": "Python机器学习", "max_results": 3, "min_score": 0.3},
                headers={"Authorization": "Bearer or-local"})
            d = r.json()
            items = d.get("results", d.get("items", []))
            print(f"Results: {len(items)}")
            for i, item in enumerate(items[:2]):
                title = item.get("title", "?")[:50]
                score = item.get("score", 0)
                print(f"  [{i+1}] {title} (score={score:.3f})")
        except Exception as e:
            print(f"Error: {e}")

        # 4. Plugin list check
        print(f"\n=== Plugin List ===")
        try:
            r = await c.get("http://localhost:8002/api/v1/plugins")
            d = r.json()
            plugins = d.get("data", {}).get("plugins", [])
            search_plugins = [p for p in plugins if "search" in p.get("name", "").lower() or "opensieve" in p.get("name", "").lower()]
            for p in search_plugins:
                print(f"  {p.get('name')}: {p.get('status', '?')}")
        except Exception as e:
            print(f"Error: {e}")

asyncio.run(main())
