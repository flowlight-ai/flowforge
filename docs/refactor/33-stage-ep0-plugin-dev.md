# EP0：软件工程化流程插件 `@flowforge/plugin-dev`（最高优先级，先于一切剩余开发）

> **背景与目标**（operator 2026-09-07 两轮指令合并）：
> flowforge 是**超级智能体自进化框架**；当前核心痛点是 **AI 协同与 AI 交付的软件质量**。
> 故规范与软件工程化流程是第一优先级：plugin-dev 落地后，所有需求开发（文档交付 + 代码交付）
> 一律标准化工程化交付，并支持**各种 AI 智能体按自动化交付流程与规范高质量交付需求与软件**。
> 两大交付诉求：① 全量高质量代码；② **更重要的是文档与规范的流程**（项目落地的根基）。
>
> 五源融合：flowforge（自有规范）+ deepseek-harness（插件架构）+ clowder-ai（交叉审查）
> + superpowers（工程方法论）+ **devforge（流程模板/门禁/SOP 谓词思想，本轮纳入）**。
> CLI 命令族前缀：**ff_***。计划总览见 `review_code.md` §11；任务总注册表见 `task.md`。

## 1. 总体架构：双平面 + 状态契约

| 平面 | 载体 | 职责 |
|---|---|---|
| **Plane 1 文档资产层** | `docs/process/`（14 份流程指令资产 + 4 类模板 + instances/） | harness 无关：任何 AI 工具（trae/claude code/opencode/codex/gemini/workbuddy/flowforge 自身）直接阅读执行 |
| **Plane 2 插件执行层** | `packages/plugins/dev`（`@flowforge/plugin-dev`） | 七阶段状态机、四工作流模板、门禁校验、`ff_` CLI、证据采集、subagent 编排 |

**状态契约（核心设计）**：流程状态承载于**仓库文件**而非会话记忆——
`docs/process/instances/<name>.json`（状态快照，入库提交）+ `docs/process/{specs,plans,reviews,verifications}/`（产物）。
这是"换工具/换模型/换会话均可接续"的唯一真相源（详见 §5）。

## 2. devforge 思想融合（第五源）

### 2.1 四工作流模板（同一七阶段脊柱，不同门禁配置）

七阶段 `requirement → design → plan → implement → review → verify → finish` 是**不变脊柱**
（不允许跳过/倒退）；工作流模板只改变各阶段的**产物要求、决策门配置、快速通道**：

| 工作流 | 场景 | 阶段侧重 | 决策门（DCP/TR） | 来源 |
|---|---|---|---|---|
| `greenfield` | 0→1 孵化 | design 产出架构；implement **并行轨道**（代码∥测试生成）；review **AI→人工降级链** | DCP-1（需求）、DCP-2（方案，人工） | dev_greenfield.yaml |
| `feature` | 新功能（标准） | 全阶段完整产物 | DCP-1 需求门（business_value/feasibility/security 加权 0.65 + security 否决）→ DCP-2 方案门（0.70，人工）→ TR-1 评审门（code_quality/security，0.65）→ DCP-3 发布门（0.75，人工） | feature.yaml |
| `change` | 既有功能变更/重构 | 轻量门禁 | DCP-1 变更门（0.60，无人工）→ DCP-2 方案门（0.65，无人工）→ TR-1（0.65）；**无 DCP-3 发布门** | change.yaml |
| `hotfix` | Bug 修复（快速通道） | requirement=bug 报告+根因分析；design=修复方案（fastpass）；plan=复现测试计划（fastpass）；**verify 硬门禁永不豁免**（回归证据必须） | TR-1 快速评审门（单维 code_quality，0.50）→ DCP 发布门（release_risk，0.30，超时可自动通过 + 审计日志）→ finish 含 24h 监控+自动回滚 | hotfix.yaml |

**快速通道语义（D4，operator 已倾向确认）**：hotfix 的 design→plan 门禁降级为"根因分析记录"，
plan→implement 降级为快速模式；但 **verify→finish 三道硬门禁中的验证证据永不豁免**。

### 2.2 DCP/TR 评估型门禁体系

现有状态机三道布尔硬门禁（designApproved/planValidated/verificationEvidence）是**机器最低线**；
devforge 的评估型门禁叠加其上（`src/workflows.ts`）：

