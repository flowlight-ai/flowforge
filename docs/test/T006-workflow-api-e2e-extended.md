# T006: IT-WF-API-05~08 + Workflow 负向测试（report_generation / multilingual / multi_platform / image_article / NEG）

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: E2E 测试（Workflow API 路径）
> **关联 spec.md**: [doc:../spec.md]（FR-CAP-06 #4/#6/#7/#8）
> **关联 arch.md**: [doc:../arch.md]（§6.5 Workflow #4/#6/#7/#8）
> **关联 design.md**: [doc:../design.md]（§9.1）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. IT-WF-API-05：报告生成 Workflow（report_generation）— 含并行步骤

**需求依据**：spec.md FR-CAP-06 #8；arch.md 6.5 Workflow #8

**输入数据**：

```json
{"workflow": "report_generation", "persona": "analyst", "task": "生成一份关于全球气候变化影响的深度研究报告"}
```

**预期执行过程**（8 步 + 并行，基于 Agent 源码）：

| 阶段 | Agent | LLM 次数 | 工具调用 | 并行验证 |
|------|-------|---------|---------|---------|
| 1 topic_research | TopicResearchAgent | **0~1** | adapter/web_search | - |
| 2 parallel: research_1 | MaterialCollectionAgent | **2~4** | adapter + web_search | **与 research_2 并发执行** |
| 2 parallel: research_2 | MaterialCollectionAgent | **2~4** | adapter + web_search | **与 research_1 并发执行** |
| 3 writing | ArticleWritingAgent | **1** | 无 | - |
| 4 seo_optimization | SEOOptimizationAgent | **2** | 无 | - |
| 5 fact_check | FactCheckAgent | **1** | httpx HEAD | - |
| 6 content_audit | ContentAuditAgent | **2** | 无 | ⚠️ 需代码修复前置条件 |
| 7 review | (human pause) | **0** | - | auto_approve 跳过 |
| 8 publish | PublishingAgent | **0** | publish_local | - |

**汇总**：总 LLM 调用 **10~15 次**

**关键模型分配**：

| 阶段 | 执行模型 |
|------|---------|
| 1~5 | `openroute/auto` |
| 6 content_audit | `openroute/doubao-web/chat`（⚠️ 评审模型 ≠ 执行模型，需代码修复前置条件） |
| 7 | — |
| 8 | `openroute/auto` |

**通过条件**：

1. ✅ **并行步骤中 research_1 和 research_2 的实际执行时间有重叠**（验证并行而非串行）
2. ✅ `research_1` 和 `research_2` 的开始时间差 < 2s（确认同时启动）
3. ✅ `max(start1, start2) - min(start1, start2) < 2.0s`（启动时间差<2s）
4. ✅ `min(end1, end2) - max(start1, start2) > 0`（执行时间有重叠）
5. ✅ 并行步骤输出独立互不污染（`materials_1` ≠ `materials_2`）
6. ✅ **content_audit 使用不同于 article_writing 的模型**（⚠️ 需代码修复前置条件）
7. ✅ content_audit 四维评分均为 0-1 浮点数
8. ⚠️ B2: _execute_parallel 存在数据竞争（context_data 同一引用），需代码修复后验证并行输出独立性

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总 LLM 调用次数 | 10~15 | _ | _ |
| 总工具调用次数 | ≥ 4 | _ | _ |
| 并行步骤时间重叠 | > 0s | _ | _ |
| content_audit 模型名 | ≠ openroute/auto (需代码修复) | _ | _ |
| 总耗时 | < 300s | _ | _ |

**失败处理**：

- 若并行步骤实际串行执行：记录为 P0 Bug（WorkflowExecutor 并行逻辑错误）
- 若并行步骤输出互相污染：记录为 P0 Bug（上下文隔离失败）
- 若 content_audit 使用相同模型：记录为 P0 Bug（需代码修复）

