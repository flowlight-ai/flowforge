# Git 工作流规范（强制）

> FlowLight 生态 9 仓库（content / contentforge / devforge / flowforge / mallforge / novelforge / openroute / opensieve / stockforge）统一执行本规范。

## 1. 分支模型：仅主干开发（最高优先级）

- **Gitee 主干分支 = `master`；GitHub 主干分支 = `main`**（stockforge/novelforge/mallforge 在 GitHub 侧历史分支为 `master`，以各仓库实际主干为准）。
- **所有代码变更必须通过 Pull Request 合入主干**：本地在主干分支提交后直接 `push`，Gitee 的 master 保护分支会自动将推送转为 PR（重定向到 `auto/master/*` 分支），评审合入后才出现在 master 上。
- **双平台同步**：同一提交须同时推送到 Gitee 和 GitHub（`./mgr sync` 或分别 push），保持两端主干内容一致。
- **禁止创建/使用 `dev`、`develop` 等长期分支**；历史遗留 dev 分支一律删除。
- **禁止绕过 PR 直接向 master/main 合并**（保护分支 review 模式，仅管理员经 PR 合入）。
- 临时分支（如 `fix/xxx`）仅在确有必要时使用，合入后立即删除。

## 1.1 双平台仓库地址与目录模型

| 仓库 | Gitee（origin） | GitHub |
|------|-----------------|--------|
| content | https://gitee.com/flowlight-ai/content.git | https://github.com/flowlight-ai/content.git |
| openroute | https://gitee.com/flowlight-ai/openroute.git | https://github.com/flowlight-ai/openroute.git |
| flowforge | https://gitee.com/flowlight-ai/flowforge.git | https://github.com/flowlight-ai/flowforge.git |
| opensieve | https://gitee.com/flowlight-ai/opensieve.git | https://github.com/flowlight-ai/opensieve.git |
| stockforge | https://gitee.com/flowlight-ai/stockforge.git | https://github.com/flowlight-ai/stockforge.git |
| contentforge | https://gitee.com/flowlight-ai/contentforge.git | https://github.com/flowlight-ai/contentforge.git |
| devforge | https://gitee.com/flowlight-ai/devforge.git | https://github.com/flowlight-ai/devforge.git |
| novelforge | https://gitee.com/flowlight-ai/novelforge.git | https://github.com/flowlight-ai/novelforge.git |
| mallforge | https://gitee.com/flowlight-ai/mallforge.git | https://github.com/flowlight-ai/mallforge.git |

双目录模型（相对定位，克隆位置无关）：

```
<workspace>/flowlight/<repo>     → Gitee 端工作副本 (origin=gitee.com, 分支 master)
<workspace>/flowlight-ai/<repo>  → GitHub 端工作副本 (origin=github.com, 分支 main)
```

- Gitee 端仓库配 `github` mirror 远程，GitHub 端仓库配 `gitee` mirror 远程（`./mgr mirror-setup` 一键配置）。
- **凭据**：GitHub 推送凭据存于 `~/.github-token`（chmod 600，不入库）或 `GITHUB_TOKEN` 环境变量；Token 需含 `repo` + `workflow` 权限（缺 `workflow` 时无法推送含 `.github/workflows/` 变更的提交）。

## 2. 提交前必拉取、收尾必提交

- 开始修改前先 `git pull`（多仓库用 `./mgr pull`），确保基于最新代码工作。
- 若本地有未提交改动，先提交或 stash 后再 pull。
- 任务完成、验证通过后必须提交并推送，禁止搁置改动（避免跨会话丢失）。

## 3. 提交信息格式（强制署名）

```
type(scope): 简短描述 [#PR号] [智能体ID]
```

- `type` 遵循 Conventional Commits：`feat` / `fix` / `refactor` / `chore` / `docs` / `test` / `ci` / `perf`；`scope` 为可选模块名。
- **每次提交必须带 FlowForge 九大灵智能体（Forgekin）署名**，按角色职责选取，不得留空：

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
| `butterfly` | 幻蝶 | Trae 桥接 |

示例：`fix(web): 修复登录超时 [luban]`、`docs(api): 补充健康检查说明 [wenxin]`

## 4. 红线

- 禁止在未 pull 的情况下直接提交推送（避免冲突与覆盖他人提交）。
- 禁止绕过 PR 直接合入主干；禁止创建 dev 等长期分支。
- **禁止提交任何密钥/Token**（如 `or-` 前缀 OpenRoute 密钥、管理员密码）；测试一律通过环境变量注入。
- `.venv/`、`node_modules/`、`__pycache__/`、运行时数据等一律不入库。
- 涉及 LLM 生成或网页发布的变更，遵守铁律：T7（LLM 二次审核）、T8（浏览器 DOM 验证）。

## 5. 多仓库工具

仓库根目录的 `./mgr` 支持多仓库管理：

```bash
./mgr status   # 查看各仓库同步状态（↑N 领先 / ↓N 落后）
./mgr pull     # 批量拉取
./mgr commit "fix(x): 描述 [署名]"   # 自动提交所有有改动的仓库
./mgr push     # 推送到远端（保护分支自动转 PR）
./mgr mirror-setup   # 一键配置双端互指 mirror 远程
./mgr sync     # 双平台同步推送（改动端 origin → 对端 mirror）
./mgr protect  # 设置 master 分支保护（仅 Gitee，需 token）
```

- `content/mgr` 默认管理全部 9 个仓库；其他仓库的 `mgr` 默认仅管理本仓库，`--all` 强制全量。
- **日常双平台提交流程**：`./mgr commit "msg"` → `./mgr sync`（先推改动端 origin，再推对端 mirror，实现 Gitee 与 GitHub 同时提交）。
