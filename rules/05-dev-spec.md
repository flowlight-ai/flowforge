# 第五部分：开发规范与最佳实践

> **来源**：原 `hiclaw/rules.md` 第五部分
> **关联**：[doc:rules/test-iron-rules.md]（测试铁律 T1-T9 独立索引） | [doc:rules/04-code-style.md]（代码风格） | [doc:rules/coding-redlines.md]（编程红线 15 条）

---

## 5.1 铁律：禁止盲目覆盖

```
🚫 绝对禁止：cp content/file.py content/backup/file.py（跨目录盲目覆盖）
🚫 绝对禁止：shutil.copy(src, dst) 跨实例覆盖
🚫 绝对禁止：批量复制模板文件
```

## 5.2 铁律：禁止造假

```
🚫 禁止使用模拟数据(fake data)假装功能已实现
🚫 禁止写死分数、写死结果、写死状态
🚫 禁止使用"模拟向量搜索"等假逻辑
🚫 禁止返回硬编码的{"status": "ok"}
🚫 禁止用hash生成假数据
```

**真实实现标准**：向量检索必须用真实模型+真实数据库；BM25必须用真实分词；重排序必须用真实Cross-Encoder；知识图谱要么真实构建要么彻底移除。

## 5.3 运行时数据文件存放规范（铁律T9）

所有运行时生成的数据文件必须存放在 `agents/main/data/` 目录下。**严禁**在代码目录中创建运行时数据文件。

## 5.4 Git 合入规范（铁律 G1-G10）

> **本规范为强制铁律，违反任何一条即视为严重事故。**
> **适用范围**：FlowLight 生态全部 9 个项目，Gitee 和 GitHub 双平台均适用。

### G1：禁止直接 push 到主分支（最高优先级铁律）

```
🚫 绝对禁止：git push origin main / git push origin master（直接推送主分支）
🚫 绝对禁止：git push --force origin main（强制推送主分支）
🚫 绝对禁止：git push --force origin master（强制推送主分支）
🚫 绝对禁止：用 orphan 分支绕过 PR 流程直接推送主分支
🚫 绝对禁止：任何绕过 PR 合入流程的推送操作
```

**所有代码变更必须通过 PR（Pull Request）合入主分支，无例外。**
- GitHub：`feature/xxx` → PR → review → 合入 `main`
- Gitee：`dev` → PR → review → 合入 `master`

### G2：分支模型

| 平台 | 主分支 | 开发分支 | 功能分支 | 规则 |
|------|--------|---------|---------|------|
| GitHub | `main` | - | `feat/xxx`、`fix/xxx`、`docs/xxx`、`ci/xxx` | feature 分支 → PR → main |
| Gitee | `master` | `dev` | `feat/xxx`、`fix/xxx` | feature 分支 → PR → dev → PR → master |

- 功能分支命名：`feat/功能名`、`fix/bug描述`、`docs/文档名`、`ci/CI变更`
- 功能分支生命周期：创建 → 开发 → PR → 合入 → 删除
- 禁止长期保留功能分支，合入后立即删除

### G3：PR 合入流程（必须完整执行）

```
1. 从最新主分支创建功能分支
   git checkout main && git pull origin main
   git checkout -b feat/your-feature

2. 开发、测试、提交
   git add -A
   git commit -m "feat: 功能描述"

3. 推送功能分支
   git push origin feat/your-feature

4. 创建 Pull Request
   - GitHub: gh pr create --base main --head feat/your-feature
   - Gitee: 通过网页或 API 创建 PR

5. 等待 CI 检查通过

6. 等待 Code Review 通过

7. 合入 PR（Squash merge 推荐）

8. 删除功能分支
   git branch -d feat/your-feature
   git push origin --delete feat/your-feature
```

**禁止跳过任何一步。** 特别是：禁止跳过 CI 检查、禁止跳过 Code Review、禁止跳过 PR 直接 push。

### G4：Conventional Commits 提交规范

```
<type>(<scope>): <subject>

类型(type)：
  feat:     新功能
  fix:      修复bug
  docs:     文档
  ci:       CI/CD
  refactor: 重构（不改功能）
  test:     测试
  chore:    构建/工具

示例：
  feat: add dual-platform sync support
  fix: resolve merge conflict in env_vars.py
  docs: update CONTRIBUTING.md with PR workflow
  ci: add ruff lint gate to Gitee pipeline
```

- 一个 PR 对应一个逻辑变更，禁止一个 PR 混入多个不相关变更
- 提交信息用英文或中文均可，但 type 必须用英文
- 禁止 `wip`、`test`、`tmp` 等无意义提交信息

### G5：禁止 force push

```
🚫 禁止：git push --force（任何分支）
🚫 禁止：git push -f（任何分支）
✅ 允许：git push --force-with-lease（仅功能分支，且需确认无他人提交）
```

**force push 会永久删除远程提交历史，是不可逆操作。** 如果推送被拒绝：
1. 先 `git pull --rebase origin <branch>`
2. 解决冲突（如有）
3. 重新 `git push origin <branch>`
4. 如果仍然失败，向团队求助，不要 force push

