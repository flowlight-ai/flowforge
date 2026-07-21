# Contributing to FlowForge / 贡献指南

[English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

Thank you for your interest in contributing to FlowForge! This document describes how to participate in the project.

### 1. Before You Start

- Read [README.md](./README.md) and [docs/spec.md](./docs/spec.md) to understand the project vision and architecture.
- Read [docs/arch.md](./docs/arch.md) to understand the seven-layer architecture and the one-way dependency rule.
- Read [SECURITY.md](./SECURITY.md) to understand the five Iron Laws.
- Check existing [Issues](https://github.com/flowlight-ai/flowforge/issues) and [Pull Requests](https://github.com/flowlight-ai/flowforge/pulls) to avoid duplicate work.

### 2. Development Environment

```bash
# Clone the repository
git clone https://github.com/flowlight-ai/flowforge.git
cd flowforge

# Create virtual environment (Python 3.11+)
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate

# Install dependencies
pip install -e ".[dev]"
```

### 3. Development Workflow

We use the GitHub Flow branching model:

1. **Fork** the repository to your GitHub account.
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/your-feature
   # or: fix/your-bugfix, docs/your-docs, refactor/your-refactor
   ```
3. **Write code** following our conventions:
   - Type annotations are mandatory (Python 3.11+).
   - All I/O operations use `async/await`.
   - Prompts, paths, and keys must be externalized to YAML configs — never hardcode.
   - Follow the single-direction dependency rule: upper layers depend on lower layers, never the reverse.
4. **Write tests** for your changes.
5. **Run tests** locally:
   ```bash
   pytest tests/ -v
   ruff check flowforge/
   mypy flowforge/
   ```
6. **Commit** with conventional commit messages:
   ```
   feat: add new evolution mode
   fix: correct metacognition routing bug
   docs: update README quickstart
   refactor: extract maturity ladder helper
   test: add knowledge evolution tests
   chore: bump dependencies
   ```
7. **Push** and open a Pull Request to `main`.

### 4. Pull Request Requirements

- PR title follows conventional commits format.
- PR description uses the [PR template](./.github/pull_request_template.md).
- All CI checks must pass.
- Code coverage should not decrease.
- At least one maintainer must approve.
- Sign the [CLA](./CLA.md) if this is your first contribution.

### 5. Branch Naming Convention

| Type | Prefix | Example |
|------|--------|---------|
| Feature | `feat/` | `feat/scope-guard-mode` |
| Bugfix | `fix/` | `fix/loop-executor-timeout` |
| Docs | `docs/` | `docs/arch-update` |
| Refactor | `refactor/` | `refactor/di-container` |
| Test | `test/` | `test/evolution-engine` |
| Chore | `chore/` | `chore/dependabot-update` |

### 6. Code Style

- **Formatter**: `ruff format`
- **Linter**: `ruff check`
- **Type checker**: `mypy`
- **Line length**: 100 characters
- **Import order**: stdlib → third-party → local

### 7. Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`

### 8. Reporting Issues

- Use the appropriate [Issue template](./.github/ISSUE_TEMPLATE/).
- Bug reports must include: environment, reproduction steps, expected vs actual behavior, logs.
- Feature requests must include: use case, proposed solution, alternatives considered.

### 9. Code Review

- Be respectful and constructive.
- Focus on the code, not the person.
- Explain why, not just what.
- Approve only when you fully understand the change.

---

<a id="中文"></a>

## 中文

感谢你对 FlowForge 项目的贡献兴趣！本文档描述如何参与项目。

### 1. 开始之前

- 阅读 [README.md](./README.md) 和 [docs/spec.md](./docs/spec.md) 了解项目愿景和架构。
- 阅读 [docs/arch.md](./docs/arch.md) 了解七层架构和单向依赖铁律。
- 阅读 [SECURITY.md](./SECURITY.md) 了解五条铁律。
- 检查现有的 [Issues](https://github.com/flowlight-ai/flowforge/issues) 和 [Pull Requests](https://github.com/flowlight-ai/flowforge/pulls) 避免重复工作。

### 2. 开发环境

```bash
# 克隆仓库
git clone https://github.com/flowlight-ai/flowforge.git
cd flowforge

# 创建虚拟环境（Python 3.11+）
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate

# 安装依赖
pip install -e ".[dev]"
```

### 3. 开发流程

我们采用 GitHub Flow 分支模型：

1. **Fork** 仓库到你的 GitHub 账户。
2. 从 `main` 分支**创建分支**：
   ```bash
   git checkout -b feat/your-feature
   # 或: fix/your-bugfix, docs/your-docs, refactor/your-refactor
   ```
3. **编写代码**，遵循规范：
   - 类型注解强制使用（Python 3.11+）。
   - 所有 I/O 操作使用 `async/await`。
   - 提示词、路径、密钥必须外置到 YAML 配置，禁止硬编码。
   - 遵循单向依赖铁律：上层依赖下层，下层绝不导入上层。
4. 为你的改动**编写测试**。
5. **本地运行测试**：
   ```bash
   pytest tests/ -v
   ruff check flowforge/
   mypy flowforge/
   ```
6. 使用约定式提交信息**提交**：
   ```
   feat: add new evolution mode
   fix: correct metacognition routing bug
   docs: update README quickstart
   ```
7. **推送**并向 `main` 发起 Pull Request。

### 4. PR 要求

- PR 标题遵循约定式提交格式。
- PR 描述使用 [PR 模板](./.github/pull_request_template.md)。
- 所有 CI 检查必须通过。
- 代码覆盖率不应下降。
- 至少一名维护者批准。
- 首次贡献需签署 [CLA](./CLA.md)。

### 5. 分支命名

| 类型 | 前缀 | 示例 |
|------|------|------|
| 功能 | `feat/` | `feat/scope-guard-mode` |
| 修复 | `fix/` | `fix/loop-executor-timeout` |
| 文档 | `docs/` | `docs/arch-update` |
| 重构 | `refactor/` | `refactor/di-container` |
| 测试 | `test/` | `test/evolution-engine` |
| 杂项 | `chore/` | `chore/dependabot-update` |

### 6. 代码风格

- **格式化**: `ruff format`
- **静态检查**: `ruff check`
- **类型检查**: `mypy`
- **行宽**: 100 字符
- **导入顺序**: 标准库 → 第三方 → 本地

### 7. 提交信息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

类型: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`

### 8. 提交 Issue

- 使用对应的 [Issue 模板](./.github/ISSUE_TEMPLATE/)。
- Bug 报告必须包含：环境、复现步骤、期望与实际行为、日志。
- 功能请求必须包含：使用场景、提议方案、考虑过的替代方案。

### 9. 代码审查

- 尊重他人，建设性反馈。
- 关注代码本身，而非个人。
- 解释"为什么"，不仅仅是"是什么"。
- 完全理解改动后才批准。
