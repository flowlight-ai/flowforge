# OpenSieve 模板（OS1-OS16）

> **本文件内容**：OpenSieve（聚合检索增强中台）专用提示词模板
> **适用项目**：OpenSieve
> **端口**：8100
> **关键目录**：opensieve/

---

## 8.1 服务启动与基础

### OS1 服务启动与验证

```
帮我启动OpenSieve的API服务（端口8100），不能只看命令退出码是否为0，
必须检查输出内容的质量。任何失败的用例都不能回避，必须找到原因并修复。
```

---

## 8.2 检索能力

### OS2 检索能力优化

```
我们opensieve项目目前检索和素材下载能力已经具备，但是能力很弱，有时还不准。
请参考Scrapling项目，对比我们opensieve项目目前已有框架和能力，
设计一个系统性的优化方案放在opensieve/docs目录下。
优化方案需保证之前对外提供的检索接口和素材下载接口向前兼容。
```

### OS3 优化方案评审

```
我设计了一个系统性的优化方案放在了opensieve/docs/optimization_plan.md中，
请你以AI高级架构师、AI Agent高级工程师、全栈高级软件工程师角度帮我评审此文档，
给出你专业的评审意见，放在opensieve/docs/review_optimization_plan.md中。
```

### OS4 检索管线验证

```
请验证OpenSieve的检索管线7阶段：
1. 查询理解 — 意图识别（事实/导航/研究/视频/图片/开发型）、查询重写、子查询分解、查询路由
2. 多源并行检索 — 网络+向量+ES+图谱
3. RRF融合 — 多源结果融合排序
4. 4阶段排名 — BM25快速过滤→N-gram短语验证→BGE-M3语义排序→Cross-Encoder精排
5. CRAG反思 — CorrectiveRAG 2轮反思
6. MMR多样化 — 结果去重和多样性
7. 结果生成 — 最终输出
每个阶段用真实查询验证，确保检索质量达标。
```

### OS5 搜索源增强验证

```
请验证OpenSieve的20+搜索源：
1. Tier 1源（稳定可用）：B站/GitHub/Wikipedia/Bing API/Google等
2. Tier 2源（实验性）：小红书/抖音/中国知网等
3. 验证搜索源注册机制和动态启用/禁用
4. 验证健康监控和优先级调度
5. 验证SearXNG兜底
6. 验证Tier 2源连续失败3次自动降级到Fallback源
```

---

## 8.3 Agent化与智能检索

### OS6 Agent化改造

```
后续我们OpenSieve需要按Agent智能体方向设计和实现，
目前最核心的查询理解层、Agentic RAG居然都没有实现，你要帮忙实现。
如果需要就调用openroute完成llm调用大模型的能力。
```

### OS7 Agentic RAG验证

```
请验证OpenSieve的Agentic RAG能力：
1. CRAG自纠正 — 2轮反思，验证修正质量（修正查询与原查询embedding相似度>=0.3）
2. Self-RAG — 自我评估检索结果相关性
3. Multi-Hop — 多跳检索，复杂问题分解为多步检索
4. 验证CRAG反思评估增强：多样性检查、Embedding覆盖度、用户反馈接口
```

---

## 8.4 向量检索与图片

### OS8 向量检索与图片搜索

```
OpenSieve当前问题：
1. Milvus向量检索已禁用，检索质量受限 — 请重新启用
2. 图片搜索需要往ES的opensieve_images索引灌数据
3. 图片下载有网络/反爬问题需要解决
4. bge-m3模型需下载到本地缓存并配置启动参数
```

### OS9 图片下载管线验证

```
请验证OpenSieve的图片下载完整管线：
1. 四层发现策略：标准HTML标签/元数据标签/CSS背景图/SVG
2. 下载管线：并发控制+速率限制+重试+反盗链绕过
3. 图片处理：格式转换/缩略图生成/EXIF剥离/感知哈希去重
4. 存储：本地文件系统/MinIO可切换
5. 三级去重：SHA-256精确/pHash感知/dHash结构
6. 完整API：下载/批量下载/元数据/文件/缩略图/删除/列表
```

---

## 8.5 爬虫与知识库

### OS10 爬虫框架验证

```
请验证OpenSieve的爬虫框架：
1. 基于Playwright的浏览器自动化引擎（无头/有头模式）
2. 反检测机制：指纹伪装、UA轮换、代理池
3. 领域爬虫框架：定时爬取、事件驱动、增量爬取
4. 内容提取：自动识别正文区域，输出LLM就绪的Markdown格式
5. 爬虫健康监控：Prometheus采集、Grafana展示、自动降级与恢复
6. 完整的爬虫任务管理API（CRUD + 手动触发）
```

