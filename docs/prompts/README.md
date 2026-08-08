# prompts/ 子目录索引

> **本目录内容**：FlowForge 生态项目提示词模板库，从原 `hiclaw/prompts.md`（194KB）拆分而来
> **拆分日期**：2026-07-19
> **拆分依据**：参照 `flowforge/docs/design/` 子目录拆分模式
> **文件大小约束**：单文件 ≤ 50KB

---

## 📁 文件清单

### 索引与规范

| 文件 | 内容 | 大小 |
|------|------|------|
| [README.md](README.md) | 本索引文件 | - |
| [TEMPLATE.md](TEMPLATE.md) | 模板创建规范指南 | - |

### 公共模板

| 文件 | 模板范围 | 大小 |
|------|---------|------|
| [P-common.md](P-common.md) | 公共模板 P1-P40 + 高级模板 A1-A12 | 47.12 KB |
| [P-v7.md](P-v7.md) | v7.0 增补模板 P41-P50（可进化智能体锻造） | 35.18 KB |
| [P-methodology.md](P-methodology.md) | v7.1 方法论模板 P51-P58（SRS/SAD/SDD + 防偏检查 + 完成度检查 + 方法论抽象 + subagent 编排） | 17.15 KB |
| [LLM-review.md](LLM-review.md) | LLM 内容审核与 Web 功能验证方法论 V1-V6 + T9 运行时数据校验 | 20.13 KB |

### 项目专用模板

| 文件 | 项目 | 模板范围 | 大小 |
|------|------|---------|------|
| [FF-flowforge.md](FF-flowforge.md) | FlowForge | FF1-FF26 + v7.0 增补 FF22-FF23 | 31.48 KB |
| [CF-contentforge.md](CF-contentforge.md) | ContentForge | CF1-CF13 | 7.40 KB |
| [DF-devforge.md](DF-devforge.md) | DevForge | DF1-DF6 | 2.93 KB |
| [NF-novelforge.md](NF-novelforge.md) | NovelForge | NF1-NF8 | 3.83 KB |
| [MF-mallforge.md](MF-mallforge.md) | MallForge | MF1-MF8 | 3.13 KB |
| [OR-openroute.md](OR-openroute.md) | OpenRoute | OR1-OR9（OR3 缺失） | 3.29 KB |
| [OS-opensieve.md](OS-opensieve.md) | OpenSieve | OS1-OS16 | 8.05 KB |
| [HL-hiclaw.md](HL-hiclaw.md) | HicLaw | HL1-HL6 | 2.84 KB |
| [SF-stockforge.md](SF-stockforge.md) | StockForge | SF1-SF5 | 3.75 KB |

### 追问纠偏

| 文件 | 模板范围 | 大小 |
|------|---------|------|
| [Q-followup.md](Q-followup.md) | 追问与纠偏模板 Q1-Q8 | 4.00 KB |

---

## 📊 模板编号总览

### 编号前缀说明

| 前缀 | 范围 | 含义 | 文件位置 |
|------|------|------|---------|
| P | P1-P40 | 公共模板（跨项目通用） | P-common.md |
| P | P41-P50 | v7.0 增补模板（可进化智能体锻造） | P-v7.md |
| P | P51-P58 | v7.1 增补模板（软件工程文档开发） | P-methodology.md |
| A | A1-A12 | 高级提示词模板（AI编程最佳实践） | P-common.md |
| FF | FF1-FF26 | FlowForge 专用 | FF-flowforge.md |
| CF | CF1-CF13 | ContentForge 专用 | CF-contentforge.md |
| DF | DF1-DF6 | DevForge 专用 | DF-devforge.md |
| NF | NF1-NF8 | NovelForge 专用 | NF-novelforge.md |
| MF | MF1-MF8 | MallForge 专用 | MF-mallforge.md |
| OR | OR1-OR9 | OpenRoute 专用（OR3 缺失） | OR-openroute.md |
| OS | OS1-OS16 | OpenSieve 专用 | OS-opensieve.md |
| HL | HL1-HL6 | HicLaw 专用 | HL-hiclaw.md |
| SF | SF1-SF5 | StockForge 专用 | SF-stockforge.md |
| Q | Q1-Q8 | 追问与纠偏模板 | Q-followup.md |
| V | V1-V6 | LLM 审核方法论 | LLM-review.md |
| T | T1-T9 | 测试铁律 | 详见 `rules/test-iron-rules.md` |

---

## 🔍 使用指南

### 选择模板

1. **跨项目通用任务** → 查阅 `P-common.md`（P1-P40 + A1-A12）
2. **v7.0 可进化智能体相关** → 查阅 `P-v7.md`（P41-P50）
3. **软件工程文档开发** → 查阅 `P-methodology.md`（P51-P58）
4. **LLM 审核与 DOM 验证** → 查阅 `LLM-review.md`（V1-V6 + T9）
5. **项目专用功能验证** → 查阅对应项目的 `<前缀>-<项目>.md`

### 引用约定

- 引用本目录模板时使用 `[prompt:prompts/PXX-xxx.md]` 格式
- 引用具体模板编号时使用 `[prompt:P8A]` 或 `[prompt:FF20]` 格式
- 顶层 `prompts.md` 仅作为索引，不重复模板内容

### 术语规范

- **官方名称优先**：技术文档中应使用 AI 业界官方术语（如"智能体"、"Evolvable Agent"）
- **别名辅助说明**：项目内部别名（如"灵智系列"、"可进化智能体"）仅用于社交讨论场景
- **"万物"弱化**：原 v7.0 中"万物可进化智能体"已弱化为"多形态可进化智能体"或"可进化智能体"

---

## ⚠️ 重要约束

1. **单文件 ≤ 50KB**：新增模板时如超出，需进一步拆分
2. **模板完整性**：拆分后的模板内容必须完整保留，禁止删减
3. **过程记录归档**：修改记录、版本变迁说明、修订日志不放在模板文件中
4. **术语规范**：禁止使用"万物"原说法，统一弱化为"可进化智能体"
5. **编号唯一性**：同一前缀下编号不可重复（已知 P19 和 FF22/FF23 存在编号冲突，已在文件内标注）

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
| `hiclaw/prompts.md` | **顶层索引**：本目录的索引文件 |
| `flowforge/docs/design/naming-contract.md` | **术语权威**：12 核心概念命名表（v2.0） |
| `flowforge/docs/design/` | **拆分参照**：本目录的拆分方法参照此模式 |
