# T014: Web UI E2E + 性能测试基准

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: E2E 测试 + 性能测试
> **关联 spec.md**: [doc:../spec.md]（FR-HELM-01~04, §4.1 性能要求）
> **关联 arch.md**: [doc:../arch.md]（§10.6）
> **关联 design.md**: [doc:../design.md]（§5.2）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]，T8 浏览器 DOM 验证）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. Web UI E2E 测试用例

| 用例 ID | 场景 | 用户操作 | 预期 |
|---------|------|---------|------|
| **E2E-01** | 创建并完成普通任务 | 仪表盘 → 填入意图 → 选择模式 → 提交 | 任务创建成功，可在任务列表查看 |
| **E2E-02** | 审核流程 | 审核中心 → 预览草稿 → 通过 | 任务状态变为 published |
| **E2E-03** | 驳回流程 | 审核中心 → 预览草稿 → 驳回 + 反馈 | 任务状态变为 rejected |
| **E2E-04** | Helm 模式实时交互 | 创建 Helm 任务 → WebSocket 连接 → 观察实时事件流 | 执行流展示全部工具调用和 LLM 思考过程 |
| **E2E-05** | Helm 模式审核 | Helm 模式中点击通过/驳回 | 任务继续执行到 publish |
| **E2E-06** | 定时任务管理 | 创建 Cron 任务 → 等待触发 | 定时触发创作 |
| **E2E-07** | 模型健康管理 | 查看模型列表 → 触发健康检查 | 模型状态更新 |
| **E2E-08** | 插件管理 | 查看已加载插件 → 安装新插件 → 重载 | 新插件可用 |

---

## 2. 性能测试基准

### 2.1 压力测试指标

| 指标 | 目标 | 测试方法 |
|------|------|---------|
| **单 Agent 执行延迟** | < 2s (不含 LLM API 耗时) | 100 次 TopicAgent.execute 取 P95 |
| **Workflow 8 步骤执行** | < 30s (不含 LLM API 耗时) | 10 次 deep_article Workflow 取均值 |
| **Reflexion 3 迭代** | < 15s (不含 LLM API 耗时) | 10 次 Reflexion Writer 取均值 |
| **并发创建 10 个不同 persona 任务** | 全部成功，无锁冲突 | 10 并发 POST /tasks |
| **WebSocket 事件延迟** | < 50ms (P95) | Helm 模式下 tool.start 到前端接收 |
| **插件加载时间** | < 500ms (10 个插件) | 启动时扫描 entry_points + YAML |
| **沙箱代码执行** | 启动延迟 < 100ms | 100 次 PythonExecutorTool 取均值 |

### 2.2 压力测试脚本示例

```python
# tests/performance/test_concurrent_tasks.py

import asyncio
import time
import httpx
import pytest

@pytest.mark.asyncio
async def test_concurrent_create_10_personas():
    """并发创建 10 个不同 persona 任务"""
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        tasks = []
        for i in range(10):
            payload = {
                "persona": f"test_persona_{i}",
                "input_data": {"topic": f"测试任务 {i}"},
                "mode": "react"
            }
            tasks.append(client.post("/api/v1/tasks", json=payload))
        start = time.time()
        results = await asyncio.gather(*tasks)
        elapsed = time.time() - start
        success = sum(1 for r in results if r.status_code == 201)
        print(f"10 并发创建: {elapsed:.2f}s, 成功: {success}/10")
        assert success == 10, "所有并发创建应该成功"
```

### 2.3 P95 延迟测试模板

```python
import statistics
import time
import pytest

@pytest.mark.asyncio
async def test_p95_agent_execution_delay():
    """单 Agent 执行延迟 P95 < 2s（不含 LLM API 耗时）"""
    from flowforge.agents.topic_agent import TopicAgent
    from flowforge.core.context import TaskContext

    agent = TopicAgent()
    latencies = []

    for i in range(100):
        ctx = TaskContext(task_id=f"perf_test_{i}", persona="tech_blog")
        # 使用 Mock LLM 排除 LLM API 耗时
        ctx.llm = MockLLM()

        start = time.time()
        await agent.execute_with_context(input_data={"topic": f"测试 {i}"}, ctx=ctx)
        elapsed = time.time() - start
        latencies.append(elapsed)

    p95 = statistics.quantiles(latencies, n=100)[94]  # P95
    assert p95 < 2.0, f"P95 延迟 {p95:.3f}s 超过 2s 阈值"
```

---

## 3. 测试覆盖率目标

