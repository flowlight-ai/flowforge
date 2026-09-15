# EP1-1b 实施计划：mcp-server 领域工具集迁移（collab/memory/signals/limb）

- 依据：`docs/process/specs/2026-09-15-mcp-server-toolsets-ep1-1b-design.md`、`docs/process/specs/2026-09-07-mcp-server-design.md` §1.2、`review_code.md` §13.2 序号 1 / §15 Q3
- 批次目标：落 `packages/mcp/mcp-server/src/toolsets/`，四家族 33 工具组的**治理清单 + 注入式回调端口**，契约测试/tsc/oxlint 全绿，`mgr` PR。
- 遵循：测试铁律 T1–T9（真实 SDK server + 内存端口 fixture，禁 Mock）。
- 边界：**不含** finance/audio（Q3）；不含 handler 真实 HTTP 实现（宿主接线）。

## 分批（每批独立 PR，按计划门禁）

| 批 | 内容 | 产物 | 门禁 |
|---|---|---|---|
| B1 | 底座：`callback-transport.ts` + `define-toolset-tool.ts`（authority 推导）+ 装配 `assemble.ts` 骨架 + 契约测试 | `src/toolsets/{callback-transport,define-toolset-tool,assemble}.ts`、`tests/toolsets/{callback-transport,define-toolset-tool}.spec.ts` | vitest 绿（TDD 先红后绿） |
| B2 | collab 家族一个组（callback）先行打通，确立 catalog 写作范式 | `src/toolsets/collab/callback.ts`、`tests/toolsets/collab-callback.spec.ts` | vitest/tsc/oxlint 绿 |
| B3 | collab 其余组（18）分期 | `src/toolsets/collab/*` | catalog 规模锚断言 |
| B4 | memory 家族（11 组） | `src/toolsets/memory/*` | 规模锚断言 |
| B5 | signals（2 组）+ limb（1 组） | `src/toolsets/signals/*`、`src/toolsets/limb/*` | 规模锚断言 |
| B6 | 全量核验 + `canonical-tool-sources.ts` + `README.md` 命名映射 + 全包 tsc/oxlint | `tests/toolsets/canonical-tool-sources.spec.ts`、`toolsets/README.md` | 全绿 |
| B7 | `mgr.ps1 sync` 提交 PR + 登记 `task.md`、`review_code.md` §13.2 序号 1（1b）、`10-stage-map.md` C43 | PR | mgr 通过 |

> 分批可合并提交（B1+B2 为「范式确立」批次），以控制 PR 粒度；B3–B5 按家族呈现稳定性后独立 PR。

## 批进度

- **B1+B2 范式确立 ✅（2026-09-15，PR #191）**：`callback-transport.ts`（注入式 `CallbackTransportPort` + `${key}` 路径模板 + `unavailableCallbackPort`）、
  `define-toolset-tool.ts`（`AuthorizationHint` authority 推导表 fail-fast + `defineMcpToolsetTool(s)`）、
  `assemble.ts`（`assembleMcpSeverToolsets` 接入 EP1-1a `registerToolset`）、`canonical-tool-sources.ts`
  （`buildCanonicalToolSources` + 规模锚 `TOOLSET_GROUP_ANCHOR`）；collab 两小组（capability-evolution-change / entrusted-work-read）迁入确立 catalog 范式。
  契约测试 3 文件 11/11 全绿，全包 9 文件 57/57 全绿，包级 tsc exit 0、oxlint 0，零 @cat-cafe 依赖；`index.ts` 增补导出。
- **B3 collab 小组 ✅（2026-09-15，PR #192）**：collab 16 小组迁入，collab 综合 18 组 41 工具；全包 10 文件 62/62 全绿、tsc exit 0、oxlint 0、零禁用依赖。
- **B4 collab callback 大组 ✅（2026-09-15）**：`collab/callback.ts` 迁入 **49 工具**（源 `callbackTools` 无遗漏），collab 累计 19 组 **90 工具** 全迁完成；
  47 个标准 callbackPost/callbackGet，2 例调和（`set_read_mode` 本地写会话文件→合成 POST 路由；`cross_post_message` 复用 `post_message` 出站路径，均文件头 NOTE）。
  `canonical-tool-sources.ts` concat+规模锚 `callback:49`、`tests/toolsets/collab-callback.spec.ts`；全包 11 文件 **67/67 全绿**、tsc exit 0、oxlint 0、零禁用依赖。
- **B5-B7（待迁）**：memory 11 组 / signals 2 组 / limb 1 组 按家族分批演进；随后全量核验 + `mgr` PR 收口。

## 文件清单

- 新增（src/toolsets）：`callback-transport.ts`、`define-toolset-tool.ts`、`assemble.ts`、`canonical-tool-sources.ts`、`README.md`、`collab/{callback,capability-evolution,capability-evolution-round,capability-evolution-change,auto-dream,community-route-acceptance,external-review-verdict,external-runtime-session-callback,hub-action,skill-consumption,entrusted-work-read,event-memory,publish-verdict,eval-lifecycle,paw-feel-disposition,rich-block-rules,game-action,schedule,shell}.ts`、`memory/{callback-memory,distillation,evidence,external-runtime-session-read,meeting-artifact,file-slice,graph,library-lifecycle,perspective,recent,session-chain}.ts`、`signals/{signals,signal-study}.ts`、`limb/limb.ts`
- 测试（tests/toolsets/）：`callback-transport.spec.ts`、`define-toolset-tool.spec.ts`、`assemble.spec.ts`、`canonical-tool-sources.spec.ts`、collab/memory/signals-limb catalog 规模锚 spec
- `index.ts` 增补导出（CallbackTransportPort / CallbackRequest / assembleMcpSeverToolsets / CANONICAL_TOOL_SOURCES）
- 文档：design（本批已建 spec）、plan 本文件、`toolsets/README.md`、review_code §13.2 序号 1（1b）、`task.md`、`10-stage-map.md` C43

## 验收

- 四家族 33 工具组 catalog 规模锚断言齐备；契约测试文件全绿；
- 包级 `tsc -p tsconfig.json --noEmit` exit 0；`oxlint` 0 error / 0 warning；
- 零 `@deepseek-ai` / `@cat-cafe` / `@clowder` 引用；
- 走 plugin-dev 七阶段，经 `mgr.ps1 sync` 提交（type feat，scope mcp-server，署名）。