# T001: 测试铁律 T1-T8 + 执行方式

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 通用（所有测试类别必须遵守）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. 测试铁律（违反即作废）

> **以下规则是本项目测试的绝对底线，任何测试用例违反以下任何一条，该测试用例视为无效，必须重写。**
> **无论任何人（包括 AI 助手）编写测试代码，都必须严格遵守以下铁律，不得以任何理由违反。**

| # | 铁律 | 说明 | 违反后果 |
|---|------|------|---------|
| **T1** | **禁止使用 Mock LLM** | 所有 E2E 测试、集成测试必须调用真实 LLM（OpenRoute 代理），不得使用 MockLLM、fake response、硬编码返回值。单元测试仅允许 Mock 外部不可控依赖（如第三方 API 的异常场景） | 测试结果视为无效，必须重写 |
| **T2** | **禁止使用假数据** | 所有测试输入必须是真实场景数据（真实话题、真实关键词、真实搜索查询），不得使用"test"、"hello world"、空字符串等无意义输入 | 测试结果视为无效，必须重写 |
| **T3** | **禁止跳过验证** | 每个测试用例必须有具体的断言（assert），不得只有 `status in ("completed", "error")` 这种"怎么都通过"的断言。必须验证：输出内容长度、关键字段存在、工具调用链、LLM 调用次数 | 测试用例视为无效，必须重写 |
| **T4** | **禁止 Mock 工具调用** | web_search、publish、fact_check 等工具必须真实调用，不得 Mock。如果工具不可用，测试标记为 SKIP 而非用 Mock 通过 | 测试结果视为无效，必须重写 |
| **T5** | **未实现即 Bug** | 测试中发现代码未实现、功能缺失、与需求规格不符，必须记录为 Bug 并修复，不得标记为"通过"或"跳过" | 视为隐瞒 Bug |
| **T6** | **必须采集指标** | 每个 E2E 测试必须使用 MetricsCollector 采集 LLM 调用次数、工具调用链、Agent 调用链、Workflow 步骤、Memory 操作等指标，并写入报告 | 测试报告视为不完整 |
| **T7** | **LLM 内容必须经 LLM 审核** | 凡 LLM 生成的内容（代码/文章/评论/文案/小说等），必须再调用 LLM 审核通过后才算验证通过 | 验证视为无效 |
| **T8** | **Web 功能必须操控浏览器验证 DOM** | 凡涉及网页操作的功能（发布/上架/部署等），必须操控浏览器查看 DOM 确认真实成功，且对 DOM 内容调用 LLM 审核质量 | 验证视为无效 |

---

## 2. 执行方式

```bash
# 必须设置此环境变量才运行真实测试
FLOWFORGE_REAL_LLM=1 pytest tests/e2e/ -v

# 仅运行单元测试（允许 Mock LLM）
pytest tests/unit/ -v

# 运行集成测试
FLOWFORGE_REAL_LLM=1 pytest tests/integration/ -v

# 运行 E2E 测试（含 Playwright 浏览器自动化）
FLOWFORGE_REAL_LLM=1 pytest tests/e2e/ -v --browser=chromium
```

---

## 3. 测试铁律自检清单

每个测试用例提交前必须完成以下自检：

- [ ] **T1**：未使用 MockLLM / fake response / 硬编码返回值（单元测试仅允许 Mock 外部不可控依赖）
- [ ] **T2**：测试输入是真实场景数据（非 "test" / "hello" / 空字符串）
- [ ] **T3**：每个用例有具体断言（非 `status in ("completed","error")` 跳过验证）
- [ ] **T4**：web_search/publish/fact_check 等工具真实调用（不可用时标记 SKIP 而非 Mock 通过）
- [ ] **T5**：发现代码未实现的功能已记录为 Bug 并修复
- [ ] **T6**：E2E 测试使用 MetricsCollector 采集 28 项指标（详见 [doc:test/T015-metrics-collector.md]）
- [ ] **T7**：LLM 生成内容已经 LLM 审核（评分 ≥ 0.85）
- [ ] **T8**：Web 功能已用 Playwright 操控浏览器验证 DOM + LLM 审核 DOM 内容

---

## 4. Mock 使用边界（T1/T4 细化）

### 4.1 允许 Mock 的场景

| 场景 | 说明 |
|------|------|
| BaseAgent.execute 接口验证 | 单元测试可 Mock 接口实现 |
| TaskContext 深拷贝测试 | 单元测试可 Mock 上下文 |
| EventBus 回调调度测试 | 单元测试可 Mock 回调 |
| DI 容器解析测试 | 单元测试可 Mock 依赖 |
| 数据库 CRUD 测试 | 单元测试可 Mock Repository |
| 沙箱安全规则测试 | 单元测试可 Mock 代码执行环境 |
| 第三方 API 异常场景 | 单元测试可 Mock 第三方 API 异常响应（如 429/503） |

### 4.2 禁止 Mock 的场景

| 场景 | 说明 |
|------|------|
| Workflow 端到端验证 | 必须真实执行所有 Workflow 步骤 |
| Agent 执行链路验证 | 必须真实调用 Agent.execute_with_context |
| Tool 调用链验证 | 必须真实调用 web_search/publish/fact_check 等工具 |
| LLM 输出格式验证 | 必须真实调用 LLM 验证输出格式 |
| 前端 Helm WebSocket E2E | 必须真实启动前端 + WebSocket |
| 多模型通道测试 | 必须真实调用各通道模型 |

---

## 5. 引用

- [doc:rules.md#T1-T8] — 测试铁律 T1-T8（详细定义）
- [doc:test/README.md] — 测试子目录索引
- [doc:test/TEMPLATE.md] — 测试用例文件模板
- [doc:test/T015-metrics-collector.md] — MetricsCollector 28 项指标采集实现
- [doc:design/naming-contract.md] — 命名契约 v2.0
- [doc:../../CONTRIBUTING.md#32-t1-t8-测试铁律] — 测试铁律自检（T1-T8）

---

## 6. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建（从 test.md 拆分：测试铁律 T1-T8 + 执行方式 + 自检清单 + Mock 边界） | 测试员可进化智能体（蜜獾·平头哥） |
