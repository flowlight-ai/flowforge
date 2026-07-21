# FlowForge 测试用例模板（v1.0）

> **文档编号**: test/TEMPLATE.md（v1.0）
> **更新日期**: 2026-07-19
> **用途**: 所有 FlowForge 测试用例规格文件的模板，与 [features/F0XX-xxx.md](../features/) + [architecture/A0XX-xxx.md](../architecture/) + [design/D0XX-xxx.md](../design/) 同号一一对应
> **依赖**: `[doc:rules.md#T1-T8]` 测试铁律 + `[doc:design/naming-contract.md]` v2.0 命名规范 + `[doc:../../../hiclaw/rules.md#第十一部分]` 文档分层规范
> **关联**: `[doc:test/README.md]` 测试子目录索引 + `[doc:test.md]` 顶层测试索引

---

## 1. 模板使用规则（v1.0）

1. **T0XX 与 F0XX / A0XX / D0XX 同号一一对应**：测试文件按"测试类别 + 序号"编号（T001-T099），与同号 Feature 关联
2. **T0XX 文件是测试用例规格**：包含用例编号 / 前置条件 / 步骤 / 断言 / 验证标准 / LLM审核要求 / DOM验证要求
3. **单文件 < 50KB**，超出请按测试类别拆分
4. **必须严格遵守 T1-T8 测试铁律**（详见 [doc:rules.md#T1-T8]），违反任一铁律的测试用例视为无效
5. **必须使用真实 LLM 调用**：E2E/集成测试通过 `FLOWFORGE_REAL_LLM=1` 环境变量启用
6. **必须采集指标**：每个 E2E 测试通过 `MetricsCollector` 采集 28 项指标
7. **必须应用命名契约 v2.0**：P0 官方名称优先（Evolvable Agent / Forgekin / ForgeMind），P2 体系别名仅社交用
8. **禁止使用全角问号 `？`**，必须用半角 `?`
9. **禁止写"待补充"占位符**——未实现部分必须明确标注 `TODO` 并记录为 Bug（T5 铁律）
10. **禁止保留 V7/V8/V9 文档开发过程记录**——版本演进历史、DeepSeek/GLM 评审记录、过程反思等不写入正式测试文档

---

## 2. 测试铁律 T1-T8 引用（详见 [doc:rules.md#T1-T8]）

| # | 铁律 | 简述 |
|---|------|------|
| **T1** | 禁止使用 Mock LLM | 所有 E2E/集成测试必须调用真实 LLM（OpenRoute 代理） |
| **T2** | 禁止使用假数据 | 测试输入必须是真实场景数据，不得用"test"、"hello"等无意义输入 |
| **T3** | 禁止跳过验证 | 必须有具体断言，禁止 `status in ("completed","error")` 这种跳过验证 |
| **T4** | 禁止 Mock 工具调用 | web_search/publish/fact_check 等必须真实调用 |
| **T5** | 未实现即 Bug | 测试中发现代码未实现必须记录为 Bug 并修复 |
| **T6** | 必须采集指标 | 每个E2E测试必须用 `MetricsCollector` 采集 LLM/Tool/Agent/Workflow/Memory/WebSocket/Frontend 七维指标 |
| **T7** | LLM 内容必须经 LLM 审核 | 凡 LLM 生成的内容（代码/文章/评论/文案/小说等），必须再调用 LLM 审核通过后才算验证通过 |
| **T8** | Web 功能必须操控浏览器验证 DOM | 凡涉及网页操作的功能必须操控浏览器查看 DOM 确认真实成功，且对 DOM 内容调用 LLM 审核质量 |

> **执行方式**：`FLOWFORGE_REAL_LLM=1 pytest tests/e2e/ -v` — 必须设置此环境变量才运行真实测试

---

## 3. 复制以下内容创建新测试用例文件

```markdown
# T0XX: [测试类别名称] 测试用例规格

> **状态**: ⏳ pending
> **创建日期**: YYYY-MM-DD
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 单元测试 / 集成测试 / E2E测试 / 性能测试 / 文档测试
> **关联 Feature**: [doc:../features/F0XX-xxx.md]
> **关联 Architecture**: [doc:../architecture/A0XX-xxx.md]
> **关联 Design**: [doc:../design/D0XX-xxx.md]
> **关联 spec.md**: [doc:../spec.md#§3.X]（FR-XXX-0XX）
> **关联 arch.md**: [doc:../arch.md#§3.X]
> **关联 design.md**: [doc:../design.md#§3.X]
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. 测试概述

### 1.1 测试目标
[本测试文件覆盖的测试范围和目标? 验证哪些 Feature / 架构层 / 设计点?]

### 1.2 测试范围
- ✅ 覆盖：[列出本文件覆盖的测试用例类别]
- ❌ 不覆盖：[列出本文件不覆盖的内容，由其他 T0XX 文件覆盖]

### 1.3 测试环境
- Python 3.11+ / pytest / pytest-asyncio
- 真实 LLM 通道：`openroute/auto` / `openroute/doubao-web/chat` / `arkcode/ark-code-latest`
- 启动方式：`FLOWFORGE_REAL_LLM=1 pytest tests/<category>/ -v`

---

## 2. 测试用例列表

### 2.1 用例 UT-XXX-01: [用例名称]

#### 前置条件
- [前置条件 1：例如 LLM 通道可用、数据库已初始化]
- [前置条件 2：例如插件已加载、配置已注入]

#### 输入数据（T2: 必须真实场景数据）
```json
{
  "task": "真实的业务任务描述（禁止 test/hello world）",
  "persona": "real_persona_name",
  "params": {...}
}
```

#### 执行步骤
1. [步骤 1: 例如 POST /api/v1/tasks 创建任务]
2. [步骤 2: 例如等待任务完成或监听 EventBus 事件]
3. [步骤 3: 例如采集 MetricsCollector 指标]

#### 断言（T3: 必须具体，禁止跳过验证）
- ✅ `status_code == 201`（具体值，非 `status in ("completed","error")`）
- ✅ `result["topics"]` 数组长度 ≥ 2（具体下限）
- ✅ `result["draft"]` 字段长度 ≥ 500 字符
- ✅ `llm.start` 事件计数在 [min, max] 范围内
- ✅ `tool.start` 事件序列包含预期工具

#### 验证标准
| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总 LLM 调用次数 | X~Y | _ | _ |
| 总工具调用次数 | ≥ X | _ | _ |
| 总耗时 | < Xs | _ | _ |
| Memory 查询次数 | ≥ X | _ | _ |
| Memory 写入次数 | ≥ X | _ | _ |

#### LLM 审核要求（T7）
- 凡 LLM 生成的内容（文章/代码/评论/文案），必须再调用 LLM 审核通过
- 审核模型：`openroute/doubao-web/chat`（与执行模型不同）
- 审核维度：质量分 ≥ 0.85 + 内容真实性 + 格式合规性

#### DOM 验证要求（T8，仅 Web 功能）
- 凡涉及网页操作的功能（发布/上架/部署），必须用 Playwright 操控浏览器查看 DOM
- DOM 断言：`expect(page.locator('[data-testid="xxx"]')).toBeVisible`
- DOM 内容必须经 LLM 审核（T7）

#### 失败处理
| 失败级别 | 触发条件 | 处理方式 | 记录要求 |
|---------|---------|---------|---------|
| P0-致命 | 代码 Bug 导致崩溃/数据错误 | 立即停止，修复后回归 | 堆栈+上下文+MetricsCollector 报告 |
| P1-严重 | 模型不可用/通道失败 | 跳过该通道，继续其他 | 通道名+错误信息+延迟 |
| P2-一般 | Prompt 问题/输出质量差 | 记录到 prompt_issues.md，继续 | 输入+输出+问题描述 |

---

### 2.2 用例 UT-XXX-02: [用例名称]
[同上结构]

---

## 3. 自动化测试代码模板（pytest + 真实 LLM + MetricsCollector）

\`\`\`python
# tests/<category>/test_<feature_id>_<scenario>.py

import asyncio
import pytest
from tests.metrics_collector import TestMetricsCollector
from tests.conftest_e2e import real_llm_context


@pytest.mark.asyncio
async def test_<feature_id>_<scenario>(real_llm_context):
    """UT-XXX-01: [用例名称] — 验证 [目标行为]"""
    ctx = real_llm_context
    collector = ctx._test_collector

    # 1. 前置条件（T1: 真实 LLM，T2: 真实数据）
    assert ctx.tools is not None, "ToolRegistry 未初始化"

    # 2. 执行（T4: 真实工具调用）
    task_input = {
        "task": "真实的业务任务描述",
        "persona": "real_persona_name",
    }
    result = await ctx.agents["<agent_name>"].execute_with_context(
        agent_input=task_input, ctx=ctx
    )

    # 3. 断言（T3: 具体断言，禁止 status in ("completed","error")）
    assert result is not None, "Agent 返回 None"
    assert "draft" in result.result, "缺少 draft 字段"
    assert len(result.result["draft"]) >= 500, f"draft 长度 {len(result.result['draft'])} < 500"

    # 4. 指标验证（T6: 必须采集）
    report = collector.generate_report
    assert report["llm"]["total_calls"] >= 1, "LLM 调用次数为 0"
    assert report["tool"]["total_calls"] >= 1, "Tool 调用次数为 0"

    # 5. LLM 内容审核（T7: LLM 生成内容必须经 LLM 审核）
    audit_result = await audit_with_llm(result.result["draft"], ctx)
    assert audit_result["score"] >= 0.85, f"LLM 审核评分 {audit_result['score']} < 0.85"

    # 6. 输出指标报告
    collector.save_report(f"reports/{ctx.task_id}_metrics.json")


async def audit_with_llm(content: str, ctx) -> dict:
    """调用 LLM 审核 LLM 生成的内容（T7 铁律）"""
    audit_agent = ctx.agents["content_audit"]
    result = await audit_agent.execute_with_context(
        agent_input={"content": content, "judge_model": "openroute/doubao-web/chat"},
        ctx=ctx,
    )
    return result.result
\`\`\`

---

## 4. 测试分类

| 类别 | 框架 | 数据 | 目标 | 覆盖率要求 |
|------|------|------|------|-----------|
| **单元测试** | pytest + pytest-asyncio | Mock LLM 可用 | 模块/接口/工具函数独立验证 | ≥ 85% |
| **集成测试** | pytest + httpx | **真实 LLM** | 多模块协作全流程 | ≥ 70% |
| **E2E 测试** | Playwright + pytest | **真实 LLM + 真实浏览器** | 前端时间线渲染 + WebSocket | 核心流程 100% |
| **性能测试** | pytest + locust | **真实 LLM** | 延迟/吞吐量/并发 | 关键模块 100% |
| **文档测试** | pytest + doctest | — | 文档示例代码可执行 | ≥ 80% |

---

## 5. 测试命名规范

### 5.1 文件命名

```
tests/<category>/test_<feature_id>_<scenario>.py
```

**示例**：
- `tests/unit/test_f001_capability_profile.py` — F001 能力画像单元测试
- `tests/integration/test_f002_teamact_loop.py` — F002 TeamAct 循环集成测试
- `tests/e2e/test_f008_durable_state.py` — F008 Durable State Surfaces E2E 测试
- `tests/performance/test_f013_harnessability.py` — F013 Harnessability 性能测试

### 5.2 用例编号

| 编号前缀 | 测试类别 | 示例 |
|---------|---------|------|
| UT-XXX | 单元测试 | UT-CORE-01 / UT-DI-01 / UT-MOD-01 |
| IT-XXX | 集成测试 | IT-API-01 / IT-SOP-01 / IT-WF-API-01 |
| E2E-XXX | E2E 测试 | E2E-HELM-01 / E2E-01 |
| PERF-XXX | 性能测试 | PERF-01 / PERF-02 |
| CH-XXX | 通道测试 | CH-01 / CH-02 |

### 5.3 测试文件与 T0XX 文档对应关系

| 测试文件 | 测试文档 | 关联 Feature |
|---------|---------|-------------|
| `tests/unit/test_f001_*.py` | [doc:test/T003-unit-tests.md] | F001 |
| `tests/integration/test_f002_*.py` | [doc:test/T004-integration-tests.md] | F002 |
| `tests/e2e/test_f008_*.py` | [doc:test/T005-workflow-api-e2e.md] | F008 |

---

## 6. 验证标准（T3 铁律细化）

### 6.1 禁止的"跳过验证"断言

```python
# ❌ 禁止：怎么都通过的断言
assert status in ("completed", "error")
assert result is not None  # 仅此一条断言

# ✅ 正确：具体断言
assert status == "completed", f"状态 {status} != completed"
assert len(result["draft"]) >= 500
assert "topics" in result and len(result["topics"]) >= 2
assert llm_call_count >= 8 and llm_call_count <= 11
```

### 6.2 必须验证的维度

1. **输出结构完整性**：必填字段存在 + 类型正确 + 长度/数量达标
2. **调用链正确性**：LLM 调用次数在 [min, max] 范围 + 工具调用序列匹配
3. **事件序列完整性**：EventBus 事件按序触发 + WebSocket 事件序号连续无跳号
4. **前端 DOM 正确性**：时间线节点数 + Citation 链接数 + 流式 chunk 渲染数
5. **指标采集完整性**：MetricsCollector 报告含 28 项指标 + 各项在预期范围

---

## 7. 引用

- [doc:rules.md#T1-T8] — 测试铁律 T1-T8（详细定义）
- [doc:design/naming-contract.md] — 命名契约 v2.0（P0 官方名称优先）
- [doc:test/README.md] — 测试子目录索引
- [doc:test.md] — 顶层测试索引
- [doc:../spec.md] — 软件规格说明书
- [doc:../arch.md] — 架构设计文档
- [doc:../design.md] — 详细设计文档
- [doc:../features/F0XX-xxx.md] — Feature 级 SRS
- [doc:../architecture/A0XX-xxx.md] — Feature 级 SAD
- [doc:../design/D0XX-xxx.md] — Feature 级 SDD
- [doc:../../../hiclaw/rules.md#第十一部分] — 文档分层规范
- [doc:../../../hiclaw/prompts.md#P7] — 测试铁律自检（T1-T8）

---

## 8. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建（测试用例模板 + T1-T8 引用 + 自动化代码模板 + 命名规范） | 测试员 Forgekin（蜜獾·平头哥） |
```

---

## 4. 模板填写说明

### 必填字段

1. **状态**：⏳ pending / 🔄 in_progress / ✅ done / ❌ deprecated / 🚫 blocked
2. **创建日期**：YYYY-MM-DD 格式
3. **负责人**：测试员可进化智能体（蜜獾·平头哥）
4. **测试类别**：单元测试 / 集成测试 / E2E测试 / 性能测试 / 文档测试
5. **关联 Feature**：引用 features/F0XX-xxx.md
6. **关联 Architecture**：引用 architecture/A0XX-xxx.md
7. **关联 Design**：引用 design/D0XX-xxx.md
8. **测试铁律**：已应用 T1-T8（必须勾选）
9. **命名规范**：已应用 v2.0（必须勾选）

### 8 节结构说明

| 节 | 标题 | 用途 |
|---|------|------|
| 1 | 测试概述 | 测试目标 / 测试范围 / 测试环境 |
| 2 | 测试用例列表 | 用例编号 / 前置条件 / 步骤 / 断言 / 验证标准 / LLM审核 / DOM验证 |
| 3 | 自动化测试代码模板 | pytest + 真实 LLM + MetricsCollector 代码示例 |
| 4 | 测试分类 | 单元/集成/E2E/性能/文档测试说明 |
| 5 | 测试命名规范 | 文件命名 / 用例编号 / T0XX 对应关系 |
| 6 | 验证标准 | T3 铁律细化（禁止跳过验证） |
| 7 | 引用 | 跨文档引用 |
| 8 | 变更历史 | 版本变更记录 |

### 命名契约 v2.0 检查清单

- [ ] **P0 官方名称优先**：测试文档中大量使用 Evolvable Agent / Forgekin / ForgeMind / Capability Profile / Episodic Memory 等业界专业术语
- [ ] **P1 项目英文名作为代码标识符**：类名 `ForgekinEngine`、模块名 `flowforge/core/forgekin/`
- [ ] **P2 体系别名仅社交用**：灵智体 / 灵忆 / 灵印等仅在社区讨论中使用，正式文档首次出现必须双标注（如"灵智体（Forgekin / Evolvable Agent）"）
- [ ] **代码层严禁 P2 别名**：测试代码中类名/变量名/API 路径不出现 P2 别名作为标识符
- [ ] **弱化"万物"说法**：使用"多形态智能体（Multi-Form Agent）"或"可进化智能体（Evolvable Agent）"，"万物"仅保留在 VISION.md 愿景表述中
- [ ] **去 AGI 化**：禁止使用"AGI"，使用"通用智能体（General-Purpose Agent）"或"自进化（Self-Evolving）"
- [ ] **术语替换**：炉灵→灵智体 / 养灵→育灵 / 魂忆→灵忆 / 魂印→灵印 / 自锻→灵锻 / 锻典→灵典（MindCodex）/ 火种等级→进化阶 / 升华阶→觉醒阶

### T1-T8 测试铁律自检清单

- [ ] **T1**：未使用 MockLLM / fake response / 硬编码返回值（单元测试仅允许 Mock 外部不可控依赖）
- [ ] **T2**：测试输入是真实场景数据（非 "test" / "hello" / 空字符串）
- [ ] **T3**：每个用例有具体断言（非 `status in ("completed","error")` 跳过验证）
- [ ] **T4**：web_search/publish/fact_check 等工具真实调用（不可用时标记 SKIP 而非 Mock 通过）
- [ ] **T5**：发现代码未实现的功能已记录为 Bug 并修复
- [ ] **T6**：E2E 测试使用 MetricsCollector 采集 28 项指标
- [ ] **T7**：LLM 生成内容已经 LLM 审核（评分 ≥ 0.85）
- [ ] **T8**：Web 功能已用 Playwright 操控浏览器验证 DOM + LLM 审核 DOM 内容
