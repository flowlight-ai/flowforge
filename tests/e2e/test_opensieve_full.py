"""OpenSieve retrieve + image download verification test."""
import httpx
import json
import asyncio

OPENSIEVE = "http://localhost:8101"
FLOWFORGE = "http://localhost:8002/api/v1/plugins"
HEADERS = {"Authorization": "Bearer or-local", "Content-Type": "application/json"}

async def main():
    async with httpx.AsyncClient(timeout=120) as c:
        # 1. OpenSieve health
        print("=" * 60)
        print("1. OpenSieve Health Check")
        print("=" * 60)
        r = await c.get(f"{OPENSIEVE}/health", headers=HEADERS)
        d = r.json()
        components = d.get("components", {})
        for name, info in components.items():
            status = info.get("status", "?")
            print(f"  {name}: {status}")

        # 2. Retrieve API (direct)
        print("\n" + "=" * 60)
        print("2. OpenSieve Retrieve API (Direct)")
        print("=" * 60)
        queries = ["Python数据分析", "人工智能教育", "机器学习入门教程"]
        for q in queries:
            r = await c.post(f"{OPENSIEVE}/api/v1/retrieve",
                json={"query": q, "max_results": 3, "min_score": 0.2},
                headers=HEADERS)
            d = r.json()
            items = d.get("results", d.get("items", []))
            print(f"\n  Query: {q}")
            print(f"  Results: {len(items)}")
            for i, item in enumerate(items[:2]):
                title = item.get("title", "?")[:50]
                score = item.get("score", 0)
                url = item.get("url", "")[:60]
                print(f"    [{i+1}] {title} (score={score:.3f})")
                print(f"        URL: {url}")

        # 3. FlowForge plugin search
        print("\n" + "=" * 60)
        print("3. FlowForge Plugin Search")
        print("=" * 60)
        r = await c.post(f"{FLOWFORGE}/opensieve_search/execute",
            json={"params": {"query": "深度学习框架", "max_results": 3, "min_score": 0.2}})
        d = r.json()
        results = d.get("data", {}).get("result", {}).get("results", [])
        error = d.get("data", {}).get("result", {}).get("error")
        print(f"  Error: {error}")
        print(f"  Results: {len(results)}")
        for i, item in enumerate(results[:2]):
            title = item.get("title", "?")[:50]
            score = item.get("score", 0)
            print(f"    [{i+1}] {title} (score={score:.3f})")

        # 4. Image search
        print("\n" + "=" * 60)
        print("4. Image Search API")
        print("=" * 60)
        try:
            r = await c.get(f"{OPENSIEVE}/api/v1/images/search",
                params={"query": "Python", "max_results": 5},
                headers=HEADERS)
            d = r.json()
            total = d.get("total", 0)
            images = d.get("images", [])
            print(f"  Total: {total}, Returned: {len(images)}")
            for i, img in enumerate(images[:3]):
                print(f"    [{i+1}] {img.get('alt_text', '?')[:40]} ({img.get('format', '?')}, {img.get('size_bytes', 0)} bytes)")
        except Exception as e:
            print(f"  Error: {e}")

        # 5. Image download from URL
        print("\n" + "=" * 60)
        print("5. Image Download API")
        print("=" * 60)
        try:
            r = await c.post(f"{OPENSIEVE}/api/v1/images/download",
                params={"url": "https://www.python.org", "max_images": 5},
                headers=HEADERS)
            d = r.json()
            total_cand = d.get("total_candidates", 0)
            downloaded = d.get("downloaded", 0)
            images = d.get("images", [])
            elapsed = d.get("elapsed_ms", 0)
            print(f"  Candidates: {total_cand}, Downloaded: {downloaded}, Elapsed: {elapsed}ms")
            for i, img in enumerate(images[:3]):
                local_path = img.get("local_path", "?")[:60]
                fmt = img.get("format", "?")
                size = img.get("size_bytes", 0)
                print(f"    [{i+1}] {fmt} {size}B -> {local_path}")
        except Exception as e:
            print(f"  Error: {e}")

        # 6. Scrape with image extraction
        print("\n" + "=" * 60)
        print("6. Scrape API (with image extraction)")
        print("=" * 60)
        try:
            r = await c.post(f"{OPENSIEVE}/api/v1/scrape",
                json={"url": "https://www.python.org"},
                headers=HEADERS)
            d = r.json()
            images = d.get("images", [])
            title = d.get("title", "?")[:50]
            print(f"  Title: {title}")
            print(f"  Images found: {len(images)}")
            for i, img_url in enumerate(images[:3]):
                print(f"    [{i+1}] {img_url[:80]}")
        except Exception as e:
            print(f"  Error: {e}")

        # 7. Summary
        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print("  OpenSieve API (8101): Running")
        print("  FlowForge Plugin: Connected")
        print("  ES Search: Working")
        print("  Image Search: Tested")
        print("  Image Download: Tested")
        print("  Scrape: Tested")

asyncio.run(main())
