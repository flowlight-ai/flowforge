# FlowForge 测试用例审核报告 (test.md v8.0)

> **审核人**: GLM-5.1 (复审)  
> **审核日期**: 2026-05-24  
> **审核对象**: `flowforge/docs/test.md` v8.0 审核修订版  
> **审核方法**: 逐条对照源码实现 + 6份审核交叉分析 + v7.0→v8.0增量验证  
> **审核结论**: **有条件通过** — v8.0 相比 v7.0 有显著改进（14项修订已落地），但仍存在 3 项致命缺陷、7 项严重缺陷、6 项一般缺陷

---

# 一、总体评价

## 1.1 v7.0 → v8.0 改进评估

v8.0 吸收了6份专家审核意见，实施了14项修订。以下逐项验证落地情况：

| # | 修订项 | 落地状态 | 验证结论 |
|---|--------|:---:|------|
| 1 | 代码修复前置清单(B1-B4) | ✅ | 文档头部新增，4项Bug清晰列出，含修复方案和阻塞测试 |
| 2 | Solo UI按意图类型设计 | ✅ | 第十七章完全重写，9个用例按意图类型设计（Fast-path/搜索/写作/研究/翻译/代码/Plan降级/复杂多步/负面测试） |
| 3 | FactCheckAgent用httpx HEAD | ✅ | 16.1/16.4/16.5已修正为"httpx HEAD×N" |
| 4 | TrendAnalysisAgent web_search必须成功断言 | ✅ | 16.3新增通过条件3-4，web_search失败标记为FAIL |
| 5 | MetricsCollector升级为可执行代码 | ✅ | 第二十八章从"设计文档"升级为完整Python类实现+pytest集成+断言模板 |
| 6 | conftest_e2e.py真实LLM基础设施 | ✅ | 第一章1.4节新增conftest_e2e.py，含real_llm_context fixture |
| 7 | 补全4个模式执行器测试 | ✅ | 新增IT-MODE-06(ReWOO)/07(SelfDiscover)/08(GoT)/09(on_error) |
| 8 | 每个Workflow增加调用路径验证表 | ⚠️ | 仅IT-WF-API-01增加了调用路径验证表，其余7个Workflow未增加 |
| 9 | 每个Workflow增加预期输出JSON结构 | ⚠️ | 仅IT-WF-API-01增加了预期输出结构，其余7个Workflow未增加 |
| 10 | 所有Workflow增加Memory指标验证 | ⚠️ | 仅IT-WF-API-01增加了Memory指标(≥6查询/≥6写入/缓存命中率)，其余7个Workflow部分缺失 |
| 11 | 通用Agent+通用Workflow测试 | ✅ | 新增第二十九章，17个通用Agent单元测试+5个通用Workflow E2E |
| 12 | 模型名无seed-2.0残留+Phase 0-Pre验证 | ✅ | 16.0节新增前置验证步骤，含Hiclaw代理模型列表验证 |
| 13 | 附录B架构问题vs Bug分类 | ✅ | B.1代码Bug(B1-B4)+B.2架构设计问题(A1-A4)+B.3叠加效应+B.4修复追踪 |
| 14 | 并行步骤数据竞争标注 | ✅ | 16.5通过条件7标注B2数据竞争 |

**落地率**: 14项中9项完全落地(64%)，3项部分落地(21%)，2项未落地(14%)

## 1.2 评分对比

| 维度 | v7.0得分 | v8.0得分 | 变化 | 说明 |
|------|:---:|:---:|:---:|------|
| 测试覆盖完整性 | 4 | 6 | ↑2 | Solo UI按意图重写、4个模式专项补全、通用Agent/Workflow新增 |
| 预期过程定义 | 3 | 5 | ↑2 | Solo UI路径预期过程大幅改进；Workflow API路径仅01号用例补全 |
| 验证断言质量 | 3 | 5 | ↑2 | 调用路径验证表、预期输出JSON、MetricsCollector断言模板 |
| 指标体系完备性 | 4 | 6 | ↑2 | MetricsCollector可执行实现、assert_metrics断言函数 |
| 真实数据可行性 | 2 | 4 | ↑2 | conftest_e2e.py新增、FLOWFORGE_REAL_LLM环境变量切换 |
| 架构问题识别 | 6 | 8 | ↑2 | Bug vs 架构分类清晰、叠加效应分析、修复追踪表 |
| 文档结构清晰度 | 7 | 8 | ↑1 | 版本说明更完整、修订清单清晰 |

