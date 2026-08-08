---
feature_ids: [F-slo, P3-002]
related_features: [F050, F051]
topics: [performance, slo, observability]
doc_kind: design
created: 2026-07-21
---

# D047: FlowForge 性能 SLO 定义与验证

> **章节编号**: D047
> **关联 CL**: P3-002 性能 SLO 达标验证
> **关联 Feature**: F-slo 性能 SLO / F050 Eval Ledger / F051 Auto Dream
> **创建日期**: 2026-07-21
> **负责人**: 夏洛克（猎犬·开发者 Forgekin）
> **状态**: accepted

---

## 1. SLO 定义表

FlowForge 性能 SLO 共 5 项，覆盖 Loop 执行、LLM 调用、API 接口、降级率与系统可用性。
所有 SLO 均基于项目硬约束（"ContentForge creation and refinement interfaces must not exceed 3 minutes"、"LLM webchat calls must not exceed 30 seconds"、"Loop 流程在3分钟内完成"）。

| SLO ID | 名称 | 目标 | 测量方法 | 错误预算 |
|--------|------|------|---------|---------|
| **SLO-1** | Loop 执行时长 | P95 < 180s | `flowforge_loop_duration_seconds` histogram | 5% (允许 5% 请求超过 180s) |
| **SLO-2** | LLM webchat 调用时长 | P95 < 30s | `flowforge_llm_webchat_duration_seconds` histogram | 1% |
| **SLO-3** | 创建/润色接口时长 | P95 < 180s | `flowforge_api_request_duration_seconds` histogram（实际由 `flowforge_loop_duration_seconds{loop_name=creation|polish}` 派生） | 5% |
| **SLO-4** | 降级率 | < 5% | `flowforge_degradation_total / flowforge_tasks_total` | 0% |
| **SLO-5** | 系统可用性 | > 99.5% | `1 - (failed_tasks / total_tasks)` | 0.5% |

### 1.1 SLO 阈值常量

阈值常量定义在 `MetricsCollector` 类中，禁止硬编码到调用方：

```python
class MetricsCollector:
    LOOP_SLO_SECONDS: float = 180.0          # SLO-1 / SLO-3 阈值
    WEBCHAT_SLO_SECONDS: float = 30.0        # SLO-2 阈值
    SLO_WINDOW_SECONDS: float = 300.0        # 最近 5 分钟滚动窗口
    DEGRADATION_RATE_THRESHOLD: float = 0.05 # SLO-4 阈值
```

### 1.2 错误预算策略

- **SLO-1 / SLO-3 (5% 错误预算)**：每 5 分钟窗口允许 5% 的 Loop 执行超过 180s。当燃烧率 > 2x（即 10% 请求超阈值）时触发告警。
- **SLO-2 (1% 错误预算)**：每 5 分钟窗口允许 1% 的 LLM webchat 调用超过 30s。LLM 调用是用户感知最直接的延迟来源，预算最严格。
- **SLO-4 (0% 错误预算)**：降级本身是异常行为，任何降级都应触发根因分析。0% 预算意味着降级率 = 0 是目标，但实际阈值放宽到 5%。
- **SLO-5 (0.5% 错误预算)**：每 5 分钟窗口允许 0.5% 的任务失败。约等于每 200 个任务允许 1 个失败。

---

## 2. 测量架构

### 2.1 三层架构

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: MetricsCollector (in-memory 采集)                     │
│  ├─ record_loop_execution()                                     │
│  ├─ record_llm_webchat_call()                                   │
│  ├─ record_degradation()                                        │
│  └─ get_slo_status() → 实时 SLO 状态计算                         │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: PrometheusExporter (导出)                              │
│  ├─ sync_from_collector() 增量同步                               │
│  ├─ /metrics 端点（FastAPI 路由）                                │
│  └─ generate_latest() → Prometheus 文本格式                      │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: Grafana Dashboard (可视化)                            │
│  ├─ P95/P99 时长趋势面板                                         │
│  ├─ SLO 燃烧率面板                                               │
│  ├─ 降级率与可用性面板                                            │
│  └─ 每 10s 自动刷新                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 关键指标与 SLO 映射

