# architecture 架构文档

> **目录作用**: 存放 FlowForge 七层架构相关的系统架构设计文档，包括架构视图、协作全景、路由协议、记忆联邦、检索流水线、用户旅程等
> **维护规则**: 新增架构文档时同步更新 `[doc:arch.md]` 索引与本 README 清单；架构文档以叙事性快照为主，归属路由另见 `ownership/` 子目录

---

## 子目录

| 子目录 | 作用 |
|--------|------|
| `assets/` | 架构图资源（PNG/SVG 手绘稿、生成脚本） |
| `ownership/` | 架构归属路由 cells（判断 Feature 落在哪条架构线） |

---

## 文档清单

### 核心架构文档（8 份，待创建）

| 文档 | 名称 | 状态 |
|------|------|------|
| `2026-07-17-architecture-views.md` | 七层架构 + forgemind 全景视图 | ⏳ |
| `collaboration-landscape.md` | 协作全景（TeamAct + 共鸣 + 灵议） | ⏳ |
| `at-mention-routing-system.md` | 行首 @ 路由协议（多 agent 路由） | ⏳ |
| `cli-integration.md` | 三方 Agent CLI 接入架构 | ⏳ |
| `feature-placement.md` | Feature 在七层架构中的归属位置 | ⏳ |
| `memory-system-overview.md` | 多域记忆联邦架构总览 | ⏳ |
| `retrieval-pipeline-deep-dive.md` | 检索流水线（三入口 + 消费加权） | ⏳ |
| `user-journeys.md` | 万物灵智体锻造用户旅程 | ⏳ |

### ownership cells（待创建）

| Cell | 名称 | 状态 |
|------|------|------|
| `ownership/README.md` | 架构归属路由索引 | ⏳ |
| `ownership/cells/*.md` | 各架构归属 cell（dispatch/memory/transport 等） | ⏳ |

---

## 维护规则

- 架构文档以日期前缀或语义化 slug 命名（如 `2026-07-17-architecture-views.md`、`memory-system-overview.md`）
- 架构视图为叙事性快照，每次重大架构演进追加新日期视图，不覆盖旧视图
- Feature 文档引用架构 cell 时使用格式：`Architecture cell: {cell_id}` + `Map delta: none|update required|new cell required`
- 找不到归属 cell = Phase 0 架构发现未完成，应先补 cell 再写 Feature
- 架构图源文件统一存放于 `assets/`，禁止散落在外部目录
- 禁止硬编码绝对路径，跨文档引用统一使用 `[doc:architecture/xxx.md]` 格式

---

## 延伸阅读

- `[doc:arch.md]` — 架构索引（顶层）
- `[doc:VISION.md]` — 万物灵智体愿景
- `[doc:decisions/README.md]` — ADR 架构决策记录
