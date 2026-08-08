# T010: 多模型通道矩阵（CH-01~05）

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 通道测试（多模型分通道验证）
> **关联 spec.md**: [doc:../spec.md]（FR-CAP-01）
> **关联 arch.md**: [doc:../arch.md]（§10.4）
> **关联 design.md**: [doc:../design.md]（§11.1）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. 通道组合测试

| 测试 ID | 通道 | Workflow | 优先级 | 说明 |
|---------|------|---------|--------|------|
| **CH-01** | `openroute/auto`（API） | quick_post | P0 | API 通道基准验证 |
| **CH-02** | `openroute/doubao-web/chat`（网页版） | quick_post | P0 | 网页版需要特殊 Prompt 约束 |
| **CH-03** | `openroute/auto`（API） | deep_article | P0 | 复杂 Workflow API 验证 |
| **CH-04** | `openroute/doubao-web/chat`（网页版） | deep_article | P0 | 复杂 Workflow 网页版验证 |
| **CH-05** | `arkcode/ark-code-latest`（coding） | quick_post | P1 | coding 档位验证 |

---

## 2. 通道验证通过标准

| 通道 | 验证标准 | 不通过处理 |
|------|---------|-----------|
| `openroute/auto` | quick_post 3 阶段全部完成 | 若通过，作为后续所有测试的主通道 |
| `doubao-web/chat` | quick_post 3 阶段全部完成 + 工具格式输出正确 | 若 LLM 输出格式不符：调整 Prompt，约束输出格式 |
| `arkcode/ark-code-latest` | 代码生成任务完成 | 若不支持：标记为不可用，在 models.yaml 中 enabled=false |
| **网页版模型** | **LLM 必须按 Prompt 约束输出工具调用格式** | **不通过则修正 Prompt，修复后重新验证** |
| **API 版模型** | **LLM 必须正确使用 tool_calls** | **不通过则检查模型是否支持 tool_calls，不支持则标记** |

---

## 3. 网页版模型 Prompt 约束模板

当使用 doubao-web/chat 或 openroute-web 时（不支持原生 tool_calls），LLM 客户端自动在 Prompt 中注入：

```
你是 FlowForge 的写作 Agent。你必须严格按照以下格式输出：

1. 如果需要搜索资料，输出:
   TOOL: web_search
   QUERY: <搜索关键词>

2. 如果需要抓取网页内容，输出:
   TOOL: web_scraper
   URL: <网页URL>

3. 如果最终回答，输出:
   FINAL_ANSWER:
   {"result": {...}}

注意: 不要输出任何其他格式的内容。
```

---

## 4. 通道健康检查流程

### 4.1 健康检查脚本

```python
import httpx
import asyncio

async def ping_channel(model: str, base_url: str = "http://localhost:13000/v1"):
    """检查单通道健康"""
    async with httpx.AsyncClient(base_url=base_url, timeout=10.0) as client:
        # 1. 模型列表
        try:
            resp = await client.get("/models")
            models = resp.json().get("data", [])
            if model not in [m["id"] for m in models]:
                return {"model": model, "status": "NOT_FOUND"}
        except Exception as e:
            return {"model": model, "status": "CONN_FAIL", "error": str(e)}

        # 2. 调用测试
        try:
            resp = await client.post("/chat/completions", json={
                "model": model,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 5
            })
            if resp.status_code == 200:
                return {"model": model, "status": "OK", "latency_ms": resp.elapsed.total_seconds() * 1000}
            return {"model": model, "status": "FAIL", "code": resp.status_code}
        except Exception as e:
            return {"model": model, "status": "CALL_FAIL", "error": str(e)}


async def health_check_all():
    """全部通道健康检查"""
    models = [
        ("openroute/auto", "OpenRoute API 主通道"),
        ("openroute/doubao-web/chat", "Doubao 网页版（评审模型）"),
        ("arkcode/ark-code-latest", "ArkCode 编码模型"),
        ("openroute-api", "OpenRoute API 备用通道"),
    ]
    for model, desc in models:
        result = await ping_channel(model)
        print(f"{desc} ({model}): {result}")


if __name__ == "__main__":
    asyncio.run(health_check_all())
```

### 4.2 失败处理决策表

| 状态 | 处理动作 |
|------|---------|
| `OK` | 进入 CH-01~05 通道验证 |
| `NOT_FOUND` | 检查 models.yaml 配置，确认模型名拼写 |
| `CONN_FAIL` | 检查 OpenRoute 服务状态（端口 13000） |
| `CALL_FAIL` | 检查模型是否已禁用，或权限不足 |
| `FAIL` (HTTP 429) | 触发限流，等待 Retry-After |
| `FAIL` (HTTP 5xx) | 服务异常，切换备用通道 |

---

## 5. LLM 静默失败识别

> **关键约束**：LLMClient 必须检测 openroute 静默失败（HTTP 200 + content 包含 "当前不可用，请稍后重试"）并分类为 `model_not_found` 触发立即 fallback。

### 5.1 INVALID_RESPONSE_PATTERNS

```python
INVALID_RESPONSE_PATTERNS = [
    "当前不可用，请稍后重试",
    "当前不可用,请稍后重试",
    "无法回答",
    "无法回答这个问题",
    "我暂时无法回答",
    "我不能回答",
    "我无法提供",
    "我无法完成",
]
```

### 5.2 错误分类

- `model_not_found`（永久错误，立即切换）：包含 "model disabled", "all_backends_failed", "无权访问", INVALID_RESPONSE_PATTERNS
- `unknown`（临时错误，重试）：其他错误

---

## 6. 模型分配总表

| 档位 | 模型 | 用途 |
|------|------|------|
| default | `openroute/auto` | 执行模型（planning + agent 执行） |
| lightweight | `openroute/doubao-web/chat` | 评审模型（content_audit）+ 简单任务 |
| coding | `arkcode/ark-code-latest` | 代码生成任务 |
| 网页版 | `doubao-web/chat` | 非 seed-2.0 |
| 备用 | `openroute-api` | API-only 通道 |

**执行前必须验证模型可用性**：

- `doubao-web/chat` — 确认模型名已从 seed-2.0 更新
- `openroute-api` — API-only 验证通过后作为备用通道
- 不通过的模型：API 版设置 `enabled: false`，网页版修正 Prompt 约束

---

## 7. 引用

- [doc:../spec.md]（FR-CAP-01）
- [doc:../arch.md]（§10.4）
- [doc:../design.md]（§11.1）
- [doc:rules.md#T1-T8]
- [doc:design/naming-contract.md]
- [doc:T002-test-strategy.md]（6 维 28 项指标体系）
- [doc:TEMPLATE.md]

---

## 8. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建：从原 test.md 第 20 章拆分，覆盖 CH-01~05 通道矩阵 + 健康检查 + 静默失败识别 | 测试员可进化智能体（蜜獾·平头哥） |