| 指标名 | 类型 | 关联 SLO | 说明 |
|--------|------|---------|------|
| `flowforge_loop_duration_seconds{loop_name}` | histogram | SLO-1 / SLO-3 | Loop 执行时长，bucket: 10/30/60/90/120/180/300/600 |
| `flowforge_llm_webchat_duration_seconds{model}` | histogram | SLO-2 | WebChat LLM 调用时长，bucket: 5/10/20/30/60/120/300 |
| `flowforge_api_request_duration_seconds` | histogram (概念性) | SLO-3 | 创建/润色 API 接口时长，实际由 loop_duration 派生 |
| `flowforge_degradation_total{component, action_type}` | counter | SLO-4 | 降级动作计数 |
| `flowforge_loop_total{loop_name, success}` | counter | SLO-4 / SLO-5 | Loop 执行计数（用于降级率分母与可用性计算） |
| `flowforge_tasks_total{mode, status}` | counter | SLO-5 | 任务总数（可用性分子分母来源） |

### 2.3 SLO 燃烧率（Burn Rate）计算公式

燃烧率 = 实际错误率 / 允许错误预算

```
burn_rate = (actual_error_rate) / (error_budget)

# SLO-1 / SLO-3 (P95 < 180s, error_budget = 0.05)
burn_rate_SLO1 = (count(loop_duration >= 180s) / count(loop_duration)) / 0.05

# SLO-2 (P95 < 30s, error_budget = 0.01)
burn_rate_SLO2 = (count(webchat_duration >= 30s) / count(webchat_duration)) / 0.01

# SLO-4 (降级率 < 5%, error_budget = 0.05 — 与阈值相等)
burn_rate_SLO4 = degradation_rate / 0.05

# SLO-5 (可用性 > 99.5%, error_budget = 0.005)
burn_rate_SLO5 = failure_rate / 0.005
```

**燃烧率告警阈值**：
- `burn_rate > 1.0`：SLO 即将耗尽错误预算
- `burn_rate > 2.0`：触发告警（推荐立即介入）
- `burn_rate > 4.0`：紧急告警（SLO 已严重超标）

### 2.4 错误预算剩余计算

```
error_budget_remaining = max(0.0, 1.0 - burn_rate)
```

- `1.0`：完全健康（无错误）
- `0.5`：消耗了一半错误预算
- `0.0`：错误预算耗尽，SLO 已超标

---

## 3. SLO 验证流程

### 3.1 实时监控（Grafana 仪表盘）

- **刷新频率**：每 10 秒自动刷新
- **数据源**：Prometheus 抓取 MetricsCollector `/metrics` 端点
- **关键面板**：
  1. Loop P95/P99 时长趋势（按 loop_name 分组）
  2. WebChat P95/P99 时长趋势
  3. SLO 燃烧率仪表盘（5 个 SLO 并列）
  4. 降级率与可用性双轴图
  5. 错误预算剩余进度条

### 3.2 定期验证（每小时一次）

由 `flowforge.scheduler.Scheduler` 每小时触发一次 SLO 验证任务：

```python
# scheduler 注册的定时任务
@scheduler.scheduled("interval", minutes=60)
async def hourly_slo_validation():
    validator = SLOValidator(metrics_collector=di.get(MetricsCollector))
    results = validator.validate_all()
    report = validator.generate_report()
    # 写入日志 + 推送告警
    logger.info(f"Hourly SLO report:\n{report}")
    for slo_id, result in results.items():
        if result.burn_rate > 2.0:
            await alert_manager.send(f"SLO {slo_id} burn_rate={result.burn_rate:.2f}")
```

### 3.3 告警阈值

| 级别 | 条件 | 响应动作 |
|------|------|---------|
| **P0 紧急** | `burn_rate > 4.0` 或 SLO 完全失败 | 立即电话告警 + 自动创建事故工单 |
| **P1 严重** | `burn_rate > 2.0` 持续 5 分钟 | 短信告警 + 值班工程师介入 |
| **P2 警告** | `burn_rate > 1.0` 持续 15 分钟 | 邮件告警 + 关注趋势 |
| **P3 提示** | `error_budget_remaining < 0.5` | Grafana 仪表盘黄色标记 |