**综合评分: v7.0 4.1/10 → v8.0 6.0/10 — 有条件通过**

---

# 二、致命缺陷 (P0 — 必须修复)

## 缺陷 P0-1：Workflow API路径16.2~16.8缺少调用路径验证表和预期输出JSON

**位置**: 第十六章 IT-WF-API-02~08 (L820-L1191)

**问题**: 修订项8和9仅对IT-WF-API-01落地，其余7个Workflow用例仍然缺少：
1. **调用路径验证表** — 无法验证Agent内部工具调用顺序
2. **预期输出JSON结构** — 无法验证各阶段输出字段完整性

这是6份审核的共识问题（5/6审核人指出），v8.0仅部分落地。

**影响**: 7个Workflow的测试即使"通过"也无法证明调用路径正确、输出格式完整。

**修复建议**: 为IT-WF-API-02~08每个用例补充：
```
调用路径验证表（同16.1格式）:
| 阶段 | 预期调用路径 | 验证方法 |

预期输出JSON结构（同16.1格式）:
{字段名: {type, min_length/min_count, value_range}}
```

---

## 缺陷 P0-2：Solo UI路径IT-SOLO-02~08缺少完整WebSocket事件序列

**位置**: 第十七章 IT-SOLO-02~08 (L1230-L1432)

**问题**: IT-SOLO-01有完整的5行WebSocket事件序列，但IT-SOLO-02~08仅IT-SOLO-02列出了部分事件序列，其余用例完全没有。

**影响**: 无法验证Solo UI路径的事件完整性，无法检测事件丢包和序号跳号。

**修复建议**: 每个Solo UI用例必须列出完整的预期WebSocket事件序列，至少包含：
1. `solo.stage.enter/exit` 事件（每个阶段）
2. `solo.tool.start/end` 事件（每个工具调用）
3. `solo.llm.start/end` 事件（每个LLM调用）
4. `solo.draft.update` 事件
5. `solo.task.completed` 事件

---

## 缺陷 P0-3：附录A报告模板未同步v8.0修订

**位置**: 附录A (L2541-L2639)

**问题**: 报告模板仍为v7.0版本，存在以下问题：
1. **Solo UI路径结果表仍按Workflow名称**（deep_article/quick_post/...），但v8.0已改为按意图类型设计
2. **缺少MetricsCollector指标报告** — 第二十八章定义了完整的28项指标JSON模板，但附录A报告模板没有集成
3. **缺少调用路径验证结果** — 新增的调用路径验证表没有对应的报告列
4. **缺少Bug修复追踪** — 附录B.4定义了修复追踪表，但报告模板没有
5. **版本号仍为v7.0** (L2544)

**修复建议**: 同步更新报告模板：
1. Solo UI结果表改为按意图类型
2. 增加"指标报告(JSON)"章节
3. 增加"调用路径验证"章节
4. 增加"Bug修复追踪"章节
5. 版本号更新为v8.0

---

# 三、严重缺陷 (P1 — 影响测试有效性)

## 缺陷 P1-1：前端E2E测试仍仅4个场景，关键验证缺失

**位置**: 第十九章 (L1684-L1833)

**问题**: 虽然v8.0在其他方面有改进，但前端E2E测试场景数未增加，仍为4个。缺失：
1. **SoloEditor编辑/预览/分屏切换** — 前端核心组件未测试
2. **虚拟滚动500+事件** — spec.md FR-SOL-02要求
3. **审核通过+编辑提交** — E2E-SOLO-04仅测试驳回
4. **Citation链接点击跳转** — 来源面板核心交互
5. **流式chunk逐字渲染** — solo.llm.stream事件渲染
6. **暂停/恢复/跳过节点操作** — 任务控制核心功能
7. **从Web前端创建Workflow API任务** — 非Solo模式的完整用户旅程

