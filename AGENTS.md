# AGENTS.md — AI 工具工作规范（强制）

> 本文件适用于所有 AI 编码工具：Trae / Claude Code / Cursor / Gemini / OpenCode / WorkBuddy / Qorder 等。
> 工具在本仓库工作时**必须读取并遵守**本文件全部规则。

## 仓库布局

FlowForge 是 TypeScript pnpm 单体仓库，核心信条是**一切皆插件**，构建在 vendored 的 [Cordis](https://github.com/cordiverse/cordis) 内核之上（rescoop 为 `@flowforge/cordis`，源码在 `vendor/cordis`）。顶层目录结构：

```
flowforge/
├── vendor/                 # vendored 依赖（rescoop 为 @flowforge/*）
│   ├── cordis/             #   插件内核 → @flowforge/cordis（核心）
│   ├── cosmokit/  schemastery/  loader/
│   ├── group/  include/  hmr/  timer/  logger-console/
├── packages/               # TS 插件（active rewrite），结构 packages/<group>/<pkg>/
│   ├── core/  harness/  llm/  web/  acp/  workflow/  mcp/  ...
├── apps/                   # (planned / stage 3) 主机 CLI，入口 apps/cli/src/bin.ts
├── web/                    # Web UI（Next.js 前端）
├── native/landlock-run/    # 原生沙箱运行器（独立子工程）
├── docs/                   # 规范 / 架构 / 开发文档
├── mgr  mgr.cmd  mgr.ps1   # 强制 Git 工作流 CLI（禁止直接 git 远程操作）
├── scripts/                # 辅助脚本
├── agents/  brain/  core/  llm/  loop/  forgemind/  web/  sdk.py   # Python 3.11+ 单体（legacy，sunset 路径）
└── ...
```

- `packages/` 下的每个包都是 cordis 插件，按 `packages/<group>/<pkg>/` 组织；vendored 库统一放在 `vendor/`（cordis、cosmokit、schemastery、loader、group、include、hmr、timer、logger-console）。
- TS 重写（`packages/*`）是当前活跃主线；Python 3.11+ 单体（`agents/`、`brain/`、`core/`、`llm/`、`loop/`、`forgemind/`、`web/`、`sdk.py`）为 legacy 实现，处于 sunset 路径——`pnpm` 管 TS，`pytest`/`ruff` 管 Python。

## 常用命令

```sh
pnpm install                       # 安装依赖（Corepack pnpm@11.7.0）
pnpm build                         # 构建 Host aggregate：tsc -b tsconfig.host.json
pnpm typecheck                     # 类型检查（同 build 的 tsc 阶段）
pnpm lint                          # oxlint 静态检查
pnpm test                          # vitest run 运行测试

# Git 远程操作一律走 ./mgr（详见下方 ./mgr  essentials）
./mgr pull                                          # 拉取当前平台更新（保持在共享主干分支）
./mgr commit "type(scope): 描述 [agentID]"          # 本地提交（强制规范检查；本地始终在主干，不建私有分支）
./mgr sync "type(scope): 描述 [agentID]" --body "PR描述" # 提交+固定远端分支 sync/<agent>+PR 一键完成（推荐：本地停留在主干）
./mgr push --pr --title "PR标题" --body "PR描述"     # 备选：若当前已在非主干分支，push+创建 PR
./mgr pr "type(scope): 描述 [agentID]" --body "PR描述"  # 为当前分支创建 PR（通常配合 ./mgr sync 使用）
./mgr merge-cross --dry-run                          # 查看双端差异
./mgr merge-cross                                    # 跨平台单向合并（手动触发，当前平台→对端）
```

> **Node 版本**：`^22.19.0 || >=24.0.0`，pnpm `11.7.0`（Corepack）。
> **平台感知**：`flowlight/flowforge/mgr` → Gitee（base `master`）；`flowlight-ai/...` → GitHub（base `main`）。
> **主机 CLI** `pnpm flowforge` / `pnpm start`（`apps/cli/src/bin.ts`）为 **planned / stage 3**，目录尚未落地，暂不可运行。

### 本地检查

提交前只运行**覆盖你改动面的最小检查集**：纯 TS 改动跑 `pnpm typecheck` + `pnpm lint`；行为变更补 `pnpm test`；文档改动跑对应文档同步；依赖构建产物（`lib/`）的检查先 `pnpm build`。全量覆盖与兼容性矩阵由 CI 负责，不要本地全量跑。

## Git 工作流（最高优先级）

### 1. 平台感知

- 脚本位置决定当前平台：
  - `flowlight/<repo>/mgr` → Gitee 平台（base=master）
  - `flowlight-ai/<repo>/mgr` → GitHub 平台（base=main）
- **在哪个平台目录下开发，就只向该平台提交 PR**，禁止同时推送双端。

### 2. 必须使用 ./mgr 命令（零绕过红线）

**禁止直接使用 `git push`、`curl`、`Invoke-RestMethod` 等任何方式绕过 `./mgr` 操作 Git 远程仓库。**
所有 commit / push / PR / sync 操作**必须**通过 `./mgr`，否则：
- mgr 的规范检查会被绕过，导致提交信息/PR 标题/描述不合规
- PR 可能出现乱码、无描述等问题

```bash
./mgr pull                                          # 拉取当前平台更新
./mgr commit "type(scope): 描述 [署名]"              # 提交（强制规范检查）
./mgr sync "type(scope): 描述 [署名]" --body "PR描述" # 提交+远端临时分支+PR 一键完成（推荐：本地停留在主干）
./mgr push --pr --title "PR标题" --body "PR描述"     # 备选：若已在非主干分支，push+创建 PR
./mgr pr "type(scope): 描述 [署名]" --body "PR描述"  # 为当前分支创建 PR
./mgr merge-cross --dry-run                          # 查看双端差异
./mgr merge-cross                                    # 跨平台单向合并（手动触发，当前平台→对端）
```

> **AI 工具特别注意**：即使你认为"只是创建一个 PR"，也必须用 `./mgr pr`。
> 直接调 Gitee/GitHub API 会导致中文乱码、无描述、无规范检查，属于严重违规。

### 3. 主干保护

- **本地分支公用**：开发者始终停留在共享主干分支（Gitee=`master` / GitHub=`main`）上工作，**不创建任务级本地分支**（`feat/xxx`、`fix/xxx` 等）。本地分支是团队共享状态，开私有本地分支会偏离共享状态、影响他人协作。
- 提交时通过 `./mgr sync` 在**远端**生成**固定** PR 分支 `sync/<agent>`（`<agent>` 取自标题 `[署名]`），该分支仅存在于远端、PR 合入后清理；本地始终停留在主干，**绝不切换本地分支**。
- **禁止直接 push 到 master/main**，必须走 PR。
- 禁止创建 dev 等长期分支。
- 远端临时 PR 分支合入后由平台/`./mgr` 自动清理，不要手动保留。

### 4. 跨平台同步

- 日常开发仅操作当前平台。
- 需要同步到对端时，使用 `./mgr merge-cross` 手动触发。
- merge-cross 会读取双端提交差异，在目标平台创建同步 PR。

### 5. 提交信息格式（强制）

```
type(scope): 简短描述 [#PR号] [智能体ID]
```

- type: `feat` / `fix` / `refactor` / `chore` / `docs` / `test` / `ci` / `perf`
- **必须带智能体署名**：`[sherlock]` / `[luban]` / `[wenxin]` / `[humming]` / `[keane]` / `[vangogh]` / `[davinci]` / `[sqrl]` / `[butterfly]`

示例：`feat(api): 新增用户认证接口 [sherlock]`

## 开发红线

1. 禁止提交密钥/Token（一律环境变量注入）
2. 禁止硬编码提示词/路径/端口
3. `.venv/`、`node_modules/`、`__pycache__/`、`.autonomous/patches/` 不入库
4. 禁止绕过 PR 直接合入主干
5. 提交前必须运行 lint 和测试
6. LLM 生成内容必须经 LLM 审核（T7 铁律）
7. Web 功能必须操控浏览器验证 DOM（T8 铁律）
8. 单文件不超过 1000 行

## 详细规范

- Git 工作流完整规范：`docs/git-workflow.md`
- 工程通用规范：`docs/dev-spec.md`
- 架构设计：`docs/arch.md`、`docs/design.md`
- 功能规格：`docs/spec.md`

## 标准开发流程

```
1. ./mgr pull                          # 拉取最新（保持在共享主干分支 master/main）
2. ... 开发 ...                        # 始终在 master/main 上工作，不切私有本地分支
3. ./mgr sync "feat(x): 描述 [id]" --body "PR描述"   # 一键：提交已暂存改动 + 固定远端分支 sync/<id> + PR（本地停留主干）
4. 平台 Web 合入 PR
5. ./mgr pull                          # 合入后拉回主干，保持本地 master/main 最新
6. ./mgr merge-cross                   # 需要时跨平台同步
```
