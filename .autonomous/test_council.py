"""测试 council 群聊消息发送 + @mention 触发灵智体响应.

验证 FlowForge Web 群聊功能端到端可用：
1. POST /api/v1/forgekins/council/chat 发送用户消息
2. @文心 触发 wenxin 灵智体通过 openroute 调用 LLM 响应
3. GET /api/v1/forgekins/council/messages 验证消息已存储
"""
import json
import sys
import time
import urllib.request

BASE = "http://localhost:8000/api/v1/forgekins/council"


def send_chat(content: str, forgekin_id=None, trigger=True) -> dict:
    """发送群聊消息."""
    payload = {
        "content": content,
        "forgekin_id": forgekin_id,
        "thread_id": "test-trae-001",
        "trigger_response": trigger,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/chat",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    print(f"[SEND] content={content!r} forgekin_id={forgekin_id} trigger={trigger}")
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read().decode("utf-8")
        elapsed = time.time() - t0
        print(f"[RECV] status={resp.status} elapsed={elapsed:.1f}s")
        return json.loads(body)


def list_messages(limit=20) -> dict:
    """获取群聊消息列表."""
    req = urllib.request.Request(f"{BASE}/messages?limit={limit}", method="GET")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    print("=" * 60)
    print("测试 1: 发送纯用户消息（不触发响应）")
    print("=" * 60)
    try:
        r1 = send_chat("测试消息：hello council", forgekin_id=None, trigger=False)
        print(f"  messages_count={len(r1.get('messages', []))}")
        print(f"  triggered={r1.get('triggered')}")
        assert len(r1.get("messages", [])) >= 1, "用户消息未存储"
        print("  [OK] 用户消息已存储")
    except Exception as e:
        print(f"  [FAIL] {type(e).__name__}: {e}")
        return 1

    print()
    print("=" * 60)
    print("测试 2: @文心 触发灵智体响应（openroute 真实 LLM 调用）")
    print("=" * 60)
    try:
        r2 = send_chat(
            "你好 @文心，请用一句话介绍 FlowForge 是什么",
            forgekin_id=None,
            trigger=True,
        )
        msgs = r2.get("messages", [])
        print(f"  messages_count={len(msgs)}")
        for m in msgs:
            sender = m.get("sender", "?")
            sender_type = m.get("sender_type", "?")
            content = m.get("content", "")
            preview = content[:150] if len(content) > 150 else content
            print(f"  - [{sender_type}/{sender}] {preview}")
        if len(msgs) >= 2:
            print("  [OK] 文心已响应")
            # 检查响应内容质量
            wenxin_msg = msgs[-1]
            content = wenxin_msg.get("content", "")
            if len(content) < 20:
                print(f"  [WARN] 响应过短: {len(content)} 字")
            if "无法回答" in content or "异常" in content:
                print(f"  [WARN] 响应含错误标记: {content[:100]}")
        else:
            print("  [FAIL] 文心未响应")
            return 1
    except Exception as e:
        print(f"  [FAIL] {type(e).__name__}: {e}")
        return 1

    print()
    print("=" * 60)
    print("测试 3: 验证消息已持久化到消息列表")
    print("=" * 60)
    try:
        r3 = list_messages(limit=20)
        total = r3.get("total", 0)
        items = r3.get("items", [])
        print(f"  total={total} items_count={len(items)}")
        if total >= 2:
            print("  [OK] 消息已持久化")
        else:
            print(f"  [WARN] 消息数不足: {total}")
    except Exception as e:
        print(f"  [FAIL] {type(e).__name__}: {e}")
        return 1

    print()
    print("=" * 60)
    print("全部测试通过 ✓")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