**修复建议**: 至少增加4个E2E场景（总计8个）：
- E2E-SOLO-05: SoloEditor三种模式切换
- E2E-SOLO-06: 审核通过+编辑提交
- E2E-SOLO-07: 暂停/恢复/跳过节点
- E2E-SOLO-08: Workflow API任务创建→完成全流程

---

## 缺陷 P1-2：Harness Layer零测试覆盖

**位置**: 全文

**问题**: v6.0核心特性Harness Layer（`flowforge/harness/`目录已实现）在test.md中零测试覆盖：
- `context_engine.py` — 上下文工程（AGENTS.md注入）
- `constraints/arch_constraint_engine.py` — 架构约束引擎
- `feedback_loop.py` — 反馈循环（全局护栏）
- `entropy_manager.py` — 熵管理器
- `permission_pipeline.py` — 权限管线
- `session_manager.py` — 会话管理器
- `orchestrator.py` — Harness编排器

**源码验证**: `flowforge/harness/`目录下7个文件均已实现，且`hybrid_executor.py`中已有`harness.pre_execute/post_execute`钩子调用。

**修复建议**: 至少增加以下测试：
1. UT-HARNESS-01: HarnessOrchestrator pre_execute/post_execute钩子调用
2. UT-HARNESS-02: FeedbackLoop evaluation_mode三档(full/lightweight/skip)
3. UT-HARNESS-03: PermissionPipeline deny→ask→allow三层
4. UT-HARNESS-04: SessionManager 92%压缩阈值触发
5. IT-HARNESS-01: Harness集成到Workflow执行流程

---

## 缺陷 P1-3：Skill系统零测试覆盖

**位置**: 全文

**问题**: v6.0新增的Skill系统（`flowforge/skills/`目录已实现）零测试覆盖：
- `registry.py` — Skill注册中心
- `adapter.py` — 4种格式适配
- `combo.py` — Combo Skills管道编排

**源码验证**: `flowforge/skills/`目录下3个文件均已实现。

**修复建议**: 至少增加Skill注册和匹配的单元测试。

---

## 缺陷 P1-4：第三十章测试执行顺序未同步v8.0修订

**位置**: 第三十章 (L2403-L2477)

**问题**: Phase 4仍列出"IT-SOLO-01~08: deep_article/quick_post/... Solo"，但v8.0第十七章已改为按意图类型设计（Fast-path/搜索/写作/研究/翻译/代码/Plan降级/复杂多步/负面测试）。

**修复建议**: Phase 4更新为：
```
Phase 4: Solo UI 路径 E2E
  ├── IT-SOLO-01: 简单问候(Fast-path)
  ├── IT-SOLO-02: 写作意图(Planning)
  ├── IT-SOLO-03: 搜索意图(Planning)
  ├── IT-SOLO-04: 研究意图(Planning)
  ├── IT-SOLO-05: 翻译意图(Fast-path/Planning)
  ├── IT-SOLO-06: 代码意图(Planning)
  ├── IT-SOLO-07: Plan降级场景
  ├── IT-SOLO-08: 复杂多步意图
  └── IT-SOLO-09: Fast-path负面测试
```

同时Phase 5应增加IT-MODE-06~09。

---

## 缺陷 P1-5：IT-SOLO-05翻译意图的Fast-path判断可能有误

**位置**: 第十七章 17.5 (L1338-L1350)

**问题**: 用户输入A `"请把'人工智能正在改变世界'翻译成英文"` 被标注为"可能走Fast-path"，但源码中`_is_simple_message()`的正则匹配模式是问候语/感谢等，**翻译请求不会匹配Fast-path**。同时`_COMPLEX_PATTERNS`中也不包含翻译关键词，所以翻译意图会走Planning路径，但Planner可能只规划1步（generate类型），而非tool/agent类型。

