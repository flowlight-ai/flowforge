# harness-feedback Eval 反馈

> **目录作用**: 存放 FlowForge Harness Eval 反馈规范与产物，包括评估域 YAML 配置、裁决记录、评估快照 bundles 等
> **维护规则**: 新增评估域时同步注册到 `eval-domains/`；裁决产物按 `bundles/{YYYY-MM-DD}-{domain}-{slug}/` 归档，禁止覆盖历史 bundle

---

## 子目录

| 子目录 | 作用 |
|--------|------|
| `eval-domains/` | 评估域 YAML 配置（每个 domain 一个 `.yaml`，定义评估契约） |
| `bundles/` | 评估快照 bundles（按日期 + domain + slug 归档，含 snapshot/attribution/provenance） |
| `verdicts/` | 裁决记录（Markdown 文档，记录评估结论与改进建议） |

---

## 文档清单

### 评估域 YAML（待创建）

| 文档 | 名称 | 状态 |
|------|------|------|
| `eval-domains/eval-teamact.yaml` | TeamAct 协作评估域 | ⏳ |
| `eval-domains/eval-memory.yaml` | 多域记忆联邦评估域 | ⏳ |
| `eval-domains/eval-forgemind.yaml` | forgemind 可进化智能体（Forgekin）评估域 | ⏳ |
| `eval-domains/eval-harness.yaml` | Harness 七层护栏评估域 | ⏳ |
| `eval-domains/eval-reliability.yaml` | 分布式可靠性评估域 | ⏳ |
| `eval-domains/eval-friction.yaml` | 摩擦信号评估域 | ⏳ |
| `eval-domains/community-fixtures/` | 社区样本夹具（脱敏 issue packet 等） | ⏳ |

### 裁决记录（待创建）

| 文档 | 名称 | 状态 |
|------|------|------|
| `verdicts/README.md` | 裁决记录索引 | ⏳ |
| `verdicts/fixtures/` | 裁决样本夹具 | ⏳ |

### bundles 归档规范

每个 bundle 目录结构：

```
bundles/{YYYY-MM-DD}-{domain}-{slug}/
├── snapshot.json       # 评估快照（输入数据 + 运行时状态）
├── attribution.json    # 归因矩阵（七类归因）
├── provenance.json     # 数据来源溯源
└── raw/                # 原始产物（rollup-report 等，可选）
```

---

## 评估域 YAML 字段规范

```yaml
---
domainId: eval:{slug}              # 评估域唯一标识
displayName: {显示名}              # 中文显示名
systemThreadId: thread_eval_{slug} # 评估系统线程 ID
evalCat:                           # 执行评估的可进化智能体
  catId: {id}
  handle: "@{handle}"
  model: {model}
frequency: daily|weekly|on-demand  # 评估频率
sourceAdapter: {adapter-name}      # 信号源适配器
sourceRefsKind: {kind}             # 信号引用类型
threadPolicy:                      # 线程策略
  role: working-home
  stateSot: registry
  allowedContent: [...]
handoffTargetResolver:             # 交接目标解析
  featureId: F{NNN}
  ownerCatId: {id}
  threadLookup: feature-thread
sla:                               # SLA
  acknowledgeHours: 24
  reevalWithinHours: 72
---
```

---

## 维护规则

- 评估域 YAML 必须有 `domainId`、`displayName`、`evalCat`、`frequency`、`sourceAdapter` 五个核心字段
- bundle 归档按日期命名，已发布日期不重排、不复用
- 裁决记录必须包含具体断言与改进建议，禁止 `status in ("completed","error")` 模糊结论（违反 T3 测试铁律）
- 评估必须调用真实 LLM，禁止 Mock（违反 T1 测试铁律）
- 评估输入必须是真实场景数据，禁止假数据（违反 T2 测试铁律）
- 禁止硬编码绝对路径，跨文档引用统一使用 `[doc:harness-feedback/xxx]` 格式
- 退役 scheduled task 清理须在 YAML `legacyScheduledTaskIds` 字段注释清理日期与归档位置

---

## 延伸阅读

- `[doc:features/F040-harness-eval-control-plane.md]` — Harness Eval 控制面 Feature（待创建）
- `[doc:decisions/009-eval-self-metabolism.md]` — Eval 自代谢 ADR（待创建）
