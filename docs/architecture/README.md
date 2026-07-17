# FlowForge 架构文档导航

> **文档编号**: architecture/README.md（v1.0）
> **依据**: `[doc:review/review.md#12.1]` 文档拆分目标结构 + `[doc:roleagent.md]` 七章工程路径
> **参考**: `[doc:clowder-ai/docs/architecture/]` 目录结构

---

## 1. 架构总览

FlowForge 采用**七层架构 + forgemind 应用层**设计：

```
应用层 (forgemind) — 万物灵智体应用实践（动物/组织/物品/虚拟/混合）
   ↓ 单向依赖
第 7 层：自进化层（ForgeMindEngine + 灵锻 SpiritForge + 灵议 Mind Council）
   ↓ 嵌入式升级（非独立层）
第 6 层：协作层（TeamAct 状态机 + 交接胶囊 + 路由协议）
第 5 层：能力画像层（CapabilityProfile + 动态路由 + 灵智体形态）
第 4 层：Harness 七层（Durable State / Tool / Evidence / Governance / 逃生舱 / Entropy / Harnessability）
第 3 层：记忆联邦层（多域记忆 + 三入口 + 消费加权 + 灵典 Mind Codex）
第 2 层：Eval 自代谢层（Eval Contract + 三方信号 + 七类归因 + Harness Eval 控制面）
第 1 层：可靠性层（Tier 1-4 恢复 + liveness 规范读 + 弱状态机）
   ↓ 单向依赖
核心层 (core/) — 共享内核（plugin / gate / context / memory / tracing）
```

**关键约束**：
- 上层可以依赖下层，下层**绝对禁止**导入上层模块（单向依赖铁律）
- forgemind 应用层通过 Plugin V3 协议注册到核心框架层
- 自进化层作为"Harness v2.0 升级"嵌入到第 6 层，**不是独立第 7 层**（解决 D-003 循环依赖）

---

## 2. 文件清单

| 文件 | 内容 | 状态 |
|------|------|:----:|
| [README.md](README.md) | 架构总览（本文件） | ✅ v1.0 |
| [2026-07-17-architecture-views.md](2026-07-17-architecture-views.md) | 架构视图（七层 + forgemind + 三方 Agent） | ⏳ Phase 1 |
| [at-mention-routing-system.md](at-mention-routing-system.md) | 行首 @ 路由协议（RA-013） | ⏳ Phase 1 |
| [cli-integration.md](cli-integration.md) | CLI 集成（三方 Agent） | ⏳ Phase 3 |
| [collaboration-landscape.md](collaboration-landscape.md) | 协作全景（TeamAct + 共鸣 + 灵议） | ⏳ Phase 1 |
| [feature-placement.md](feature-placement.md) | Feature 在七层架构中的归属 | ⏳ Phase 0 |
| [memory-system-overview.md](memory-system-overview.md) | 多域记忆联邦架构 | ⏳ Phase 1 |
| [retrieval-pipeline-deep-dive.md](retrieval-pipeline-deep-dive.md) | 检索流水线 | ⏳ Phase 1 |
| [user-journeys.md](user-journeys.md) | 用户旅程（万物灵智体锻造 → 育灵 → 进化） | ⏳ Phase 2 |
| [ownership/](ownership/) | 所有权矩阵（16 cells） | ⏳ Phase 5 |
| [assets/](assets/) | 架构图（PNG/SVG） | ⏳ Phase 1 |

---

## 3. 关键架构决策

以下架构决策已通过 ADR 固化，详见 `[doc:decisions/]`：

- **ADR 004**: 能力画像路由（CapabilityProfile + 动态路由）—— 对应第 5 层
- **ADR 005**: forgemind 应用层 —— 对应应用层
- **ADR 006**: 三方 Agent 集成 —— 对应第 4 层 + 第 5 层
- **ADR 007**: Harness 工程路径 —— 对应第 4 层
- **ADR 008**: 多域记忆联邦 —— 对应第 3 层
- **ADR 009**: Eval 自代谢 —— 对应第 2 层
- **ADR 010**: 分布式可靠性 —— 对应第 1 层
- **ADR 011**: 伙伴系统数学 —— 跨层
- **ADR 012**: 命名融合（ForgeMind 主名）—— 跨层
- **ADR 013**: 万物灵智体愿景 —— 应用层 + 全层

---

## 4. 架构不变量

以下不变量必须严格遵守，违反任一即架构腐化：

1. **单向依赖**：上层 → 下层，下层禁止 import 上层
2. **flowforge 禁止业务代码**：核心框架层不含任何特定领域业务逻辑（编程红线第 10 条）
3. **flowforge 禁止 import *Forge**：反向依赖零容忍
4. **ForgekinEngine 不绕过 Harness 护栏**：必须是装饰器，不是独立入口（D-004/D-005）
5. **治理规则走 system role**：禁止 user message prepend（压缩免疫层）
6. **forgemind 通过 Plugin V3 注册**：单向依赖，不能反向调用 flowforge 内部模块
7. **三方 Agent 通过 ExternalAgentAdapter 接入**：能力扩展，不是工具调用

---

## 5. 与 v6.0 架构的映射

| v6.0 层 | v7.0 层 | 变化 |
|---|---|---|
| 应用层（Gateway） | forgemind 应用层 | 新增万物灵智体应用实践 |
| 指挥中枢层（Brain） | 第 6 层 协作层 | 升级为 TeamAct 状态机 |
| 专家执行层（Workers） | 第 5 层 能力画像层 | 升级为 CapabilityProfile 动态路由 |
| 工具与记忆层 | 第 4 层 Harness + 第 3 层 记忆联邦 | 拆分 + 升级 |
| — | 第 2 层 Eval 自代谢 | **新增** |
| — | 第 1 层 可靠性 | **新增** |
| — | 第 7 层 自进化层 | **新增**（嵌入第 6 层，非独立） |
