# design 设计文档

> **目录作用**: 存放 FlowForge 详细设计文档，包括命名契约、控制台设计系统、forgemind 品牌视觉、动效设计等设计规范
> **维护规则**: 新增设计文档时同步更新 `[doc:design.md]` 索引与本 README 清单；术语命名必须对齐 `[doc:decisions/012-naming-fusion.md]` 项目正式术语表

---

## 文档清单

### 核心设计文档（4 份，待创建）

| 文档 | 名称 | 状态 |
|------|------|------|
| `naming-contract.md` | 命名契约（12 概念 + 双轨命名） | ⏳ |
| `console-design-system.md` | 控制台设计系统（UI/UX） | ⏳ |
| `forgemind-brand.md` | forgemind 品牌（万物灵智体形态视觉） | ⏳ |
| `hero-prism-motion.md` | 动效设计（灵智体锻造动效） | ⏳ |

### 设计资源（待补充）

| 资源 | 名称 | 状态 |
|------|------|------|
| `*.pen` | Penbook 设计稿（控制台布局等） | ⏳ |
| `assets/` | 设计资源目录（图标 / 字体 / 配色板） | ⏳ |

---

## 项目正式术语表（命名契约核心）

| 正式术语 | 英文类名 | 废弃术语 |
|----------|---------|---------|
| 灵智 ForgeMind | ForgeMindEngine | SelfEvolutionEngine |
| 灵智体 Forgekin | Forgekin | SelfEvolutionAgent |
| 育灵 ForgeNurturing | ForgeNurturing | Agent Lifecycle |
| 灵忆 EchoStore | EchoStore | MemoryGovernance |
| 灵印 SoulImprint | SoulImprint | Agent Profile |
| 灵锻 SpiritForge | SpiritForge | SelfEvolutionEngine |
| 锻典 MindCodex | MindCodex | Skill Library |
| 灵议 MindCouncil | MindCouncil | CollaborationGate |
| 进化阶 E1-E6 | EvolutionStage | Agent Maturity Level |

详见 `[doc:decisions/012-naming-fusion.md]`

---

## 维护规则

- 设计文档以语义化 slug 命名（如 `naming-contract.md`、`console-design-system.md`）
- 命名术语严格遵守项目正式术语表，禁止使用废弃术语（炉灵/E6 灵匠/M18/M19/M20 等）
- 设计稿源文件（`.pen`、`.fig`、`.sketch`）与导出资源（PNG/SVG）分离存放
- 视觉资产变更须同步更新 `[doc:design/forgemind-brand.md]` 中的色板/字体/图标清单
- 禁止硬编码绝对路径，跨文档引用统一使用 `[doc:design/xxx.md]` 格式
- 控制台设计系统变更须同步前端实现（`flowforge/web/`）

---

## 延伸阅读

- `[doc:design.md]` — 设计索引（顶层）
- `[doc:decisions/012-naming-fusion.md]` — 命名融合 ADR
- `[doc:decisions/005-forgemind-application-layer.md]` — forgemind 应用层 ADR