```ts
interface DecisionGateConfig {
  id: 'dcp1' | 'dcp2' | 'tr1' | 'dcp3' | 'dcp1_hotfix'
  phase: ProcessPhase                // 挂接的阶段
  dimensions: Array<{ name: string; weight: number; threshold: number }>
  passThreshold: number              // 加权总分阈值
  vetoDimensions: string[]           // 否决维（如 security）
  humanRequired: boolean             // 人工中断点（interrupt_before 映射）
  onReject: { retries: number; fallback: 'terminate' | 'escalate' | 'rollback' }
  autoPassOnTimeout?: boolean        // 仅 hotfix 发布门
}
```

评估结果经 `ff_dev gate` 命令登记（分数 + 证据路径 + 评审者），存入实例状态。

### 2.3 SOP 硬规则与谓词 → ff_doctor（遵从度引擎）

devforge SOP 的 `hard_rules` + `predicates` 机制（git_state/command_pattern/handle_check/command_sequence）
落地为 `ff_doctor` 校验命令，供 CI 与本地拦截（详见 §6）。

### 2.4 其余机制映射

| devforge 机制 | plugin-dev 对应 |
|---|---|
| checkpoint（every_n_steps + interrupt_before） | 实例状态快照（每步落盘）+ humanRequired 中断点 |
| parallel steps（greenfield 并行开发） | implement 阶段并行轨道标记（配合 ⑤ 并行子代理调度资产） |
| fallback（AI 审查→人工标记） | review 阶段降级链（审查者不可用时人工标记继续） |
| 熔断（circuit_failure_threshold） | 修复循环熔断（④ 资产第 5 轮熔断，已移植） |
| 跨模型评审（reviewer ≠ author 模型族） | review 阶段约束（TR-1 门禁维度之一） |
| feature doc truth check | finish 门禁：文档-代码一致性核对（⑩ 资产"需求核对"模式） |

## 3. ff_*** CLI 命令族设计

前缀规则：plugin-dev 系列命令一律 `ff_` 开头（operator 2026-09-07 裁决，替代早期 `flowforge process` 设计）。
两个可执行入口（bin 挂接于 `packages/plugins/dev/package.json`，经 tsx 直跑 TS，无构建依赖）：

### ff_dev —— 流程生命周期主命令

| 命令 | 语义 | 备注 |
|---|---|---|
| `ff_dev init <name> [--workflow feature\|greenfield\|change\|hotfix]` | 创建实例（落盘 `docs/process/instances/<name>.json`） | 默认 feature |
| `ff_dev status [name] [--json]` | 查看实例（阶段/门禁/产物/工作流） | 省略 name 列全部 |
| `ff_dev advance <name>` | 推进到下一阶段（前置三道硬门禁校验，拒绝即非零退出） | CI/工具可依赖退出码 |
| `ff_dev gate <name> <design\|plan\|verify> [--score N --evidence <path> --approver <who>]` | 开门禁并登记证据/评分 | 评估型门禁记录 |
| `ff_dev evidence <name> --command "..." --exit 0 --summary "..."` | 记录验证证据（追加 `docs/process/verifications/<name>.md`） | verify→finish 门禁输入 |
| `ff_dev resume [name]` | **接续指令**：输出当前状态 + 下一步指引（含对应 skills 资产路径） | §4/§5 的自然语言锚点 |
| `ff_dev snapshot <name> [--out <path>]` | 导出状态快照 JSON | 跨仓库迁移用 |

### ff_doctor —— 遵从度检查命令（CI / pre-commit 用）

| 命令 | 语义 |
|---|---|
| `ff_doctor plan <path>` | No-Placeholder 校验（TBD/TODO/无代码块步骤/"类似任务N"引用/任务头五要素缺失） |
| `ff_doctor state [--repo <root>]` | 实例状态一致性（活跃实例存在、产物路径有效、阶段合法） |
| `ff_doctor docs [--repo <root>]` | 存量盘点报告（文档数/包测试覆盖，EP0-7 治理输入） |
| `ff_doctor all` | plan + state（CI 默认组合） |

## 4. 自然语言需求入口（免提示词模板方案）

**设计立场**（operator 指令："最好不需要标准提示词模板，实在不行搞几个简单引导"）：
不引入重量级提示词模板，靠**发现机制 + 状态锚点 + 强制兜底**三层达成：

