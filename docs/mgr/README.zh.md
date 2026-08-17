[English](README.md) | 中文

# mgr — Git / PR / 同步控制面

> `mgr` 是 flowforge 仓库**强制**使用的 git / PR / 跨平台同步控制面。禁止用原始
> `git push` 或 `curl` 直连远程——每一次提交、推送、PR、同步、跨平台合并都必须走 `./mgr`。
> 完整、权威规范见 [`docs/git-workflow.md`](../git-workflow.md)。
> 脚本本体在仓库根目录：`mgr`（另有 `mgr.cmd` / `mgr.ps1` 包装）。

## 平台感知（脚本所在路径决定当前平台）

`mgr` 会根据脚本在磁盘上的位置自动识别当前平台。请**只在单一平台**开发，并只向该平台提 PR；
跨平台同步是单独、手动的一步。

| 脚本位置                  | 当前平台 | 远程          | 主干分支 |
|--------------------------|----------|---------------|----------|
| `flowlight/<repo>/mgr`   | Gitee    | gitee.com     | `master` |
| `flowlight-ai/<repo>/mgr`| GitHub   | github.com    | `main`   |

- `commit` / `push` / `pr` / `sync` **只**作用于当前平台——绝不碰对端。
- 跨平台同步**只能**用 `./mgr merge-cross`（手动触发）。

## 关键命令

| 命令 | 用途 |
|------|------|
| `./mgr pull` | 拉取并快进/合并当前平台远端更新。 |
| `./mgr commit "type(scope): 描述 [agentID]"` | 暂存全部并在当前平台提交（强制校验消息格式）。 |
| `./mgr push [--pr] [--title "标题"] [--body "说明"]` | 推送当前分支；带 `--pr` 同时创建/更新 PR。拒绝直接推送到 `master`/`main`。 |
| `./mgr pr "type(scope): 描述 [agentID]" [--body "说明"]` | 为当前分支在当前平台创建 PR。 |
| `./mgr sync "type(scope): 描述 [agentID]" [--body "说明"]` | 一键完成：提交改动 + 智能推送 + 开 PR。在主干上会自动建临时分支 `sync/<base>-<ts>`。 |
| `./mgr status [--cross] [--fetch]` | 显示当前平台分支与同步状态（`--cross` 显示双端，`--fetch` 从远端刷新）。 |
| `./mgr merge-cross [--dry-run]` | **单向**跨平台合并：当前平台 → 对端。在对端创建同步 PR。`--dry-run` 仅查看文件差异。 |
| `./mgr log [N]` | 查看最近 N 条提交（默认 5）。 |
| `./mgr diff` | 查看未提交改动。 |
| `./mgr branch` | 查看当前分支。 |
| `./mgr list` | 查看仓库信息与平台状态。 |
| `./mgr mirror-setup` | 配置双端互指 mirror 远程。 |
| `./mgr protect` | 设置 Gitee `master` 分支保护（仅 Gitee）。 |

全局作用域参数（放在子命令之前）：`--all`、`--repo NAME`。

## 提交 / PR 消息格式（强制校验）

消息不符合以下格式时，`./mgr` 会**在本地直接中止**：

```
type(scope): 简短描述 [#PR号] [智能体ID]
```

- `type` 必须是脚本强制校验的其中之一：`feat` `fix` `refactor` `chore`
  `docs` `test` `ci` `perf` `style` `build`。
- `scope` 为可选模块名。
- 末尾的 `[智能体ID]` **必填**，且必须是：`wenxin` `sherlock`
  `luban` `vangogh` `davinci` `keane` `humming` `sqrl` `butterfly` 之一。
- `commit`、`pr`、`sync` 都会强制校验。示例：
  `fix(web): 修复登录超时 [luban]`、`docs(api): 补充健康检查说明 [wenxin]`。

## 主干保护

- **绝不直接指向 `master` / `main`。** `./mgr push` 在主干分支上会拒绝推送，并提示改用 PR 或先切分支。
- 所有改动经 PR 合入：Gitee 走 `master` PR，GitHub 走 `main` PR。
- 禁止创建 `dev` / `develop` 等长期分支。临时分支 `feat/xxx` / `fix/xxx` 合入后立即删除。

完整、权威规范请见 [`docs/git-workflow.md`](../git-workflow.md)。
