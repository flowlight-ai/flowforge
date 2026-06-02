import urllib.request, json

# Test OpenSieve health
try:
    r = urllib.request.urlopen('http://127.0.0.1:8100/health', timeout=10)
    health = json.loads(r.read().decode())
    print(f"Health: {json.dumps(health, ensure_ascii=False, indent=2)[:500]}")
except Exception as e:
    print(f"Health check failed: {e}")

# Test OpenSieve retrieve
print("\n--- Testing retrieve ---")
data = json.dumps({"query": "2024年中国AI发展趋势", "max_results": 5}).encode()
req = urllib.request.Request("http://127.0.0.1:8100/api/v1/retrieve", data=data, headers={"Content-Type": "application/json"})
try:
    r2 = urllib.request.urlopen(req, timeout=30)
    result = json.loads(r2.read().decode())
    print(f"Retrieve status: {result.get('status', 'unknown')}")
    results = result.get('results', [])
    print(f"Results count: {len(results)}")
    for i, item in enumerate(results[:3]):
        print(f"  [{i}] {item.get('title', 'N/A')[:80]}")
        print(f"      source: {item.get('source_type', 'N/A')}, score: {item.get('score', 'N/A')}")
except urllib.error.HTTPError as e:
    print(f"Retrieve failed: HTTP {e.code}")
    print(e.read().decode()[:500])
except Exception as e:
    print(f"Retrieve error: {e}")
