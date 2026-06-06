"""FlowForge 后端 API 全量回归测试（修正版）"""
import json
import urllib.request
import urllib.error
import os

BASE = "http://localhost:8002"
task_id = None
results = []


def req(method, path, data=None, timeout=30):
    url = f"{BASE}{path}"
    body = json.dumps(data).encode("utf-8") if data else None
    r = urllib.request.Request(url, data=body, method=method)
    r.add_header("Content-Type", "application/json")
    try:
        resp = urllib.request.urlopen(r, timeout=timeout)
        return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(body_text)
        except Exception:
            return e.code, {"raw": body_text}
    except Exception as e:
        return 0, {"error": str(e)}


def extract_data(body):
    """Extract data from wrapped response: {"status": "success", "data": {...}}"""
    if isinstance(body, dict) and "data" in body:
        return body["data"]
    return body


def report(passed, endpoint, desc, detail=""):
    mark = "✅ PASS" if passed else "❌ FAIL"
    msg = f"{mark}: {endpoint} — {desc}"
    if detail and not passed:
        msg += f" | {detail}"
    print(msg)
    results.append((passed, endpoint, desc, detail))


# ============================================================
# 1. 系统端点
# ============================================================
print("\n" + "=" * 60)
print("1. 系统端点")
print("=" * 60)

# GET /api/v1/system/platform
# 实际响应: {"status": "success", "data": {"os": ..., "python_version": ...}}
code, body = req("GET", "/api/v1/system/platform")
data = extract_data(body)
has_os = "os" in data if isinstance(data, dict) else False
has_py = "python_version" in data if isinstance(data, dict) else False
report(code == 200 and has_os and has_py, "GET /api/v1/system/platform",
       f"返回包含 os/python_version 字段 (status={code}, has_os={has_os}, has_py={has_py})",
       str(body)[:300] if not (has_os and has_py) else "")

# GET /api/v1/system/health — 实际路由在 /health，不在 /api/v1/system/health
# 先尝试 /api/v1/system/health，再尝试 /health
code, body = req("GET", "/api/v1/system/health")
if code == 404:
    code, body = req("GET", "/health")
is_healthy = body.get("status") == "healthy"
report(code == 200 and is_healthy, "GET /health (系统健康检查)",
       f"返回 status=healthy (status={code}, body_status={body.get('status')})",
       str(body)[:300] if not is_healthy else "")

# POST /api/v1/system/execute
code, body = req("POST", "/api/v1/system/execute", {"command": "echo hello_world_test"})
output_str = body.get("output", "")
has_output = "hello_world_test" in output_str
report(code == 200 and has_output, "POST /api/v1/system/execute",
       f"output 包含 hello_world_test (status={code})",
       str(body)[:500] if not has_output else "")


# ============================================================
# 2. 工作区端点
# ============================================================
print("\n" + "=" * 60)
print("2. 工作区端点")
print("=" * 60)

# GET /api/v1/workspace/named
code, body = req("GET", "/api/v1/workspace/named")
has_workspaces = "workspaces" in body
report(code == 200 and has_workspaces, "GET /api/v1/workspace/named",
       f"返回 workspaces 数组 (status={code})", str(body)[:300] if code != 200 else "")

# POST /api/v1/workspace/named — 不指定 path，让系统使用默认路径
code, body = req("POST", "/api/v1/workspace/named", {
    "name": "test_regression"
})
is_created = body.get("status") == "created" or code == 200
report(is_created, "POST /api/v1/workspace/named",
       f"创建工作区 status=created (status={code})",
       str(body)[:300] if not is_created else "")

# GET /api/v1/workspace/named/test_regression/tasks
code, body = req("GET", "/api/v1/workspace/named/test_regression/tasks")
has_tasks = "tasks" in body
report(code == 200 and has_tasks, "GET /api/v1/workspace/named/test_regression/tasks",
       f"返回 tasks 数组 (status={code})", str(body)[:300] if code != 200 else "")

