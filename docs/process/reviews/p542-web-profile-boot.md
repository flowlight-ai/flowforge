# review: P-542 web profile 无法启动（hotfix）

> 实例：`p542-web-profile-boot` ｜ 规格：`docs/test/bugs/round13-browser-e2e-2026-09-19.md` §P-542 ｜ 计划：`docs/process/plans/2026-09-19-p542-web-profile-boot.md`
> 日期：2026-09-19 ｜ 工作流：hotfix ｜ 角色声明：本轮修复与回归由同一执行体完成（operator 明确授权），**偏离 BUG_PROTOCOL 的开发/测试角色分离**，已在工单中留痕待 operator 确认。

## 阶段一：规格合规审查

| 计划项 | 落地 | 证据 |
|---|---|---|
| 步 1 前端包改名消除重名 | ✅ `web/package.json` `name` → `@flowforge/web-frontend`（与 bundle 源码注释既定名一致，`packages/bundle/web-app/src/index.ts:13/182`） | 文件 diff |
| 步 2 同步 CI 过滤器 | ✅ `.github/workflows/web-ci.yml` 4 处 `--filter` 改为 `@flowforge/web-frontend` | `grep -n "filter @flowforge/web"` 4 行已更新 |
| 步 3 apps/cli 声明 in-box bundle | ✅ `apps/cli/package.json` 按字母序插入 `"@flowforge/web-app": "workspace:^"`（与 `@flowforge/base`/`@flowforge/headless` 同法） | 文件 diff；`apps/cli/node_modules/@flowforge/web-app` 已建立链接 |
| 步 4 依赖/锁文件同步 | ✅ `pnpm install` 完成，链接生效 | 安装输出 + 链接检查 |
| 约束：不改 profile 模板与 `resolveBundleDir` | ✅ 未改动 | — |

**结论**：计划内改动全部落地，未越界。**P0/P1：0**。

## 阶段二：质量审查

### P1（已修）
无。

### P2（须记录，不属本单修复范围）
- **P2-1｜修复只解除了第一层阻断**：bundle 解析已通过（`--profile web --dump-config` exit 0），但真实启动在**更深一层**失败——`flowforge: plugin tree failed to load: loader entries failed to apply`，含 7 条 `ERR_MODULE_NOT_FOUND`（`@flowforge/harness-env-registry`、`@flowforge/llm-openroute`、`@flowforge/session-log-export`、profile 侧 `@flowforge/web-app`、仓库侧 `@flowforge/cats-routes`）。
  **归因**：这些是**独立根因**——`pnpm build`（`tsc -b tsconfig.host.json && tsdown`）因 `tsc -b` 报错（既有类型债）**短路**，`tsdown` 从不执行，`lib/` 构建产物永不产出（实测 `packages/cats/routes/lib/index.js` 未产出）。
  **处置**：按 BUG_PROTOCOL **B4 一因一单**，另立新工单（P-544），并把本轮回归判定为 `⚠️ Partial`（部分修复，仍有残留）。

### P3（登记）
- **P3-1｜`web/package.json` 的自述主入口** `main: src/index.ts`：该包是 Next.js 应用，`main` 指向源码的意义待确认（不属本单范围，未改动）。
- **P3-2｜profile 目录残留**：`~/.flowforge/profiles/node_modules/` 下有 136 个 `@flowforge/*`（含一份 `lib/` 缺失的 `web-app`），来源为早前安装，未纳入本轮处置。

## 审查结论

- 规格合规：**通过**（计划 4 步全落地，未越界）
- 质量：**通过**（无 P1；P2-1 已按 B4 拆单并改判 `⚠️ Partial`；P3 登记）
- 放行至 verify：**是**（验证范围限定为「第一层根因已消除」，端到端启动另见 P-544）