1. **发现机制（唯一的"简单引导"）**：各 AI 工具的约定入口文件各写**一段话**（非模板）：
   根目录 `AGENTS.md`（trae/codex/opencode 等读）、`CLAUDE.md`（claude code 读）、`GEMINI.md`（gemini 读），
   内容统一为"开发任何需求前：读 `docs/process/README.md` → 执行 `ff_dev resume` → 按输出指引走七阶段"。
2. **状态锚点**：`ff_dev resume` 的输出是结构化"接续简报"（实例/工作流/当前阶段/门禁状态/下一步+资产路径）。
   自然语言需求进来 → AI 工具读入口 → resume → 被状态机约束推进 → 证据落盘。
3. **强制兜底**：CI + mgr 拦截（§6）。提示词可以不听，CI 不放行。

自然语言需求本身即 `requirement` 阶段的输入（brainstorming ① 资产处理澄清与分级），不需要翻译成中间格式。

## 5. 双向互操作（两场景）

**场景 1：flowforge 主导自动开发，调用其他智能体**
flowforge Agent（宿主，挂 `ctx.forgeProcess` 服务）创建流程实例 → 派发任务给外部灵智体/三方智能体
（经 `packages/subagent/*` 多驱动）或切换 LLM 模型 → 全部状态在 `docs/process/instances/<name>.json`
+ 产物目录 → 任何新智能体接手时 `ff_dev resume` 从中断处继续（状态在文件不在会话，换体无损）。

**场景 2：其他智能体主导自动开发，调用 flowforge 中的插件**
外部 AI 工具（trae/claude code/opencode/codex/gemini/workbuddy 等）开发 flowforge 仓库时：
入口文件发现（§4）→ 读 `docs/process/`（Plane 1 资产 harness 无关）→ 用 `ff_dev` CLI（纯命令行，
不需要装 flowforge 插件，仅需 tsx）推进状态 → mgr/CI 强制兜底（§6）。
**同一套状态文件同时服务两个方向**——这是"状态契约"设计的直接收益。

## 6. 遵从度五层保障体系（回答"AI 工具遵照度不一致怎么破"）

| 层 | 手段 | 强度 | 现状 → 目标 |
|---|---|---|---|
| L0 入口引导 | AGENTS.md / CLAUDE.md / GEMINI.md 一段话引导 | 软 | EP0-4 落地 |
| L1 方法论资产 | `docs/process/skills/` 14 份（含合理化对照表） | 软 | ✅ EP0-1 已交付 |
| L2 状态机门禁 | `ff_dev advance` 拒绝无证据推进（非零退出码） | 硬（工具内） | EP0-3 落地 |
| L3 本地 Git 拦截 | mgr 提交前跑 `ff_doctor`（commit 格式已有 `_check_msg_format` 先例） | 硬（本地） | EP0-4 设计 + EP0-6 mgr 集成（D5） |
| L4 CI 强制拦截 | `.github/workflows/ts-ci.yml`：`pnpm typecheck` + `pnpm vitest run` + `ff_doctor all`，PR 必须 | **硬（远端）** | EP0-4 落地（D1） |

**关键缺口（本轮修复）**：现 `.github/workflows/ci.yml` 是 Python 时代遗留（pytest/ruff/mypy 跑 `flowforge/`
Python 目录），对 TS monorepo **完全不设防**——TS 代码无 CI 拦截，是遵从度体系最大漏洞。
新增 `ts-ci.yml` 后 Python CI 保留至 EP4 双栈下线（D7）。

## 7. 存量治理（EP0-7，operator 第 0 点指令）

**治理原则**：plugin-dev 标准落地后，存量文档与存量代码必须回补一致性；
不合适的文档按流程文档标准重构优化；不合适的流程规范按 plugin-dev 整改；
flowforge 自有的流程思想（doc-layering 11/12、git-workflow、mgr、T1-T9）中尚未融入 plugin-dev 的，
**反向融合进插件**（superpowers 缺什么补什么，有什么就融合）。

**治理范围盘点**（`ff_doctor docs` 输出，数字以工具输出为准）：
- 存量文档：`docs/`（architecture/design/features/decisions 为 Python 遗留层 + rules/prompts/test +
  refactor 规范层）；按 F-A-D-T 四件套核对每个 feature 的 spec/arch/design/test 齐全性与编号映射。