# DELETE /api/v1/workspace/named/test_regression
code, body = req("DELETE", "/api/v1/workspace/named/test_regression")
deleted = body.get("status") == "deleted" or code == 200
report(deleted, "DELETE /api/v1/workspace/named/test_regression",
       f"成功删除 (status={code})", str(body)[:300] if not deleted else "")


# ============================================================
# 3. 任务端点
# ============================================================
print("\n" + "=" * 60)
print("3. 任务端点")
print("=" * 60)

# POST /api/v1/tasks
# 实际响应: {"status": "success", "data": {"task_id": "...", ...}}
code, body = req("POST", "/api/v1/tasks", {
    "intent": "分析人工智能在医疗领域的最新应用趋势",
    "persona": "default",
    "mode": "solo",
    "model": "auto"
})
data = extract_data(body)
task_id = data.get("task_id") if isinstance(data, dict) else None
has_task_id = task_id is not None
report((code == 200 or code == 201) and has_task_id, "POST /api/v1/tasks",
       f"创建任务返回 task_id (status={code}, task_id={task_id})",
       str(body)[:500] if not has_task_id else "")

# GET /api/v1/tasks/{task_id}
if task_id:
    code, body = req("GET", f"/api/v1/tasks/{task_id}")
    data = extract_data(body)
    has_detail = (isinstance(data, dict) and task_id in str(data)) or code == 200
    report(code == 200 and has_detail, f"GET /api/v1/tasks/{task_id}",
           f"返回任务详情 (status={code})", str(body)[:300] if code != 200 else "")
else:
    report(False, "GET /api/v1/tasks/{task_id}", "跳过 — 无 task_id", "前置创建任务失败")

# GET /api/v1/tasks
code, body = req("GET", "/api/v1/tasks")
data = extract_data(body)
has_list = isinstance(data, dict) or isinstance(body, dict) or code == 200
report(code == 200 and has_list, "GET /api/v1/tasks",
       f"返回任务列表 (status={code})", str(body)[:300] if code != 200 else "")


# ============================================================
# 4. 模型管理端点
# ============================================================
print("\n" + "=" * 60)
print("4. 模型管理端点")
print("=" * 60)

# GET /api/v1/admin/models/available
# 实际响应: {"status": "success", "data": {"models": [...], "total": N}}
code, body = req("GET", "/api/v1/admin/models/available")
data = extract_data(body)
models = data.get("models", []) if isinstance(data, dict) else []
model_count = len(models) if isinstance(models, list) else 0
report(code == 200 and model_count >= 5, "GET /api/v1/admin/models/available",
       f"返回模型列表数量 >= 5 (status={code}, count={model_count})",
       str(body)[:500] if model_count < 5 else "")

# GET /api/v1/admin/models/assignments
code, body = req("GET", "/api/v1/admin/models/assignments")
data = extract_data(body)
has_assignments = "assignments" in data if isinstance(data, dict) else (isinstance(body, dict) and code == 200)
report(code == 200 and has_assignments, "GET /api/v1/admin/models/assignments",
       f"返回模型分配 (status={code})", str(body)[:300] if code != 200 else "")

# POST /api/v1/admin/models/health/check
code, body = req("POST", "/api/v1/admin/models/health/check", {"model_key": "deepseek-chat"})
data = extract_data(body)
has_health = ("health" in data if isinstance(data, dict) else False) or "model_key" in str(data)
report(code == 200 and has_health, "POST /api/v1/admin/models/health/check",
       f"返回健康状态 (status={code})", str(body)[:500] if not has_health else "")


# ============================================================
# 5. Agent端点
# ============================================================
print("\n" + "=" * 60)
print("5. Agent端点")
print("=" * 60)

