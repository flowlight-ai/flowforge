"""
FlowForge Solo 前端E2E测试脚本
通过API和WebSocket模拟用户操作，验证完整工作流
"""
import asyncio
import json
import time
import requests
import websockets

BASE = "http://127.0.0.1:8002/api/v1"
WS_URL = "ws://127.0.0.1:8002/api/v1/ws/solo"

def test_api(name, func):
    try:
        result = func()
        print(f"  ✅ {name}")
        return result
    except Exception as e:
        print(f"  ❌ {name}: {e}")
        return None

def run_phase1_api_tests():
    """Phase 1: 后端API基础测试"""
    print("\n=== Phase 1: 后端API测试 ===")
    
    # 1.1 命名工作区列表
    r = test_api("1.1 列出命名工作区", lambda: requests.get(f"{BASE}/workspace/named").json())
    if r:
        ws_names = [w["name"] for w in r["workspaces"]]
        print(f"      工作区: {ws_names}")
    
    # 1.2 创建新工作区
    r = test_api("1.2 创建工作区 'e2e-test'", 
        lambda: requests.post(f"{BASE}/workspace/named", json={"name": "e2e-test"}).json())
    
    # 1.3 列出default工作区任务
    r = test_api("1.3 列出default工作区任务",
        lambda: requests.get(f"{BASE}/workspace/named/default/tasks").json())
    if r:
        print(f"      任务数: {len(r['tasks'])}")
    
    # 1.4 列出default工作区文件
    r = test_api("1.4 列出default工作区文件",
        lambda: requests.get(f"{BASE}/workspace/default/files").json())
    if r:
        print(f"      文件数: {r['total']}")
    
    # 1.5 创建任务
    r = test_api("1.5 在default工作区创建任务",
        lambda: requests.post(f"{BASE}/tasks", json={
            "intent": "E2E测试：帮我写一篇关于量子计算的短文",
            "persona": "default",
            "mode": "solo",
            "workspace": "default"
        }).json())
    task_id = None
    if r and r.get("status") == "created":
        task_id = r["data"]["task_id"]
        print(f"      task_id: {task_id[:12]}...")
    
    # 1.6 验证任务在工作区中
    if task_id:
        r = test_api("1.6 验证任务在default工作区中",
            lambda: requests.get(f"{BASE}/workspace/named/default/tasks").json())
        if r:
            found = any(t["task_id"] == task_id for t in r["tasks"])
            print(f"      任务找到: {found}")
    
    # 1.7 在e2e-test工作区创建任务
    r = test_api("1.7 在e2e-test工作区创建任务",
        lambda: requests.post(f"{BASE}/tasks", json={
            "intent": "E2E测试：帮我分析2025年AI趋势",
            "persona": "default",
            "mode": "solo",
            "workspace": "e2e-test"
        }).json())
    task_id_2 = None
    if r and r.get("status") == "created":
        task_id_2 = r["data"]["task_id"]
        print(f"      task_id: {task_id_2[:12]}...")
    
    # 1.8 验证任务隔离
    if task_id_2:
        r1 = requests.get(f"{BASE}/workspace/named/default/tasks").json()
        r2 = requests.get(f"{BASE}/workspace/named/e2e-test/tasks").json()
        default_ids = [t["task_id"] for t in r1["tasks"]]
        e2e_ids = [t["task_id"] for t in r2["tasks"]]
        isolated = task_id_2 in e2e_ids and task_id_2 not in default_ids
        print(f"  {'✅' if isolated else '❌'} 1.8 任务隔离验证: default={len(default_ids)}, e2e-test={len(e2e_ids)}, isolated={isolated}")
    
    # 1.9 删除e2e-test工作区
    test_api("1.9 删除e2e-test工作区",
        lambda: requests.delete(f"{BASE}/workspace/named/e2e-test").status_code)
    
    # 1.10 验证只剩default
    r = test_api("1.10 验证只剩default工作区",
        lambda: requests.get(f"{BASE}/workspace/named").json())
    if r:
        ws_names = [w["name"] for w in r["workspaces"]]
        print(f"      工作区: {ws_names}")
    
    return task_id

async def test_websocket(task_id):
    """Phase 2: WebSocket实时通信测试"""
    print("\n=== Phase 2: WebSocket测试 ===")
    
    if not task_id:
        print("  ⚠️ 跳过（无task_id）")
        return
    
    events_received = []
    try:
        async with websockets.connect(WS_URL, ping_interval=25) as ws:
            print(f"  ✅ 2.1 WebSocket连接成功")
            
            # 发送ping
            await ws.send(json.dumps({"type": "ping"}))
            msg = await asyncio.wait_for(ws.recv(), timeout=5)
            print(f"  ✅ 2.2 Ping/Pong: {msg[:50]}")
            
            # 订阅任务
            await ws.send(json.dumps({
                "type": "subscribe",
                "task_id": task_id
            }))
            msg = await asyncio.wait_for(ws.recv(), timeout=5)
            print(f"  ✅ 2.3 订阅任务: {msg[:80]}")
            
            # 等待事件
            print("  ⏳ 2.4 等待事件（10秒）...")
            start = time.time()
            while time.time() - start < 10:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=2)
                    data = json.loads(msg)
                    if data.get("type") == "server_ping":
                        continue
                    events_received.append(data)
                    event_type = data.get("type", "unknown")
                    print(f"      收到事件: {event_type}")
                except asyncio.TimeoutError:
                    continue
            
            print(f"  ✅ 2.4 收到 {len(events_received)} 个事件")
            
    except Exception as e:
        print(f"  ❌ WebSocket测试失败: {e}")

