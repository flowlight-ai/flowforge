"""OpenSieve search accuracy test."""
import urllib.request, json, sys, time

BASE = "http://127.0.0.1:8002"

def api_get(path):
    try:
        r = urllib.request.urlopen(f"{BASE}{path}", timeout=10)
        return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}

def api_post(path, data):
    try:
        body = json.dumps(data).encode()
        req = urllib.request.Request(f"{BASE}{path}", data=body, headers={"Content-Type": "application/json"})
        r = urllib.request.urlopen(req, timeout=30)
        return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {"error": f"HTTP {e.code}: {body[:200]}"}
    except Exception as e:
        return {"error": str(e)}

def es_search(query, index="helixrag_documents", size=5):
    """Direct ES search to verify data."""
    try:
        body = json.dumps({"query": {"match": {"content": query}}, "size": size}).encode()
        req = urllib.request.Request(f"http://localhost:9200/{index}/_search", data=body, headers={"Content-Type": "application/json"})
        r = urllib.request.urlopen(req, timeout=10)
        data = json.loads(r.read().decode())
        hits = data.get("hits", {}).get("hits", [])
        return [{"score": h["_score"], "title": h["_source"].get("title", ""), "content": h["_source"].get("content", "")[:100]} for h in hits]
    except Exception as e:
        return [{"error": str(e)}]

print("=" * 60)
print("OpenSieve Search Accuracy Test")
print("=" * 60)

# Test 1: Direct ES search
print("\n--- Test 1: Direct Elasticsearch Search ---")
queries = ["python", "教程", "编程", "人工智能", "AI"]
for q in queries:
    results = es_search(q)
    if results and "error" not in results[0]:
        print(f"  Query '{q}': {len(results)} results")
        for r in results[:2]:
            print(f"    - score={r['score']:.2f}, title={r['title'][:50]}, content={r['content'][:60]}...")
    else:
        print(f"  Query '{q}': ERROR - {results[0].get('error', 'unknown')}")

# Test 2: ES index verification
print("\n--- Test 2: ES Index Verification ---")
try:
    r = urllib.request.urlopen("http://localhost:9200/_cat/indices?v", timeout=10)
    print(r.read().decode()[:500])
except Exception as e:
    print(f"  Error: {e}")

# Test 3: FlowForge tools API
print("\n--- Test 3: FlowForge Tools API ---")
tools = api_get("/api/v1/system/tools")
if "error" in tools:
    print(f"  Error: {tools['error']}")
else:
    tool_names = [t.get("name", "") for t in tools.get("data", tools) if isinstance(t, dict)]
    opensieve_tools = [t for t in tool_names if "opensieve" in t.lower() or "search" in t.lower()]
    print(f"  Total tools: {len(tool_names)}")
    print(f"  Search-related tools: {opensieve_tools}")

# Test 4: OpenSieve search via tool execution
print("\n--- Test 4: OpenSieve Search Plugin ---")
result = api_post("/api/v1/tools/execute", {"tool": "opensieve_search", "params": {"query": "python教程"}})
if "error" in result:
    print(f"  Error: {result['error'][:200]}")
else:
    print(f"  Result: {json.dumps(result, ensure_ascii=False)[:300]}")

# Test 5: Web search (fallback)
print("\n--- Test 5: Web Search Plugin (DuckDuckGo) ---")
result = api_post("/api/v1/tools/execute", {"tool": "duckduckgo_search", "params": {"query": "人工智能教育应用"}})
if "error" in result:
    print(f"  Error: {result['error'][:200]}")
else:
    print(f"  Result: {json.dumps(result, ensure_ascii=False)[:300]}")

# Test 6: Material collection via task
print("\n--- Test 6: Material Collection via Helm Task ---")
task_data = json.dumps({"task": "搜索关于人工智能在教育领域应用的最新资料", "persona": "education", "mode": "helm", "model": "moonshotai/kimi-k2.6:free"}).encode()
req = urllib.request.Request(f"{BASE}/api/v1/tasks", data=task_data, headers={"Content-Type": "application/json"})
try:
    r = urllib.request.urlopen(req, timeout=30)
    task = json.loads(r.read().decode())["data"]
    print(f"  Task created: {task['task_id']}")
    print(f"  Status: {task.get('status', 'unknown')}")
    # Wait for completion
    for i in range(60):
        time.sleep(5)
        r2 = urllib.request.urlopen(f"{BASE}/api/v1/tasks/{task['task_id']}", timeout=10)
        d = json.loads(r2.read().decode())["data"]
        s = d.get("status", "")
        if i % 6 == 0:
            print(f"  [{i*5}s] status={s}")
        if s in ("completed", "failed", "error"):
            print(f"  Final status: {s}")
            if d.get("summary"):
                print(f"  Summary: {d['summary'][:200]}")
            break
except Exception as e:
    print(f"  Error: {e}")

print("\n" + "=" * 60)
print("Test Complete")
print("=" * 60)
