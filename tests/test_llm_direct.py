import httpx, json, time

# Test LLM call directly through the OpenRoute proxy
start = time.time()
try:
    resp = httpx.post("http://127.0.0.1:13000/v1/chat/completions", json={
        "model": "openroute/auto",
        "messages": [
            {"role": "system", "content": "你是一个专业的技术文章作者"},
            {"role": "user", "content": "请写一篇关于Python编程的短文，200字左右"},
        ],
        "max_tokens": 500,
        "stream": False,
    }, timeout=180)
    elapsed = time.time() - start
    print(f"LLM call completed in {elapsed:.1f}s")
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        print(f"Content length: {len(content)} chars")
        print(f"Content: {content[:200]}")
    else:
        print(f"Error: {resp.text[:300]}")
except Exception as e:
    elapsed = time.time() - start
    print(f"LLM call failed after {elapsed:.1f}s: {e}")
