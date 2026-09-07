---
name: finishing-a-development-branch
description: 实现完成、测试全绿后使用——验证测试 → mgr PR → 清理分支；集成方式是操作者的决定，不是你的。
phase: finish
source: superpowers/finishing-a-development-branch → flowforge 适配（EP0-1 T0.1.7⑫）
---

# 完成开发分支（finishing-a-development-branch）

## 触发时机

- 实现完成、全部测试通过，需要决定如何集成时。

**核心原则**：验证测试 → 检测环境 → 呈现选项 → 执行选择 → 清理。

## 流程步骤

### 第 1 步：验证测试（证据标准见 ⑩）

跑全量测试套件（`pnpm vitest run` + `pnpm typecheck`）。

**失败** → 报告失败并停下——菜单在绿色之后才有意义。测试不过就问"选哪个集成方式"是把决定建立在沙子上。

### 第 2 步：检测环境

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
WORKTREE_PATH=$(git rev-parse --show-toplevel)
```

普通仓库 / 命名分支 worktree / detached HEAD 三种状态决定菜单形态与清理方式。

### 第 3 步：确认基准分支

本分支从哪分叉（计划/会话/上游一般有记录）；不确定就问——**合错基准的代价极高**。

### 第 4 步：呈现选项（flowforge 场景固定为 mgr 路径）

**普通仓库与命名分支 worktree**：

```
实现完成，接下来？

1. 经 mgr 创建 PR（推荐——仓库规范强制：所有变更走 PR，禁止直接合入 main/master）
2. 保留分支待操作者处理
3. （仅操作者明确要求时）本地合入基准分支

选哪个？
```

**detached HEAD**：推送为新分支 → mgr PR；或保留原样。

菜单**原样呈现**、等操作者回答——集成是操作者的决定。丢弃分支只响应操作者明确请求（且要键入 `discard` 确认）。

### 第 5 步：执行选择

**mgr PR（标准路径）**：
- `./mgr sync` 提交并推送、`./mgr push --pr` 创建/更新 PR（禁止直接 git push / 直接合 master）；
- commit 消息遵循 git-workflow 规范（类型前缀 + 署名），mgr 会拦截不合规消息；
- PR 报告给操作者后，**保留工作分支**——操作者在里面迭代 PR 反馈。

**保留原样**：报告"保留分支 <名>，工作区在 <路径>"。

**丢弃（仅明确请求）**：确认对话（将永久删除：分支、全部提交、worktree；键入 `discard` 确认）后执行。

### 第 6 步：清理工作区

仅本地合入与确认丢弃时执行；PR 与保留路径**永远保留** worktree。
- 普通仓库：无事可清。
- `.worktrees/` 下的自建 worktree：`git worktree remove` + `git worktree prune`；移除被拒（含未提交文件）时展示 `git status --porcelain -uall` 清单让操作者选（提交/移走/删除），**绝不自行 `--force`**。
- 宿主环境拥有的工作区：原样保留。

## 门禁

典型自我合理化对照：

| 念头 | 事实 |
|---|---|
| "测试本会话早跑过了" | 对将要集成的树跑；绿色只证明跑过的那棵树 |
| "他们显然想合入" | 集成是操作者的决定；呈菜单、等待 |
| "PR 挂上了，worktree 是杂物了" | PR 反馈在那个 worktree 里修；落地前它留着 |
| "这个 worktree 看着也过期了，顺手清了" | 只清自己建的（`.worktrees/`）；其余属于宿主 |
| "移除被拒，--force 收个尾" | 拒绝意味着文件只存在于那里；--force 永久销毁。展示给操作者问 |
| "推送被拒，force-push 解决" | 远端动了；先调查；force-push 仅操作者明确要求 |
| "基准分支显然是 main" | 确认分叉点或问；合错基准代价极高 |

## 与我方规范对接

- **对应状态机**：本资产覆盖 `finish` 阶段；进入它的前提是 verify 门禁已过（verificationEvidence 已记录）。
- **mgr 强制**：flowforge 仓库所有集成一律走 mgr（`docs/mgr/`）：PR 创建/更新用 `mgr sync` / `mgr push --pr`；禁止直接 push main/master、禁止绕过 mgr 的 curl/Invoke-RestMethod；`./mgr cleanup` 负责已合并分支清理（本地 `--dry-run` 预览 / `--remote` 远端），保留 dev/* 分支池与 main/master。
- **提交规范**：commit 消息格式（类型 + 描述 + 署名）由 mgr 拦截校验（git-workflow.md）。
- **Gitee 优先**：主仓库 Gitee；GitHub 同步可能因访问问题失败，失败不阻塞主流程。
- **收尾产物**：PR 链接 + 验证证据（⑩）一起汇报；`docs/process/verifications/` 归档。
