# FlowForge 文档总入口

> **文档编号**: README.md（v1.0）
> **维护方式**: 灵智体可自我演进更新（按 `[doc:roleagent.md#第5章]` Eval 自代谢机制）
> **依赖引用**: 13 份外部文档（详见 `[doc:review/review.md#1.1.3]`）

---

## 1. 这是什么

FlowForge 是一个**灵智体锻造厂**——用自进化的核心框架，把灵智锻造进万事万物，构建物理 AI 与虚拟 AI 真实复现的万物灵智体世界。详见 `[VISION.md]`。

文档目录按 `[doc:clowder-ai/docs/]` 结构组织，便于灵智体增量维护每个 Feature / ADR / 架构视图，达成"自己开发自己"。

---

## 2. 顶层文档导航

| 文档 | 用途 | 状态 |
|------|------|:----:|
| [VISION.md](VISION.md) | 万物灵智体愿景声明（operator 通用 AGI 愿景） | ✅ v1.0 |
| [ROADMAP.md](ROADMAP.md) | 6 阶段路线图（Phase 0-6） | ✅ v1.0 |
| [SOP.md](SOP.md) | 灵智体协作标准操作流程 | ✅ v1.0 |
| [TIPS.md](TIPS.md) | 经验提示与陷阱清单 | ✅ v1.0 |
| [roleagent.md](roleagent.md) | roleagent.md 工程路径镜像（Cat Café 七章） | ✅ 镜像 |
| [design-system.md](design-system.md) | 设计系统规范 | ⏳ Phase 1 |
| [public-lessons.md](public-lessons.md) | 公开教训（来自 clowder-ai） | ⏳ Phase 1 |
| [spec.md](spec.md) | v7.0 主规格书（保留为索引，详细内容已拆分到 features/） | 🔄 索引化 |
| [arch.md](arch.md) | v7.0 架构文档（保留为索引，详细内容已拆分到 architecture/） | 🔄 索引化 |
| [design.md](design.md) | v7.0 详细设计（保留为索引，详细内容已拆分到 design/ + features/） | 🔄 索引化 |
| [task.md](task.md) | Phase 0-6 分阶段任务清单 | ✅ v1.0 |
| [test.md](test.md) | 测试规范 | 🔄 待更新 |

---

## 3. 七大子目录导航

| 子目录 | 用途 | 关键文件 |
|--------|------|---------|
| [architecture/](architecture/) | 架构文档（七层架构 + forgemind 应用层 + ownership/） | `README.md` / `2026-07-17-architecture-views.md` |
| [decisions/](decisions/) | 架构决策记录 ADR（13 份核心 ADR） | `004-capability-profile-routing.md` / `005-forgemind-application-layer.md` / `006-external-agent-integration.md` / `013-all-things-spirit-mind-vision.md` |
| [design/](design/) | 设计规范（命名契约 + forgemind 品牌 + 控制台） | `naming-contract.md` / `forgemind-brand.md` |
| [features/](features/) | Feature 规格（每 Feature 一文件，F001-F040+） | `TEMPLATE.md` / `F001-capability-profile.md` / `F026-forgemind-app-layer.md` / `F031-external-agent-adapter.md` |
| [harness-feedback/](harness-feedback/) | Harness Eval 反馈（bundles + eval-domains + verdicts） | `README.md` |
| [perspectives/](perspectives/) | 视角文档（operator / 架构师 / 灵智体 / 三方厂商） | `README.md` |
| [setup/](setup/) | 部署配置 | `README.md` |

---

## 4. 审核与历史

| 子目录 | 用途 |
|--------|------|
| [review/](review/) | 16 份审核文件（12 份专家原始 + 4 份归并），终稿 `review.md` v1.2 |
| [face/](face/) | face v3.0 文档（保留为 v7.0 Phase 0 历史快照） |
| [archive/](archive/) | 归档文档（legacy_design / reviews / empty_stubs） |

---

## 5. 文档自我演进规则

> 依据: `[doc:roleagent.md#第5章]` Eval 自代谢 + `[doc:review/review.md#12.3]` 自我演进三层架构

1. **每个 Feature 一个文件**：Feature 文件 < 50KB，灵智体可在单次任务中完整重写
2. **每个 ADR 不可变历史**：决策变更通过新增 ADR 引用旧 ADR，不修改旧 ADR
3. **真相源唯一**：每个概念只有一个真相源文件，其他文件用 `[doc:文件名#章节]` 引用
4. **Eval 驱动更新**：文档更新必须由 Eval 信号触发（如 Feature 完成后自动更新状态）
5. **operator 愿景锚点不可改**：VISION.md §7 的 7 条原则不能被灵智体修改

---

## 6. 引用约定

文档间引用使用 `[doc:文件名#章节]` 格式：

- `[doc:roleagent.md#第3章]` — 引用 roleagent.md 第 3 章
- `[doc:review/review.md#第八章]` — 引用 review.md 第八章
- `[doc:decisions/004-capability-profile-routing.md]` — 引用 ADR 004
- `[doc:features/F001-capability-profile.md#验收标准]` — 引用 F001 的验收标准章节
- `[doc:rules.md#T7]` — 引用 hiclaw/rules.md 测试铁律 T7
- `[doc:project_rules.md#红线10]` — 引用 .trae/rules/project_rules.md 编程红线第 10 条

---

## 7. 快速开始

- **想理解愿景**：读 [VISION.md](VISION.md)
- **想了解路线**：读 [ROADMAP.md](ROADMAP.md)
- **想理解工程路径**：读 [roleagent.md](roleagent.md)
- **想看审核意见**：读 [review/review.md](review/review.md)（v1.2 终稿，340 项问题）
- **想看具体任务**：读 [task.md](task.md)（Phase 0-6）
- **想看灵智体协作流程**：读 [SOP.md](SOP.md)
- **想看核心架构**：读 [architecture/README.md](architecture/README.md)
- **想看关键决策**：读 [decisions/](decisions/)
