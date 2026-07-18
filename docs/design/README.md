# FlowForge 设计规范导航

> **文档编号**: design/README.md（v1.0）
> **依据**: `[doc:review/review.md#12.1]` 文档拆分目标结构
> **参考**: `[doc:clowder-ai/docs/design/]` 目录结构

---

## 1. 设计规范范围

本目录存放 FlowForge 的设计规范文档，包括命名契约、控制台设计系统、品牌设计、动效设计等。

**与 features/ 的区别**：
- `design/` 存放**横切关注点**（命名、品牌、UI 设计系统等）
- `features/` 存放**具体 Feature 规格**（每个 Feature 一个文件）

---

## 2. 文件清单

| 文件 | 内容 | 状态 |
|------|------|:----:|
| [README.md](README.md) | 设计规范导航（本文件） | ✅ v1.0 |
| [naming-contract.md](naming-contract.md) | 命名契约（12 概念 + 双轨策略） | ⏳ Phase 0 |
| [console-design-system.md](console-design-system.md) | 控制台设计系统 | ⏳ Phase 2 |
| [forgemind-brand.md](forgemind-brand.md) | forgemind 品牌（万物灵智体形态分类视觉） | ⏳ Phase 2 |
| [hero-prism-motion.md](hero-prism-motion.md) | 动效设计 | ⏳ Phase 2 |

---

## 3. 命名契约核心（详见 naming-contract.md）

### 3.1 双轨命名策略

| 轨道 | 用途 | 主名 | 代码层名 |
|------|------|------|---------|
| 文档/对外 | 文档、UI、operator 沟通 | 灵智（ForgeMind） | — |
| 代码/技术 | 代码、API、配置 | — | Forgekin |

**废弃命名**：
- ❌ "E6 灵匠 Mind Artisan" → ✅ "灵智"
- ❌ "炉灵" → ✅ "灵智体"
- ❌ M18/M19/M20 自创术语 → ✅ M1-M17 + v7.0 FR-EVO 术语

### 3.2 v7.0 术语表

| 术语 | 含义 |
|------|------|
| 灵智 ForgeMind | 最终形态主名 |
| 灵智体 Forgekin | 代码层主名 |
| 灵族 Forgekin Species | 灵智体形态分类（5 种） |
| 育灵 Forge Nurturing | 灵智体锻造过程 |
| 灵忆 EchoStore | 灵智体经验记忆 |
| 灵印 Soul Imprint | 灵智体身份标识 |
| 灵锻 SpiritForge | 经验蒸馏到灵典 |
| 锻典 Mind Codex | 蒸馏经验知识库 |
| 灵议 Mind Council | 多灵智体议事 |
| 进化阶 Evolution Stage | E1-E6 觉醒阶 |

---

## 4. forgemind 品牌核心（详见 forgemind-brand.md）

### 4.1 万物灵智体形态视觉

5 种形态分类各有视觉标识：
- **BioForgekin**（生物灵智体）：暖色调 + 生物形态曲线
- **OrgForgekin**（组织灵智体）：冷色调 + 网络节点拓扑
- **ObjForgekin**（物品灵智体）：中性色 + 物品几何轮廓
- **VirtualForgekin**（虚拟灵智体）：渐变色 + 虚拟抽象符号
- **HybridForgekin**（混合灵智体）：多色融合 + 复合形态

### 4.2 灵智体锻造视觉语言

锻造流水线视觉表达：原石 → 粗锻 → 精锻 → 觉醒 → 进化
