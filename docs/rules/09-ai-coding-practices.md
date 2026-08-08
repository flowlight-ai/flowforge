# 第九部分：AI 编程优秀实践与踩坑总结（阶段1+选题迁移经验）

> **来源**：原 `hiclaw/rules.md` 第九部分
> **关联**：[doc:rules/05-dev-spec.md]（开发规范） | [doc:rules/test-iron-rules.md]（测试铁律）
> **说明**：本部分总结 ContentForge 阶段1（创作+润色接口替换）和阶段2（选题接口迁移+URL向量化）中遇到的关键坑和经验，防止后续新功能重复踩坑。

---

## 9.1 ContentForge 阶段1：创作+润色接口替换的18个坑

阶段1替换工作历时近一个月、数百次迭代，主要坑集中在5类：

### 9.1.1 JSON 包装泄漏（最严重的格式问题）

**现象**：发布到头条的文章内容包含 `{"draft": "..."}` JSON 包装，丢失 markdown 格式。

**根因**：Loop 结果提取器（result_extractor）未剥离 ToolOutput result dict 序列化后的 JSON 包装，导致评委和发布工具收到 JSON 字符串而非纯 markdown。

**修复**：在3处添加 `_strip_json_wrapper()` 逻辑：
- `flowforge/loop/result_extractor.py`
- `contentforge/app/api/endpoints/content.py`（`_strip_json_wrapper_content` + `_deep_extract_content_fallback`）
- `flowforge/loop/executor.py`

**经验**：凡是从 Loop 结果提取内容的代码路径，必须在最终输出前检查 `content.strip().startswith("{")` 并剥离 JSON 包装。

### 9.1.2 LLM 静默失败（最隐蔽的稳定性问题）

**现象**：OpenRoute 返回 HTTP 200 + 伪装的 `chat.completion`，但内容是 `"模型 X 当前不可用，请稍后重试"`，导致 LLMClient 误判为成功，不触发模型回退。

**根因**：`classify_error` 只检查 HTTP 状态码和显式 error 字段，未检查响应内容中的伪装失败文案。

**修复**：
- `INVALID_RESPONSE_PATTERNS` 加入 `"当前不可用，请稍后重试"` 和 `"当前不可用,请稍后重试"`
- `_normal_call` 和 `_stream_call` 显式检查静默失败内容，抛出 `RuntimeError("model disabled")` 触发回退
- `classify_error` 识别 `"model disabled"`、`"all_backends_failed"`、`"无权访问"` 为永久错误（model_not_found），立即切换而非重试

**经验**：LLM 网关可能返回 HTTP 200 + 伪装失败体，必须检查响应内容模式，不能只看状态码。

### 9.1.3 URL 路径处理陷阱

**现象**：OpenRoute 健康检查探测 URL 错误地变成 `http://localhost:1300/v1`（端口从 13001 变成 1300）。

**根因**：使用 `.rstrip("/v1")` 处理 URL 后缀，但 `rstrip` 是字符集删除而非字符串删除，把端口号 `13001` 末尾的 `1` 也剥掉了。

**修复**：改用 `.removesuffix("/v1")`（Python 3.9+），只删除完整后缀。

**经验**：永远不要用 `rstrip` 删除字符串后缀，必须用 `removesuffix` 或正则。

### 9.1.4 条件路由正则陷阱

**现象**：`publish_agent` 错误调用，因为 Workflow YAML 中的 `${{state.xxx}}` 双花括号变量无法解析。

**根因**：`workflow_executor.py` 的 `_evaluate_condition` 正则 `^\$\{(\w+)(?::([^}]*))?\}$` 只匹配单花括号 `${...}`，不匹配双花括号 `${{...}}`。

**修复**：改为 `^\$\{{1,2}(\w+)(?::([^}]*))?\}{1,2}$`，支持单/双花括号。

**经验**：变量引用语法必须统一（`${{state.xxx}}` 双花括号），正则必须覆盖所有合法语法。

### 9.1.5 模型分配并发瓶颈

**现象**：StockForge 所有 assignments 的 primary 都是 proxy，与 ContentForge 共用同一平台造成同平台内部串行等待。

**修复**：改为不同平台（data_analysis/prediction/risk_assessment/report_generation/bull_bear_debate 分别对应 Kimi-K2.6/Qwen3.6-Plus/Kimi-K2.6/Kimi-K2.6/Qwen3.6-Plus）。

**经验**：模型分配的 primary 必须跨厂商分布，避免单一平台并发瓶颈。评委候选链排序时，评委指定模型排在首位。

### 9.1.6 SSE 流式进度推送

**现象**：SSE 客户端收不到 Loop 执行进度事件。