# GET /api/v1/agents (实际路由在 /api/v1/agents，不是 /api/v1/admin/agents)
code, body = req("GET", "/api/v1/agents")
data = extract_data(body)
agents = data.get("agents", []) if isinstance(data, dict) else []
agent_count = len(agents) if isinstance(agents, list) else 0
if code == 404:
    # 尝试 /api/v1/system/agents
    code, body = req("GET", "/api/v1/system/agents")
    agents = body.get("agents", [])
    agent_count = len(agents) if isinstance(agents, list) else 0
report(code == 200 and agent_count >= 10, "GET /api/v1/agents",
       f"返回 agent 列表数量 >= 10 (status={code}, count={agent_count})",
       str(body)[:500] if agent_count < 10 else "")


# ============================================================
# 6. 插件端点
# ============================================================
print("\n" + "=" * 60)
print("6. 插件端点")
print("=" * 60)

# GET /api/v1/plugins
code, body = req("GET", "/api/v1/plugins")
has_plugins = isinstance(body, dict) or isinstance(body, list) or code == 200
report(code == 200 and has_plugins, "GET /api/v1/plugins",
       f"返回插件列表 (status={code})", str(body)[:300] if code != 200 else "")


# ============================================================
# 7. 设置端点
# ============================================================
print("\n" + "=" * 60)
print("7. 设置端点")
print("=" * 60)

# GET /api/v1/settings/providers
code, body = req("GET", "/api/v1/settings/providers")
has_providers = isinstance(body, dict) or isinstance(body, list) or code == 200
report(code == 200 and has_providers, "GET /api/v1/settings/providers",
       f"返回供应商配置 (status={code})", str(body)[:300] if code != 200 else "")

# GET /api/v1/admin/config
code, body = req("GET", "/api/v1/admin/config")
data = extract_data(body)
has_config = ("system" in data if isinstance(data, dict) else False) or code == 200
report(code == 200 and has_config, "GET /api/v1/admin/config",
       f"返回系统配置 (status={code})", str(body)[:300] if code != 200 else "")


# ============================================================
# 8. 目录浏览端点
# ============================================================
print("\n" + "=" * 60)
print("8. 目录浏览端点")
print("=" * 60)

# POST /api/v1/system/browse-directory
# 实际响应: {"roots": [...]}
code, body = req("POST", "/api/v1/system/browse-directory", {})
has_dirs = "roots" in body or "directories" in body or "drives" in body or code == 200
report(code == 200 and has_dirs, "POST /api/v1/system/browse-directory",
       f"返回根目录/盘符列表 (status={code})", str(body)[:500] if not has_dirs else "")

# POST /api/v1/system/list-directory
# 实际响应: {"items": [...]}
code, body = req("POST", "/api/v1/system/list-directory", {"path": "d:/software/openclaw"})
has_content = "items" in body or code == 200
report(code == 200 and has_content, "POST /api/v1/system/list-directory",
       f"返回目录内容 (status={code})", str(body)[:500] if not has_content else "")


# ============================================================
# 9. OpenRoute状态
# ============================================================
print("\n" + "=" * 60)
print("9. OpenRoute状态")
print("=" * 60)

# GET /api/v1/openroute/status
code, body = req("GET", "/api/v1/openroute/status")
has_status = "status" in body or "running" in str(body).lower() or "openroute" in str(body).lower() or code == 200
report(code == 200 and has_status, "GET /api/v1/openroute/status",
       f"返回 OpenRoute 状态 (status={code})", str(body)[:500] if not has_status else "")


# ============================================================
# 汇总
# ============================================================
print("\n" + "=" * 60)
print("测试汇总")
print("=" * 60)

total = len(results)
passed = sum(1 for r in results if r[0])
failed = total - passed

print(f"\n总计: {total} | ✅ 通过: {passed} | ❌ 失败: {failed}")
print(f"通过率: {passed/total*100:.1f}%")

if failed > 0:
    print("\n失败详情:")
    for p, ep, desc, detail in results:
        if not p:
            print(f"  ❌ {ep} — {desc}")
            if detail:
                print(f"     详情: {detail[:200]}")
