# T011: 并发 + Circuit Breaker 测试（IT-CONC + IT-CB）

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 集成测试（并发与容错）
> **关联 spec.md**: [doc:../spec.md]（FR-ENG-01, §4.3 可靠性）
> **关联 arch.md**: [doc:../arch.md]（§9.2 MCPBroker, §12.2 Persona 锁）
> **关联 design.md**: [doc:../design.md]（§4.2, §16.3）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. IT-CONC-01：10 并发不同 persona 任务

**需求依据**：spec.md 4.1 性能要求"并发创建 10 个不同 persona 任务：全部成功，无锁冲突"

**操作**：10 个并发 POST /api/v1/tasks，使用 10 个不同 persona（persona_1~10），全部使用 quick_post Workflow

**预期**：

1. ✅ 全部返回 201，无 409 ConflictError
2. ✅ 10 个任务全部成功完成
3. ✅ 各任务状态互不污染

**测试代码**：

```python
import asyncio
import httpx
import pytest

@pytest.mark.asyncio
async def test_it_conc_01_concurrent_different_personas():
    """IT-CONC-01: 10 并发不同 persona 任务"""
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        tasks = []
        for i in range(10):
            payload = {
                "persona": f"persona_{i}",
                "workflow": "quick_post",
                "task": f"写一篇关于主题 {i} 的简短文章",
                "platforms": ["local"],
            }
            tasks.append(client.post("/api/v1/tasks", json=payload))

        responses = await asyncio.gather(*tasks)

        # 全部 201
        for r in responses:
            assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"

        # 等待全部完成
        task_ids = [r.json()["task_id"] for r in responses]
        for tid in task_ids:
            for _ in range(60):  # 最多等 60s
                resp = await client.get(f"/api/v1/tasks/{tid}")
                status = resp.json().get("status")
                if status in ("completed", "error"):
                    break
                await asyncio.sleep(1)
            assert status == "completed", f"Task {tid} failed: {status}"
```

---

## 2. IT-CONC-02：同 persona 并发冲突

**需求依据**：spec.md FR-ENG-01 Persona 锁；arch.md 12.2

**操作**：2 个并发 POST /api/v1/tasks，使用同一个 persona

**预期**：

1. ✅ 第 1 个返回 201
2. ✅ 第 2 个返回 409 ConflictError
3. ✅ 第 1 个完成后，同 persona 新任务可正常执行

**测试代码**：

```python
@pytest.mark.asyncio
async def test_it_conc_02_same_persona_conflict():
    """IT-CONC-02: 同 persona 并发冲突"""
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        payload = {
            "persona": "conflict_test_persona",
            "workflow": "quick_post",
            "task": "测试任务",
            "platforms": ["local"],
        }
        r1, r2 = await asyncio.gather(
            client.post("/api/v1/tasks", json=payload),
            client.post("/api/v1/tasks", json=payload),
        )
        statuses = sorted([r1.status_code, r2.status_code])
        assert statuses == [201, 409], f"Expected [201, 409], got {statuses}"
```

---

## 3. IT-CB-01：连续失败触发熔断

**需求依据**：spec.md 4.3 可靠性要求"Circuit Breaker 触发：5 次连续失败触发熔断"；arch.md 9.2 MCPBroker

**操作**：配置一个必定失败的工具 → 连续调用 5 次

**预期**：

1. ✅ 前 5 次返回错误
2. ✅ 第 6 次返回 Circuit Breaker 开启状态
3. ✅ 熔断后不再尝试调用

**测试代码**：

```python
@pytest.mark.asyncio
async def test_it_cb_01_circuit_breaker_trigger():
    """IT-CB-01: 连续失败触发熔断"""
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        # 配置必定失败的工具（如指向不存在的 MCP server）
        results = []
        for i in range(6):
            resp = await client.post("/api/v1/tools/execute", json={
                "tool": "always_fail_tool",
                "input": {"attempt": i}
            })
            results.append(resp.status_code)

        # 前 5 次返回错误，第 6 次熔断
        assert all(r in (500, 503) for r in results[:5]), "前 5 次应该返回错误"
        assert results[5] == 503, "第 6 次应该返回 Circuit Breaker 开启"
```

---

## 4. IT-CB-02：429 retry-after 处理

**需求依据**：spec.md 4.3 可靠性要求"429 Retry-After：支持 retry-after 头部解析"

**操作**：模拟 LLM 返回 429 状态码 + Retry-After: 5

**预期**：

1. ✅ 等待 5 秒后重试
2. ✅ 重试成功
3. ✅ 日志记录 429 事件和重试行为

**测试代码**：

```python
@pytest.mark.asyncio
async def test_it_cb_02_429_retry_after():
    """IT-CB-02: 429 retry-after 处理"""
    import time
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        # 触发限流
        start = time.time()
        resp = await client.post("/api/v1/llm/test_429", json={
            "model": "openroute/auto",
            "messages": [{"role": "user", "content": "test"}]
        })
        elapsed = time.time() - start

        # 应该等待 Retry-After 秒后重试成功
        assert resp.status_code == 200, f"Expected 200 after retry, got {resp.status_code}"
        assert elapsed >= 5.0, f"Expected wait >= 5s, got {elapsed:.2f}s"
```

---

## 5. Circuit Breaker 状态机

```
[Closed] --连续失败≥阈值--> [Open]
   ↑                          │
   │                          │ 冷却时间过后
   │                          ↓
   └─── 成功 ──── [Half-Open]
                    │
                    │ 失败
                    ↓
                  [Open]
```

### 5.1 状态参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `failure_threshold` | 5 | 触发熔断的连续失败次数 |
| `recovery_timeout` | 30s | Open 状态冷却时间 |
| `half_open_max_calls` | 3 | Half-Open 状态最大测试调用数 |
| `success_threshold` | 2 | Half-Open 转 Closed 所需连续成功次数 |

### 5.2 状态转换断言

| 转换 | 触发 | 断言 |
|------|------|------|
| Closed → Open | 连续失败 ≥ 5 | `state == "open"` |
| Open → Half-Open | 冷却时间过后 | `state == "half_open"` |
| Half-Open → Closed | 连续成功 ≥ 2 | `state == "closed"` |
| Half-Open → Open | 任意失败 | `state == "open"` |

---

## 6. 引用

- [doc:../spec.md]（FR-ENG-01, §4.3 可靠性）
- [doc:../arch.md]（§9.2, §12.2）
- [doc:../design.md]（§4.2, §16.3）
- [doc:rules.md#T1-T8]
- [doc:design/naming-contract.md]
- [doc:TEMPLATE.md]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建：从原 test.md 第 21 章拆分，覆盖 IT-CONC-01~02 + IT-CB-01~02 + 状态机 | 测试员可进化智能体（蜜獾·平头哥） |