**根因**：`TaskContext` 未显式注入 `event_bus`，导致 `task.event_bus` 为 None，Loop 发射的事件无法被 `_subscribe_loop_progress` 订阅。

**修复**：构造 TaskContext 时显式注入 `event_bus=getattr(_sdk, '_event_bus', None) or getattr(_sdk, 'events', None)`。

**经验**：LoopExecutor 发射的进度事件依赖 TaskContext.event_bus，必须显式注入。

### 9.1.7 浏览器自动化陷阱（T8测试）

**现象**：T8 测试频繁超时，浏览器实例失效后 `is_connected()` 误报 True。

**根因**：
1. Next.js 开发服务器的 HMR/websocket 网络活动导致 `networkidle` 等待条件永远无法满足
2. 浏览器实例失效后 `is_connected()` 可能误报 True

**修复**：
- 浏览器等待条件用 `wait_until="domcontentloaded"` 而非 `networkidle`
- 浏览器实例失效后必须重建，包括 `is_connected()` 检测和 `new_page()` 失败重试逻辑
- 默认超时从 30s 提升到 60s
- Windows 下 openroute browser 必须用 `headless=False`（可见模式）

**经验**：SPA 站点（Next.js 等）的浏览器自动化不要用 `networkidle`，用 `domcontentloaded`。

### 9.1.8 其他坑汇总

| 坑 | 修复 |
|----|------|
| `_normal_call` 访问 `data["choices"]` 抛 KeyError | 先检查 `"error" key |
| `reflector.reflect` 缺少执行时间日志 | 添加 `execution_time` 日志 |
| `editor_engine` 报 "Invalid params" | polish 任务必须传递 `draft` 字段 |
| ReflexionExecutor 走 DefaultLLMActor fallback | task 只有 57 字符，LLM 收到无意义提示超时 |
| 头条发布内容有 markdown 符号 | 发布前 `_strip_markdown_for_publish` 剥离 `**` `##` 等 |
| 评委全从路由 primary 开始造成并发瓶颈 | 评委指定模型排在候选链首位 |
| 4/5评委超时（Kimi/Qwen/HunYuan/MiniMax >180s） | `judge_timeout` 提升到 300s |
| 候选链缺少 Qwen3.6-Plus 和 HunYuan3 | judge 路由 fallback 补全 |
| Toutiao publisher 与 interactor 在 Windows 下不共用 user_data_dir | 直接用，不加 `_N` 后缀 |

## 9.2 ContentForge 阶段2：选题接口迁移+URL向量化

### 9.2.1 设计原则

1. **配置驱动**：选题 Loop 通过 `topic_loop.yaml` 配置，3评委+6维度+阈值0.80
2. **双模式支持**：默认提示词选题（intent 驱动）+ URL 选题模式（source_url 驱动）
3. **URL 向量化**：爬取URL下所有文章 → 15维度评估 → 写入 OpenSieve 向量库
4. **Loop 复用**：选题接口复用 FlowForge LoopExecutor，3评委并行评审

### 9.2.2 选题 Loop 配置要点

```yaml
# topic_loop.yaml 关键配置
verifier:
  mode: multi_judge
  judges:  # 3评委跨厂商，全部 prefer_api=true 避免 webchat 截断
    - model: openroute/Doubao-Seed2.0  # 字节 - 最稳定
    - model: openroute/GLM-5.1         # 智谱 - 成功率高
    - model: openroute/Kimi-K2.6       # 月之暗面 - 质量高
  exclude_creator: true  # 排除创作模型，避免自评偏差
  pass_threshold: 0.80   # 选题阈值低于文章创作(0.85)，允许更大探索空间
  judge_timeout: 60      # API backend 响应快(5-30s)，3评委并行<30s
```

### 9.2.3 URL 向量化15维度评估

URL 向量化工具 (`url_ingestor.py`) 实现：
1. 识别URL类型（单篇文章/用户主页/话题页/RSS）
2. 并行爬取文章（限制并发3，避免反爬）
3. LLM 评估15维度（title_attractiveness/opening_hook/content_depth/...）
4. 写入 OpenSieve 向量库（含15维度分数）

**关键设计**（v2.1 修正）：
- 15维度与 `deep_article_loop.yaml` 一致，确保选题和创作评估标准统一
- 提示词外置到 `opensieve/config/prompts.yaml`（`preselect.evaluate_15_dims` key），**禁止跨层依赖 contentforge 配置**
- OpenSieve 端点从环境变量注入（`OPENSIEVE_ENDPOINT`），禁止硬编码
- ContentForge 的 `url_ingestor.py` 是薄包装，仅调用 OpenSieve API，不自己爬取/向量化