**预期输出结构**：
```json
{
  "topics": {"type": "list"},
  "research_1": {"type": "object"},
  "research_2": {"type": "object"},
  "draft": {"type": "str", "min_length": 800},
  "score": {"type": "float"},
  "published": {"type": "dict"}
}
```

---

## 2. IT-WF-API-06：多语言发布 Workflow（multilingual）— 5 步 API 路径

**需求依据**：spec.md FR-CAP-06 #7；arch.md 6.5 Workflow #7

**输入数据**：

```json
{"workflow": "multilingual", "persona": "global_writer", "task": "写一篇介绍中国茶文化的文章并翻译成英文和日文"}
```

**预期执行过程**（基于 Agent 源码）：

| 阶段 | Agent | LLM 次数 | 工具调用 | 验证点 |
|------|-------|---------|---------|--------|
| 1 topic_research | TopicResearchAgent | **0~1** | adapter/web_search | — |
| 2 material_collection | MaterialCollectionAgent | **2~4** | adapter + web_search | — |
| 3 writing | ArticleWritingAgent | **1** | 无 | 中文初稿 |
| 4 translation | MultilingualAgent | **3** (detect+translate+verify) | 无 | **translated 含 en/ja 目标语言版本** |
| 5 publish | PublishingAgent | **0** | publish_local | 多语言版本均发布 |

**汇总**：总 LLM 调用 **6~9 次**

**通过条件**：

1. ✅ translated 输出至少含 2 种目标语言翻译（英文+日文）
2. ✅ 翻译质量不低于机器翻译基准
3. ✅ multilingual Agent 必须使用 plan_execute 模式（YAML 定义）

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总 LLM 调用次数 | 6~9 | _ | _ |
| 总工具调用次数 | ≥ 2 | _ | _ |
| 翻译语言数 | ≥ 2 | _ | _ |
| 总耗时 | < 200s | _ | _ |

**预期输出结构**：
```json
{
  "topics": {"type": "list"},
  "draft": {"type": "str"},
  "translated": {"type": "str", "min_length": "draft×0.8"},
  "audit_score": {"type": "float"},
  "published": {"type": "dict"}
}
```

---

## 3. IT-WF-API-07：多平台分发 Workflow（multi_platform）— 4 步 API 路径

**需求依据**：spec.md FR-CAP-06 #4；arch.md 6.5 Workflow #4

**输入数据**：

```json
{"workflow": "multi_platform", "persona": "social_media", "task": "写一篇关于远程办公效率的文章并适配公众号/头条/知乎三个平台", "platforms": ["wechat", "toutiao", "zhihu"]}
```

**预期执行过程**（基于 Agent 源码）：

| 阶段 | Agent | LLM 次数 | 工具调用 | 特别关注 |
|------|-------|---------|---------|---------|
| 1 topic_research | TopicResearchAgent | **0~1** | adapter/web_search | — |
| 2 writing | ArticleWritingAgent | **1** | 无 | 产出主版本 |
| 3 repurpose | ContentRepurposerAgent | **1 + N_platforms** (analyze + per-platform rewrite) = **4** | 无 | **variants 应含不同平台的改写版本** |
| 4 publish | PublishingAgent | **0** | publish_local | 多平台发布 |

**汇总**：总 LLM 调用 **5~6 次**

**通过条件**：

1. ✅ **content_repurposer 必须调用**（格式转换核心步骤）
2. ✅ variants 数组长度 ≥ 3（对应 3 个以上目标平台）
3. ✅ 各版本风格有差异（公众号偏正式、知乎偏深度、头条偏标题党）
4. ✅ 每个平台版本内容非空

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总 LLM 调用次数 | 5~6 | _ | _ |
| 总工具调用次数 | ≥ 1 | _ | _ |
| 平台变体数 | ≥ 3 | _ | _ |
| 总耗时 | < 150s | _ | _ |

**预期输出结构**：
```json
{
  "draft": {"type": "str"},
  "variants": {"type": "dict", "min_count": 2, "keys": "含 platform 名"},
  "audit_score": {"type": "float"},
  "published": {"type": "dict"}
}
```

---

