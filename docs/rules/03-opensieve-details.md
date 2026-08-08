# 第三部分：OpenSieve 详解

> **来源**：原 `hiclaw/rules.md` 第三部分
> **关联**：[doc:rules/02-core-architecture-principles.md#2.2]（原则1：所有数据检索走 OpenSieve）

---

## 3.1 定位

OpenSieve 是**超级RAG智能体平台**，是所有数据检索的**统一入口**。

## 3.2 核心能力

| 能力 | 说明 |
|------|------|
| **DataSource协议** | 结构化数据源管理（如Tushare/AkShare/BaoStock股票数据适配器），由SourceLifecycleManager统一管理三源容错 |
| **SearchSource协议** | 非结构化检索（SearXNG/Tavily/DuckDuckGo等20+搜索源） |
| **检索Pipeline** | 10步流程：CacheCheck→QueryUnderstanding→MultiSourceSearch→Deduplication→Ranking→Reranker→CRAGReflection→MMRDiversify→ImageDownload→CacheUpdate |
| **Native Agent** | 5大Agent：SearchAgent/ResearchAgent/MaterialAgent/CrawlAgent/GraphAgent |
| **知识库引擎** | 五种入库 + 三级去重 + 六种召回算法 |
| **四级语义缓存** | L1 Redis Sorted Set → L2 Redis → L3 内存LRU → L4 ES |
| **爬虫框架** | Playwright + 反检测 + 领域爬虫 |
| **多租户架构** | 租户识别、数据隔离、资源配额、配置层级、API Key轮转 |

## 3.3 数据库

Milvus（向量）、Elasticsearch（BM25全文）、Neo4j（知识图谱）、Redis（缓存）、PostgreSQL（关系型）

## 3.4 部署规范

必须使用 `quickstart.sh` 一键启动脚本管理生命周期：

```bash
cd opensieve  # 相对仓库根（勿写死绝对路径）
./quickstart.sh start      # 首次启动
./quickstart.sh restart    # 重启
./quickstart.sh stop       # 停止
./quickstart.sh status     # 状态
./quickstart.sh build      # 重新构建镜像（仅在代码变更时）
```

**严禁**：
- ❌ 直接使用docker命令启停容器
- ❌ 反复重新构建镜像（除非代码变更）
- ❌ 在容器内手动安装依赖

---

> **本文件来源**：原 `hiclaw/rules.md` 第三部分 OpenSieve 详解
