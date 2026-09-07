---
name: using-git-worktrees
description: 开始需要与当前工作区隔离的特性开发，或执行实施计划之前使用——先检测既有隔离，再用原生工具，最后退回 git worktree。
phase: implement（前置）
source: superpowers/using-git-worktrees → flowforge 适配（EP0-1 T0.1.7⑪）
---

# Git worktree 隔离开发（using-git-worktrees）

## 触发时机

- 开始需要与当前工作区隔离的特性开发（保护当前分支不被污染）。
- 执行实施计划之前（③④ 的准备步骤）。

**核心原则**：先检测既有隔离 → 再用原生工具 → 最后退回手动 git worktree。永远不与宿主环境对抗。

## 流程步骤

### 第 0 步：检测既有隔离

创建任何东西之前，先确认是否已在隔离工作区：

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
BRANCH=$(git branch --show-current)
```

- **子模块防护**：`GIT_DIR != GIT_COMMON` 在 git 子模块内也为真；先 `git rev-parse --show-superproject-working-tree` 确认不是子模块再下结论。
- **已在隔离工作区**（且非子模块）：跳到第 2 步项目设置，**不要再建** worktree。
- **普通检出**：若操作者未表达过 worktree 偏好，先征求同意："需要我建一个隔离 worktree 吗？保护你当前分支不被改动。"偏好已声明则直接执行；拒绝则就地工作。

### 第 1 步：创建隔离工作区（两个机制按序尝试）

**1a. 原生 worktree 工具（优先）**：宿主环境若有 `EnterWorktree`/`WorktreeCreate` 类工具、`/worktree` 命令或 `--worktree` 旗标，用它——原生工具管目录放置、分支创建与清理；绕过它会产生宿主看不见的幽灵状态。flowforge 场景下优先使用平台能力（shell 域 / limb/terminal）。

**1b. git worktree 退路**（仅当无原生工具）：

目录选择优先级：操作者声明的偏好 > 已有的项目本地 worktree 目录（`.worktrees` 优先于 `worktrees`）> 默认 `.worktrees/`（项目根）。

**安全校验（必须）**：`git check-ignore -q .worktrees`——未被忽略则先加入 `.gitignore` 并提交，否则整个 worktree 树会被提交进仓库。

```bash
git worktree add "$LOCATION/$BRANCH_NAME" -b "$BRANCH_NAME"
cd "$LOCATION/$BRANCH_NAME"
```

沙盒拒绝创建（权限错误）时：告知操作者沙盒阻止了 worktree 创建，就地工作并就地跑基线测试。

### 第 2 步：项目设置

自动检测并执行：Node 项目 `pnpm install`；其他语言走各自安装命令。

### 第 3 步：验证干净基线

跑全量测试（`pnpm vitest run`）：失败 → 报告失败，问操作者继续还是先查；通过 → 报告就绪：

```
worktree 就绪：<路径>
测试通过（N 个，0 失败）
准备实施：<特性名>
```

## 门禁

- **未过第 0 步检测不得创建**："我显然不在 worktree 里，不用查"——宿主创建的隔离和子模块都能骗过目测，检测命令说了算。
- **未确认忽略不得使用项目本地目录**：未忽略的 worktree 目录会把整棵树提交进仓库。
- **基线不绿不得开工**：脏基线让之后的每个失败都无法归因；带着失败继续是操作者的决定，不是你的。

典型自我合理化对照：

| 念头 | 事实 |
|---|---|
| "`git worktree add` 比找原生工具快" | 原生工具拥有放置/分支/清理的全部职责；绕过它是第一大错误 |
| "目录肯定被忽略了" | 跑 `git check-ignore`；未忽略 = 整棵树进仓库 |
| "工作区是新的，基线测试可以等等" | 脏基线让后续所有失败歧义化；现在就跑 |

## 与我方规范对接

- **mgr 分支规范**：worktree 中创建的分支同样走 mgr 提交流程；分支命名遵循 git-workflow 规范（禁止直接 push main/master）。
- **Windows 长路径风险**：本仓库在 Windows 下已识别长路径风险（33-stage 文档风险①）；`.worktrees/` 就近放在项目根可缓解，但 EP0 期 worktree 隔离**不强制启用**（决策点 D），mgr 直提分支仍为默认路径。
- **对应状态机**：本资产为 `implement` 阶段的前置步骤；Plane 2 将以 flowforge 的 shell/terminal 能力实现等价物。
- **清理**：分支收尾（⑫）负责 worktree 的回收，本资产只管创建与基线。