### OS11 知识库引擎验证

```
请验证OpenSieve的知识库引擎：
1. 五种入库方式：定时爬取、检索结果、素材下载、手动导入、RSS/Feed
2. 三级去重：URL去重、SimHash内容去重、近重复合并
3. 六种召回算法：BM25、向量语义、混合检索、LazyGraphRAG、分类过滤、时间衰减
4. 数据生命周期管理：过期标记、质量衰减、脏数据清理、容量控制
5. 自动入库容量预检机制
```

---

## 8.6 语义缓存与评估

### OS12 语义缓存验证

```
请验证OpenSieve的四级语义缓存架构：
1. L1语义缓存(Redis Sorted Set, TTL=1h) — ZRANGEBYSCORE替代SCAN遍历
2. L2精确缓存(Redis, TTL=30min)
3. L3 Embedding缓存(内存LRU)
4. L4 ES索引(持久化)
5. 验证预估命中率30-50%
6. 验证缓存失效和更新机制
```

### OS13 评估体系验证

```
请验证OpenSieve的RAGAS评估体系：
1. Context Precision/Recall/Relevancy
2. Faithfulness
3. Answer Relevancy/Correctness
4. 评估API：评估检索质量、获取评估报告、运行基准测试
5. 用真实查询和真实检索结果验证评估指标
```

---

## 8.7 架构优化与SDK/CLI

### OS14 架构优化与SDK/CLI集成

```
非常好，我们上述爬虫能力都已经重构完成。目前我们迭代到目前，架构有所腐化，再就是检索来源和质量不足，对本地搜索和检索能力支持不够，除了api端点外我们还需要支持sdk或cli本地集成的方案（我们的opensieve需要提供过多接口，甚至直接提供原生native agent（你可以根据我们opensieve的能力提供search agent、智能搜索agent、其他若干与搜索、检索和素材下载的agent等等）给三方集成，比喻flowforge优先使用本地native agent集成方案，你帮忙看下是使用sdk还是cli集成到本地原生native中提升性能）。
除了上述我期望的能力，你需补充到我们架构优化方案外，还需帮我审核我写和收集的几个专家的架构优化的方案。你以AI高级架构师、AI Agent高级工程师、全栈高级软件工程师角度，审核opensieve/docs下的架构优化设计文档arch_optplan.md，给出了专业的评审意见，评审意见放在opensieve的docs目录下的review_arch_optplan.md中。
1、要求先评审arch_optplan.md文档，给出专业评审意见
2、然后把我前边的期望、arch_optplan.md中的所有专家方案的、你自己的想法和思考先合并为一个新的架构设计优化文档（可以增加，但是不能遗漏，需要要完整）。把新的架构设计文档暂时放在arch_tmp.md中，接下来我们专家团队继续进行评审。
3、接着对新的架构设计文档进行评审，最后把1和3的评审结论汇总，放在review_arch_optplan.md中。
```

### OS15 Native Agent集成方案设计

```
请为OpenSieve设计Native Agent集成方案：
1. 基于OpenSieve能力设计以下Native Agent：
   - SearchAgent：智能搜索Agent，支持多源检索+查询理解+结果排序
   - ResearchAgent：深度研究Agent，支持多跳检索+CRAG反思+知识综合
   - MaterialAgent：素材下载Agent，支持图片/文档/视频素材获取
   - CrawlAgent：爬虫Agent，支持定时爬取+增量爬取+内容提取
2. 设计SDK集成方案（Python SDK，供flowforge等上层项目本地调用）
3. 设计CLI集成方案（命令行工具，供脚本和自动化场景使用）
4. 对比SDK vs CLI的性能差异，给出推荐方案
5. 确保与现有API端点向前兼容
6. 设计Agent注册协议，使Native Agent可被FlowForge的AgentRegistry识别
```

### OS16 多租户架构验证

```
请验证OpenSieve的多租户架构：
1. 租户识别：API Key → tenant_id映射
2. 数据隔离：Milvus Collection/ES Index/PG行级tenant_id(RLS)/Redis前缀/Neo4j Label
3. 资源配额：QPS/存储/并发/日调用四维度
4. 配置层级：请求级 > 租户级 > 全局默认
5. API Key轮转机制（grace period）
```