### 9.2.4 选题接口的 T6+T7 验证

T6 指标采集：
- quality_score / iterations / strategy / topics_count
- 任务耗时 / 评委数量 / 阈值
- 每个选题的 title/angle/domain/trend_reason

T7 LLM 审核：
- 对每个选题（title + angle + trend_reason）调用 LLMReviewer 审核
- 审核维度：自然度(无AI痕迹)、相关性、格式、内容、连贯性
- 全部通过才算 PASS

**验证结果**（2026-07-08）：
- T6 PASS: quality=0.845, topics=3, iterations=1, strategy=hot_trend
- T7 PASS: 3/3 选题通过 LLM 审核

### 9.2.5 v2.1 架构修复经验（2026-07-09）

**发现的6个问题及修复**：

1. **source_filter 链路断裂（最严重）**：
   - 问题：设计文档说 retrieve.py 支持 source_filter，但 RetrieveQuery 模型无该字段（`extra="ignore"` 直接丢弃），OpenSieveClient._do_search payload 不含 source_filter
   - 修复：RetrieveQuery 增加 source_filter 字段，retrieve.py 路由层分流（preselect/web/local→PreselectService，all→原有Pipeline），OpenSieveClient._do_search 传递 source_filter
   - **教训**：设计文档与代码实现必须一致，每次修改后必须验证链路完整性

2. **定时预抓取未真正实现**：
   - 问题：preselect_service.schedule 只存内存 dict，未注册到调度器
   - 修复：用 APScheduler AsyncIOScheduler+CronTrigger 注册 cron 任务，持久化调度记录
   - **教训**：调度功能必须注册到真正的调度引擎，不能只存内存

3. **Milvus 向量未隔离**：
   - 问题：preselect_service 覆盖了 `_es_index` 但未覆盖 Milvus collection，预选题向量混入普通文档向量
   - 修复：IngestionPipeline._generate_vector 优先使用 `_milvus_collection` 属性
   - **教训**：数据隔离必须同时覆盖所有存储后端（ES+Milvus），不能只隔离一个

4. **15维度提示词跨层依赖**：
   - 问题：OpenSieve（下层）从 contentforge/config/prompts.yaml（上层）加载提示词，违反分层原则
   - 修复：提示词迁移到 opensieve/config/prompts.yaml 的 preselect.evaluate_15_dims key
   - **教训**：下层服务不能依赖上层配置文件，必须自包含

5. **路径计算错误**：
   - 问题：`_project_root = Path(__file__).resolve().parent.parent.parent.parent` 多算一层
   - 修复：改为 `parent.parent.parent`（opensieve/core/services/ → opensieve/）
   - **教训**：路径计算必须验证，用 print/os.path.exists 确认

6. **Docker bind mount 验证**：
   - 经验：OpenSieve 运行在 Docker 中，通过 bind mount 挂载宿主机代码目录（config/core/server/），修改代码后只需 `docker restart` 即可加载新代码，无需重建镜像

## 9.3 通用经验总结

### 9.3.1 LLM 调用稳定性

1. **必须实现候选链回退**：单一模型不可靠，必须配置跨厂商候选链
2. **必须识别静默失败**：HTTP 200 + 伪装内容是常见模式
3. **永久错误立即切换**：model_not_found/no_permission/无权访问 不重试，立即切换
4. **临时错误指数退避**：timeout/rate_limit 用 `backoff = retry_delay × 2^attempt`
5. **free 模型不可用于关键任务**：free 模型经常返回空内容或"无法回答"，创作/润色/评委必须用 webchat 模型

### 9.3.2 Loop 工程模式

1. **Discover→Assign→Act→Verify→Persist 五步闭环**
2. **长程任务用进度文件模式+检查点驱动**
3. **六层 Guardrails**：Input validation + System prompt constraints + Tool allow-lists + Output validation + Action confirmation + Cost ceilings
4. **自我纠错**：Error-driven Reflection + 迭代上限3-5次
5. **增量规划**：先规划前3-5步→执行→观察→再规划

### 9.3.3 新功能开发流程（防止阶段1重蹈覆辙）

1. **先读后写**：修改前完整理解当前实现
2. **确定影响范围**：涉及多模块修改时列出影响清单
3. **逐个处理**：跨模块修改逐个处理，不可批量复制
4. **可验证目标**：每个任务必须有可验证的完成标准
5. **T6+T7 同步验证**：开发完成后立即跑 T6（指标采集）+T7（LLM审核）
6. **记录坑和经验**：每个新功能完成后，把坑更新到本部分

---

> **本文件来源**：原 `hiclaw/rules.md` 第九部分 AI 编程优秀实践与踩坑总结
