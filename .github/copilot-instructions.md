# AGENTS.md — AI 工具工作规范（强制）

> 本文件适用于所有 AI 编码工具：Trae / Claude Code / Cursor / Gemini / OpenCode / WorkBuddy / Qorder 等。
> 工具在本仓库工作时**必须读取并遵守**本文件全部规则。

## Git 工作流（最高优先级）

### 1. 平台感知

- 脚本位置决定当前平台：
  - `flowlight/<repo>/mgr` → Gitee 平台（base=master）
  - `flowlight-ai/<repo>/mgr` → GitHub 平台（base=main）
- **在哪个平台目录下开发，就只向该平台提交 PR**，禁止同时推送双端。

### 2. 必须使用 ./mgr 命令

**禁止直接使用 `git push`**。所有 Git 操作必须通过 `./mgr`：

```bash
./mgr pull                              # 拉取当前平台更新
./mgr commit "type(scope): 描述 [署名]"  # 提交到当前平台
./mgr push --pr                         # push + 创建 PR（推荐）
./mgr sync                              # 提交+push+PR 一键完成
./mgr merge-cross --dry-run             # 查看双端差异
./mgr merge-cross                       # 跨平台双向合并（手动触发）
```

### 3. 主干保护

- **禁止直接 push 到 master/main**，必须走 PR。
- 禁止创建 dev 等长期分支。
- 临时分支（feat/xxx、fix/xxx）合入后立即删除。

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
1. ./mgr pull                          # 拉取最新
2. git checkout -b feat/xxx            # 创建功能分支
3. ... 开发 ...
4. ./mgr commit "feat(x): 描述 [id]"   # 提交
5. ./mgr push --pr                     # push + PR（仅当前平台）
6. 平台 Web 合入 PR
7. ./mgr merge-cross                   # 需要时跨平台同步
```
