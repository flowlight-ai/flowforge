# @flowforge/mcp-server — 领域工具集（EP1-1b）命名映射

> 依据 `packages/mcp/mcp-server/src/toolsets/` 目录，对照 `docs/design/naming-contract.md`。
> 迁移自 clowder-ai `packages/mcp-server/src/tools/*`（B1）。四个家族（collab / memory / signals / limb），
> finance / audio 依 Q3（2026-09-10）剔除。
>
> 工具名 `cat_cafe_*` 保留原名（对外 MCP 工具契约不复用字段名，避免宿主与既有协议断连），
> 本表仅补中文说明与本包源码面落点。

## 工具组 → 正式名 / 中文名

| 家族 | 工具组（clowder 源文件） | 源码面（本包） | 正式名 | 中文名 |
|---|---|---|---|---|
| collab | `capability-evolution-change-tools.ts` | `collab/capability-evolution-change.ts` | capability-evolution-change（进化程序变更） | 能力进化变更 |
| collab | `entrusted-work-read-tools.ts` | `collab/entrusted-work-read.ts` | entrusted-work-read（受托工作读取） | 受托工作读取 |
| collab | `community-route-acceptance-tool.ts` | `collab/community-route-acceptance.ts` | community-route-acceptance（社区路线裁决） | 社区路线裁决 |
| collab | `auto-dream-tools.ts` | `collab/auto-dream.ts` | auto-dream（私享时间/梦/日记） | 自动梦境 |
| collab | `capability-evolution-tools.ts` | `collab/capability-evolution.ts` | capability-evolution（进化程序） | 能力进化 |
| collab | `capability-evolution-round-tools.ts` | `collab/capability-evolution-round.ts` | capability-evolution-round（进化轮次） | 能力进化轮次 |
| collab | `eval-lifecycle-tools.ts` | `collab/eval-lifecycle.ts` | eval-lifecycle（求值生命周期） | 求值生命周期 |
| collab | `event-memory-tools.ts` | `collab/event-memory.ts` | event-memory（事件记忆） | 事件记忆 |
| collab | `external-review-verdict-tool.ts` | `collab/external-review-verdict.ts` | external-review-verdict（外部评审裁决） | 外部评审裁决 |
| collab | `external-runtime-session-tools.ts` | `collab/external-runtime-session-callback.ts` | external-runtime-session（外部运行时会话） | 外部运行时会话 |
| collab | `game-action-tools.ts` | `collab/game-action.ts` | game-action（游戏动作） | 游戏动作 |
| collab | `hub-action-tools.ts` | `collab/hub-action.ts` | hub-action（Hub 动作） | Hub 动作 |
| collab | `paw-feel-disposition-tools.ts` | `collab/paw-feel-disposition.ts` | paw-feel-disposition（掌感处置） | 掌感处置 |
| collab | `publish-verdict-tool.ts` | `collab/publish-verdict.ts` | publish-verdict（发布裁决） | 发布裁决 |
| collab | `rich-block-rules-tool.ts` | `collab/rich-block-rules.ts` | rich-block-rules（富块规则） | 富块规则 |
| collab | `schedule-tools.ts` | `collab/schedule.ts` | schedule（计划任务） | 计划任务 |
| collab | `shell-tools.ts` | `collab/shell.ts` | shell（只读 Shell） | 只读 Shell |
| collab | `skill-consumption-tools.ts` | `collab/skill-consumption.ts` | skill-consumption（技能消费） | 技能消费 |
| collab | `callback-tools.ts` | `collab/callback.ts`（待迁） | callback（回调） | 回调 |
| — | — | — | — | — |
| memory | `callback-memory-tools.ts` 等 | `memory/*`（待迁） | memory（记忆） | 记忆域工具集 |
| signals | `signals-tools.ts` / `signal-study-tools.ts` | `signals/*`（待迁） | signals（信号） | 信号域工具集 |
| limb | `limb-tools.ts` | `limb/limb.ts`（待迁） | limb（肢端运行时） | 肢端运行时工具集 |

## 批登记

- **B1 底座（2026-09-15）**：`callback-transport.ts`（注入式 `CallbackTransportPort` + `${key}` 路径模板）、
  `define-toolset-tool.ts`（authority 推导表 + `defineMcpToolsetTool(s)`）、`assemble.ts`（`assembleMcpSeverToolsets`）接入 EP1-1a 装配机制。
- **B2 范式确立（2026-09-15）**：collab 两小组（capability-evolution-change / entrusted-work-read）迁入，确立 catalog 写作范式；
  `canonical-tool-sources.ts`（`buildCanonicalToolSources` / 规模锚 `TOOLSET_GROUP_ANCHOR`）。
  契约测试 `tests/toolsets/` 全绿（callback-transport / define-toolset-tool / canonical-tool-sources）。
- **B3 领域工具集迁移（2026-09-15）**：collab 新增 16 小组（community-route-acceptance / auto-dream / capability-evolution /
  capability-evolution-round / eval-lifecycle / event-memory / external-review-verdict / external-runtime-session-callback /
  game-action / hub-action / paw-feel-disposition / publish-verdict / rich-block-rules / schedule / shell / skill-consumption），
  collab 合计 41 工具。`publish-verdict` 内联其 `*_source-refs` / `*_findings` / `*_refresh-action` 纯文件常量；无 `@cat-cafe` / `@deepseek-ai` / `@clowder` 运行时依赖。
  契约测试 `tests/toolsets/collab-B3.spec.ts` 全绿。