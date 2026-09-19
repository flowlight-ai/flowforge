# plan: P-542 web profile 无法启动（hotfix）

> 实例：`p542-web-profile-boot` ｜ 规格（Spec）：`docs/test/bugs/round13-browser-e2e-2026-09-19.md`（§P-542 缺陷单即本 hotfix 的规格与根因分析） ｜ 工作流：hotfix

**目标（Goal）**：让官方入口 `pnpm start`（web profile）能正常启动，解除后端不可用对 T8 端到端验证的阻断。
**架构（Architecture）**：修两处装配缺陷——① `web/`（Next.js 前端）与 `packages/bundle/web-app`（profile bundle）**包名冲突** `@flowforge/web-app`；② `apps/cli` 未声明 in-box bundle `@flowforge/web-app`，导致 `resolveBundleDir` 的「安装目录优先」契约无法解析（对照 `@flowforge/base`/`@flowforge/headless` 均已声明）。
**技术栈（Tech Stack）**：pnpm workspace + Node ESM（`createRequire().resolve.paths` 解析）+ GitHub Actions 过滤器。

## 全局约束
- 前端包名按 bundle 源码注释记载的既定名 `@flowforge/web-frontend` 更正（`packages/bundle/web-app/src/index.ts:13/182`）。
- 不改 profile 模板、不改 `resolveBundleDir` 解析逻辑（契约本身正确）。
- 依赖变更必须同步 `pnpm-lock.yaml`，并以 `pnpm install --frozen-lockfile` 自证。

## 任务清单

### 任务 1：消除包名冲突 + 声明 in-box bundle 依赖

- [ ] **步骤 1：前端包改名**——`web/package.json` 的 `name` 由 `@flowforge/web-app` 改为 `@flowforge/web-frontend`（与 bundle 源码注释一致），消除与 `packages/bundle/web-app` 的重名。

```json
{ "name": "@flowforge/web-frontend", "private": true }
```

- [ ] **步骤 2：同步 CI 过滤器**——`.github/workflows/web-ci.yml` 4 处 `pnpm --filter @flowforge/web-app ...` 改为 `@flowforge/web-frontend`（否则过滤器歧义/失配）。

```yaml
- run: pnpm --filter @flowforge/web-frontend lint
- run: pnpm --filter @flowforge/web-frontend build
- run: pnpm --filter @flowforge/web-frontend exec playwright install --with-deps chromium
- run: pnpm --filter @flowforge/web-frontend test:e2e
```

- [ ] **步骤 3：apps/cli 声明 bundle 依赖**——在 `apps/cli/package.json` 依赖表中按字母序插入 `"@flowforge/web-app": "workspace:^"`，使 in-box bundle 在安装目录可解析（与 `@flowforge/base` / `@flowforge/headless` 同法）。

- [ ] **步骤 4：重装并自证锁文件（测试确认：重装后必须建立链接）**——`pnpm install` 建立链接，随后 `pnpm install --frozen-lockfile --ignore-scripts` 自证；本条为任务 1 的测试确认点（链接未建立即视为未通过）。

```bash
pnpm install --lockfile-only --ignore-scripts && pnpm install --frozen-lockfile --ignore-scripts
```

### 任务 2：回归验证（含真实启动证据）

- [ ] **步骤 1：解析性回归**——确认 `node_modules/@flowforge/web-app` 已链接、且 `--profile web` 不再抛 `cannot resolve profile bundle`。

```bash
ls -d node_modules/@flowforge/web-app
timeout 60 node --import tsx/esm apps/cli/src/bin.ts --profile web --dump-config | head -5
```

- [ ] **步骤 2：真实启动回归（测试证据，T8 前置）**——`pnpm start --no-open --port 5200` 启动后，用真实 HTTP 探测确认 Web 服务可访问（含真实浏览器 E2E 复跑）。

```bash
pnpm start --no-open --port 5200 &   # 后台启动
curl -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 30 http://127.0.0.1:5200/
```

- [ ] **步骤 3：缺陷单回填**——`docs/test/bugs.md` P-542 条目补 `开发自述`（修复提交号 + 改动点）与 `测试回归结论`（复现命令 + 真实输出 + 判定），并按 BUG_PROTOCOL 注明本轮修复/回归由同一执行体完成（operator 授权）。

## 计划自审清单
- [ ] 覆盖根因两处（重名 + 缺依赖声明），不越界改解析逻辑
- [ ] 依赖变更同步锁文件并 frozen 自证
- [ ] 回归证据为真实命令输出，非读码推断

## 校验登记
`ff_dev gate p542-web-profile-boot plan --evidence docs/process/plans/2026-09-19-p542-web-profile-boot.md` → 通过后 `ff_doctor plan` 本文件合规。