- 存量代码：`packages/*` + `apps/*`；盘点有测试/无测试包清单，无测试包纳入补测计划。
- 反向融合候选：`docs/rules/11-doc-layering.md`（F/A/D 分层→design/plan 模板内嵌结构）、
  `docs/rules/12-doc-refactor-methodology.md`（三阶段递进→greenfield 工作流 design 阶段方法）、
  mgr 分支池/PR 规范（已融入 ⑫ 资产）、T1-T9（已融入 ⑥⑩ 资产）。

**治理节奏（D2，建议）**：不搞一次性大治理——每个 EP1-EP4 批次开工前跑 `ff_doctor docs`
取本域盘点，把治理项并入该批次任务清单（"改动哪块、治理哪块"）；全量对账在 EP4 收尾批统一验收。

## 8. 决策点清单（operator 裁决）

| # | 决策点 | 建议 | 状态 |
|---|---|---|---|
| D1 | ts-ci.yml 是否设为 PR 必须检查 | 是（否则硬拦截无牙） | ✅ 已裁决（按建议执行）：ts-ci.yml 落地，push/PR 双触发 |
| D2 | 存量治理节奏：批次前置 vs 一次性大治理 | 批次前置（"改动哪块治理哪块"）+ EP4 收尾对账 | ✅ 已裁决（按建议执行）：治理台账 `docs/process/governance.md` §2 |
| D3 | 状态文件入库（`docs/process/instances/`）vs 本地忽略 | 入库（跨工具/跨 clone 接续需要） | ✅ 已裁决（按建议执行）：instances/ README 已声明入库 |
| D4 | hotfix 快速通道豁免边界 | design/plan 门禁 fastpass，verify 硬门禁永不豁免 | ✅ 已裁决（按建议执行）：workflows.ts `fastpass` 仅豁免 design/plan |
| D5 | mgr 是否内嵌 ff_doctor 前置校验 | 建议做（L3 层闭合），因 mgr 为共享基础设施，单独批次实施 | ✅ 已裁决（按建议执行）：EP0-6 未动 mgr，留独立批次实施 |
| D6 | 入口文件集合 | AGENTS.md + CLAUDE.md + GEMINI.md 三件套（.cursorrules 等后续按需） | ✅ 已裁决（按建议执行）：三件套已统一为最新内容 |
| D7 | Python 遗留 CI（ci.yml）去留 | 保留至 EP4 双栈下线，避免双栈期 Python 侧裸奔 | ✅ 已裁决（按建议执行）：ts-ci.yml 头注释已声明双轨期 |

> 决策依据：operator 2026-09-07 指令——"按上述要求和目标，发挥你智能体开发的专家能力，把剩余的plugin-dev插件计划和方案全部完成"，即按各决策点建议值执行。

## 9. 任务清单（七批次）

### EP0-1 插件骨架 + 14 份流程指令资产（✅ 已完成，PR #152）

- [x] T0.1.1 `packages/plugins/dev/package.json`（`@flowforge/plugin-dev`，ESM，对齐 canary/modes 包形态）
- [x] T0.1.2 `tsconfig.json` + 根 `tsconfig.host.json` references 增补
- [x] T0.1.3 `src/state-machine.ts`：七阶段 + 合法迁移表 + 三道硬门禁 + `ForgeProcessStateMachine`
- [x] T0.1.4 `src/registry.ts`：`ForgeProcessRegistry`（create/get/list + snapshots 导入导出）
- [x] T0.1.5 `src/index.ts` 导出面 + `tests/dev.spec.ts`（16/16 绿）
- [x] T0.1.6 `docs/process/README.md`（双平面/目录索引/七阶段流程图/AI 工具使用指引）
- [x] T0.1.7 移植 14 份流程指令资产至 `docs/process/skills/`（四节结构，融合 mgr/T1-T9/命名契约；
      前置：移除 `.gitignore` 对 `docs/process/` 的旧忽略）
- [x] T0.1.8 单测全绿 + typecheck 通过
- [x] T0.1.9 进度回填（10-stage-map P1-P4 / task.md）
- [x] T0.1.10 `./mgr sync` 提交 PR #152（commit `5af3c6c3`）

### EP0-2 文档模板 + No-Placeholder 校验器（✅ 已完成）

