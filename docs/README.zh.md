# 文档总入口（中文）

[English](README.md) | 中文

> **文档编号**：README.zh.md（v1.0）
> **最近修订**：2026-08-17
> **用途**：给第一次进入本仓库的人，用最直白的话讲清 `docs/` 里都有什么、该先看哪份。

---

## 一句话先搞懂：现在有两个"栈"

FlowForge 正在从 **Python 单体** 重写成 **TypeScript（pnpm monorepo + Cordis 插件内核）**。所以文档也分两套，请先看清楚你面对的是哪一套：

- 🟦 **新 TS 重写（进行中，最重要）** → 全部在 [`refactor/`](refactor/) 目录。写新 TS 代码、加插件、改架构，**优先看这里**：
  - [`refactor/00-overview.md`](refactor/00-overview.md) — 总览：目标、核心决策、目标架构、阶段总览
  - [`refactor/10-stage-map.md`](refactor/10-stage-map.md) — 阶段地图 + 功能全集矩阵（D/C/F 三源能力勾选表）
  - [`refactor/04-code-standards.md`](refactor/04-code-standards.md) — **每次改代码前必读**的合并编码规范
  - [`refactor/01-stack-decision.md`](refactor/01-stack-decision.md) — 技术栈决策（R01–R21）
- 🟥 **Python 旧版（正在日落）** → `spec.md` / `arch.md` / `design.md` 以及 `architecture/`、`design/`、`features/`、`decisions/`。它们描述**当前还能跑的 Python 单体**，是"行为基线 / 黄金参考"，不是新 TS 的蓝本。新 TS 工作不要复制它们，用 `[doc:...]` 交叉引用即可。
- Python 按 [`refactor/31-stage11-sunset.md`](refactor/31-stage11-sunset.md) 在功能齐平后 冻结→归档→删除。双栈隔离：`/api/v1`=Python、`/api/v2`=TS，数据库物理隔离。

---

## 顶层文档地图（先看哪个？）

| 文档 | 是干什么的 | 属于哪套 |
|------|-----------|:--------:|
| [VISION.md](VISION.md) | 可进化智能体愿景（operator 通用智能体愿景） | 通用 |
| [ROADMAP.md](ROADMAP.md) | 阶段路线图 | 通用 |
| [SOP.md](SOP.md) | 可进化智能体协作标准流程 | 通用 |
| [TIPS.md](TIPS.md) | 经验提示与陷阱清单 | 通用 |
| [roleagent.md](roleagent.md) | 七大工程路径镜像 | 通用 |
| [task.md](task.md) | 生态移植任务总览（11 阶段里程碑） | 通用 |
| [spec.md](spec.md) | 需求规格说明书（SRS，Python 旧版，已索引化） | 🟥 Python |
| [arch.md](arch.md) | 架构设计说明书（SAD，Python 旧版，已索引化） | 🟥 Python |
| [design.md](design.md) | 详细设计说明书（SDD，Python 旧版，已索引化） | 🟥 Python |
| [test.md](test.md) | 测试规范导航 + Test Feature 索引（19 份 T0XX） | 通用 |
| [DEPLOY.md](DEPLOY.md) | 外部开发者部署指南 | 通用 |
| [AGENTS.md](AGENTS.md) | **写文档/AI 生成文档的规则手册（改 docs 前必读）** | 通用 |

---

## 子目录地图

| 子目录 | 干什么的 | 属于哪套 |
|--------|---------|:--------:|
| [refactor/](refactor/) | **TS 重写计划（活规范）**——新 TS 工作的首要依据 | 🟦 TS |
| [architecture/](architecture/) | 架构文档（七层 + forgemind 应用层），Python-era SAD 拆分 | 🟥 Python |
| [design/](design/) | 详细设计（命名契约 + 44 份 Feature 级 SDD），Python-era | 🟥 Python |
| [features/](features/) | Feature 规格（每 Feature 一文件 F001–F046），Python-era SRS 拆分 | 🟥 Python |
| [decisions/](decisions/) | 架构决策记录 ADR（13 份核心），Python-era | 🟥 Python |
| [review/](review/) | 审核追溯索引（RA/FM/FR/CL 命名空间） | 通用 |
| [rules/](rules/) | 开发/AI 行为红线规范（8 份） | 通用 |
| [prompts/](prompts/) | AI 工具提示词模板 | 通用 |
| [test/](test/) | Test Feature 规格（19 份 T0XX + bugs） | 通用 |
| [perspectives/](perspectives/) | 视角文档 | 通用 |
| [harness-feedback/](harness-feedback/) | Harness 评估反馈 | 通用 |
| [setup/](setup/) | 环境搭建笔记（当前为空） | 通用 |

---

## 新手建议路线

1. 想懂"这是什么" → [VISION.md](VISION.md)
2. 想懂"现在在干嘛、往哪走" → [ROADMAP.md](ROADMAP.md) + [refactor/00-overview.md](refactor/00-overview.md)
3. 想动手写 TS → 先读 [refactor/04-code-standards.md](refactor/04-code-standards.md)，再按 [refactor/10-stage-map.md](refactor/10-stage-map.md) 找自己那阶段
4. 想看旧 Python 怎么实现 → [spec.md](spec.md) / [arch.md](arch.md) / [design.md](design.md) + 对应子目录
5. 想看历史决策 → [decisions/](decisions/)
6. 想看测试怎么写 → [test.md](test.md)

---

## 写文档的人必读

- 改任何 `docs/` 内容前，先读 [AGENTS.md](AGENTS.md)（文档编写规则）与 [rules/11-doc-layering.md](rules/11-doc-layering.md)（软件工程文档分层铁律）。
- 文档间引用统一用 `[doc:文件名#章节]` 格式。
- 面向用户的文档做成中英成对：英文 `xxx.md` + 中文 `xxx.zh.md`（本文与 `README.md` 即为一对）。
- 涉及 Git 远程操作一律走 `./mgr`，禁止 AI 直接绕过规范检查（见根目录 `AGENTS.md`）。
