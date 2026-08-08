# ContentForge 模板（CF1-CF13）

> **本文件内容**：ContentForge（AI 内容创作工厂）专用提示词模板
> **适用项目**：ContentForge
> **端口**：8001/5175
> **关键目录**：contentforge/

---

## 3.1 创作全流程

### CF1 内容创作全流程验证

```
请让AI写一篇文章，验证其是否按工作流调用多个agent（选题→研究→写作→审核→发布），
而不是直接调用article_writing工具一步完成。
输出框节点中应体现完整的workflow阶段和步骤。
```

### CF2 六大专家Agent验证

```
请逐一验证ContentForge的6大专家Agent：
1. 选题Agent — 四级选题策略（缓存复用->自定义触发->OpenSieve深度检索->Tavily+热榜聚合）
2. 研究Agent — 并行多源检索（OpenSieve/Tavily/DuckDuckGo），素材抓取清洗
3. 创作Agent — SOUL/MEMORY风格注入，爆款结构复用，去AI味，平台风格适配
4. SEO Agent — 标题优化三维度方法论，关键词植入，段落结构优化
5. 事实核查Agent — 链接有效性检查，数据交叉验证
6. 发布Agent — 多平台发布（Playwright自动化），内容适配引擎，时间错峰发布
每个Agent用真实数据和真实LLM调用验证。
```

### CF3 SOP编排验证

```
请验证ContentForge的SOP编排：
1. 深度长文SOP（6节点：选题→研究→写作→SEO→事实核查→发布）
2. 验证LangGraph检查点机制，任务中断后可恢复
3. 验证审核节点interrupt_before=["review"] + Command(resume=...)
4. 验证persona锁在审核暂停期间必须保留，审核完成后释放
5. 验证多Agent并行调度（无依赖关系的Agent可并行工作）
```

---

## 3.2 检索与素材

### CF4 选题搜索链路

```
选题研究和搜索素材，调用web_search经常失败。
请检查这个工具内部有没有调用helixrag，可以按这样的顺序：
1. 优先调用helixrag选题和搜索素材
2. 如果失败就调用自己实现的web爬虫选题和搜索素材
3. 如果还是失败就调用web chat模型进行选题和搜索素材
   （web chat模型都可以联网，需要设计提示词引导）
```

### CF5 Agentic RAG知识中枢验证

```
请验证ContentForge的Agentic RAG知识中枢：
1. 混合多源检索：融合外部搜索、Elasticsearch文档、Milvus向量库
2. 知识资产沉淀：审核通过的文章自动存入知识库
3. 多维度排序与去重：RRF融合、时间衰减、SimHash去重
4. 验证检索结果的相关性和质量
5. 验证知识库的增量更新机制
```

---

## 3.3 发布与渠道

### CF6 发布技能测试

```
你把content的发布技能，通过hiclaw/test中的脚本测试通过后，
接下来我们需要把opensieve集成到flowforge中可以正常使用
（集成方法参考content发布技能中的选题、检索、素材下载和图片下载的实现）。
```

### CF7 多平台发布验证

```
请验证ContentForge的多平台发布能力：
1. 今日头条发布 — Playwright自动化，验证文章/微头条/视频发布
2. 微信公众号发布 — 验证富文本/图片/封面发布
3. 验证内容适配引擎：同一文章自动适配不同平台格式要求
4. 验证时间错峰发布：不同平台间隔5-10分钟
5. 验证熔断保护：发布失败3次自动暂停该平台
```

---

## 3.4 模型治理

### CF8 模型治理验证

```
请验证ContentForge的模型治理能力：
1. 多模型供应池：OpenRouter、阿里云百炼、火山引擎、腾讯混元
2. 差异化模型分配：不同Agent/专栏指定不同主力和备用模型
3. 模型健康检查：自动探测可用性、配额、延迟
4. 级联修复：建议模式，不强制覆盖
5. 验证模型故障时自动切换到备用模型
```

---

## 3.5 Web UI

### CF9 Web控制台验证

