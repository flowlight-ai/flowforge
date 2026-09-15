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