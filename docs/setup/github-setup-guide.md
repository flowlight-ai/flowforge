# FlowForge · GitHub 仓库配置指南（小白教程）

> 本指南面向从未配置过 GitHub 仓库的新手，手把手教你完成 PR 创建、分支保护、CI 门禁和协作流程配置。

---

## 前置条件

- 你已经有一个 GitHub 账号
- 仓库 `https://github.com/flowlight-ai/flowforge` 已创建
- 你是仓库的 Owner（拥有管理员权限）
- 本地代码已推送到 `chore/security-cleanup-and-ci-hardening` 分支

---

## 第一部分：创建 Pull Request（合并代码到 main）

### 步骤 1：打开创建 PR 页面

1. 浏览器打开：https://github.com/flowlight-ai/flowforge/pull/new/chore/security-cleanup-and-ci-hardening
2. 或者：进入仓库主页 → 点击 `Compare & pull request` 按钮（如果有黄色提示条）

### 步骤 2：填写 PR 信息

1. **Base**: `main` ← 目标分支（合并到哪）
2. **Compare**: `chore/security-cleanup-and-ci-hardening` ← 源分支（你的改动）
3. **标题**：`chore: security hardening, CI setup, and docs polish`
4. **描述**：PR 模板会自动加载，按提示勾选检查清单
5. 点击 `Create pull request` 按钮

### 步骤 3：等待 CI 检查

创建 PR 后，GitHub 会自动运行 CI 检查（在 PR 页面底部显示）：
- `CI / lint` — 代码风格检查（ruff）
- `CI / type-check` — 类型检查（mypy）
- `CI / test` — 单元测试（pytest）
- `CodeQL` — 安全扫描

等所有检查通过（绿色 ✓）后，才能合并。

### 步骤 4：合并 PR

1. 确认所有 CI 检查通过
2. 点击 `Merge pull request` 按钮
3. 点击 `Confirm merge`
4. 合并后，点击 `Delete branch` 删除已合并的分支

---

## 第二部分：配置 main 分支保护规则

> 这一步确保：没有人能直接 push 代码到 main 分支，所有改动必须通过 PR + CI 通过 + 审核才能合并。

### 步骤 1：进入分支保护设置

1. 打开：https://github.com/flowlight-ai/flowforge/settings/branches
2. 或者：仓库主页 → `Settings` 标签 → 左侧菜单 `Branches`

### 步骤 2：添加 main 分支规则

1. 点击 `Add branch protection rule` 按钮
2. **Branch name pattern**：输入 `main`

### 步骤 3：勾选保护规则（推荐配置）

勾选以下选项：

#### ✅ Require a pull request before merging
- **作用**：所有改动必须通过 PR，不能直接 push
- 勾选 `Require approvals`，数量设为 `1`
  - **作用**：至少需要 1 人审核通过才能合并
- 勾选 `Dismiss stale pull request approvals when new commits are pushed`
  - **作用**：新提交代码后，之前的审核自动失效，需重新审核

#### ✅ Require status checks to pass before merging
- **作用**：CI 检查必须全部通过才能合并（CI 门禁）
- 勾选 `Require branches to be up to date before merging`
- 在搜索框中搜索并添加以下必需检查：
  - `CI / lint (push)`
  - `CI / type-check (push)`
  - `CI / test (push)`
  - `CodeQL`
  - 如果搜不到，先创建一个 PR 触发 CI 后再回来配置

#### ✅ Require conversation resolution before merging
- **作用**：所有评论必须标记为"已解决"才能合并

#### ✅ Do not allow bypassing the above settings
- **作用**：连管理员也不能绕过这些规则

### 步骤 4：保存

点击 `Create` 或 `Save changes` 按钮。

---

## 第三部分：CI 门禁说明

> 仓库已预配置以下 GitHub Actions 工作流（在 `.github/workflows/` 目录下）。

| 工作流文件 | 作用 | 触发条件 |
|-----------|------|---------|
| `ci.yml` | 代码风格检查 + 类型检查 + 单元测试 + 构建 | push 和 PR 到 main |
| `codeql.yml` | 安全漏洞扫描 | push 和 PR 到 main |
| `dependabot.yml` | 依赖自动更新 | 定期检查 |
| `labels.yml` | 自动给 Issue/PR 打标签 | Issue/PR 创建时 |
| `stale.yml` | 自动关闭长期不活跃的 Issue/PR | 每天检查 |
| `welcome.yml` | 新贡献者首次 PR 自动欢迎 | 首次 PR 创建时 |

### 如何修改 CI 配置

