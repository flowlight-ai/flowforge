# AGENTS.md — FlowForge 文档编写规则手册（强制）

> 本文适用于**所有**编写或 AI 生成 `docs/` 文档的人（人类作者与 AI 编码工具）。
> 编写/修改任何文档前，请先读本文件与 `rules/11-doc-layering.md`（软件工程文档分层铁律）。
> 仓库级 AI 工具规范见根目录 `AGENTS.md`（`./mgr` 工作流、开发红线等），本文件只管**文档本身**。

---

## 一、文档的定位与优先级

- **规则：** `docs/` 是"约定/规范/设计"的唯一真相源。代码若与文档冲突，先确认文档意图，再决定是否改文档——禁止仅凭代码推断来"静默覆盖"文档结论。
- **规则：** `docs/refactor/` 是**活着的 TS 重写规范**，是**新 TypeScript 工作的首要依据**。新写 TS 代码、加插件、改架构时，先查 `refactor/00-overview.md`、`10-stage-map.md`、`04-code-standards.md`，按其阶段/契约落地。
- **规则：** `spec.md` / `arch.md` / `design.md`（含 `architecture/`、`design/`、`features/`、`decisions/`）描述的是 **Python 单体时代的遗留实现（legacy）**。它们是行为基线与历史裁决，**不是**新 TS 工作的蓝本。
- **规则：** 双栈现实必须如实标注：**Python 单体正在日落（sunsetting），TS 重写进行中**。任何文档不得假装只有单一技术栈；引用能力时注明其属于 legacy(Python) 还是 TS 重写阶段。

## 二、不要重复，要交叉引用

- **规则：** 不重复 Python-era 文档已写清楚的遗留实现细节。若 TS 重写需要参考，用 `[doc:xxx#章节]` 交叉引用，**不要复制粘贴**大段内容到 `refactor/`。
- **规则：** `refactor/` 是 TS 自身的规范树；`architecture/`、`design/`、`features/` 是 Python-era 的 SRS→SAD→SDD 拆分树。两套树各自闭环、互相 `doc:` 引用，**不要**把 TS 设计塞进 Python-era 的 `A0XX/D0XX` 编号，也不要反向。
- **规则：** 每个概念只有一个真相源文件；其余地方一律用 `[doc:文件名#章节]` 引用，禁止多份文件各自维护同一说法导致漂移。

## 三、文档分层（铁律）

- **规则：** 严格遵循 `rules/11-doc-layering.md` 的三层结构：顶层三文档 `spec.md`(SRS) / `arch.md`(SAD) / `design.md`(SDD) 一一对应；feature 级 `features/ F0XX` ↔ `architecture/ A0XX` ↔ `design/ D0XX` 同号齐全。
- **规则：** 核心关键功能放顶层三文档；非核心/单一 feature 拆到 `features/` + `architecture/` + `design/` 三子目录，缺一即文档不完整。
- **规则：** 单文件大小上限牢记：顶层文档 ≤ 3000 行、feature 级 ≤ 50KB，超出即拆分，不堆砌。

## 四、改动纪律

- **规则：** 非平凡改动（新增/重命名/重构大段、跨文件影响）必须在文件头或对应 `review/`、`test/bugs.md` 留下 **Agent Notes**（谁、为何、依据哪个规范条款、影响范围），便于可追溯复盘。
- **规则：** ADR（`decisions/`）不可变历史：决策变更**新增** ADR 引用旧 ADR，禁止修改旧 ADR 正文。
- **规则：** `VISION.md` §7 的 operator 愿景锚点 7 条原则不可被 AI/可进化智能体修改。
- **规则：** 文档内容必须由 Eval 信号触发更新（如某 feature 完成后更新其状态勾选），不主动臆造状态。

## 五、双语与用户可见性

- **规则：** **面向用户**的文档采用中英双语成对：英文 `xxx.md` + 中文 `xxx.zh.md`（如本索引 `README.md` ↔ `README.zh.md`）。内部实现/规范文件可只保留中文，但对外发布物必须成对。
- **规则：** 双语成对文件顶部互换语言切换链接（`English | [中文](xxx.zh.md)` / `[English](README.md) | 中文`），且内容同步更新，禁止只改一边。
- **规则：** 所有文档引用统一用 `[doc:路径#章节]` 格式（见各 README 的"引用约定"），保证跨文件链接在 AI 工具下可被解析。

## 六、与 AI 工具协作

- **规则：** AI 工具动手前必须先读 `docs/rules/` 下规范与 `docs/prompts/` 下提示词模板；本仓库 `docs/` 只记录 flowforge 平台自身内容，与其他项目解耦。
- **规则：** 涉及 Git 远程操作（commit/push/PR）一律走 `./mgr`，禁止 AI 直接调 `git push` 或 API 绕过规范检查（见根目录 `AGENTS.md`）。
- **规则：** 提交前必须运行 lint 与测试（`refactor/04-code-standards.md` R20/R21）；文档改动同样纳入 `./mgr commit` 规范检查。

---

> 本文件来源：依据根目录 `AGENTS.md` 与 `rules/11-doc-layering.md`、`rules/12-doc-refactor-methodology.md` 整理，专管文档编写。
