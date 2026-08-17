# Git 工作流规范（强制）

> 本规范在 flowforge 仓库执行。AI 工具（Trae / Claude Code / Cursor / Gemini / OpenCode / WorkBuddy / Qorder 等）必须严守本规范。

## 1. 平台感知模型（核心变更）

### 1.1 双平台双目录

| 平台 | 远程地址 | 本地目录 | 主干分支 |
|------|---------|---------|---------|
| Gitee（origin） | https://gitee.com/flowlight-ai/flowforge.git | `<workspace>/flowlight/flowforge` | `master` |
| GitHub（origin） | https://github.com/flowlight-ai/flowforge.git | `<workspace>/flowlight-ai/flowforge` | `main` |

```
<workspace>/flowlight/flowforge     → Gitee 端 (origin=gitee.com,  base=master)
<workspace>/flowlight-ai/flowforge  → GitHub 端 (origin=github.com, base=main)
```

### 1.2 平台感知原则（最高优先级）

- **在哪个平台目录下开发，就只向该平台提交 PR**，不再同时推送双端。
- `./mgr` 脚本根据所在目录自动检测当前平台：
  - `flowlight/<repo>/mgr` → 当前平台 = Gitee
  - `flowlight-ai/<repo>/mgr` → 当前平台 = GitHub
- `commit` / `push` / `pr` / `sync` 等命令仅操作当前平台，不触碰对端。
- **跨平台同步**：使用 `./mgr merge-cross` 命令手动触发（详见 §5），禁止在日常开发中同时推送双端。

### 1.3 分支模型

- **本地分支公用**：开发者始终停留在共享主干分支（Gitee=`master` / GitHub=`main`）上工作，**不创建任务级本地分支**（`feat/xxx`、`fix/xxx` 等）。本地分支是团队共享状态，开私有本地分支会偏离共享状态、影响他人协作。
- **仅主干开发**：Gitee = `master` / GitHub = `main`，所有代码变更必须通过 PR 合入。
- **禁止直接 push 到 master/main**：`./mgr push` 会拒绝并提示创建 PR。
- **禁止创建/使用 `dev`、`develop` 等长期分支**。提交时通过 `./mgr sync` 在**远端**自动生成临时 PR 分支（`cross/...` / `feat/...`），仅存在于远端、PR 合入后清理；不要在本地保留任务分支。
- Gitee master 分支保护：pusher=none, merger=admin, mode=review（`./mgr protect` 配置）。

## 2. 提交前必拉取、收尾必提交

- 开始修改前先 `./mgr pull`，确保基于最新代码工作。
- 若本地有未提交改动，先提交或 stash 后再 pull。
- 任务完成、验证通过后必须提交并推送，禁止搁置改动。
- **提交前必须运行 lint 和测试**，确保不引入新问题。

## 3. 提交信息格式（强制署名）

```
type(scope): 简短描述 [#PR号] [智能体ID]
```

- `type` 遵循 Conventional Commits：`feat` / `fix` / `refactor` / `chore` / `docs` / `test` / `ci` / `perf`。
- `scope` 为可选模块名。
- **每次提交必须带智能体署名**，按角色职责选取：

| ID | 名称 | 角色 |
|---|---:|---|
| `wenxin` | 文心 | 文档员 |
| `sherlock` | 夏洛克 | 开发者 |
| `luban` | 鲁班 | 架构师 |
| `vangogh` | 梵高 | 审查员 |
| `davinci` | 达芬奇 | 测试员 |
| `keane` | 鹰·凯恩 | 产品经理 |
| `humming` | 蜂鸟·闪电 | 运维 |
| `sqrl` | 铃鼓 | 开源程序员 |
| `butterfly` | 蝴蝶 | Trae 桥接 |

示例：`fix(web): 修复登录超时 [luban]`、`docs(api): 补充健康检查说明 [wenxin]`

## 4. 红线

- **禁止同时推送双端**：使用 `./mgr commit` + `./mgr push --pr` 仅推当前平台，跨平台同步用 `./mgr merge-cross`。
- **禁止直接 push 到 master/main**：必须走 PR。
- 禁止在未 pull 的情况下直接提交推送。
- 禁止创建 dev 等长期分支。
- **禁止提交任何密钥/Token**（如 `or-` 前缀 OpenRoute 密钥、管理员密码）；测试一律通过环境变量注入。
- `.venv/`、`node_modules/`、`__pycache__/`、`.autonomous/patches/`、运行时数据等一律不入库。
- 涉及 LLM 生成或网页发布的变更，遵守铁律：T7（LLM 二次审核）、T8（浏览器 DOM 验证）。

## 5. 仓库工具 ./mgr

### 5.1 日常开发命令（平台感知，仅操作当前平台）