**源码验证**: `_is_simple_message()`匹配模式为`^(你好|hi|hello|...)$`，翻译请求不匹配。

**修复建议**: 
1. 简单翻译不应标注"可能走Fast-path"，应明确走Planning路径
2. 增加验证：Planning输出的plan步骤数和类型

---

## 缺陷 P1-6：conftest_e2e.py中MetricsCollector订阅方式与EventBus实现不匹配

**位置**: 第一章1.4 + 第二十八章 (L172-L221, L2122-L2320)

**问题**: `TestMetricsCollector.__init__()`中使用`event_bus.subscribe(f"{task_id}.*", ...)`订阅事件，但源码`EventBus`的实现是`subscribe(event_type, callback)`，不支持`task_id.*`通配符模式（仅支持`*`全局通配符）。

**源码验证**: `events/event_bus.py`的subscribe方法签名是`subscribe(event_type: str, callback)`, emit是`emit(task_id, event_type, payload)`，回调收到的参数是`{type, payload, task_id, timestamp}`。不支持`task_id.*`格式的订阅。

**修复建议**: 修改MetricsCollector的订阅方式：
```python
# 方案1: 订阅全局通配符，在回调中过滤task_id
event_bus.subscribe("*", self._on_event)

def _on_event(self, data):
    if data.get("task_id") != self.task_id:
        return
    # ... 处理事件
```

---

## 缺陷 P1-7：LLM调用次数预期仍与源码存在偏差

**位置**: 第十六章 IT-WF-API-01 (L744)

**问题**: IT-WF-API-01预期"总LLM调用8~11次"，但源码分析：
- TopicResearchAgent: 4步降级链(cache→opensieve→web_search→llm)，每步都可能触发LLM回退，实际0~2次
- MaterialCollectionAgent: cache_check + web_search + llm_summarize，实际2~4次
- ArticleWritingAgent: 1次LLM generate
- SEOOptimizationAgent: planning + optimize = 2次
- FactCheckAgent: url_check(httpx HEAD) + fact_verify(LLM) = 1次
- ContentAuditAgent: assess + compliance = 2次
- PublishingAgent: 0次LLM

**实际范围**: 6~12次（比8~11更宽），下限偏低。

**修复建议**: 将LLM调用次数预期改为条件区间，标注每个条件分支：
```
| 条件 | LLM次数 |
|------|--------|
| 全部工具命中缓存 | 6 (仅writing+seo+audit) |
| OpenSieve可用 | 8~10 |
| OpenSieve不可用，web_search降级 | 8~12 |
```

---

# 四、一般缺陷 (P2 — 影响测试质量)

## 缺陷 P2-1：MetricsCollector中Memory指标为硬编码占位值

**位置**: 第二十八章 (L2291-L2296)

**问题**: `generate_report()`中Memory维度的compactions和cache_hit_rate硬编码为0：
```python
"memory": {
    "compactions": 0,  # 需要从context.warning事件采集
    "cache_hit_rate": 0,  # 需要从cache工具结果采集
},
```

**修复建议**: 实现从EventBus事件采集：
- compactions: 订阅`context.warning`事件计数
- cache_hit_rate: 从`tool.end`事件中cache工具的`cached=True`比例计算

---

## 缺陷 P2-2：MetricsCollector中WebSocket序号连续性检测未实现

**位置**: 第二十八章 (L2302)

**问题**: `sequence_gaps`硬编码为0，未实现序号连续性检测。

**修复建议**: 从Solo事件中提取序号，检测差值>1的间隙。

---

## 缺陷 P2-3：MetricsCollector中Frontend指标为占位值

**位置**: 第二十八章 (L2306-L2312)

**问题**: `timeline_nodes`和`citation_links`硬编码为0，需要从Playwright采集但未实现集成。

**修复建议**: 在Playwright测试中增加DOM计数逻辑，将结果注入MetricsCollector。

---

## 缺陷 P2-4：需求追溯矩阵未同步v8.0新增用例

**位置**: 第三十一章 (L2481-L2533)