```
请验证ContentForge的Web控制台功能完整性：
1. 仪表盘：P0关键操作区、P1实时状态区、P2统计报表区
2. 审核中心：Human-in-the-Loop，Tiptap富文本编辑
3. 定时任务管理：可视化创建定时创作计划
4. 专栏与模型配置：SOUL/MEMORY/模型分配/发布渠道编辑
5. 发布日志与审计：历史任务状态、文章链接、错误日志
6. Helm Studio：实时观察创作过程，审核节点内联操作
```

### CF10 Content集成验证

```
验证content是否正确集成contentforge：
1. 三种模式（native_sdk/web_api/独立服务）是否都通过
2. 创作和润色是否为两个独立接口
3. content调用contentforge是否通过SDK而非HTTP
4. 质量分阈值是否为0.85
```

### CF11 选题接口验证（阶段2）

```
验证ContentForge的选题接口（POST /api/v1/content/topic）：
1. 默认提示词选题模式：提供intent，验证返回3个以上高质量选题
2. URL选题模式：提供source_url（如头条账号首页），验证先爬取向量化再选题
3. 选题Loop配置：3评委并行评审（Doubao-Seed2.0/GLM-5.1/Kimi-K2.6），6维度（relevance/attractiveness/angle_uniqueness/feasibility/timeliness/differentiation），阈值0.80
4. T6指标采集：quality_score/iterations/strategy/topics_count必须完整
5. T7 LLM审核：每个选题（title+angle+trend_reason）必须通过LLM审核
6. 性能：单轮迭代<180s，总耗时<420s
7. 幂等性：相同idempotency_key返回相同task_id
8. SSE流式进度：stream=true时能实时收到loop.started/iteration.start/verify.passed等事件
9. v2.1新增：source_filter链路验证 — URL选题模式传source_filter=preselect，验证helixrag_search→OpenSieveClient→/api/v1/retrieve→PreselectService完整链路无断裂
10. v2.1新增：老选题兼容验证 — 默认模式(source_filter=all)走原有RetrievePipeline，结果不变
```

### CF12 URL向量化入库验证

```
验证ContentForge的URL向量化接口（POST /api/v1/content/ingest-url）：
1. 单篇文章：提供文章URL，验证爬取+15维度评估+OpenSieve入库
2. 用户主页：提供头条账号首页URL，验证爬取所有文章+并行评估+批量入库
3. 15维度评估：title_attractiveness/opening_hook/content_depth/structure_clarity/ai_flavor/persona_fit/fact_accuracy/differentiation/timeliness/viral_potential/platform_fit/originality/engagement/compliance
4. 入库结果：articles_found/articles_scraped/articles_ingested/avg_quality_score/top_dimensions
5. 并发限制：爬取并发3，评估并发3（避免反爬）
6. OpenSieve端点从环境变量注入（OPENSIEVE_ENDPOINT），禁止硬编码
7. v2.1修正：提示词外置到opensieve/config/prompts.yaml的preselect.evaluate_15_dims（非contentforge/config/prompts.yaml，消除跨层依赖）
8. v2.1新增：定时预抓取验证 — POST /api/v1/preselect/schedule注册cron任务，验证APScheduler真正注册（非仅存内存dict）
9. v2.1新增：Milvus隔离验证 — 预选题向量写入helixrag_preselect collection（非opensieve_vectors），通过_milvus_collection属性隔离
10. v2.1新增：ContentForge薄包装验证 — url_ingestor.py不自己爬取/向量化，仅调用OpenSieve POST /api/v1/preselect/ingest
```

### CF13 选题→创作全流程验证

```
验证ContentForge的选题→创作全流程：
1. 调用POST /api/v1/content/topic获取选题列表
2. 从选题列表中选择一个选题，调用POST /api/v1/content/create创作文章
3. 验证创作接口能正确接收选题结果（topic_list参数）
4. 验证创作Loop（deep_article_loop）能基于选题生成高质量文章
5. T6+T7+T8全量验证：选题质量分≥0.80，文章质量分≥0.85，发布DOM验证通过
```
