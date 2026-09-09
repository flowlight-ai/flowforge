# 依赖补丁边界（patches/）

> 对应 `review_code` A37 / `10-stage-map` D54（EP3-3）。
> 上游 dsh 用 `patchedDependencies` 打运行时补丁；FlowForge 采用 **pnpm-workspace 边界声明 + 本地 postinstall 治理**，
> 因此**不引入 `pnpm.patchedDependencies` 文件本地覆写**，以下记录每个需要"补丁层"的依赖的治理方式。

| 依赖 | 用途 | 治理方式 | 状态 |
|---|---|---|---|
| `node-pty` | 持久 PTY 后端（含 Windows ConPTY） | `pnpm-workspace.yaml` `allowBuilds.node-pty: true` 放行构建；`@flowforge/subprocess-local` postinstall `ensure-spawn-helper.mjs` 恢复 spawn helper exec bit | ✅ 已验证 |
| `koffi` | 会话 JSONL 持久化 Windows `MoveFileExW` write-through | `pnpm-workspace.yaml` `allowBuilds.koffi: true` | ✅ 已验证 |
| `@yao-pkg/pkg` | （上游 dsh 可执行打包） | FlowForge 不依赖该包，采用自研 spawn/pty 治理 | ⬜ 无需移植 |

## node-pty Windows 验证（D54 验收）

1. **构建侧**：`pnpm-workspace.yaml` 声明 `allowBuilds.node-pty: true`，`node-pty` 原生构建放行；
2. **运行时侧**：`@flowforge/subprocess-local/scripts/ensure-spawn-helper.mjs`（postinstall）在节点上恢复
   `node-pty` spawn helper 的可执行位（chmod +x），规避 Windows/打包后权限丢失；
3. **验证命令**：

   ```sh
   pnpm --filter @flowforge/subprocess-local install   # 触发 postinstall
   # tsc 类型检查（ConPTY 路径）
   pnpm typecheck
   # PTY 冒烟（若本机可运行）
   node --import tsx --eval "import { SubprocessTerminalHandle } from './packages/subprocess/subprocess-local/src/terminal.ts'"
   ```

> 若后续引入需本地覆写的第三方依赖，再在当前表新增条目并落 `pnpm-workspace.yaml` 的
> `pnpm.patchedDependencies`（届时同步在 `31-stage11-sunset.md` 与 `review_code.md` §13 登记）。