**问题**: 需求追溯矩阵缺少以下v8.0新增用例：
- IT-SOLO-01~09（按意图类型，非Workflow名称）
- IT-MODE-06~09（ReWOO/SelfDiscover/GoT/on_error）
- UT-GA-01~17（通用Agent）
- IT-GEN-WF-01~05（通用Workflow）

---

## 缺陷 P2-5：并发测试缺少真实并发验证

**位置**: 第二十一章 IT-CONC-01 (L1888-L1897)

**问题**: 10个并发任务仅验证"全部成功"，没有验证：
1. 任务间state是否真的隔离
2. Persona锁的获取/释放时序
3. 并发下EventBus事件是否串扰

---

## 缺陷 P2-6：Circuit Breaker测试缺少恢复验证

**位置**: 第二十一章 IT-CB-01 (L1910-L1919)

**问题**: 仅验证熔断触发，没有验证：
1. 熔断恢复时间（半开状态）
2. 熔断期间其他工具是否正常
3. 熔断恢复后工具调用是否恢复

---

# 五、v8.0新增内容的质量评估

## 5.1 第十七章 Solo UI路径（按意图类型设计）— 优秀

v8.0最大的改进是将Solo UI测试从"按Workflow名称"改为"按意图类型"，这是6份审核中Qwen提出的颠覆性发现。具体评价：

| 用例 | 意图类型 | 预期过程 | Planner输出 | 事件序列 | 评分 |
|------|---------|---------|------------|---------|:---:|
| IT-SOLO-01 | 简单问候 | ✅ Fast-path | N/A | ✅ 5行 | 9/10 |
| IT-SOLO-02 | 写作 | ✅ Planning | ✅ JSON | ✅ 完整 | 9/10 |
| IT-SOLO-03 | 搜索 | ✅ Planning | ✅ JSON | ❌ 缺失 | 6/10 |
| IT-SOLO-04 | 研究 | ✅ Planning | ✅ JSON | ❌ 缺失 | 6/10 |
| IT-SOLO-05 | 翻译 | ⚠️ Fast-path判断有误 | ❌ 无 | ❌ 缺失 | 4/10 |
| IT-SOLO-06 | 代码 | ✅ Planning | ✅ JSON | ❌ 缺失 | 6/10 |
| IT-SOLO-07 | Plan降级 | ✅ 降级场景 | N/A | ❌ 缺失 | 5/10 |
| IT-SOLO-08 | 复杂多步 | ✅ Planning | ✅ JSON | ❌ 缺失 | 6/10 |
| IT-SOLO-09 | 负面测试 | ✅ Fast-path否定 | N/A | ❌ 缺失 | 5/10 |

**核心问题**: IT-SOLO-02有完整WebSocket事件序列，但IT-SOLO-03~09全部缺失。

## 5.2 第二十八章 MetricsCollector — 良好

从"设计文档"升级为"可执行代码"是重大改进。具体评价：

| 方面 | 评价 | 说明 |
|------|:---:|------|
| EventBus订阅 | ⚠️ | task_id.*通配符不匹配EventBus实现 |
| LLM维度采集 | ✅ | 6项指标完整 |
| Tool维度采集 | ✅ | 5项指标完整 |
| Agent维度采集 | ✅ | 5项指标完整 |
| Workflow维度采集 | ✅ | 4项指标完整 |
| Memory维度采集 | ⚠️ | 2项占位值 |
| WebSocket维度采集 | ⚠️ | 1项占位值 |
| Frontend维度采集 | ⚠️ | 2项占位值 |
| assert_metrics | ✅ | 断言模板实用 |
| pytest集成 | ✅ | conftest_e2e.py集成 |

## 5.3 第二十九章 通用Agent/Workflow — 合格

新增17个通用Agent单元测试和5个通用Workflow E2E测试，覆盖了之前零覆盖的领域。但：
1. 通用Agent测试仅验证"输出非空"，缺少具体断言
2. 通用Workflow测试缺少预期步骤数和LLM调用次数

## 5.4 附录B Bug vs 架构分类 — 优秀