## 4. IT-WF-API-08：图文并茂 Workflow（image_article）— 5 步 API 路径

**需求依据**：spec.md FR-CAP-06 #6；arch.md 6.5 Workflow #6

**输入数据**：

```json
{"workflow": "image_article", "persona": "visual_writer", "task": "写一篇关于日本樱花季旅行攻略的图文文章"}
```

**预期执行过程**（基于 Agent 源码）：

| 阶段 | Agent | LLM 次数 | 工具调用 | 特别关注 |
|------|-------|---------|---------|---------|
| 1 topic_research | TopicResearchAgent | **0~1** | adapter/web_search | — |
| 2 material_collection | MaterialCollectionAgent | **2~4** | adapter + web_search | — |
| 3 writing | ArticleWritingAgent | **1** | 无 | — |
| 4 image_research | ImageResearchAgent | **1~2** | pexels_image 或 web_search | **images 应包含真实可访问的图片 URL，非占位符** |
| 5 publish | PublishingAgent | **0** | publish_local | 图文混排发布 |

**汇总**：总 LLM 调用 **4~8 次**

**通过条件**：

1. ✅ image_research 必须调用 pexels_image 工具（非 LLM 编造 URL）
2. ✅ images 数组至少含 2 张可用图片
3. ✅ 图片 URL 可通过 HTTP 200 访问
4. ✅ 若含 content_audit 步骤，需使用不同模型（⚠️ 需代码修复前置条件）

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总 LLM 调用次数 | 4~8 | _ | _ |
| 总工具调用次数 | ≥ 3 | _ | _ |
| 图片数量 | ≥ 2 | _ | _ |
| 图片 URL 可访问率 | = 1.0 | _ | _ |
| 总耗时 | < 200s | _ | _ |

**预期输出结构**：
```json
{
  "topics": {"type": "list"},
  "draft": {"type": "str", "min_length": 300},
  "images": {"type": "list", "min_count": 1, "item": {"url": "str", "alt": "str"}},
  "layout": {"type": "str"},
  "published": {"type": "dict"}
}
```

---

## 5. IT-WF-NEG: Workflow 负向/异常路径测试

| 测试 ID | 输入 | 预期行为 | 验证方法 |
|--------|------|---------|---------|
| IT-WF-NEG-01 | 空字符串 `{"task": ""}` | 优雅降级，返回错误提示，不崩溃 | 检查 HTTP 422 或 400 |
| IT-WF-NEG-02 | 超长文本 (100K+ token) | 截断或拒绝，不 OOM | 检查响应正常 |
| IT-WF-NEG-03 | 无效 JSON | 返回 422 | 检查 HTTP 422 |
| IT-WF-NEG-04 | Workflow YAML 不存在 | 明确错误信息 | 检查错误消息 |
| IT-WF-NEG-05 | Agent 未注册 | 跳过步骤+警告 | 检查日志 |
| IT-WF-NEG-06 | 工具未注册 | ToolNotFoundError | 检查异常类型 |
| IT-WF-NEG-07 | LLM 返回非 JSON | JSON 解析降级逻辑 | 检查降级行为 |
| IT-WF-NEG-08 | 并行步骤某 Agent 崩溃 | 其他 Agent 不受影响 | 检查部分结果 |

---

## 6. 引用

- [doc:rules.md#T1-T8] — 测试铁律 T1-T8（详细定义）
- [doc:test/README.md] — 测试子目录索引
- [doc:test/TEMPLATE.md] — 测试用例文件模板
- [doc:test/T005-workflow-api-e2e-core.md] — IT-WF-API-01~04 测试用例
- [doc:../spec.md] — 软件规格说明书
- [doc:../arch.md] — 架构设计文档
- [doc:../design.md] — 详细设计文档
- [doc:design/naming-contract.md] — 命名契约 v2.0

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建（从 test.md 拆分：IT-WF-API-05~08 + Workflow 负向测试共 5 个 E2E 测试用例） | 测试员可进化智能体（蜜獾·平头哥） |
