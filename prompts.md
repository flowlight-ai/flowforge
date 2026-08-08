# FlowForge 生态项目 — AI 编程工具提示词模板库（索引）

> **用途**：与 AI 编程工具（Trae CN、Cursor、CC等）协作时的结构化提示词模板。按项目分类，可直接套用或按需修改。
> **原则**：真实数据、真实调用、禁止 Mock、禁止偷工减料、发现未实现即 Bug。
> **本文件**：仅作为索引，所有模板已拆分到 `prompts/` 子目录。

---

## 📁 模板文件索引

> 完整索引详见 [prompts/README.md](prompts/README.md)
> 模板创建规范详见 [prompts/TEMPLATE.md](prompts/TEMPLATE.md)

### 公共模板（跨项目通用）

| 文件 | 模板范围 | 内容说明 |
|------|---------|---------|
| [prompts/P-common.md](prompts/P-common.md) | P1-P40 + A1-A12 | 公共模板 + 高级提示词模板（AI编程最佳实践） |
| [prompts/P-v7.md](prompts/P-v7.md) | P41-P50 | v7.0 增补模板（可进化智能体锻造） |
| [prompts/P-methodology.md](prompts/P-methodology.md) | P51-P58 | v7.1 方法论模板（SRS/SAD/SDD + 防偏检查 + 完成度检查 + 方法论抽象 + subagent 编排） |
| [prompts/LLM-review.md](prompts/LLM-review.md) | V1-V6 + T9 | LLM 内容审核与 Web 功能验证方法论 + 运行时数据文件存放校验 |

### 项目专用模板

| 文件 | 项目 | 模板范围 |
|------|------|---------|
| [prompts/FF-flowforge.md](prompts/FF-flowforge.md) | FlowForge | FF1-FF26 + v7.0 增补 FF22-FF23 |
| [prompts/CF-contentforge.md](prompts/CF-contentforge.md) | ContentForge | CF1-CF13 |
| [prompts/DF-devforge.md](prompts/DF-devforge.md) | DevForge | DF1-DF6 |
| [prompts/NF-novelforge.md](prompts/NF-novelforge.md) | NovelForge | NF1-NF8 |
| [prompts/MF-mallforge.md](prompts/MF-mallforge.md) | MallForge | MF1-MF8 |
| [prompts/OR-openroute.md](prompts/OR-openroute.md) | OpenRoute | OR1-OR9（OR3 缺失） |
| [prompts/OS-opensieve.md](prompts/OS-opensieve.md) | OpenSieve | OS1-OS16 |
| [prompts/HL-hiclaw.md](prompts/HL-hiclaw.md) | HicLaw | HL1-HL6 |
| [prompts/SF-stockforge.md](prompts/SF-stockforge.md) | StockForge | SF1-SF5 |

### 追问纠偏

| 文件 | 模板范围 |
|------|---------|
| [prompts/Q-followup.md](prompts/Q-followup.md) | Q1-Q8 |

---

## 📊 模板编号总览

| 前缀 | 范围 | 含义 |
|------|------|------|
| P | P1-P58 | 公共模板（P1-P40 通用 + P41-P50 v7.0 增补 + P51-P58 v7.1 方法论） |
| A | A1-A12 | 高级提示词模板（AI编程最佳实践） |
| FF | FF1-FF26 | FlowForge 专用 |
| CF | CF1-CF13 | ContentForge 专用 |
| DF | DF1-DF6 | DevForge 专用 |
| NF | NF1-NF8 | NovelForge 专用 |
| MF | MF1-MF8 | MallForge 专用 |
| OR | OR1-OR9 | OpenRoute 专用（OR3 缺失） |
| OS | OS1-OS16 | OpenSieve 专用 |
| HL | HL1-HL6 | HicLaw 专用 |
| SF | SF1-SF5 | StockForge 专用 |
| Q | Q1-Q8 | 追问与纠偏模板 |
| V | V1-V6 | LLM 审核方法论 |
| T | T1-T9 | 测试铁律（详见 `rules/test-iron-rules.md`） |

---

## 📖 高频模板速查

### 公共高频模板