编辑 `.github/workflows/ci.yml`，主要配置项：

```yaml
# Python 版本
python-version: '3.11'

# 检查命令
- ruff check .          # 代码风格
- mypy flowforge/       # 类型检查
- pytest tests/ -v      # 单元测试
```

---

## 第四部分：支持其他开发者提交 PR

### 方式 1：邀请协作者（适合小团队）

1. 打开：https://github.com/flowlight-ai/flowforge/settings/access
2. 点击 `Add people` 按钮
3. 输入对方的 GitHub 用户名
4. 选择权限级别：
   - `Read` — 只能查看和 clone
   - `Triage` — 可以管理 Issue/PR，但不能推送代码
   - `Write` — 可以推送到非保护分支，创建分支
   - `Maintain` — 可以管理仓库，但不能修改设置
   - `Admin` — 完全权限
5. 对方接受邀请后，就可以 clone 仓库、创建分支、提交 PR

### 方式 2：Fork + PR（适合开源社区贡献者）

任何 GitHub 用户都可以：
1. Fork 仓库到自己账号
2. 在 Fork 仓库创建分支、修改代码
3. 向 `flowlight-ai/flowforge` 提交 PR
4. 你审核通过后合并

### 配置 CODEOWNERS 自动审核

仓库已有 `.github/CODEOWNERS` 文件，指定哪些人负责审核哪些目录的代码：

```
# 默认审核人
* @flowlight-ai

# 核心模块需要额外审核
/core/ @flowlight-ai
/evolution/ @flowlight-ai
/forgemind/ @flowlight-ai
```

修改此文件可以添加更多审核人。当 PR 涉及对应目录时，会自动请求这些人审核。

---

## 第五部分：完整协作流程示例

### 场景：开发者 Alice 想给 FlowForge 贡献代码

#### 如果 Alice 是协作者（有 Write 权限）

```bash
# 1. Clone 仓库
git clone https://github.com/flowlight-ai/flowforge.git
cd flowforge

# 2. 创建功能分支（不能直接改 main）
git checkout -b feature/my-new-feature

# 3. 写代码、测试
python scripts/setup.py        # 搭建环境
# ... 编写代码 ...
python scripts/start.py        # 本地测试

# 4. 提交
git add .
git commit -m "feat: add my new feature"

# 5. 推送到 GitHub
git push origin feature/my-new-feature

# 6. 在 GitHub 上创建 PR（base: main, compare: feature/my-new-feature）
```

#### 如果 Alice 是外部贡献者（无权限）

```bash
# 1. 在 GitHub 上 Fork 仓库
# 2. Clone 自己的 Fork
git clone https://github.com/alice/flowforge.git
cd flowforge

# 3. 添加上游仓库
git remote add upstream https://github.com/flowlight-ai/flowforge.git

# 4. 创建分支、写代码、提交
git checkout -b feature/my-new-feature
# ... 编写代码 ...
git add .
git commit -m "feat: add my new feature"
git push origin feature/my-new-feature

# 5. 在 GitHub 上从 alice/flowforge 向 flowlight-ai/flowforge 创建 PR
```

#### 你（仓库 Owner）的审核流程

1. 收到 PR 通知（邮件或 GitHub 通知）
2. 打开 PR 页面，查看改动
3. 等待 CI 检查通过（绿色 ✓）
4. 审核代码（`Files changed` 标签页）：
   - 可以逐行评论
   - 可以 `Approve`（通过）或 `Request changes`（要求修改）
5. 如果 `Approve` → 点击 `Merge pull request` 合并
6. 如果 `Request changes` → 等待 Alice 修改后重新审核

---

## 常见问题

### Q: CI 检查失败了怎么办？
A: 点击 PR 页面 CI 检查旁边的 `Details` 链接，查看失败日志。常见问题：
- `ruff check` 失败 → 运行 `ruff check . --fix` 自动修复
- `mypy` 失败 → 添加类型注解
- `pytest` 失败 → 修复测试用例

### Q: 如何给 CI 加新的检查项？
A: 编辑 `.github/workflows/ci.yml`，在 `steps` 中添加新的检查命令。

### Q: 紧急情况下能否绕过分支保护？
A: 如果配置了 `Do not allow bypassing`，则不能。如需紧急修复，可以临时修改分支保护规则，修复后立即恢复。

### Q: 如何查看 CI 运行历史？
A: 仓库主页 → `Actions` 标签页，可以查看所有工作流的运行历史和日志。

---

## 参考链接

- [GitHub 分支保护官方文档](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/configuring-protected-branches)
- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [CODEOWNERS 语法](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