- [x] T0.2.1 `docs/process/templates/design-template.md`（目标/架构/技术栈/规范引用/全局约束/DCP-1 与 DCP-2 签核块；
      内嵌 F/A/D 静态分层结构——flowforge doc-layering 反向融合）
- [x] T0.2.2 `docs/process/templates/plan-template.md`（任务头五要素：Goal/Architecture/Tech Stack/Spec 引用/
      Global Constraints + Task N 结构：Files/Interfaces/Steps checkbox 含 TDD 五步）
- [x] T0.2.3 `docs/process/templates/review-template.md`（两阶段审查：spec 合规 + 代码质量，P1/P2/P3 分级，
      跨模型评审约束 + AI→人工降级记录块）
- [x] T0.2.4 `docs/process/templates/verification-template.md`（证据条目：命令/exit code/输出摘要/耗时/时间戳）
- [x] T0.2.5 `src/plan-validator.ts`：No-Placeholder 扫描（TBD/TODO/待补充/无代码块步骤/"类似任务 N"引用）
      + 结构校验（任务头五要素 + checkbox 步骤存在 + 每个 Task 含测试步骤）
- [x] T0.2.6 `tests/plan-validator.spec.ts`（拦截正例 + 通过反例 + 边界）
- [x] T0.2.7 `docs/process/` 产物目录启用：`specs/ plans/ reviews/ verifications/ instances/` 各 README（命名约定）

### EP0-3 ff_ CLI 命令族 + 四工作流模板 + 持久化（✅ 已完成）

- [x] T0.3.1 `src/workflows.ts`：`WorkflowProfile` + 四模板（greenfield/feature/change/hotfix，
      含 DCP/TR 决策门配置、humanRequired、hotfix fastpass 标记，数值从 devforge YAML 照搬）
- [x] T0.3.2 `src/persistence.ts`：实例状态读写（`docs/process/instances/<name>.json`，含 workflow 字段）
- [x] T0.3.3 `src/cli/main.ts`：`ff_dev`（init/status/advance/gate/evidence/resume/snapshot，手写参数解析零依赖）
- [x] T0.3.4 `bin/ff_dev.mjs` + package.json bin 字段（tsx/esm/api 直跑 TS）
- [x] T0.3.5 resume 输出"接续简报"（状态 + 下一步 + skills 资产路径）——§4/§5 的锚点实现
- [x] T0.3.6 `tests/workflows.spec.ts` + `tests/persistence.spec.ts` + CLI 冒烟（init→…→finish 全链 + 门禁拒绝路径）
- [x] T0.3.7 `docs/process/README.md` 增补 ff_ 命令族与状态契约说明

### EP0-4 遵从度强制体系（ff_doctor + 入口文件 + TS CI）（✅ 已完成）

- [x] T0.4.1 `src/cli/doctor.ts`：`ff_doctor`（plan/state/docs/all 四模式）+ `bin/ff_doctor.mjs`
- [x] T0.4.2 入口文件三件套：根 `AGENTS.md` 更新 + `CLAUDE.md` + `GEMINI.md`（一段话引导，见 §4）
- [x] T0.4.3 `.github/workflows/ts-ci.yml`：TS typecheck + vitest + `ff_doctor all`，PR 触发（D1 裁决后设必须）
- [x] T0.4.4 `ff_dev`/`ff_doctor` 退出码约定文档化（0=合规 / 1=违规 / 2=用法错误），CI 与脚本依赖此契约
- [x] T0.4.5 `tests/cli-doctor.spec.ts`（doctor 四模式的正反例）

### EP0-5 编排 + 两阶段审查 + 验证证据采集（✅ 已完成，T0.5.4 见 docs/process/instances/ep0-plugin-dev.json）

- [x] T0.5.1 `src/evidence.ts`：证据条目结构 + `ff_dev evidence` 落盘逻辑（追加 verifications/<name>.md）
- [x] T0.5.2 `src/review-protocol.ts`：两阶段审查协议（阶段 1 spec 合规 / 阶段 2 代码质量）+ P1/P2/P3 分级
      + 跨模型约束 + 降级链（AI 审查不可用→人工标记）
- [x] T0.5.3 `src/dispatcher.ts`：`TaskDispatcher` 接口（harness 注入 subagent 驱动 / 无宿主时 NullDispatcher
      降级为人工执行指引）——场景 1/2 双向可用
