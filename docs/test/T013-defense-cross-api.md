# T013: 防御集成 + 跨 Workflow + API 业务正确性测试

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 集成测试（防御 + 跨流程 + API 业务）
> **关联 spec.md**: [doc:../spec.md]（FR-DEF-01, FR-ENG-01~06）
> **关联 arch.md**: [doc:../arch.md]（§9.1, §4.7）
> **关联 design.md**: [doc:../design.md]（§16.1, §4.2）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. 防御集成测试（IT-DEF）

> **三层防御架构**：L1 超时控制 → L2 异常检测 → L3 自修正（reflexion_retry）

### 1.1 三层防御联合测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-DEF-01** | L1 超时 → L2 检测 → L3 修正 | 工具超时 → 重复检测 → reflexion_retry 自修正 |
| **IT-DEF-02** | 防御配置传递 | `ctx.metadata["defense"]` 正确合并到步骤级 |
| **IT-DEF-03** | SOP 模板渲染 | `{{variable}}` 被正确替换 |
| **IT-DEF-04** | Checkpoint 入口保存 | checkpoint_enabled=True 时，SOP 入口自动保存检查点 |

### 1.2 IT-DEF-01 详细流程

```
1. 工具调用超时（L1 触发）
   ↓
2. 检测到重复失败模式（L2 触发）
   ↓
3. Reflexion 分析失败原因 → 修正 → 重试（L3 触发）
   ↓
4. 重试成功（或达到上限后 abort）
```

**通过条件**：

1. ✅ L1 超时事件被记录
2. ✅ L2 检测事件被记录
3. ✅ L3 reflexion_retry 事件被记录
4. ✅ 最终结果要么成功要么明确 abort（不能挂起）

---

## 2. 跨 Workflow 组合测试

### 2.1 IT-CROSS-01：先后执行两个 Workflow

**操作**：

1. 先执行 deep_article（persona=tech_blog）
2. 等待完成后，执行 quick_post（persona=tech_blog）

**预期**：

1. ✅ 两个 Workflow 独立完成，状态不互相污染
2. ✅ 第 1 个 Workflow 的 Memory 数据在第 2 个中可查询到（如果 TTL 未过期）
3. ✅ Persona 锁在 deep_article review 暂停时正确释放，quick_post 能正常获取

### 2.2 IT-CROSS-02：deep_article → multi_platform 链式

**操作**：

1. 执行 deep_article（含 review 暂停）
2. 审核通过后，对同一篇文章执行 multi_platform

**预期**：

1. ✅ multi_platform 可以复用 deep_article 的 draft 和 materials
2. ✅ 两个 Workflow 的 publish 输出不同（不同平台）

### 2.3 跨 Workflow 不变量

- ✅ 任务状态机不串扰（每个 Workflow 独立 task_id）
- ✅ Memory 命名空间隔离（persona 维度）
- ✅ Persona 锁正确获取/释放（不能跨 Workflow 持锁）
- ✅ 数据库事务边界清晰（不能跨 Workflow 共享未提交事务）

---

## 3. API 业务正确性验证

> **要求**：不再只检查 `status_code=200`，必须验证业务逻辑正确性。

### 3.1 API-01：模式列表验证

**操作**：GET /api/v1/modes

**验证**：

1. ✅ 返回 9 种模式（react/plan_execute/reflexion/multi_agent/workflow/rewoo/self_discover/agent_judge/graph_of_thoughts）
2. ✅ 每个模式包含完整字段（name, description, capabilities）
3. ✅ 不包含未注册的垃圾模式
4. ✅ 模式执行器初始化失败的不出现在列表中

### 3.2 API-02：任务创建验证

**操作**：POST /api/v1/tasks

**验证**：

1. ✅ 返回 task_id（非空 UUID）
2. ✅ 返回 status=pending
3. ✅ 返回 mode 字段与请求一致
4. ✅ 返回 persona 字段与请求一致
5. ✅ 任务记录写入数据库（可查询）

### 3.3 API-03：任务状态转换验证

**操作**：创建任务 → 查询状态 → 等待完成 → 查询最终状态

**验证**：

1. ✅ 状态转换序列：pending → running → completed/error
2. ✅ running 状态包含 current_step 信息
3. ✅ completed 状态包含 result 字段（非空 JSON）
4. ✅ error 状态包含 error 字段（非空字符串）
5. ✅ 不存在从 completed 回退到 running 的情况

### 3.4 API 测试代码模板

```python
import pytest
import httpx
import uuid

@pytest.mark.asyncio
async def test_api_01_modes_list():
    """API-01: 模式列表验证"""
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        resp = await client.get("/api/v1/modes")
        assert resp.status_code == 200

        data = resp.json()
        modes = data.get("modes", [])
        assert len(modes) == 9, f"Expected 9 modes, got {len(modes)}"

        expected_modes = {
            "react", "plan_execute", "reflexion", "multi_agent",
            "workflow", "rewoo", "self_discover", "agent_judge", "graph_of_thoughts"
        }
        actual_modes = {m["name"] for m in modes}
        assert actual_modes == expected_modes, f"Mode mismatch: {actual_modes ^ expected_modes}"

        # 每个模式必须有完整字段
        for m in modes:
            assert "name" in m and m["name"]
            assert "description" in m and m["description"]
            assert "capabilities" in m


@pytest.mark.asyncio
async def test_api_02_task_creation():
    """API-02: 任务创建验证"""
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        payload = {
            "persona": "tech_blog",
            "workflow": "quick_post",
            "task": "写一篇关于 AI Agent 的文章",
            "platforms": ["local"],
        }
        resp = await client.post("/api/v1/tasks", json=payload)
        assert resp.status_code == 201

        data = resp.json()
        assert "task_id" in data
        assert uuid.UUID(data["task_id"])  # 合法 UUID

        assert data["status"] == "pending"
        assert data["persona"] == "tech_blog"


@pytest.mark.asyncio
async def test_api_03_status_transitions():
    """API-03: 任务状态转换验证"""
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        # 创建任务
        payload = {
            "persona": "tech_blog",
            "workflow": "quick_post",
            "task": "测试任务",
            "platforms": ["local"],
        }
        resp = await client.post("/api/v1/tasks", json=payload)
        task_id = resp.json()["task_id"]

        # 轮询状态
        previous_status = "pending"
        seen_statuses = ["pending"]
        for _ in range(120):  # 最多等 120s
            resp = await client.get(f"/api/v1/tasks/{task_id}")
            status = resp.json().get("status")
            if status != previous_status:
                seen_statuses.append(status)
                previous_status = status
            if status in ("completed", "error"):
                break
            await asyncio.sleep(1)

        # 验证状态序列
        assert seen_statuses[0] == "pending"
        assert seen_statuses[-1] in ("completed", "error")

        if seen_statuses[-1] == "completed":
            assert "result" in resp.json()
            assert resp.json()["result"]
        else:
            assert "error" in resp.json()
            assert resp.json()["error"]
```

---

## 4. 引用

- [doc:../spec.md]（FR-DEF-01, FR-ENG-01~06）
- [doc:../arch.md]（§9.1, §4.7）
- [doc:../design.md]（§16.1, §4.2）
- [doc:rules.md#T1-T8]
- [doc:design/naming-contract.md]
- [doc:TEMPLATE.md]

---

## 5. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建：从原 test.md 第 23-25 章拆分，覆盖 IT-DEF + IT-CROSS + API-01~03 | 测试员可进化智能体（蜜獾·平头哥） |