B.1代码Bug(B1-B4) + B.2架构设计问题(A1-A4) + B.3叠加效应分析 + B.4修复追踪表，结构清晰、逻辑完整。这是v8.0最扎实的改进之一。

---

# 六、与6份审核的交叉验证

## 6.1 v8.0已解决的审核共识问题

| 共识问题 | 指出者 | v8.0解决状态 |
|---------|--------|:---:|
| 全量Mock LLM | 全部6人 | ✅ conftest_e2e.py新增 |
| Workflow mode字段不生效 | 全部6人 | ✅ B3标注+附录B分类 |
| ContentAuditAgent不支持独立模型 | 全部6人 | ✅ B1标注+修复追踪 |
| Solo UI测试缺失 | 全部6人 | ✅ 第十七章完全重写 |
| 测试指标未实现 | 5/6人 | ✅ MetricsCollector可执行实现 |
| LLM调用次数与源码不一致 | 5/6人 | ⚠️ 部分修正，仍有偏差 |
| doubao-web/seed-2.0需更新 | 5/6人 | ✅ 16.0前置验证 |
| 调用路径验证缺失 | 5/6人 | ⚠️ 仅01号用例补全 |
| 测试文档不可执行 | 全部6人 | ✅ MetricsCollector+conftest_e2e.py |

## 6.2 v8.0未解决的审核共识问题

| 共识问题 | 指出者 | v8.0状态 | 本报告缺陷编号 |
|---------|--------|:---:|------|
| 调用路径验证仅部分落地 | 5/6人 | 部分 | P0-1 |
| Solo UI事件序列缺失 | GLM/Kimi/M27 | 未解决 | P0-2 |
| 前端E2E场景不足 | 全部6人 | 未解决 | P1-1 |
| Harness Layer零覆盖 | GLM | 未解决 | P1-2 |
| Skill系统零覆盖 | GLM | 未解决 | P1-3 |

## 6.3 各审核独特发现的处理状态

| 独特发现 | 审核人 | v8.0状态 | 本报告评估 |
|---------|--------|:---:|------|
| Solo UI `_infer_steps_from_intent`与YAML不匹配 | Qwen | ✅ 第十七章按意图重写 | 已解决 |
| parallel_group数据竞争 | Qwen/豆包 | ✅ B2标注+16.5条件7 | 已解决 |
| FactCheckAgent用httpx HEAD | Qwen/豆包 | ✅ 已修正 | 已解决 |
| TrendAnalysisAgent web_search失败降级 | Qwen | ✅ 16.3条件3-4 | 已解决 |
| 14个通用Agent零覆盖 | GLM | ✅ 第二十九章 | 已解决 |
| 5个通用Workflow零覆盖 | GLM | ✅ 第二十九章 | 已解决 |
| ReWOO/SelfDiscover/GoT零覆盖 | GLM | ✅ IT-MODE-06~08 | 已解决 |
| DI容器是全局单例 | GLM | ✅ A4标注 | 已记录 |
| 28项指标仅2项记录 | GLM | ⚠️ MetricsCollector实现但Memory/Frontend占位 | P2-1~3 |
| 翻译意图Fast-path判断 | GLM(本次) | ❌ 未解决 | P1-5 |
| EventBus订阅方式不匹配 | GLM(本次) | ❌ 未解决 | P1-6 |

---

# 七、测试用例统计

## 7.1 用例数量统计

| 类别 | v7.0 | v8.0 | 增量 |
|------|:---:|:---:|:---:|
| 单元测试(UT) | 70+ | 87+ | +17(通用Agent) |
| API集成测试(IT-API) | 27 | 27 | 0 |
| Workflow API E2E | 8 | 8 | 0 |
| Solo UI E2E | 8 | 9 | +1(负面测试) |
| 模式执行器专项 | 5 | 9 | +4(ReWOO/SelfDiscover/GoT/on_error) |
| 前端E2E | 4 | 4 | 0 |
| 通用Workflow E2E | 0 | 5 | +5 |
| 并发+熔断 | 4 | 4 | 0 |
| 跨Workflow | 2 | 2 | 0 |
| 通道测试 | 5 | 5 | 0 |
| **总计** | **133+** | **160+** | **+27** |

