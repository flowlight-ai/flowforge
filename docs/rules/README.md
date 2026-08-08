# hiclaw/rules 文档索引

> **本目录**：`hiclaw/rules/` — `rules.md` 拆分后的子目录
> **顶层索引**：[doc:rules.md]（仅作导航，规范正文在本目录各文件中）
> **版本**：v3.4 终态（已移除 V7 文档开发过程记录）
> **最后更新**：2026-07-19

---

## 一、文档拆分背景

原 `hiclaw/rules.md` 为 92KB 超大文件，单次处理存在以下问题：
- AI 助手一次性 Read 8000+ 行容易丢失上下文
- 单文件难以并行 subagent 编排
- 不同章节使用频率差异大，但全部加载浪费资源

参照 `flowforge/docs/design/` 子目录模式，按章节拆分为多个 < 50KB 文件，便于：
- 按需引用（`[doc:rules/01-architecture-overview.md#1.2]`）
- 并行编排（不同 subagent 处理不同章节）
- 增量更新（只重写目标章节文件）

---

## 二、章节编号体系

| 编号 | 文件 | 章节标题 | 来源 |
|------|------|---------|------|
| 00 | [00-v7-supplement.md](00-v7-supplement.md) | 第零部分：v7.0 增补规范（可进化智能体体系） | rules.md §0.1-§0.11 |
| 01 | [01-architecture-overview.md](01-architecture-overview.md) | 第一部分：9 大项目架构总览 | rules.md 第一部分 |
| 02 | [02-core-architecture-principles.md](02-core-architecture-principles.md) | 第二部分：核心架构原则 | rules.md 第二部分 |
| 03 | [03-opensieve-details.md](03-opensieve-details.md) | 第三部分：OpenSieve 详解 | rules.md 第三部分 |
| 04 | [04-code-style.md](04-code-style.md) | 第四部分：代码风格规范 | rules.md 第四部分 |
| 05 | [05-dev-spec.md](05-dev-spec.md) | 第五部分：开发规范与最佳实践 | rules.md 第五部分 |
| 06 | [06-ai-behavior.md](06-ai-behavior.md) | 第六部分：AI 助手行为准则 | rules.md 第六部分 |
| 07 | [07-coding-redlines.md](07-coding-redlines.md) | 第七部分：Trae CN 编程红线（15 条） | rules.md 第七部分 |
| 08 | [08-flowforge-boundary.md](08-flowforge-boundary.md) | 第八部分：FlowForge 与 *Forge 架构边界验证 | rules.md 第八部分 |
| 09 | [09-ai-coding-practices.md](09-ai-coding-practices.md) | 第九部分：AI 编程优秀实践与踩坑总结 | rules.md 第九部分 |
| 11 | [11-doc-layering.md](11-doc-layering.md) | 第十一部分：软件工程文档分层规范 | rules.md 第十一部分 |
| 12 | [12-doc-refactor-methodology.md](12-doc-refactor-methodology.md) | 第十二部分：大规模文档重构方法论 | rules.md 第十二部分 |
| — | [test-iron-rules.md](test-iron-rules.md) | 测试铁律 T1-T9（独立索引，便于引用） | rules.md §5.5 抽取 |
| — | [coding-redlines.md](coding-redlines.md) | 编程红线 15 条（独立索引，便于引用） | rules.md 第七部分 抽取 |

> 注：原"第十部分：修改记录"已移除（V7 文档开发过程记录，代码已落地，无需保留）。

---

## 三、引用规则

引用本目录下规范时，统一使用以下格式：

```
[doc:rules/<filename>#<section>]
```

**示例**：
- 引用第一部分 §1.2：`[doc:rules/01-architecture-overview.md#1.2]`
- 引用测试铁律 T1-T9：`[doc:rules/test-iron-rules.md]`
- 引用编程红线第 10 条：`[doc:rules/coding-redlines.md#10]`
- 引用 v7.0 命名规范：`[doc:rules/00-v7-supplement.md#0.1]`

---

## 四、核心铁律速查

### 4.1 测试铁律 T1-T9（详见 [test-iron-rules.md](test-iron-rules.md)）

| # | 铁律 |
|---|------|
| T1 | 禁止使用 Mock LLM |
| T2 | 禁止使用假数据 |
| T3 | 禁止跳过验证 |
| T4 | 禁止 Mock 工具 |
| T5 | 未实现即 Bug |
| T6 | 必须采集指标 |
| T7 | LLM 内容必须经 LLM 审核 |
| T8 | Web 功能必须操控浏览器验证 DOM |
| T9 | 运行时数据文件必须存放 data 目录 |

### 4.2 编程红线 15 条（详见 [coding-redlines.md](coding-redlines.md)）

1. 禁止添加 CoT 检测/中文比例检测
2. 质量分阈值默认 0.85（可在 Loop 配置中覆盖）
3. 禁止使用 Mock LLM
4. 禁止使用假数据
5. 禁止跳过验证
6. 禁止只看退出码不检查输出质量
7. 禁止在修复问题时修改不相关代码
8. 禁止删除已有测试用例
9. 禁止用继承替代组合/插件
10. 禁止在 flowforge 中写死业务领域代码
11. 禁止硬编码提示词/路径/密钥/端口
12. 禁止绕过 DI 容器直接实例化
13. 禁止直接操作数据库
14. 禁止不按 prompts.md 和 rules.md 执行
15. 禁止偷工减料（发现未实现即 Bug）

---

## 五、术语说明

依据 [doc:rules/11-doc-layering.md#11.5] 第 6 条"弱化'万物'"规则：
- 对外宣称统一使用"智能体自进化框架"或"多形态可进化智能体（Evolvable Agent）"
- 内部体系文档保留"灵智体"作为社区社交别名
- 本目录中所有原"万物灵智体"表述已弱化为"可进化智能体（Evolvable Agent）"或"多形态可进化智能体"

术语对照唯一权威源：[doc:flowforge/docs/design/naming-contract.md] v2.0。

---

## 六、版本历史

| 日期 | 版本 | 修改内容 |
|------|------|---------|
| 2026-03-05 | v1.0 | 初始版本 |
| 2026-06-28 | v3.0 | 完全重写：9 大项目架构总览、核心架构原则、Plugin 注册规则、编程红线 15 条 |
| 2026-07-08 | v3.1 | 添加第九部分：AI 编程优秀实践与踩坑总结 |
| 2026-07-19 | v3.2 | 新增第十一部分：软件工程文档分层规范；新增第十二部分：文档重构方法论 |
| 2026-07-19 | v3.4 | 重写第十二部分为通用方法论（6 条铁律）；移除 V7 开发过程记录；弱化"万物"表述 |
| 2026-07-19 | v3.5 | 拆分 rules.md 为 rules/ 子目录（本目录），顶层 rules.md 改为索引文件 |

---

> **本索引文件**：`hiclaw/rules/README.md`
> **顶层索引**：[doc:rules.md]（仅作导航，规范正文在各章节文件中）
> **相关文档**：[doc:prompts.md]（AI 助手 Prompt 模板，最高优先级）