| 模块 | 目标覆盖率 | 关键覆盖项 |
|------|-----------|-----------|
| `core/` | ≥ 90% | BaseAgent, BaseTool(+safety_level), TaskContext, DI, Errors, CheckpointManager(增强) |
| `modes/` | ≥ 85% | 所有 9 种执行器 + MultiAgent(三策略) + Workflow(防御+reflexion_retry) |
| `events/` | ≥ 90% | EventBus, HelmAdapter |
| `tools/` | ≥ 85% | Registry(+timeout), SecureToolRegistry, Sandbox, LLMClient |
| `memory/` | ≥ 85% | MemoryManager(+compressor), TaskBoard, Mailbox, ContextCompressor |
| `executor/` | ≥ 80% | HybridExecutor, StateManager |
| `plugins/` | ≥ 75% | PluginManager, entry_points 加载 |

---

## 4. T8 浏览器 DOM 验证要求

> **T8 铁律**：Web UI E2E 测试必须操控浏览器验证 DOM 内容，且对 DOM 内容调用 LLM 审核质量。

### 4.1 浏览器等待条件

- 必须使用 `wait_until="domcontentloaded"`（**非 `networkidle`**）
- 原因：Next.js HMR/websocket 活动会导致 `networkidle` 永不触发

### 4.2 DOM 内容 LLM 审核

每个 E2E 用例完成后：

1. 提取关键 DOM 内容（任务列表、草稿、状态显示等）
2. 调用 LLM（如 Kimi-K2.6）对 DOM 内容进行质量审核
3. 审核维度：内容完整性、渲染正确性、交互响应性、AI 痕迹
4. 审核分数 ≥ 0.85 才算通过

### 4.3 Playwright + LLM 审核代码模板

```python
import pytest
from playwright.async_api import async_playwright
from flowforge.tools.llm_client import LLMClient

@pytest.mark.asyncio
async def test_e2e_02_review_approve_flow_with_llm_review():
    """E2E-02: 审核流程 + LLM 审核 DOM 内容"""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto("http://localhost:5173/review", wait_until="domcontentloaded")

        # 预览草稿
        await page.click('[data-testid="draft-preview"]')
        await page.wait_for_selector('[data-testid="draft-content"]', timeout=10000)

        # 提取 DOM 内容
        draft_content = await page.text_content('[data-testid="draft-content"]')
        assert len(draft_content) > 100, "草稿内容过短"

        # LLM 审核 DOM 内容
        llm = LLMClient()
        review_result = await llm.execute(
            prompt=f"审核以下 Web UI 草稿内容的质量（0-1 分）：\n{draft_content[:2000]}",
            model="kimi-k2.6"
        )
        score = float(review_result.strip())
        assert score >= 0.85, f"LLM 审核分数 {score} < 0.85"

        # 点击通过
        await page.click('[data-testid="approve-btn"]')
        await page.wait_for_selector('[data-testid="status-published"]', timeout=10000)

        await browser.close()
```

---

## 5. 性能基准报告模板

```markdown
# FlowForge 性能基准报告

## 1. 单 Agent 延迟（100 次取 P95）

| Agent | P50 | P95 | P99 | 达标 |
|-------|-----|-----|-----|------|
| TopicAgent | - | - | - | - |
| MaterialCollectionAgent | - | - | - | - |
| ArticleWritingAgent | - | - | - | - |
| SEOOptimizationAgent | - | - | - | - |

## 2. Workflow 端到端延迟（10 次取均值）

| Workflow | 均值 | P95 | 达标 (< 30s) |
|----------|------|-----|-------------|
| deep_article | - | - | - |
| quick_post | - | - | - |
| trend_article | - | - | - |

## 3. 并发性能

| 场景 | 成功率 | 均值延迟 | P95 延迟 |
|------|--------|---------|---------|
| 10 并发不同 persona | - | - | - |
| 50 并发不同 persona | - | - | - |
| 2 并发同 persona | - | - | - |

## 4. WebSocket 事件延迟

| 事件类型 | P50 | P95 | P99 |
|---------|-----|-----|-----|
| tool.start → 前端接收 | - | - | - |
| llm.stream → 前端渲染 | - | - | - |
| task.completed → 前端更新 | - | - | - |
```

---

## 6. 引用

- [doc:../spec.md]（FR-HELM-01~04, §4.1 性能要求）
- [doc:../arch.md]（§10.6）
- [doc:../design.md]（§5.2）
- [doc:rules.md#T1-T8]（特别是 T8 浏览器 DOM 验证）
- [doc:design/naming-contract.md]
- [doc:TEMPLATE.md]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建：从原 test.md 第 26-27 章拆分，覆盖 E2E-01~08 + 性能基准 + 覆盖率目标 + T8 模板 | 测试员可进化智能体（蜜獾·平头哥） |