## 7.2 覆盖率评估

| 模块 | 覆盖状态 | 缺口 |
|------|:---:|------|
| 8个业务Workflow(API路径) | ✅ | 调用路径/输出JSON仅01号补全 |
| Solo UI(9种意图) | ✅ | 事件序列仅02号完整 |
| 9大模式执行器 | ✅ | — |
| 14个通用Agent | ✅ | 断言过于宽松 |
| 5个通用Workflow | ✅ | 缺少预期步骤数 |
| Harness Layer | ❌ | 零覆盖 |
| Skill系统 | ❌ | 零覆盖 |
| FeedbackLoop外环 | ❌ | 零覆盖 |
| 前端组件 | ⚠️ | 仅4个E2E场景 |

---

# 八、修复优先级建议

## 8.1 必须修复（阻塞测试执行）

| 优先级 | 缺陷 | 工作量 | 说明 |
|--------|------|--------|------|
| P0 | P0-1: 补全16.2~16.8调用路径+输出JSON | 中 | 7个Workflow用例各需1个表格 |
| P0 | P0-2: 补全IT-SOLO-03~09事件序列 | 中 | 7个用例各需5~15行事件序列 |
| P0 | P0-3: 同步附录A报告模板 | 小 | 更新Solo结果表+增加指标章节 |
| P1 | P1-6: 修复MetricsCollector EventBus订阅 | 小 | 改为全局通配符+task_id过滤 |

## 8.2 建议修复（提升测试质量）

| 优先级 | 缺陷 | 工作量 |
|--------|------|--------|
| P1 | P1-1: 增加前端E2E至8个场景 | 中 |
| P1 | P1-2: 增加Harness Layer测试 | 大 |
| P1 | P1-3: 增加Skill系统测试 | 中 |
| P1 | P1-4: 同步第三十章执行顺序 | 小 |
| P1 | P1-5: 修正IT-SOLO-05 Fast-path判断 | 小 |
| P1 | P1-7: 修正LLM调用次数预期 | 小 |
| P2 | P2-1~3: 实现MetricsCollector占位指标 | 中 |
| P2 | P2-4: 同步需求追溯矩阵 | 小 |
| P2 | P2-5~6: 增加并发/熔断验证 | 小 |

---

# 九、结论

## 9.1 审核结论: 有条件通过

v8.0 相比 v7.0 有显著改进，特别是：
1. **Solo UI路径按意图类型重写** — 解决了最根本的设计缺陷
2. **MetricsCollector可执行实现** — 从设计文档升级为可运行代码
3. **代码修复前置清单** — 明确了测试前必须修复的4项Bug
4. **Bug vs 架构分类** — 清晰区分了代码问题和设计问题
5. **通用Agent/Workflow覆盖** — 填补了之前的零覆盖缺口

但仍有3项致命缺陷需要修复：
1. 7个Workflow用例缺少调用路径验证和预期输出
2. 7个Solo UI用例缺少WebSocket事件序列
3. 报告模板未同步v8.0修订

## 9.2 建议的下一步行动

1. **修复3项P0缺陷** — 预计1天工作量
2. **修复P1-6 EventBus订阅** — 预计1小时
3. **执行代码修复前置清单(B1-B4)** — 这是测试能否真正运行的前提
4. **执行Phase 0-Pre模型验证** — 确认OpenRoute和Hiclaw代理可用
5. **执行真实LLM端到端测试** — 从Solo对话框发起，记录完整指标
6. **生成完整测试报告** — 包含28项指标+调用路径+事件序列+Bug修复追踪

---

> **本报告基于对 `flowforge/docs/test.md` v8.0 与源码的逐条对照审查，并交叉验证了6份已有审核报告的发现。**  
> **v8.0相比v7.0评分从4.1提升至6.0，主要得益于Solo UI路径重写和MetricsCollector可执行实现。**  
> **修复3项P0缺陷后，测试文档可达到可执行标准。**