### G6：push 前必须 pull

```
✅ 正确流程：
   git pull --rebase origin <branch>
   git push origin <branch>

🚫 错误流程：
   git push origin <branch>  # 不 pull 直接 push，大概率冲突
```

### G7：双平台同步规范

FlowLight 生态同时维护 Gitee 和 GitHub 两个平台：

| 目录 | 平台 | origin remote | 用途 |
|------|------|--------------|------|
| `D:\software\fl\flowlight` | Gitee | gitee.com/flowlight-ai | Gitee 开发主目录 |
| `D:\software\fl\flowlight-ai` | GitHub | github.com/flowlight-ai | GitHub 开发主目录 |
| `D:\software\openclaw\flowlight-ai` | 备份 | - | 只读备份，禁止修改 |

- 两个平台的代码通过增量合并保持同步，**禁止盲目覆盖**
- 合并时必须逐文件对比，分析差异后增量合并
- 两个平台各自独立走 PR 流程，不能在一个平台 push 后直接 force 到另一个平台
- 如果一个平台 push 成功另一个失败，记录失败平台和分支，下次单独重试失败平台

### G8：大文件与敏感信息

```
🚫 禁止提交：__pycache__/、*.pyc、.venv/、.egg-info/、.ruff_cache/
🚫 禁止提交：*.bak、*.bak.*、调试脚本（diag_*.py、analyze_*.py）
🚫 禁止提交：API Key、Token、密码等敏感信息
🚫 禁止提交：node_modules/、dist/、build/（前端构建产物）
```

- 提交前检查 `.gitignore` 是否覆盖以上模式
- 如果 GitHub Push Protection 拦截了包含敏感信息的推送，**必须清除敏感信息后重新提交**，不能用 orphan 分支绕过
- 敏感信息替换为占位符：`YOUR_XXX_API_KEY`、`YOUR_TOKEN_HERE`

### G9：PR 质量要求

- PR 标题必须符合 Conventional Commits 格式
- PR 描述必须包含：变更说明、变更类型、测试方式
- 单个 PR 变更量建议 ≤ 500 文件，超过时拆分为多个 PR
- 大型合并任务按项目/模块拆分为多个 PR（如：9个项目 = 9个PR）
- PR 必须通过 CI 检查（ruff lint、type check、test）
- PR 必须至少 1 人 Code Review 通过

### G10：违规处理

如果违反以上任何铁律：
1. **立即恢复**：将被覆盖的分支恢复到原始状态
2. **改用 PR**：通过正规 PR 流程重新提交
3. **记录事故**：在 `docs/task.md` 中记录违规操作和恢复过程
4. **完善规范**：如果规范有漏洞导致违规，立即补充规范

### 5.4.1 Git 操作其他规范

1. 恢复文件：优先使用 `git checkout HEAD -- path/to/file`
2. 非git管理文件：手动备份后再修改
3. 修改前：先 `git diff` 了解当前状态
4. 分支损坏时：先 `git fsck` 诊断，再从远程 `git fetch && git reset --hard origin/<branch>` 恢复
5. index.lock 反复出现：检查是否有后台 git 进程，用 `rm -f .git/index.lock` 清理

## 5.5 测试铁律（T1-T9）

> **完整索引**：详见 [doc:rules/test-iron-rules.md]（独立文件，便于跨文档引用）

| 编号 | 铁律 | 说明 |
|------|------|------|
| T1 | 禁止使用Mock LLM | 所有E2E/集成测试必须调用真实LLM |
| T2 | 禁止使用假数据 | 测试输入必须是真实场景数据 |
| T3 | 禁止跳过验证 | 必须有具体断言，不能只看退出码 |
| T4 | 禁止Mock工具 | web_search/publish/fact_check等必须真实调用 |
| T5 | 未实现即Bug | 发现代码未实现必须记录为Bug并修复 |
| T6 | 必须采集指标 | E2E测试必须用MetricsCollector采集完整指标 |
| T7 | LLM内容必须经LLM审核 | 凡LLM生成的内容，必须再调用LLM审核通过才算验证通过（生成与审核使用不同模型） |
| T8 | Web功能必须操控浏览器验证DOM | 凡涉及网页操作的功能，必须操控浏览器查看DOM确认真实成功 |
| T9 | 运行时数据文件必须存放data目录 | 禁止污染代码目录 |

## 5.6 质量评审配置规则（P33）

- 质量分阈值默认 **0.85**（v4.0: 由0.9调整为0.85，平衡质量与可用性）
- 禁止修改提示词引导评委给高分
- 5个WebChat评委必须使用**不同模型**
- 1个写作Agent必须与评委使用**不同模型**
- 评委必须**并行评审**
- 不达标必须优化提示词和质量，不能降低阈值

---

> **本文件来源**：原 `hiclaw/rules.md` 第五部分 开发规范与最佳实践
