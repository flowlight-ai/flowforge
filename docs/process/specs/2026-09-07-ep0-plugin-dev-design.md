# 设计文档：EP0 工程化流程插件 @flowforge/plugin-dev（feature 工作流）

> 实例：`ep0-plugin-dev`（`docs/process/instances/ep0-plugin-dev.json`）
> 日期：2026-09-07 ｜ 状态：已交付（本文为 EP0 交付的设计基线回溯记录，供流程验证与后续追溯）

## 1. 目标（Goal）

解决超级智能体自进化框架的 **AI 协同与 AI 交付软件质量** 问题：以规范和软件工程化流程为第一优先级，
让所有需求开发（文档与代码）按标准化工程化交付，任何 AI 智能体（flowforge 内部灵智体或外部工具
trae/claude code/opencode/codex/gemini/workbuddy 等）都能按同一流程与规范高质量交付。

## 2. 架构（Architecture）——双平面 + 状态契约

| 平面 | 载体 | 职责 |
|---|---|---|
| Plane 1 文档资产层 | `docs/process/`（14 份 skills + 4 模板 + 产物目录 + 治理台账） | harness 无关，任何 AI 工具直接阅读执行 |
| Plane 2 插件执行层 | `packages/plugins/dev` | 七阶段状态机、四工作流模板、门禁、`ff_` CLI、证据、dispatcher |

**状态契约**：实例状态落盘 `docs/process/instances/<name>.json`（状态在文件不在会话）——
场景 1（flowforge 主导，换智能体/换 LLM 接续）与场景 2（外部工具主导，按规范接续）共用同一套状态文件。

**四项目思想融合**：flowforge（mgr Git 流程 / T1-T9 / F-A-D 文档分层）+ devforge（greenfield/feature/change/hotfix
四工作流、DCP/TR 加权决策门）+ superpowers（14 份工程方法论技能资产）+ clowder（两阶段审查、P1/P2/P3 分级、
subagent 编排降级链）。

## 3. 技术栈（Tech Stack）

TypeScript（ESM、`.ts` 直跑经 tsx）、零运行时依赖 CLI（手写参数解析）、vitest 单测、
cordis 插件形态（`packages/plugins/dev`，对齐 canary/modes 包）。

## 4. 规范引用（Spec）

- `docs/refactor/33-stage-ep0-plugin-dev.md`（本插件完整方案与任务清单）
- `docs/rules/13-dev-process.md`（流程铁律 §13.1-13.7）
- `docs/rules/11-doc-layering.md`（F/A/D 静态分层，内嵌于设计/计划模板）

## 5. 全局约束（Global Constraints）

- 提交一律走 `./mgr` PR，禁止直接 push 远端（根目录 AGENTS.md 红线）。
- 测试遵守 T1-T9 铁律：禁止 Mock LLM、禁止无断言测试、禁止假数据。
- 单文件 ≤ 1000 行；禁止硬编码提示词/路径/端口。
- Plane 1 资产与 Plane 2 实现同批更新，禁止只改一侧。

## 6. 决策门记录

### DCP-1 需求决策（requirement → design）

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| business_value | 0.40 | 0.5 | 0.95 | operator 2026-09-07 指令：工程化流程为第一优先级 |
| feasibility | 0.35 | 0.6 | 0.85 | 四项目均有成熟参考实现，纯增量移植融合 |
| security | 0.25 | 0.7 | 0.80 | 无密钥/无外联依赖，本地状态文件 |

加权总分 0.887 / 阈值 0.65；security 无否决。**通过**。

### DCP-2 方案决策（design → plan）

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| architecture_fit | 0.35 | 0.6 | 0.90 | 双平面架构与"一切皆插件"信条一致 |
| completeness | 0.30 | 0.6 | 0.85 | 七批次任务清单覆盖全部 operator 诉求（0-4 点） |
| risk | 0.35 | 0.5 | 0.75 | 遵从度风险由 L2-L4 三层硬拦截兜底 |

加权总分 0.84 / 阈值 0.65。**通过**。

## 7. 交付物清单

- Plane 2：state-machine / registry / workflows / persistence / plan-validator / evidence /
  review-protocol / dispatcher / cli(main+doctor) + bin(ff_dev/ff_doctor) + 87 项单测
- Plane 1：14 skills + 4 templates + 5 产物目录 README + governance.md + 流程 README
- 遵从度：入口三件套（AGENTS/CLAUDE/GEMINI）+ ts-ci.yml（L4 硬拦截）
- 规范回填：13-dev-process.md / docs/AGENTS.md / 04-code-standards.md §6
