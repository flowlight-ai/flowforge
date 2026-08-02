"""测试 council 群聊 — 用具体项目相关问题触发有效响应."""
import json
import sys
import time
import urllib.request

BASE = "http://localhost:8000/api/v1/forgekins/council"


def send_chat(content: str, forgekin_id=None, trigger=True) -> dict:
    payload = {
        "content": content,
        "forgekin_id": forgekin_id,
        "thread_id": "test-trae-002",
        "trigger_response": trigger,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/chat", data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    print(f"[SEND] {content[:80]}...")
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as resp:
        elapsed = time.time() - t0
        print(f"[RECV] status={resp.status} elapsed={elapsed:.1f}s")
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    # 用具体项目问题触发有效响应
    questions = [
        "@文心 请列出 FlowForge 项目当前的 5 个灵智体名称和它们的角色",
        "@夏洛克 flowforge/forgemind/autonomous.py 文件中 AutonomousDaemon 类的 scan_interval 默认值是多少？",
    ]
    for q in questions:
        print("=" * 60)
        try:
            r = send_chat(q, trigger=True)
            msgs = r.get("messages", [])
            for m in msgs:
                sender = m.get("sender", "?")
                sender_type = m.get("sender_type", "?")
                content = m.get("content", "")
                model = m.get("model", "?")
                preview = content[:300] if len(content) > 300 else content
                print(f"  [{sender_type}/{sender}] (model={model})")
                print(f"  {preview}")
                print()
            # 质量检查
            if len(msgs) >= 2:
                last = msgs[-1]
                content = last.get("content", "")
                if len(content) >= 50 and "无法回答" not in content and "异常" not in content:
                    print("  [QUALITY_OK] 响应内容有效")
                else:
                    print(f"  [QUALITY_WARN] 响应可能无效: len={len(content)}")
        except Exception as e:
            print(f"  [FAIL] {type(e).__name__}: {e}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
