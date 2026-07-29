# FlowForge Documentation

> FlowForge 是可进化智能体（Forgekin）自进化框架 — Agent 驾驭层（Harness Layer）的工程化实现，让 LLM-based Agent 从"会话级软件助手"进化为"有持久身份、可自我进化的可进化智能体（Forgekin）"。

---

## 文档总览

### 核心三件套

| 文档 | 内容 |
|------|------|
| [spec.md](./spec.md) | 全局规格说明 — FlowForge 做什么（核心概念 + 核心特性 + 设计原则） |
| [arch.md](./arch.md) | 全局架构设计 — FlowForge 如何组织（三层架构 + 模块组织 + Plugin 协议） |
| [design.md](./design.md) | 当前阶段设计 — FlowForge 如何实现（动态文档，描述当前正在做的） |

### 顶层文档

- [VISION.md](./VISION.md) — 可进化智能体愿景声明
- [roadmap.md](./roadmap.md) — 阶段路线图
- [SOP.md](./SOP.md) — 可进化智能体协作标准操作规程
- [TIPS.md](./TIPS.md) — 经验提示

### 子目录

- [decisions/](./decisions/) — Architecture Decision Records (ADRs)
- [features/](./features/) — Feature 规格文档（F001-F040）
- [architecture/](./architecture/) — 系统架构深入文档
- [design/](./design/) — 详细设计文档（命名契约 + 控制台设计 + forgemind 品牌）
- [harness-feedback/](./harness-feedback/) — Eval 反馈规范
- [perspectives/](./perspectives/) — 多视角文档
- [setup/](./setup/) — 部署/配置文档

---

## 文档演进规则

1. **新增 Feature**：复制 `features/TEMPLATE.md` 到 `features/F{NNN}-{slug}.md`
2. **新增 ADR**：参考 `decisions/` 现有 ADR 格式（NNN-slug.md，11 个标准段）
3. **术语对齐**：严格遵守 12 核心概念命名表（见 `spec.md` §2.1）
4. **跨文档引用**：使用相对路径（如 `[VISION.md#6](./VISION.md#6)`）
5. **路径铁律**：禁止硬编码绝对路径，必须使用 `${...}` 占位符，支持 Linux / Windows / macOS

---

## 核心概念快速导航

FlowForge 围绕"可进化智能体（Forgekin）"构建：

- **12 核心概念**：通用智能体框架 / 可进化智能体 / 智能体形态学 / 智能体入职与终身学习 / 情景记忆存储 / 持久身份 / 经验蒸馏 / 锻典 / 多智能体议事 / 进化阶 / 觉醒阶 / 能力画像（详见 `spec.md` §2.1）
- **5 形态分类**：生物 / 组织 / 物品 / 虚拟 / 混合（详见 `spec.md` §2.3）
- **三层 + 一扩展架构**：核心框架层 / forgemind 应用层 / *Forge 垂直业务层 / 三方 Agent 扩展层（详见 `arch.md` §1）

## 核心差异化

FlowForge 与主流 multi-agent 框架（AutoGen / CrewAI / LangGraph）的差异：

| 维度 | 主流 multi-agent | FlowForge |
|------|------------------|-----------|
| **主体** | Role（岗位槽位） | Profile（能力画像，长期主体） |
| **记忆** | 短期上下文窗口 | EchoStore（情景记忆）+ MindCodex（程序性记忆） |
| **进化** | 无 / 手动微调 | 三闭环自进化（Mode A/B/C）+ Eval 自代谢 |
| **协作** | 静态角色分配 | TeamAct 六步循环 + 跨厂商盲点补偿 |
| **治理** | Prompt 约束 | 六层 Guardrails + 觉醒阶自主范围 + 多智能体议事共识 |
| **形态** | 抽象 agent | 可进化智能体 5 形态 |
| **扩展** | Tool 调用 | 三方 Agent 能力扩展（ClaudeCode/Codex/OpenCode/Trae） |

详见 `spec.md` §1.3。

---

## 引用

- [spec.md](./spec.md) — 全局规格说明
- [arch.md](./arch.md) — 全局架构设计
- [design.md](./design.md) — 当前阶段设计
- [VISION.md](./VISION.md) — 可进化智能体愿景
- [.env.example](../.env.example) — 环境变量模板
- [config/system.yaml](../config/system.yaml) — 系统配置