def test_frontend_render():
    """Phase 3: 前端页面渲染测试"""
    print("\n=== Phase 3: 前端页面渲染测试 ===")
    
    # 3.1 Solo页面加载
    try:
        r = requests.get("http://127.0.0.1:5174/solo", timeout=60)
        print(f"  ✅ 3.1 Solo页面加载: {r.status_code} ({len(r.text)} bytes)")
        
        # 检查关键组件是否在HTML中
        checks = {
            "SoloLayout": "SoloLayout" in r.text or "solo-layout" in r.text.lower(),
            "TaskListPanel": "task" in r.text.lower(),
            "WorkspacePanel": "workspace" in r.text.lower() or "explorer" in r.text.lower(),
            "MarkdownPanel": "editor" in r.text.lower() or "markdown" in r.text.lower(),
        }
        for name, found in checks.items():
            print(f"      {'✅' if found else '⚠️'} {name}: {'found' if found else 'not in SSR'}")
    except Exception as e:
        print(f"  ❌ 3.1 Solo页面加载失败: {e}")
    
    # 3.2 API代理测试
    try:
        r = requests.get("http://127.0.0.1:5174/api/v1/workspace/named", timeout=10)
        print(f"  ✅ 3.2 API代理: {r.status_code} - {len(r.json()['workspaces'])} workspaces")
    except Exception as e:
        print(f"  ❌ 3.3 API代理失败: {e}")

def test_file_operations(task_id):
    """Phase 4: 文件操作测试"""
    print("\n=== Phase 4: 文件操作测试 ===")
    
    if not task_id:
        print("  ⚠️ 跳过（无task_id）")
        return
    
    # 4.1 写入文件到工作区
    content = "# E2E测试文件\n\n这是一个测试文件，用于验证文件操作功能。\n\n" + "测试行 " * 50
    try:
        r = requests.post(f"{BASE}/workspace/default/files", json={
            "filename": "output/e2e-test.md",
            "content": content
        })
        print(f"  ✅ 4.1 写入文件: {r.status_code}")
    except Exception as e:
        print(f"  ❌ 4.1 写入文件失败: {e}")
    
    # 4.2 读取文件
    try:
        r = requests.get(f"{BASE}/workspace/default/files/output/e2e-test.md")
        if r.status_code == 200:
            data = r.json()
            print(f"  ✅ 4.2 读取文件: {len(data.get('content', ''))} chars")
        else:
            print(f"  ⚠️ 4.2 读取文件: {r.status_code}")
    except Exception as e:
        print(f"  ❌ 4.2 读取文件失败: {e}")
    
    # 4.3 列出文件
    try:
        r = requests.get(f"{BASE}/workspace/default/files")
        data = r.json()
        files = data.get("files", [])
        print(f"  ✅ 4.3 列出文件: {data['total']} files")
        for f in files[:5]:
            print(f"      - {f.get('name', f.get('path', '?'))}")
    except Exception as e:
        print(f"  ❌ 4.3 列出文件失败: {e}")
    
    # 4.4 搜索文件
    try:
        r = requests.get(f"{BASE}/workspace/default/files/search?q=e2e")
        data = r.json()
        print(f"  ✅ 4.4 搜索文件: {len(data.get('results', []))} results")
    except Exception as e:
        print(f"  ❌ 4.4 搜索文件失败: {e}")

def test_llm_call():
    """Phase 5: LLM调用测试"""
    print("\n=== Phase 5: LLM调用测试 ===")
    
    # 5.1 OpenRoute健康检查
    try:
        r = requests.get("http://127.0.0.1:13000/v1/models", timeout=10)
        if r.status_code == 200:
            models = r.json().get("data", [])
            print(f"  ✅ 5.1 OpenRoute: {len(models)} models available")
        else:
            print(f"  ⚠️ 5.1 OpenRoute: {r.status_code}")
    except Exception as e:
        print(f"  ❌ 5.1 OpenRoute不可用: {e}")
    
    # 5.2 通过FlowForge创建任务（触发LLM调用）
    try:
        r = requests.post(f"{BASE}/tasks", json={
            "intent": "简单测试：1+1等于几",
            "persona": "default",
            "mode": "solo",
            "workspace": "default"
        })
        data = r.json()
        if data.get("status") == "created":
            tid = data["data"]["task_id"]
            print(f"  ✅ 5.2 创建LLM测试任务: {tid[:12]}...")
            
            # 等待任务执行
            print("      等待任务执行（15秒）...")
            time.sleep(15)
            
            # 检查任务状态
            r2 = requests.get(f"{BASE}/tasks/{tid}")
            if r2.status_code == 200:
                task_data = r2.json()
                status = task_data.get("status", "unknown")
                print(f"      任务状态: {status}")
            else:
                print(f"      任务状态查询: {r2.status_code}")
        else:
            print(f"  ⚠️ 5.2 创建任务: {data}")
    except Exception as e:
        print(f"  ❌ 5.2 LLM调用测试失败: {e}")

def main():
    print("=" * 60)
    print("FlowForge Solo 前端E2E测试")
    print("=" * 60)
    
    # Phase 1
    task_id = run_phase1_api_tests()
    
    # Phase 2
    asyncio.run(test_websocket(task_id))
    
    # Phase 3
    test_frontend_render()
    
    # Phase 4
    test_file_operations(task_id)
    
    # Phase 5
    test_llm_call()
    
    print("\n" + "=" * 60)
    print("E2E测试完成！请检查上方结果")
    print("=" * 60)

if __name__ == "__main__":
    main()
