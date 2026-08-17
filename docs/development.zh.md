# 开发指南

[English](development.md) | 中文

> **文档 ID**：development.zh.md
> **范围**：如何构建、测试并向 FlowForge 贡献。
> **配套规范**：[AGENTS.md](../AGENTS.md)（强制 AI 工具与 Git 规则）、[CONTRIBUTING.md](../CONTRIBUTING.md)。

FlowForge 是一个 TypeScript pnpm 单体仓库，**每一项能力都是一个 Cordis 插件**（`packages/*`，作用域 `@flowforge/*`），构建于 vendored 的 [Cordis](https://github.com/cordiverse/cordis) 内核（rescoop 为 `@flowforge/cordis`）。Python 3.11+ 单体（`agents/`、`brain/`、`core/`、`llm/`、`loop/`、`forgemind/`、`web/`、`sdk.py`）为 **legacy**，处于 sunset 路径。

- **活跃主线** → TypeScript：使用 `pnpm`。
- **Legacy 主线** → Python：使用 `pytest` / `ruff`。

## 环境前置

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | `^22.19.0 \|\| >=24.0.0` | 由 `package.json` 的 `engines` 强制。 |
| pnpm | `11.7.0` | 通过 Corepack 安装（`corepack enable && corepack prepare pnpm@11.7.0 --activate`）。 |
| Python | `>=3.11` | 仅 legacy Python 单体及其测试需要。 |
| Git | 任意较新版本 | 所有远程操作均经 `./mgr`（见下）。 |

> **平台感知**：`flowlight/flowforge/mgr` → Gitee（base `master`）；`flowlight-ai/...` → GitHub（base `main`）。仅在当前所在平台的目录下开发，且只向该平台提交 PR。

## 仓库初始化（TypeScript）

```sh
git clone https://gitee.com/flowlight/flowforge.git   # Gitee（base: master）
cd flowforge
corepack enable
pnpm install
```

`pnpm install` 会为 `vendor/*`、`packages/*/*` 与 `apps/*` 安装工作区依赖。

## 构建与验证

```sh
pnpm build        # 构建 Host aggregate：tsc -b tsconfig.host.json
pnpm typecheck    # 仅类型检查（与 build 同一 tsc 阶段）
pnpm lint         # oxlint 静态检查
pnpm test         # vitest run
```

### 提交前最小检查集

仅运行**覆盖你改动面的检查**。穷尽覆盖与兼容性矩阵由 CI 负责——不要本地全量跑。

| 改动类型 | 运行 |
|----------|------|
| 纯 TypeScript | `pnpm typecheck` + `pnpm lint` |
| 行为变更 | 补充 `pnpm test` |
| 文档改动 | 同步对应文档 |
| 依赖 / 构建产物（`lib/`）改动 | 先 `pnpm build` |

## 运行主机

> **状态**：主机 CLI（`pnpm flowforge` / `pnpm start`，入口 `apps/cli/src/bin.ts`）为 **planned / stage 3**，`apps/cli` 尚未落地。**当前不可运行。**

在 `apps/cli` 落地之前，通过各包自身的示例与测试套件来使用系统：

```sh
pnpm test                       # 运行整个 vitest 套件
pnpm vitest <path/to/file>      # 运行聚焦测试
```

各包的示例与入口见 `packages/<group>/<pkg>/`。

## Python 单体（legacy）

Python 3.11+ 单体已冻结进入 sunset。仅在 TS 重写尚未覆盖你所需能力时使用。

```sh
# 创建虚拟环境并安装（可编辑 + dev 依赖）
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# 检查与测试
ruff check .                   # 静态检查（行宽 110，py311）
ruff format .                  # 格式化（双引号）
pytest                         # 运行 Python 测试套件
mypy .                         # 严格类型检查（可选）
```

Python 配置（pytest markers、ruff、mypy）定义于 [`pyproject.toml`](../pyproject.toml)。

## Git 工作流（最高优先级）

**禁止使用 `git push`、`curl` 或 `Invoke-RestMethod` 直接操作 Git 远程。** 所有 commit / push / PR / sync 操作**必须**通过 `./mgr`。绕过会跳过强制规范检查（提交信息、PR 标题、PR 描述），产生有问题的 PR。

```sh
./mgr pull                                          # 拉取当前平台更新
./mgr commit "type(scope): 描述 [agentID]"          # 提交（强制规范检查）
./mgr push --pr --title "PR标题" --body "PR描述"     # push + 创建 PR（推荐）
./mgr sync "type(scope): 描述 [id]" --body "..."    # 提交+push+PR 一键完成
./mgr pr "type(scope): 描述 [id]" --body "..."      # 为当前分支创建 PR
./mgr merge-cross --dry-run                          # 预览双端差异
./mgr merge-cross                                    # 跨平台双向合并（手动触发）
```

> **AI 工具**：即便"只是创建一个 PR"，也必须使用 `./mgr pr`。直接调用 Gitee/GitHub API 会导致乱码、无描述、无规范检查，属于严重违规。

### 提交信息格式（强制）

```
type(scope): 简短描述 [#PR] [智能体ID]
```

- `type`：`feat` / `fix` / `refactor` / `chore` / `docs` / `test` / `ci` / `perf`
- **必须带智能体署名**：`[sherlock]` / `[luban]` / `[wenxin]` / `[humming]` / `[keane]` / `[vangogh]` / `[davinci]` / `[sqrl]` / `[butterfly]`

示例：`feat(api): 新增用户认证接口 [sherlock]`

### 主干保护

- **禁止直接 push** 到 `master`/`main`，必须走 PR。
- 禁止创建 `dev` 等长期分支。临时分支（`feat/xxx`、`fix/xxx`）合入后立即删除。

## 开发红线

1. 禁止提交密钥/Token（一律环境变量注入）。
2. 禁止硬编码提示词/路径/端口。
3. `.venv/`、`node_modules/`、`__pycache__/`、`.autonomous/patches/` 不入库。
4. 禁止绕过 PR 直接合入主干。
5. 提交前必须运行 lint 和测试。
6. LLM 生成内容必须经 LLM 审核（T7 铁律）。
7. Web 功能必须操控真实浏览器验证 DOM（T8 铁律）。
8. 单文件不超过 1000 行。

## 项目结构

```
flowforge/
├── vendor/                 # vendored 依赖（rescoop 为 @flowforge/*）：cordis、cosmokit……
├── packages/               # TS 插件（活跃重写）—— packages/<group>/<pkg>/
├── apps/                   # (planned / stage 3) 主机 CLI —— apps/cli/src/bin.ts
├── web/                    # Web UI（Next.js 前端）
├── native/landlock-run/    # 原生沙箱运行器（独立子工程）
├── docs/                   # 规格 / 架构 / 开发文档
├── mgr  mgr.cmd  mgr.ps1   # 强制 Git 工作流 CLI（禁止直接 git 远程操作）
├── scripts/                # 辅助脚本
└── agents/ brain/ core/ llm/ loop/ forgemind/ web/ sdk.py  # Python 3.11+ 单体（legacy，sunset）
```

## 延伸阅读

- 架构与设计：[docs/arch.md](../arch.md)、[docs/design.md](../design.md)、[docs/spec.md](../spec.md)
- Git 工作流规范：[docs/git-workflow.md](git-workflow.md)
- 工程通用规范：[docs/dev-spec.md](dev-spec.md)
- AI 工具规则手册：[AGENTS.md](../AGENTS.md)