```bash
./mgr status              # 查看双端同步状态 (↑N 领先 / ↓N 落后, 标 → 为当前平台)
./mgr pull                # 拉取当前平台远端更新
./mgr commit "fix(x): 描述 [署名]"   # 提交到当前平台
./mgr push --pr           # push 当前分支并自动创建 PR (推荐)
./mgr push                # 仅 push, 不创建 PR
./mgr pr "标题"           # 为当前分支创建 PR
./mgr sync                # 提交+push+PR 一键完成 (主干自动建临时分支)
./mgr log [N]             # 查看最近 N 条提交 (默认 5)
./mgr diff                # 查看未提交改动
./mgr branch              # 查看当前分支
./mgr list                # 查看仓库信息与平台状态
```

### 5.2 跨平台合并命令（手动触发）

```bash
./mgr merge-cross --dry-run     # 查看双端提交差异 (不创建 PR)
./mgr merge-cross               # 单向合并: 当前平台主干 → 对端主干 (创建对端同步 PR)
```

- `merge-cross` 为**单向**（当前平台 → 对端）：Gitee 触发则同步到 GitHub，GitHub 触发则同步到 Gitee；**不支持反向，也不支持 `--g2l` / `--l2g`**。
- `merge-cross` 读取双端提交差异（使用 tree-hash 对比，自动跳过内容一致的仓库），在目标平台创建同步 PR。
- 若有合并冲突，脚本自动中止并提示手动处理，不会破坏工作区。
- 脚本会自动 stash 未提交的本地更改，合并完成后恢复。

### 5.3 其他命令

```bash
./mgr mirror-setup        # 配置双端互指 mirror 远程
./mgr protect             # 设置 Gitee master 分支保护
```

### 5.4 作用域

- `./mgr` 默认仅管理本仓库。
- `--all` 对本仓库仍只操作本仓库；`--repo NAME` 仅管理指定仓库（本仓库仅可填 flowforge）。

## 6. 标准工作流

### 6.1 日常开发流程（单平台）

```
1. cd flowlight/flowforge          # 或 cd flowlight-ai/flowforge (GitHub 端)
2. ./mgr pull                      # 拉取最新代码（保持在共享主干分支 master/main）
3. ... 开发 ...                     # 始终在 master/main 上工作，不创建任务级本地分支
4. ./mgr sync "feat(x): 功能描述 [sherlock]" --body "PR描述"
                                   # 一键：提交本地改动 + 远端临时分支 + PR（仅当前平台）
5. 在平台 Web 界面合入 PR
6. ./mgr pull                      # 合入后拉回主干，保持本地 master/main 最新
```

> **本地分支公用（红线）**：开发者始终停留在共享主干分支（Gitee=`master` / GitHub=`main`）上工作，**不创建任务级本地分支**（`feat/xxx`、`fix/xxx` 等）。本地分支是团队共享状态，开私有本地分支会偏离共享状态、影响他人协作。提交时通过 `./mgr sync` 在**远端**自动生成临时 PR 分支（`cross/...` / `feat/...`），该分支仅存在于远端、PR 合入后清理；本地始终停留在主干。

### 6.2 跨平台同步流程（阶段性触发）

```
1. 确认源平台 PR 已合入主干
2. ./mgr merge-cross --dry-run     # 查看双端差异（当前平台 → 对端）
3. ./mgr merge-cross               # 跨平台单向合并（当前平台→对端），在**对端**创建同步 PR
4. 在**对端**平台合入同步 PR（merge-cross 为单向，不支持反向）
5. 若有冲突, 解决后重新运行 merge-cross
```

### 6.3 凭据配置

- **Gitee Token**：存放于 `.mgr-token` 文件（仓库根目录或 `flowlight/` 根目录）或 `GITEE_TOKEN` 环境变量。
- **GitHub Token**：存放于 `~/.github-token` 文件或 `GITHUB_TOKEN` 环境变量；需含 `repo` + `workflow` 权限。
- Token 文件不入库（已加入 `.gitignore`）。

## 7. AI 工具合规要求

所有 AI 编码工具（Trae / Claude Code / Cursor / Gemini / OpenCode / WorkBuddy / Qorder 等）在本仓库工作时：

1. **必须使用 `./mgr` 命令**进行提交、推送、PR 操作，禁止直接使用 `git push`。
2. **必须遵守平台感知原则**：在当前平台目录下开发，仅向当前平台提交 PR。
3. **必须使用 merge-cross 进行跨平台同步**，禁止在 commit/push 时同时推送双端。
4. **必须按 §3 格式撰写提交信息**，包含 type、scope、智能体署名。
5. **必须在提交前运行 lint 和测试**。
6. 规范文件位置：`docs/git-workflow.md`（本文件）、`docs/dev-spec.md`。
7. AI 工具配置文件：仓库根目录 `AGENTS.md`（所有工具通用）、`CLAUDE.md`（Claude Code）、`.cursorrules`（Cursor）。