---

## 4. 性能优化指南

> **铁律**：性能优化必须通过定位并修复根因（LLM 问题、OpenRoute 性能、Workflow Bug）来实现，
> **禁止简化文章质量标准或 Loop 流程**（项目硬约束）。

### 4.1 Loop 3 分钟超时优化策略（不降低质量标准）

#### 4.1.1 并行化独立步骤

Loop 五步（Discover → Assign → Act → Verify → Persist）中，部分子步骤可并行：

```yaml
# config/workflows/creation.yaml
steps:
  discover:
    parallel:
      - topic_research   # 选题调研
      - trend_analysis   # 趋势分析
      - fact_prefetch    # 事实预取
  assign:
    sequential: true     # 依赖 discover 结果
  act:
    parallel:
      - draft_writing    # 草稿撰写
      - image_search     # 配图搜索（独立于正文）
  verify:
    parallel_judges: 5   # 5 评委并行评审
  persist:
    sequential: true
```

#### 4.1.2 LLM 调用流式响应

- 使用 OpenRouter webchat 模型的 SSE 流式接口
- 首字延迟 < 2s，避免长 prompt 阻塞
- 在 Loop 内增量消费 LLM 输出，边生成边验证

#### 4.1.3 减少不必要的 verify 循环（保留质量门禁）

- 质量分 ≥ 0.92 时直接通过，跳过额外迭代
- 质量分在 [0.85, 0.92) 时进入一次精修
- 质量分 < 0.85 时才进入完整迭代（最多 3 次）
- **不取消质量门禁**，仅减少高质内容的冗余验证

### 4.2 LLM webchat 30 秒优化策略

#### 4.2.1 使用 OpenRoute webchat 模型

- OpenRoute 已配置 webchat 专用路由（短 prompt、低延迟模型）
- 优先使用 `Doubao-Seed2.0` / `GLM-5.1` 等首字延迟 < 1s 的模型

#### 4.2.2 超时检测 + 自动切换 backup

```python
# 伪代码：webchat 调用超时自动切换
async def webchat_with_failover(prompt: str, timeout: float = 25.0):
    try:
        return await asyncio.wait_for(
            primary_webchat.call(prompt),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        metrics.record_degradation("llm_provider", "fallback", "webchat timeout")
        return await backup_webchat.call(prompt)
```

#### 4.2.3 避免长 prompt（精简 system prompt）

- system prompt 严格控制在 500 token 以内
- 历史对话超过 3 轮触发压缩（保留最近 2 轮 + 摘要）
- 禁止将完整文章正文作为 webchat 输入（应传摘要或关键段）

### 4.3 创建/润色接口 3 分钟优化策略

#### 4.3.1 并行 5 评委评审

```python
# 5 评委并行评审，10s 内完成（原串行需 50s）
async def parallel_judge(article: str) -> JudgeResult:
    judges = ["seo", "fact_check", "writing", "structure", "engagement"]
    tasks = [judge.evaluate(article) for judge in judges]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return aggregate(results)
```

#### 4.3.2 增量式输出

- SSE 流式返回 Loop 进度（discover/assign/act/verify/persist 各阶段事件）
- 前端实时显示进度，避免长时间无响应
- 后端继续执行，不因 SSE 中断而中止

#### 4.3.3 缓存中间结果

- 选题调研结果按 `topic_hash` 缓存 1 小时
- 事实核查结果按 `claim_hash` 缓存 24 小时
- 相似主题的草稿片段复用（相似度 > 0.85 时）

---

## 5. 性能瓶颈定位流程

> **铁律**：性能优化需要"quantitative time statistics at each node to identify bottlenecks"。
> 禁止凭直觉优化，必须基于指标数据定位。

### 5.1 步骤 1：查看 Grafana P95/P99 时长趋势

打开 Grafana `flowforge-dashboard`，查看以下面板：

