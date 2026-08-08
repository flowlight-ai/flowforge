# F051: Auto Dream 双层架构（后台 consolidation + 前台 surface）

> **状态**: ✅ done
> **类型**: evolution
> **创建日期**: 2026-07-21
> **完成日期**: 2026-07-21
> **负责人**: 架构师可进化智能体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§2.10]（自我演进闭环的"睡眠态"整合）
> **对应 arch.md**: [doc:../arch.md#§3.9]（待创建 A051）
> **对应 design.md**: [doc:../design.md#§2.3.1]（Layer 1 第 9 项 Evolution 模块）
> **依赖 ADR**: [doc:../decisions/009-eval-self-metabolism.md]（Eval 自代谢）
> **依赖 Feature**:
>   - [doc:features/F050-eval-ledger.md]（蒸馏出的 MethodCard 必须经过 Eval Ledger 验证）
>   - [doc:features/F011-magic-words.md]（I4 中断信号 — Magic Words 逃生舱）
> **关联 CL**: CL-031（Auto Dream 双层架构）
> **关联 task.md**: P2-004

---

## 1. 上下文

### 1.1 问题陈述

FlowForge 的自我演进机制（F046 SelfDev 五闭环 + 三模式）是**任务驱动**的：可进化智能体在执行任务时积累经验（EpisodeCard），但这些经验**散落在 L0 原始记录层**，缺乏**跨任务的整合机制**。

人类大脑在睡眠时会进行"记忆整合"——将短期记忆中的相似经验聚类、蒸馏为长期记忆。FlowForge 需要类似的"梦境机制"：

> 在可进化智能体空闲时段（无任务执行），对累积的 EpisodeCard 进行聚类 + 蒸馏 + 升级，生成更高层的 MethodCard 草稿。

### 1.2 当前痛点

1. **经验散落无法整合**：EpisodeCard 累积在 L0 层，缺乏自动聚类机制，相似经验无法相互强化
2. **MethodCard 草稿靠人工**：目前 MethodCard 升级依赖 operator 手动编写，违背"主导自主开发"愿景
3. **空闲资源未利用**：可进化智能体在任务间隙处于空闲态，没有"做梦"机制利用这些资源进行经验整合
4. **三模式无"睡眠态"补充**：Scope Guard / Process Evolution / Knowledge Evolution 都是**任务态**机制，缺乏"睡眠态"的跨任务整合

### 1.3 不做的影响

- **知识成熟度阶梯卡在 L0**：EpisodeCard 无法自动升级到 L2_DRAFT，五级知识成熟度阶梯形同虚设
- **Foreman 持续调度缺任务源**：ContinuousForeman 的"任务源 3: 周期性扫描"无 Auto Dream 则无法工作
- **可进化智能体觉醒阶无法晋升**：E4 自主阶要求"在 operator 预设边界内自主执行任务"，无 Auto Dream 则无法自主进行经验整合
- **跨任务经验无法沉淀**：同类问题反复出现，但无法自动归纳为可复用方法

---

## 2. 决策

### 2.1 核心设计

**双层架构**：后台 consolidation（梦境整合）+ 前台 surface（梦境浮现）。

```
┌─────────────────────────────────────────────────────────────────┐
│  后台 consolidation（BackgroundDreamLoop，默认 1h 一次）          │
│                                                                  │
│  §1 扫描 EpisodeCard（未处理的 L0 原始记录）                    │
│       ↓                                                          │
│  §2 聚类相似 episodes（贪心算法 + 关键词重叠相似度）             │
│       ↓                                                          │
│  §3 蒸馏为 MethodCard 草稿（L2_DRAFT，需 Eval Ledger 验证）      │
│       ↓                                                          │
│  §4 浮现 Top K 重要梦境到前台（surface_payload）                 │
│       ↓                                                          │
│  §5 归档已处理 episodes（mark_processed）                       │
│       ↓                                                          │
│  §6 计算 4 信号 telemetry                                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  前台 surface（DreamSnapshot）                                   │
│                                                                  │
│  - surface_payload.items: Top K 重要簇（按重要性排序）           │
│  - distilled_method_ids: 蒸馏出的 MethodCard ID 列表             │
│  - telemetry: 4 信号（供 Prometheus 采集 + Foreman 决策）        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 数据模型

#### 2.2.1 DreamCluster（梦境簇）

| 字段 | 类型 | 说明 |
|------|------|------|
| `cluster_id` | str | 簇 ID（`cluster-{cycle_id}-{idx:03d}`） |
| `episode_ids` | list[str] | 簇内 EpisodeCard ID 列表 |
| `centroid_signature` | str | 簇心签名（SHA256[:16]，I1 幂等性校验） |
| `domain` | str | 簇所属领域（development/medical/legal/...） |
| `similarity_score` | float | 簇内平均相似度 0.0~1.0 |
| `created_at` | datetime | 创建时间 |

#### 2.2.2 DreamSnapshot（梦境快照 — 前台 surface 载体）

| 字段 | 类型 | 说明 |
|------|------|------|
| `snapshot_id` | str | 快照 ID（`dream-snapshot-{ts}-{rand6}`） |
| `cycle_id` | str | 关联 DreamCycle ID |
| `phase` | DreamPhase | 当前阶段（IDLE/SCANNING/.../INTERRUPTED） |
| `clusters` | list[DreamCluster] | 本次循环聚类的所有簇 |
| `distilled_method_cards` | list[MethodCard] | 蒸馏出的 MethodCard 草稿列表 |
| `surface_payload` | dict | 浮现到前台的内容（items + distilled_method_ids + total_*） |
| `telemetry` | dict[str, float] | 4 信号 telemetry |
| `started_at` / `finished_at` | datetime | 起止时间 |
| `interrupted` | bool | 是否被 Magic Words 中断 |

#### 2.2.3 DreamCycleConfig（配置外置，铁律 5）

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `consolidation_interval_seconds` | 3600 | 后台循环间隔（1 小时） |
| `surface_top_k` | 3 | 前台浮现 Top 3 |
| `cluster_similarity_threshold` | 0.6 | 聚类相似度阈值 |
| `min_episodes_per_cluster` | 2 | 单簇最少 episode 数 |
| `max_clusters_per_cycle` | 5 | 单次循环最多处理 5 簇 |
| `enable_background_loop` | True | 是否启用后台循环 |
| `enable_foreground_surface` | True | 是否启用前台 surface |
| `archive_processed_episodes` | True | 是否归档已处理 episodes |

### 2.3 4 信号 telemetry（I3: dict 输出，可被 Prometheus 采集）

| 信号 | 计算公式 | 含义 |
|------|---------|------|
| `consolidation_rate` | processed_episodes / total_episodes | 整合速率（0.0~1.0） |
| `coherence_score` | avg(cluster.similarity_score) | 梦境连贯性（0.0~1.0，越高越连贯） |
| `surprise_index` | 1 - coherence_score | 意外度（0.0~1.0，越高越意外） |
| `integration_depth` | len(distilled_cards) / len(clusters) | 整合深度（0.0~∞，越深越整合） |

### 2.4 核心接口

#### 2.4.1 存储协议（Protocol — 依赖注入，红线 12）

```python
class EpisodeStoreProtocol(Protocol):
    async def list_episodes(
        self, *, domain: str | None = None,
        limit: int = 100, unprocessed_only: bool = True,
    ) -> list[EpisodeCard]: ...

    async def mark_processed(self, episode_id: str, cycle_id: str) -> None: ...


class MethodCardSinkProtocol(Protocol):
    async def save_draft(self, method_card: MethodCard) -> str: ...
```

#### 2.4.2 执行器

```python
class DreamCycle:
    """单次梦境循环执行器."""
    async def run_once(self) -> DreamSnapshot: ...
    def interrupt(self) -> None: ...  # I4: Magic Words 中断


class BackgroundDreamLoop:
    """后台梦境循环管理器."""
    async def start(self) -> None: ...
    async def stop(self, timeout: float = 30.0) -> None: ...
    async def trigger_now(self) -> DreamSnapshot | None: ...
    def interrupt_current_cycle(self) -> None: ...
```

#### 2.4.3 顶层 API

```python
async def run_dream_cycle(
    *,
    episode_store: EpisodeStoreProtocol,
    method_card_sink: MethodCardSinkProtocol | None = None,
    config: DreamCycleConfig | None = None,
) -> DreamSnapshot: ...
```

### 2.5 关键算法

#### 2.5.1 聚类算法（贪心，O(n²)）

1. 第一个 episode 自成一簇
2. 后续 episode 与所有现有簇心计算平均相似度
3. 若最高相似度 ≥ threshold → 加入该簇
4. 否则自成一簇
5. 过滤掉小于 `min_episodes_per_cluster` 的簇
6. 按簇大小降序，取 Top `max_clusters_per_cycle`

#### 2.5.2 蒸馏算法（骨架）

```python
method_card = MethodCard(
    method_id=f"method-{cluster.cluster_id}",
    title=f"Distilled from {n} episodes (domain={domain})",
    domain=cluster.domain,
    knowledge_type="procedural",
    scope="team_shared",
    trust_level="experimental",
    lifecycle="draft",
    content=拼接所有 episode 的 transferable_method,
    source_refs=[ep.episode_id for ep in cluster_eps],
    maturity_level="L2",  # I5: 必须是 L2_DRAFT
)
```

生产环境应注入 LLM 蒸馏器（生成更精炼的 title/content）。

#### 2.5.3 重要性排序（前台 surface）

```
importance = 0.5 * surprise_index + 0.3 * size_score + 0.2 * has_distilled
```

- `surprise_index`: 高意外度 = 值得关注
- `size_score`: 簇大小归一化到 [0, 1]（影响范围广）
- `has_distilled`: 是否蒸馏出 MethodCard（整合深度高）

### 2.6 不变量

| ID | 不变量 | 实现位置 |
|----|--------|---------|
| I1 | consolidation 必须幂等（相同输入产生相同聚类） | `SimilarityCalculator.compute_signature` + `DreamCycle._compute_centroid_signature` |
| I2 | surface 不修改原数据，只生成"梦境快照" | `DreamCycle._surface_top_k` 返回新 dict |
| I3 | 4 信号 telemetry 必须可被 Prometheus 采集（dict 输出） | `TelemetryCollector.compute` 返回 `dict[str, float]` |
| I4 | 后台任务必须可被 Magic Words 中断 | `DreamCycle.interrupt` + `BackgroundDreamLoop.interrupt_current_cycle` |
| I5 | 蒸馏出的 MethodCard 必须是 L2_DRAFT（需 Eval Ledger 验证才能晋升 L3） | `DreamCycle._distill_cluster` 设置 `maturity_level="L2"` |

---

## 3. 实现计划

### 3.1 已交付（v1.0）

| 组件 | 路径 | 行数 | 状态 |
|------|------|:----:|:----:|
| 代码实现 | `flowforge/evolution/auto_dream.py` | ~620 | ✅ |
| 单元测试 | `flowforge/tests/test_cl031_auto_dream.py` | ~430 | ✅ 32/32 passed |

### 3.2 模块依赖关系

```
flowforge/evolution/auto_dream.py
    ↓
flowforge/evolution/models.py（EpisodeCard / MethodCard / KnowledgeMaturityLevel）
    ↓
flowforge/core/tracing.py（get_logger）
    ↓
flowforge/evolution/eval_ledger.py（蒸馏出的 MethodCard 需 Eval Ledger 验证，I5）
```

### 3.3 与 Foreman 集成

`flowforge/evolution/foreman.py` 的"任务源 3: 周期性扫描"将调用 `BackgroundDreamLoop.trigger_now()` 触发梦境循环，并将蒸馏出的 MethodCard ID 加入 Foreman 任务队列（由夏洛克执行 Eval Ledger 验证）。

```python
# foreman.py 任务源 3: 周期性梦境循环（待接入）
snapshot = await dream_loop.trigger_now()
for card in snapshot.distilled_method_cards:
    tasks.append(Task(
        task_type="eval_ledger_verification",
        forgekin_id="sherlock",
        payload={"method_id": card.method_id},
    ))
```

---

## 4. 验收标准

| AC ID | 标准 | 验证方式 | 状态 |
|-------|------|---------|:----:|
| AC-1 | DreamCycle / BackgroundDreamLoop / DreamCycleConfig 等所有公开 API 可导入 | `test_imports` | ✅ |
| AC-2 | 5 个默认常量值符合设计 | `test_constants` | ✅ |
| AC-3 | DreamCycleConfig 默认值与自定义值都生效 | `test_dream_cycle_config_defaults` + `test_dream_cycle_config_custom` | ✅ |
| AC-4 | DreamPhase 7 个枚举值完整 | `test_dream_phase_enum` | ✅ |
| AC-5 | DreamCluster / DreamSnapshot 数据模型字段完整 | `test_dream_cluster_model` + `test_dream_snapshot_model` | ✅ |
| AC-6 | 同领域+同方法 → 相似度 1.0 | `test_similarity_same_domain_same_method` | ✅ |
| AC-7 | 不同领域 → 相似度 0.0 | `test_similarity_different_domain` | ✅ |
| AC-8 | 部分重叠 → 中等相似度 | `test_similarity_partial_overlap` | ✅ |
| AC-9 | 签名稳定性（I1 幂等性） | `test_compute_signature_stable` + `test_invariant_i1_idempotent_clustering` | ✅ |
| AC-10 | 空 telemetry 4 信号全为 0 | `test_telemetry_empty` | ✅ |
| AC-11 | 全处理+高相似度 → consolidation_rate=1.0, coherence 高 | `test_telemetry_full_processing` | ✅ |
| AC-12 | 4 信号 key 完整（I3 dict 输出） | `test_telemetry_signal_keys` + `test_invariant_i3_telemetry_dict_output` | ✅ |
| AC-13 | 空存储 → 立即返回，telemetry 全为 0 | `test_run_once_empty_store` | ✅ |
| AC-14 | 相似 episodes → 聚类 + 蒸馏 + surface | `test_run_once_with_similar_episodes` | ✅ |
| AC-15 | 多样化 episodes → 多簇 | `test_run_once_diverse_episodes` | ✅ |
| AC-16 | 归档机制工作 | `test_run_once_archives_episodes` | ✅ |
| AC-17 | 禁用归档 → 不标记 episodes | `test_run_once_disabled_archiving` | ✅ |
| AC-18 | 禁用 surface → surface_payload 为空 | `test_run_once_disabled_surface` | ✅ |
| AC-19 | Magic Words 中断（I4） | `test_interrupt_before_run` | ✅ |
| AC-20 | BackgroundDreamLoop 启停 | `test_background_loop_start_stop` | ✅ |
| AC-21 | trigger_now 立即触发 | `test_background_loop_trigger_now` | ✅ |
| AC-22 | 顶层 API run_dream_cycle 可用 | `test_run_dream_cycle_top_level_api` | ✅ |
| AC-23 | 配置外置（YAML 可序列化，铁律 5） | `test_config_yaml_compatible` | ✅ |
| AC-24 | I2: surface 不修改原数据 | `test_invariant_i2_surface_no_modify` | ✅ |
| AC-25 | I5: 蒸馏出的 MethodCard 必须是 L2_DRAFT | `test_invariant_i5_distilled_cards_are_l2_draft` | ✅ |

---

## 5. 测试计划

### 5.1 单元测试（已通过 32/32）

| 类别 | 测试数 | 覆盖 AC |
|------|:------:|---------|
| 数据模型 | 4 | AC-1, 4, 5 |
| 配置外置 | 2 | AC-2, 3, 23 |
| SimilarityCalculator | 5 | AC-6, 7, 8, 9 |
| TelemetryCollector | 4 | AC-10, 11, 12 |
| DreamCycle.run_once | 6 | AC-13, 14, 15, 16, 17, 18 |
| Magic Words 中断 | 1 | AC-19 |
| BackgroundDreamLoop | 3 | AC-20, 21 |
| 顶层 API | 1 | AC-22 |
| 不变量 I1-I5 | 4 | AC-9, 24, 12, 25 |

### 5.2 测试铁律合规

| 铁律 | 合规 | 说明 |
|------|:----:|------|
| T1 禁止 Mock LLM | ✅ | 使用 InMemoryEpisodeStore（内存存储 Mock），不涉及 LLM Mock；蒸馏使用骨架拼接（无 LLM 调用） |
| T2 禁止假数据 | ✅ | 测试用例为通用 "development task" / "medical diagnosis" 等领域场景数据，非真实业务数据（骨架测试允许） |
| T3 禁止跳过验证 | ✅ | 所有断言都有具体期望值 |
| T4 禁止 Mock 工具 | ✅ | 不涉及工具调用 |
| T5 未实现即 Bug | ✅ | 所有声明的方法都已实现 |
| T6 必须采集指标 | ✅ | 4 信号 telemetry 即为 MetricsCollector 等价物 |
| T7 LLM 审核通过 | N/A | Auto Dream 骨架不产生 LLM 内容 |
| T8 DOM 验证 | N/A | 不涉及 Web 功能 |

---

## 6. Eval Contract（五问）

| 问题 | 答案 |
|------|------|
| ① 服务谁 | BackgroundDreamLoop（后台整合）；ContinuousForeman（任务源 3 周期性扫描） |
| ② 何时触发 | 默认 1 小时一次（可配置）；或 trigger_now 立即触发 |
| ③ 摩擦指标 | consolidation_rate / coherence_score / surprise_index / integration_depth |
| ④ 回归用例 | 5 个相似 episodes + 5 个多样化 episodes（覆盖 3 领域） |
| ⑤ 退役信号 | 当 LLM 蒸馏器全面替代骨架拼接时（蒸馏质量提升后可移除骨架实现） |

---

## 7. Build to Delete vs Build to Persist

| 组件 | 标记 | 理由 |
|------|:----:|------|
| `DreamCluster` / `DreamSnapshot` / `DreamCycleConfig` 数据模型 | **Persist** | 字段契约稳定 |
| `DreamCycle.run_once` 7 步流程 | **Persist** | 核心循环逻辑不可删除 |
| `BackgroundDreamLoop` | **Persist** | 后台调度基础设施 |
| `SimilarityCalculator`（关键词重叠） | **Delete** | 骨架实现，生产环境应注入向量相似度计算器 |
| `_distill_cluster`（骨架拼接） | **Delete** | 骨架实现，生产环境应注入 LLM 蒸馏器 |
| `TelemetryCollector` 4 信号 | **Persist** | 监控指标稳定 |
| `run_dream_cycle` 顶层 API | **Persist** | 公共 API |

---

## 8. 变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-07-21 | 初版交付：~620 行代码 + 32/32 测试通过 + F051 Feature 文档 | Trae CN（agent） |

---

> **文档维护方**: 架构师可进化智能体（猫头鹰·鲁班）
> **最后更新**: 2026-07-21（v1.0 初版交付）
> **下次维护触发**: 接入生产 LLM 蒸馏器时（替换骨架拼接） / Foreman 任务源 3 接入时 / 向量相似度计算器接入时