| 编号 | 用途 | 文件 |
|------|------|------|
| P5 | 全量回归验证 | prompts/P-common.md |
| P6 | 测试质量检查 | prompts/P-common.md |
| P7 | 测试铁律自检（T1-T8） | prompts/P-common.md |
| P8A | FlowForge 与 *Forge 架构边界验证（核心铁律） | prompts/P-common.md |
| P10 | 未实现功能审查 | prompts/P-common.md |
| P14A | 代码全量扫描（逐文件逐行审计） | prompts/P-common.md |
| P16 | 提示词外置验证 | prompts/P-common.md |
| P31 | Loop 执行流程强制验证 | prompts/P-common.md |
| P32 | 修复过程变更安全验证 | prompts/P-common.md |
| P33 | 质量分与评审配置验证 | prompts/P-common.md |
| P34 | 禁止事项清单（15条红线） | prompts/P-common.md |
| P35 | 长程任务执行规范 | prompts/P-common.md |

### 项目高频模板

| 项目 | 编号 | 用途 |
|------|------|------|
| FlowForge | FF20 | Loop 执行器集成验证 |
| FlowForge | FF21 | SSE 协议契约验证 |
| ContentForge | CF10 | Content 集成验证 |
| DevForge | DF1 | 开发全流程验证 |
| NovelForge | NF1 | 小说创作全流程验证 |
| HicLaw | HL6 | 测试性能与稳定性验证 |

---

## 🔍 使用原则

1. **先读后写**：使用提示词前先阅读相关设计文档和代码
2. **真实验证**：所有验证必须使用真实数据和真实环境
3. **禁止 Mock**：测试铁律 9 条（T1-T9），违反即无效（详见 `rules/test-iron-rules.md`）
4. **渐进实施**：大型任务分步进行，每步可验证
5. **文档同步**：代码变更后同步更新设计文档

---

## 🧭 审计优先级指南

1. **首次审计**：先执行 P14A（代码全量扫描），这是最严格的逐文件扫描，能发现最多问题
2. **架构边界**：执行 P8A（FlowForge 与 *Forge 架构边界验证），这是核心铁律
3. **测试质量**：执行 P7（测试铁律自检 T1-T8）+ P6（测试质量检查）
4. **Loop 流程**：执行 P31（Loop 执行流程强制验证）
5. **变更安全**：执行 P32（修复过程变更安全验证）

---

## ⚠️ 重要约束

1. **单文件 ≤ 50KB**：拆分后每个文件大小约束
2. **顶层文件仅作索引**：本文件不重复模板内容
3. **模板完整性**：拆分后的模板内容必须完整保留
4. **过程记录归档**：修改记录、版本变迁说明、修订日志不放在模板文件中
5. **术语规范**：禁止使用"万物"原说法，统一弱化为"可进化智能体"

---

## 📝 已知问题

| 问题 | 说明 | 处理方式 |
|------|------|---------|
| P19 编号冲突 | 公共模板 P19 出现两次（"插件注册完整性" vs "提示词外置全量验证"） | 在 P-common.md 中标注，未删除任一方 |
| FF22/FF23 编号冲突 | 修复经验类 FF22-FF26 与 v7.0 增补 FF22-FF23 编号冲突 | 在 FF-flowforge.md 中标注，未删除任一方 |
| OR3 缺失 | 原 prompts.md 中 OR3 编号缺失 | 在 OR-openroute.md 中标注，保留空缺 |

---

## 🔄 与其他规范的关系

| 文档 | 关系 |
|------|------|
| `hiclaw/rules.md` | **必读**：开发规范与 AI 编程实践 |
| `flowforge/docs/design/naming-contract.md` | **术语权威**：12 核心概念命名表（v2.0） |
| `flowforge/docs/design/` | **拆分参照**：本目录的拆分方法参照此模式 |

---

## 📐 拆分历史

- **拆分日期**：2026-07-19
- **拆分前大小**：194 KB（~4430 行）
- **拆分依据**：参照 `flowforge/docs/design/` 子目录拆分模式
- **拆分后文件数**：14 个模板文件 + 1 个 README + 1 个 TEMPLATE
- **拆分约束**：单文件 ≤ 50KB，模板内容完整保留