- **Loop Duration P95/P99 Trend**：按 `loop_name` 分组的时长趋势
- **WebChat Duration P95/P99 Trend**：LLM webchat 调用时长趋势
- **Loop Step Duration Heatmap**：5 大步骤（discover/assign/act/verify/persist）的时长热力图

**判断标准**：
- P95 > 阈值（180s 或 30s）→ 进入步骤 2
- P95 正常但 P99 异常高 → 个别请求异常，进入步骤 2 按请求分组分析

### 5.2 步骤 2：定位慢请求（按 loop_name / step_name 分组）

使用 PromQL 查询慢请求分布：

```promql
# 慢 Loop 请求分布（按 loop_name）
histogram_quantile(0.95, sum(rate(flowforge_loop_duration_seconds_bucket[5m])) by (le, loop_name))

# 慢步骤分布（按 step_name）
topk(5, sum(rate(flowforge_loop_step_duration_seconds_bucket[5m])) by (le, step_name))
```

**判断标准**：
- 某个 `loop_name` 明显慢于其他 → 该 Loop 流程有问题
- 某个 `step_name`（如 `verify`）耗时占比 > 50% → 该步骤是瓶颈

### 5.3 步骤 3：分析 LLM 调用时长占比

```promql
# Loop 总时长 vs LLM 调用时长
sum(rate(flowforge_loop_duration_seconds_sum[5m])) by (loop_name)
/
sum(rate(flowforge_llm_duration_seconds_sum[5m])) by (model)
```

**判断标准**：
- LLM 调用时长占比 > 70% → LLM 是瓶颈，检查 OpenRoute 路由配置
- LLM 调用正常但 Loop 总时长高 → Workflow 逻辑问题（如串行可并行步骤）

### 5.4 步骤 4：检查降级率（是否频繁触发 fallback）

```promql
# 降级率趋势
sum(rate(flowforge_degradation_total[5m])) by (component, action_type)
/
sum(rate(flowforge_loop_total[5m]))
```

**判断标准**：
- `llm_provider` 降级频繁 → OpenRoute 或上游 LLM 不稳定
- `openroute` 降级频繁 → OpenRoute 网关本身有问题
- `loop_executor` 降级频繁 → Workflow 执行器有问题

### 5.5 步骤 5：根据根因修复（不简化质量标准）

| 根因类型 | 修复策略 | 禁止操作 |
|---------|---------|---------|
| LLM 模型慢 | 切换更快的模型（Doubao/GLM） | ❌ 降低质量分阈值 |
| OpenRoute 性能 | 检查 OpenRoute 路由配置、增加并发 | ❌ 取消 fallback chain |
| Workflow Bug | 修复串行可并行步骤、减少冗余 verify | ❌ 取消质量门禁 |
| Prompt 过长 | 精简 system prompt、压缩历史 | ❌ 删除关键上下文 |
| 配额耗尽 | 申请更多配额、切换 provider | ❌ 跳过 moderation |

---

## 6. SLO 验证测试用例

### 6.1 测试用例 1：Loop 时长 SLO-1 验证

**目标**：注入 100 个 Loop 任务，统计 P95 时长，验证 SLO-1 达标。

**步骤**：
1. 创建 `MetricsCollector` 实例
2. 注入 100 个 `record_loop_execution()` 调用，时长在 [30s, 150s] 区间
3. 调用 `SLOValidator.validate_slo("SLO-1")`
4. 断言 `result.passed is True`
5. 断言 `result.actual` 包含 "P95" 且 P95 < 180s
6. 断言 `result.burn_rate < 1.0`（错误预算未耗尽）

**反向验证**：
1. 注入 50 个时长 200s 的 Loop 任务
2. 断言 `result.passed is False`
3. 断言 `result.burn_rate > 1.0`

### 6.2 测试用例 2：LLM webchat SLO-2 验证

**目标**：模拟 1000 次 LLM webchat 调用，统计 P95 时长，验证 SLO-2 达标。

**步骤**：
1. 注入 1000 个 `record_llm_webchat_call()` 调用，时长在 [5s, 25s] 区间
2. 调用 `SLOValidator.validate_slo("SLO-2")`
3. 断言 `result.passed is True`
4. 断言 P95 < 30s
5. 断言 `error_budget_remaining > 0.5`

