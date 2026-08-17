# mgr 操作红线规则（AI 工具必读）

> 本文档是 flowforge 仓库根目录 `./mgr` 控制面的**规则手册**。所有 AI 编码工具（Trae / Claude Code / Cursor / Gemini / OpenCode / WorkBuddy / Qorder 等）在本仓库执行任何 git / PR / 同步操作时，**必须读取并遵守**以下规则。
> 完整规范见仓库 `docs/git-workflow.md`；脚本本体在仓库根目录 `mgr`（另有 `mgr.cmd`、`mgr.ps1`）。

## 零绕过红线（最高优先级）

- **规则：** 所有 commit / push / PR / sync / 跨平台合并操作**必须通过 `./mgr` 执行**，禁止直接用 `git push`、`git remote add` + `git push`、或 `curl` / `Invoke-RestMethod` 等任何方式绕过 `./mgr` 直连远程仓库。
- **规则：** 想"只是创建一个 PR"或"只是推一下"也必须用 `./mgr pr` / `./mgr push --pr`；直连 Gitee / GitHub API 会导致中文乱码、无描述、无规范检查，属于严重违规。
- **规则：** 脚本内部已处理 token 注入、规范校验、PR 累加与分支保护；绕过它会破坏这些保护。

## 平台感知（路径决定当前平台）

- **规则：** 脚本所在目录决定当前平台，开发前先确认你在哪一端：
  - `flowlight/<repo>/mgr` → 当前平台 = **Gitee**（origin=gitee.com，主干 `master`）
  - `flowlight-ai/<repo>/mgr` → 当前平台 = **GitHub**（origin=github.com，主干 `main`）
- **规则：** 在哪个平台目录下开发，**只向该平台提交 PR**，禁止同时推送双端。
- **规则：** `./mgr` 的 `commit` / `push` / `pr` / `sync` 只操作当前平台，绝不触碰对端。
- **规则：** 跨平台同步**只能**用 `./mgr merge-cross` 手动触发（见下文），禁止在日常 commit/push 时双端推送。

## 提交信息格式（强制署名，不合规则中止）

- **规则：** `commit` / `pr` / `sync` 的标题/消息**必须**符合格式 `type(scope): 描述 [#PR号] [智能体ID]`，否则 `./mgr` 本地报错并中止，不会提交或创建 PR。
- **规则：** 末尾的 `[智能体ID]` **必需**，且必须是合法署名之一：`wenxin` / `sherlock` / `luban` / `vangogh` / `davinci` / `keane` / `humming` / `sqrl` / `butterfly`。
- **规则：** 开头 `type` **必需**，且必须是合法类型之一：`feat` / `fix` / `refactor` / `chore` / `docs` / `test` / `ci` / `perf` / `style` / `build`（脚本实际强制校验的全部类型，见 `mgr` 第 609–611 行）。
- **规则：** 缺署名或缺合法 type，提交/PR 直接被拒。示例：`fix(web): 修复登录超时 [luban]`、`docs(api): 补充健康检查说明 [wenxin]`。

## 主干保护

- **规则：** **禁止直接 push 到 `master` / `main`**；在主干分支上 `.push` 会被拒绝并提示改用 PR 或先切分支。
- **规则：** 必须走 PR 合入主干（`master` 经 Gitee PR、`main` 经 GitHub PR）。
- **规则：** **禁止创建 `dev` / `develop` 等长期分支**；临时分支（`feat/xxx`、`fix/xxx`）合入后立即删除。
- **规则：** 在主干上执行 `./mgr sync` 时，脚本会自动基于 `origin/<base>` 创建临时分支（`sync/<base>-<ts>`）提交并推送，合入后再清理，无需手动建分支。

## 关键命令速查（仅当前平台）

- **规则：** 提交前先 `./mgr pull` 拉取最新；本地有未提交改动时先 commit/stash 再 pull。
- **规则：** 推送并开 PR 用 `./mgr push --pr --title "..." --body "..."`（推荐）；只为当前分支补建 PR 用 `./mgr pr "type(scope): 描述 [署名]" --body "..."`。
- **规则：** 一键提交+推送+PR 用 `./mgr sync "type(scope): 描述 [署名]" --body "..."`（主干自动建临时分支）。
- **规则：** 提交用 `./mgr commit "type(scope): 描述 [署名]"`，脚本会 `add -A` 并强制校验格式。
- **规则：** 跨平台同步用 `./mgr merge-cross [--dry-run]`（**单向**：当前平台 → 对端；`--dry-run` 仅查看差异不建 PR）。

## 凭据与红线补充

- **规则：** Gitee Token 放 `.mgr-token` 文件（仓库根或 `flowlight/` 根）或 `GITEE_TOKEN` 环境变量；GitHub Token 放 `~/.github-token` 或 `GITHUB_TOKEN` 环境变量。Token 一律不入库。
- **规则：** 禁止提交任何密钥 / Token；测试经环境变量注入。
- **规则：** 提交前必须运行 lint 和测试，禁止引入新问题。
- **规则：** 涉及 LLM 生成或网页发布的变更遵守 T7（LLM 二次审核）、T8（浏览器 DOM 验证）铁律。

## 标准流程（单平台）

```
1. cd flowlight/flowforge                  # 或 cd flowlight-ai/flowforge (GitHub 端)
2. ./mgr pull                              # 拉取最新
3. git checkout -b feat/xxx                # 创建功能分支
4. ... 开发 ...
5. ./mgr commit "feat(x): 功能描述 [sherlock]"
6. ./mgr push --pr                         # push 并创建 PR (仅当前平台)
7. 在平台 Web 界面合入 PR
8. git checkout master && git pull         # 回到主干并更新
```

## 跨平台同步流程（阶段性手动触发）

```
1. 确认源平台 PR 已合入主干
2. ./mgr merge-cross --dry-run             # 查看双端差异
3. ./mgr merge-cross                       # 当前平台 → 对端 创建同步 PR
4. 在对端平台 Web 界面合入同步 PR
5. 若有冲突，解决后重新运行 merge-cross
```

> 参考：`docs/git-workflow.md` 为本规范完整来源；`mgr` 脚本本体在仓库根目录。