- [x] T0.5.4 端到端验收：以一个真实小需求走完七阶段（四产物 + mgr PR 合入）作为 DoD
- [x] T0.5.5 对应测试（evidence/review-protocol/dispatcher 各一 spec）

### EP0-6 规范回填 + 流程切换声明（✅ 已完成，T0.6.4 mgr 集成留独立批次）

- [x] T0.6.1 新增 `docs/rules/13-dev-process.md`（流程铁律：七阶段时序/门禁/产物路径/ff_ 命令/
      工具无关性/与 04-code-standards、git-workflow、T1-T9 的引用关系）
- [x] T0.6.2 更新 `docs/AGENTS.md`：交付强制入口改为 plugin-dev 七阶段流程
- [x] T0.6.3 更新 `docs/refactor/04-code-standards.md`：批次交付与 forgeProcess 衔接
- [ ] T0.6.4 mgr 集成（D5 已裁决：单独批次实施，不动共享基础设施 mgr）：`cmd_sync` 前置 `ff_doctor` 本地拦截
- [x] T0.6.5 切换声明：此后所有批次（EP1-EP4）交付必须走 plugin-dev 流程（13-dev-process.md §13.7）；进度回填三文档

### EP0-7 存量治理（基线 ✅ 已完成；T0.7.2/T0.7.3 按 D2 节奏随批次执行）

- [x] T0.7.1 `ff_doctor docs` 盘点基线报告（文档 F-A-D-T 齐全性 + 包测试覆盖两张清单，
      数字落 `docs/process/governance.md` §1）
- [ ] T0.7.2 存量文档治理：Python 遗留层（architecture/design/features/decisions）按 F-A-D-T 补全/归档
      （不合适的重构优化，过期的入 `docs/_archive/`）——按 D2 节奏随 EP1-EP4 批次执行
- [ ] T0.7.3 存量代码治理：无测试包补测计划（并入 EP1-EP4 各批次；基线：attachment/attachment、util/brand）
- [x] T0.7.4 反向融合核对：flowforge 自有流程思想（§7 列表）在 plugin-dev 资产/模板中的落点核对表
      （`docs/process/governance.md` §1.3）
- [x] T0.7.5 治理台账：`docs/process/governance.md`（盘点数字 + 治理进度跟踪）

## 10. 验收标准（EP0 整体）

1. `packages/plugins/dev` 提供 `ff_dev`/`ff_doctor` 两个可执行命令（tsx 直跑，无构建依赖）。
2. 四工作流模板可创建实例并全链走通；hotfix fastpass 语义正确（verify 硬门禁不豁免）。
3. `docs/process/` 14 资产 + 4 模板 + 产物目录齐全，任何 AI 工具凭入口文件三件套即可独立执行流程。
4. 状态契约生效：`ff_dev resume` 在换工具/换会话场景输出正确接续简报（场景 1/2 验证）。
5. plan-validator 拦截占位符违规；`ff_doctor all` 成为 CI 必须检查（D1）。
6. 端到端：一个小需求从 requirement 到 finish 产物齐备并经 mgr PR 合入。
7. `docs/rules/13-dev-process.md` 生效，流程切换声明发布。
8. 存量治理基线报告产出，治理项纳入 EP1-EP4 批次清单（D2）。

## 提交信息模板

```
feat(plugin-dev): EP0-x <批次要点> [sherlock]
docs(process): EP0-x 流程资产/规范回填 <要点> [sherlock]
```

## 风险备注

1. **Windows 长路径风险**：worktree 隔离方法论已入库（⑪），EP0 期不强制启用（决策点 D）。
2. **subagent-ff-sdk 契约**：EP0-5 dispatcher 以 `ctx.subagents` 注入式适配，无宿主时降级为人工指引
   （不硬依赖 harness，保证场景 2 可用）。
3. **流程采用率**：L2-L4 三层硬拦截兜底（状态机拒绝 + doctor 非零退出 + CI 必须），
   声明与提示词只是软引导——遵从度问题的正解。
4. **双平面一致性**：Plane 1 资产与 Plane 2 实现必须同批更新，禁止只改一侧。
5. **CI 双轨期**：Python ci.yml 与 ts-ci.yml 并存至 EP4（D7），期间 Python 侧继续受保护。