**反向验证**：
1. 注入 100 个时长 45s 的 webchat 调用
2. 断言 `result.passed is False`
3. 断言 `burn_rate > 1.0`

### 6.3 测试用例 3：降级率 SLO-4 验证

**目标**：触发降级场景，验证 SLO-4 降级率计算正确。

**步骤**：
1. 注入 100 个 Loop 任务 + 3 个降级记录（降级率 3%）
2. 调用 `SLOValidator.validate_slo("SLO-4")`
3. 断言 `result.passed is True`（3% < 5%）
4. 断言 `result.details["degradation_rate"] == 0.03`

**反向验证**：
1. 注入 100 个 Loop 任务 + 10 个降级记录（降级率 10%）
2. 断言 `result.passed is False`（10% > 5%）
3. 断言 `burn_rate > 1.0`

---

## 7. 与 MetricsCollector 集成

### 7.1 实时 SLO 状态查询

```python
from flowforge.observability.metrics_collector import MetricsCollector

mc = MetricsCollector()
# ... 记录指标 ...

# 实时 SLO 状态（基于最近 5 分钟数据）
slo_status = mc.get_slo_status()
# 返回:
# {
#   "loop_3min_slo": True/False,
#   "webchat_30s_slo": True/False,
#   "degradation_rate": 0.03,
#   "loop_p95_seconds": 145.2,
#   "webchat_p95_seconds": 22.5,
#   "loop_sample_count": 87,
#   "webchat_sample_count": 156
# }
```

### 7.2 完整指标摘要查询

```python
# 完整 FlowForge 指标摘要（5 个顶层键：loop/llm/degradation/recovery/provider）
metrics_summary = mc.get_flowforge_metrics()
```

### 7.3 SLOValidator 调用示例

```python
from flowforge.tools.slo_validator import SLOValidator
from flowforge.observability.metrics_collector import MetricsCollector

mc = MetricsCollector()
# ... 记录指标 ...

validator = SLOValidator(metrics_collector=mc)

# 验证单个 SLO
result = validator.validate_slo("SLO-1")
print(f"SLO-1 passed={result.passed}, burn_rate={result.burn_rate:.2f}")

# 验证所有 SLO
results = validator.validate_all()
for slo_id, result in results.items():
    print(f"{slo_id}: {result.name} - {'PASS' if result.passed else 'FAIL'}")

# 生成 Markdown 报告
report = validator.generate_report()
print(report)
```

### 7.4 集成注意事项

1. **不依赖真实 Prometheus 查询**：`SLOValidator` 仅基于 `MetricsCollector` 的 in-memory 数据，避免对外部 Prometheus 服务的耦合。
2. **不调用真实 LLM**：`SLOValidator` 仅基于 metrics 数据验证，不触发任何 LLM 调用。
3. **DI 容器集成**：通过构造函数注入 `MetricsCollector`，遵守铁律 12（禁止绕过 DI 容器直接实例化）。
4. **类型注解强制**：所有方法签名使用 Python 3.11+ 类型注解。
5. **async 友好**：`SLOValidator` 的核心方法为同步实现（基于 in-memory 数据计算），可在 async 上下文中直接调用。

---

## 8. 引用

- [doc:observability/metrics_collector.py] `MetricsCollector.get_slo_status()` 方法
- [doc:observability/prometheus_exporter.py] Prometheus 指标导出
- [doc:observability/grafana/flowforge-dashboard.json] Grafana 仪表盘配置
- [doc:design/D045-docs-front-matter.md] Front-matter 规范
- [doc:features/F050-eval-ledger.md] Eval Ledger
- [doc:features/F051-auto-dream.md] Auto Dream
- [rules:CONTRIBUTING.md] 性能优化铁律：不简化质量标准

---

## 9. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|------|------|--------|
| 2026-07-21 | v1.0 | 初版：定义 5 个性能 SLO、测量架构、验证流程、优化指南、瓶颈定位流程、测试用例 | 夏洛克 |
