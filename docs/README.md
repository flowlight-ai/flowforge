# FlowForge 文档总入口

> **文档编号**: README.md（v1.3）
> **最近修订**: 2026-07-21（v1.3：移除对 gitignored 文件的死链；同步文档体系净化）
> **维护方式**: 可进化智能体可自我演进更新（按 `[doc:roleagent.md#第5章]` Eval 自代谢机制）
> **依赖引用**: 13 份外部文档（详见 `[doc:review/review.md#1.1.3]`）

---

## 工程规范（9 仓库统一）

| 文档 | 说明 |
|------|------|
| [git-workflow.md](./git-workflow.md) | Git 工作流规范：仅主干开发（Gitee=master / GitHub=main）、PR 合入、提交署名 |
| [dev-spec.md](./dev-spec.md) | 工程通用规范：测试交付三件套、测试铁律 T1-T9、编程红线 15 条 |

## 1. 这是什么

FlowForge 是一个**可进化智能体锻造厂**（Persistent Identity Agent Framework，项目代号 ForgeMind，社区社交称"通用智能体框架"）——用自进化的核心框架，给各类实体锻造可进化智能体（Evolvable Agent，项目代号 Forgekin，社区社交称"可进化智能体"），构建具身智能（Embodied AI）与虚拟角色智能体（Character AI）工程落地的可进化智能体生态。详见 [VISION.md](VISION.md)。

文档目录按标准软件工程文档结构组织，便于可进化智能体增量维护每个 Feature / ADR / 架构视图，达成"自己开发自己"。

---

## 2. 顶层文档导航

| 文档 | 用途 | 状态 |
|------|------|:----:|
| [VISION.md](VISION.md) | 可进化智能体愿景声明（operator 通用智能体愿景） | ✅ v1.2 |
| [ROADMAP.md](ROADMAP.md) | 阶段路线图 | ✅ v1.1 |
| [SOP.md](SOP.md) | 可进化智能体协作标准操作流程 | ✅ v1.1 |
| [TIPS.md](TIPS.md) | 经验提示与陷阱清单 | ✅ v1.1 |
| [roleagent.md](roleagent.md) | roleagent.md 工程路径镜像（七大工程路径） | ✅ v1.1 镜像 |
| [spec.md](spec.md) | 需求规格说明书（SRS，保留为索引，详细内容已拆分到 features/） | 🔄 索引化 |
| [arch.md](arch.md) | 架构设计说明书（SAD，保留为索引，详细内容已拆分到 architecture/） | 🔄 索引化 |
| [design.md](design.md) | 详细设计说明书（SDD，保留为索引，详细内容已拆分到 design/ + features/） | 🔄 索引化 |
| [test.md](test.md) | 测试规范导航 + Test Feature 索引（19 份 T0XX） | ✅ v2.0 |

---

## 3. 六大子目录导航

| 子目录 | 用途 | 关键文件 |
|--------|------|---------|
| [architecture/](architecture/) | 架构文档（七层架构 + forgemind 应用层） | `README.md` / `A026-forgemind-app-layer.md` / `A036-forgemind-forge-relationship.md` |
| [decisions/](decisions/) | 架构决策记录 ADR（13 份核心 ADR） | `004-capability-profile-routing.md` / `005-forgemind-application-layer.md` / `006-external-agent-integration.md` / `013-all-things-spirit-mind-vision.md` |
| [design/](design/) | 详细设计（命名契约 + 44 份 Feature 级 SDD） | `naming-contract.md` / `D001-capability-profile.md` / `D026-forgemind-app-layer.md` |
| [features/](features/) | Feature 规格（每 Feature 一文件，F001-F046） | `TEMPLATE.md` / `F001-capability-profile.md` / `F026-forgemind-app-layer.md` / `F031-external-agent-adapter.md` |
| [review/](review/) | 审核追溯索引（RA/FM/FR/CL 命名空间导航） | `review.md` |
| [test/](test/) | Test Feature 规格（19 份 T0XX + TEMPLATE + README） | `TEMPLATE.md` / `T001-test-ironrules.md` / `T002-test-strategy.md` |

---

## 4. 文档自我演进规则

> 依据: `[doc:roleagent.md#第5章]` Eval 自代谢 + `[doc:review/review.md#12.3]` 自我演进三层架构

1. **每个 Feature 一个文件**：Feature 文件 < 50KB，可进化智能体可在单次任务中完整重写
2. **每个 ADR 不可变历史**：决策变更通过新增 ADR 引用旧 ADR，不修改旧 ADR
3. **真相源唯一**：每个概念只有一个真相源文件，其他文件用 `[doc:文件名#章节]` 引用
4. **Eval 驱动更新**：文档更新必须由 Eval 信号触发（如 Feature 完成后自动更新状态）
5. **operator 愿景锚点不可改**：VISION.md §7 的 7 条原则不能被可进化智能体修改

---

## 5. 引用约定

文档间引用使用 `[doc:文件名#章节]` 格式：

- `[doc:roleagent.md#第3章]` — 引用 roleagent.md 第 3 章
- `[doc:review/review.md#第八章]` — 引用 review.md 第八章
- `[doc:decisions/004-capability-profile-routing.md]` — 引用 ADR 004
- `[doc:features/F001-capability-profile.md#验收标准]` — 引用 F001 的验收标准章节
- `[doc:rules.md#T7]` — 引用 CONTRIBUTING.md 测试铁律 T7
- `[doc:project_rules.md#红线10]` — 引用 .trae/rules/project_rules.md 编程红线第 10 条

---

## 6. 快速开始

- **想理解愿景**：读 [VISION.md](VISION.md)
- **想了解路线**：读 [ROADMAP.md](ROADMAP.md)
- **想理解工程路径**：读 [roleagent.md](roleagent.md)
- **想看审核意见**：读 [review/review.md](review/review.md)（审核追溯索引）
- **想看可进化智能体协作流程**：读 [SOP.md](SOP.md)
- **想看经验提示**：读 [TIPS.md](TIPS.md)
- **想看需求规格**：读 [spec.md](spec.md)（SRS 顶层索引）
- **想看核心架构**：读 [arch.md](arch.md) + [architecture/README.md](architecture/README.md)
- **想看详细设计**：读 [design.md](design.md) + [design/README.md](design/README.md)
- **想看关键决策**：读 [decisions/](decisions/)
- **想看测试规范**：读 [test.md](test.md)（v2.0 索引 + 19 份 T0XX）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-17 | v1.0 | 初版：FlowForge 文档总入口 | 鲁班（猫头鹰 Owl） |
| 2026-07-19 | v1.1 | 新增 test.md v2.0 条目；移除 design-system.md / public-lessons.md 死链 | 鲁班（猫头鹰 Owl） |
| 2026-07-19 | v1.2 | 补全 test/ 子目录导航；新增 _archive/ 子目录条目；同步 SOP.md / TIPS.md 版本状态至 v1.1 | 鲁班（猫头鹰 Owl） |
| 2026-07-21 | v1.3 | 移除对内部文档（task.md / _archive / harness-feedback / perspectives / setup）的死链；六大子目录导航聚焦公开文档 | 架构师可进化智能体 |
