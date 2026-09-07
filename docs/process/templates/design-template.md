# [需求/主题名] 设计文档（design-template）

> 用途：`design` 阶段产物，brainstorming（①）architectural 路径的落盘模板。
> 落点：`docs/process/specs/YYYY-MM-DD-<topic>-design.md`。
> 命名遵循 `docs/design/naming-contract.md`（官方 AI 概念名优先；涉及智能体区分静态/可进化）。

## 元信息

| 字段 | 值 |
|---|---|
| 流程实例名 | `<name>`（`ff_dev status <name>` 可查） |
| 工作流 | feature / greenfield / change / hotfix |
| 分级路径 | Spike / Bounded / Architectural（brainstorming ① 第一步的分级结果） |
| 操作者 | `<operator>` |
| 日期 | `YYYY-MM-DD` |

## 目标（Goal）

一句话说明本需求交付什么、为什么值得做。

## 架构（Architecture）

2-3 段：组件划分、数据流、与既有系统的关系。
greenfield 工作流此处即架构基座（12-doc-refactor-methodology 三阶段递进：SRS→SAD→SDD）。

## 技术栈（Tech Stack）

关键技术选型与理由（对齐 deepseek-harness/clowder-ai 既定栈，不引入新依赖需说明）。

## 规范引用（Spec Compliance）

- 编程红线：`docs/refactor/04-code-standards.md` §2.1
- 测试铁律：T1-T9（`docs/refactor/04-code-standards.md` §2.2）
- 文档分层：`docs/rules/11-doc-layering.md`（F/A/D 结构要求）
- Git 流程：`docs/mgr/`（mgr 命令族）

## 全局约束（Global Constraints）

规格级项目要求逐条列出（版本下限、依赖限制、命名与文案外置规则、平台要求）——
实施计划（②）的每个任务隐式继承本节，精确值照抄不得改写。

## 数据模型 / 接口设计

（按需）类型定义、接口签名、错误处理策略。代码块给出精确签名。

## 测试策略

TDD 红绿循环覆盖点、集成/E2E 范围（T1-T9 约束下不 Mock LLM 的验证路径）。

## 决策门记录

### DCP-1 需求/变更决策

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| business_value | 0.40 | 0.5 | | |
| feasibility | 0.35 | 0.6 | | |
| security | 0.25 | 0.7 | | |

加权总分 ___ / 阈值 0.65；security 为否决维。登记：`ff_dev gate <name> design --score ___ --evidence <本文件>`。

### DCP-2 方案决策（human_required）

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| feasibility | 0.50 | 0.6 | | |
| security | 0.30 | 0.7 | | |
| ux | 0.20 | 0.5 | | |

加权总分 ___ / 阈值 0.70；**操作者签核**（design→plan 硬门禁）：操作者 ___，日期 ___。

## 自审清单（落盘前）

- [ ] 占位符扫描：无 TBD/TODO/空节
- [ ] 内部一致性：各节术语、数值、路径互相一致
- [ ] 范围检查：单一主题，无需分解
- [ ] 歧义检查：任一需求不会有两种合理解读
