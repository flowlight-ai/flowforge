import requests, json, time

BASE = "http://127.0.0.1:8002/api/v1"

# 1. Check incomplete tasks
print("=== 检查运行中的任务 ===")
r = requests.get(f"{BASE}/workspace/incomplete")
data = r.json()
print(f"未完成任务: {json.dumps(data, indent=2, ensure_ascii=False)}")

# 2. List all tasks in default workspace
print("\n=== Default工作区任务 ===")
r = requests.get(f"{BASE}/workspace/named/default/tasks")
tasks = r.json()["tasks"]
for t in tasks:
    tid = t["task_id"][:12]
    status = t["status"]
    intent = t.get("intent", "")[:40]
    print(f"  {tid}: status={status}, intent={intent}")

# 3. Cancel/complete all running tasks
print("\n=== 清理运行中的任务 ===")
for t in tasks:
    if t["status"] in ("running", "pending"):
        tid = t["task_id"]
        try:
            r = requests.put(f"{BASE}/tasks/{tid}", json={"status": "completed"})
            print(f"  {tid[:12]}: {r.status_code} - {r.json().get('status', '?')}")
        except Exception as e:
            print(f"  {tid[:12]}: ERROR - {e}")

# 4. Now create a new task and wait for LLM execution
print("\n=== 创建新任务并等待LLM执行 ===")
r = requests.post(f"{BASE}/tasks", json={
    "intent": "简单测试：1+1等于几？请直接回答",
    "persona": "default",
    "mode": "solo",
    "workspace": "default"
})
data = r.json()
print(f"创建结果: status={data.get('status')}, task_id={data.get('data', {}).get('task_id', '?')[:12]}")

task_id = data.get("data", {}).get("task_id")
if task_id:
    # Wait for execution
    print("等待LLM执行（30秒）...")
    for i in range(6):
        time.sleep(5)
        r = requests.get(f"{BASE}/tasks/{task_id}")
        task_data = r.json().get("data", {})
        status = task_data.get("status", "unknown")
        error = task_data.get("error", "")
        print(f"  {i*5+5}s: status={status}" + (f", error={error[:80]}" if error else ""))
        if status in ("completed", "failed", "error"):
            break
    
    # Check chat messages
    r = requests.get(f"{BASE}/tasks/{task_id}/messages")
    if r.status_code == 200:
        messages = r.json().get("messages", [])
        print(f"\n聊天消息数: {len(messages)}")
        for msg in messages[-3:]:
            role = msg.get("role", "?")
            content = msg.get("content", "")[:100]
            print(f"  [{role}]: {content}")
    else:
        print(f"消息查询失败: {r.status_code}")
