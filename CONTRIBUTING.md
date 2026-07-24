# Contributing to FlowForge

> 感谢您考虑为 FlowForge 贡献代码！本文档介绍贡献流程与规范。

## 1. 项目背景

FlowForge 是一个**多项目 AI Agent 智能体平台**，以 FlowForge 为通用底座框架，上层 *Forge 项目通过插件化/配置化方式扩展专业场景能力。

**核心原则**：配置驱动 > 代码继承 > 独立实现；组合优于继承。

## 2. 贡献前置要求

### 2.1 必读文档

提交 PR 前请确保已阅读：

- `docs/spec.md` — 需求规格（FR/CL ID 命名空间）
- `docs/arch.md` — 架构文档
- `docs/design.md` — 详细设计
- `docs/design/naming-contract.md` — 命名契约（三层命名体系）
- `docs/decisions/` — 核心 ADR（决策记录）
- `docs/VISION.md` — 项目愿景

### 2.2 开发环境

- Python 3.11+
- Node.js 18+ / Next.js 14（前端可选）
- SQLite（开发期）/ PostgreSQL（生产期）

```bash
# 克隆仓库
git clone https://github.com/<your-org>/flowforge.git
cd flowforge

# 安装依赖
pip install -e ".[dev]"

# 运行测试
pytest flowforge/tests/
```

## 3. 代码规范

### 3.1 15 条编程红线（违反即拒绝合入）

1. 禁止添加 CoT 检测 / 中文比例检测
2. 质量分阈值默认 0.85（可在 Loop 配置中覆盖）
3. 禁止使用 Mock LLM（所有测试必须调用真实 LLM）
4. 禁止使用假数据（测试输入必须是真实场景数据）
5. 禁止跳过验证（必须有具体断言）
6. 禁止只看退出码不检查输出质量
7. 禁止在修复问题时修改不相关代码
8. 禁止删除已有测试用例
9. 禁止用继承替代组合/插件
10. 禁止在 FlowForge 中写死业务领域代码
11. 禁止硬编码提示词/路径/密钥/端口
12. 禁止绕过 DI 容器直接实例化
13. 禁止直接操作数据库（必须通过 Repository 层）
14. 禁止不按规范执行
15. 禁止偷工减料（发现未实现即 Bug）

### 3.2 T1-T8 测试铁律

| # | 铁律 | 说明 |
|---|------|------|
| **T1** | 禁止使用 Mock LLM | 所有 E2E/集成测试必须调用真实 LLM |
| **T2** | 禁止使用假数据 | 测试输入必须是真实场景数据 |
| **T3** | 禁止跳过验证 | 必须有具体断言 |
| **T4** | 禁止 Mock 工具 | web_search/publish/fact_check 等必须真实调用 |
| **T5** | 未实现即 Bug | 发现代码未实现必须记录为 Bug |
| **T6** | 必须采集指标 | E2E 测试必须用 MetricsCollector |
| **T7** | LLM 内容必须经 LLM 审核 | LLM 生成内容必须再调用 LLM 审核通过 |
| **T8** | Web 功能必须操控浏览器验证 DOM | 网页操作必须操控浏览器查看 DOM |

### 3.3 架构约束

- **分层单向依赖**：应用层 → 指挥中枢 → 专家执行 → 工具与记忆
- **FlowForge 反向依赖零容忍**：FlowForge 中禁止 import 任何 *Forge 模块
- **接口隔离**：所有抽象基类在 `core/interfaces/` 中定义
- **循环依赖零容忍**：发现循环依赖必须重构

### 3.4 代码风格

- Python 3.11+，类型注解**强制**
- 所有 I/O 操作使用 `async/await`
- Agent 禁止直接导入 LLM SDK，必须通过 `LLMClient`
- 工具调用必须通过 `ToolRegistry.execute()`
- 日志使用 `core/tracing.py` 的 `get_logger`
- 提示词必须外置到 YAML 配置

## 4. PR 提交流程

### 4.1 提交前检查清单

- [ ] 代码通过 `pytest flowforge/tests/`
- [ ] 代码通过 `mypy flowforge/`
- [ ] 代码通过 `ruff check flowforge/`
- [ ] 新增 Feature 必须附 Eval Contract 五问（参见 F018）
- [ ] 新增文档必须含 front-matter（参见 D045）
- [ ] 提交信息遵循 Conventional Commits

### 4.2 Conventional Commits

```
<type>(<scope>): <subject>

<body>

<footer>
```

类型：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档变更
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具变更

示例：
```
feat(evolution): add CL-006 Mode C reflective review

- Add MetacognitionReflection data model
- Add MetacognitionReflector with 4 ReflectionOutcome types
- Add calibration_score computation
- 20/20 unit tests pass

Closes F046
```

### 4.3 PR 标题格式

```
[F<feature_id>] <short description>
```

示例：
```
[F050] Add Eval Ledger with Replay A/B 7-step validation
```

### 4.4 PR 描述模板

```markdown
## 关联 Feature
- F0XX: <Feature 标题>

## 变更类型
- [ ] 新增 Feature
- [ ] Bug 修复
- [ ] 重构
- [ ] 文档
- [ ] 测试

## 变更说明
<详细描述变更内容与原因>

## 验收标准
- [ ] 单元测试通过
- [ ] 集成测试通过（如适用）
- [ ] Eval Contract 五问已附（新增 Feature）
- [ ] 文档已更新

## 测试结果
<粘贴 pytest 输出>

## 关联 ADR
- ADR-0XX: <标题>
```

## 5. 文档贡献

### 5.1 文档 front-matter 规范（D045）

所有 `docs/` 目录下的正式文档必须含 5 字段 front-matter：

```yaml
---
feature_ids: [F018]
related_features: [F012]
topics: [eval, contract]
doc_kind: feature
created: 2026-07-21
---
```

### 5.2 命名规范

- **P0 官方名称**（如 "Evolvable Agent"）：正式文档首选
- **P1 项目英文名**（如 "Forgekin"）：代码标识符
- **P2 体系别名**（如 "灵智体"）：仅社区社交

详见 `docs/design/naming-contract.md`。

## 6. Issue 报告

### 6.1 Bug 报告模板

```markdown
## Bug 描述
<清晰描述 bug>

## 复现步骤
1. ...
2. ...
3. ...

## 期望行为
<期望发生什么>

## 实际行为
<实际发生什么>

## 环境
- OS: <操作系统>
- Python: <版本>
- FlowForge: <版本>

## 日志/截图
<粘贴相关日志或截图>
```

### 6.2 Feature Request 模板

```markdown
## Feature 描述
<清晰描述 feature>

## 动机
<为什么需要这个 feature>

## 提议方案
<如何实现>

## 关联
- 关联 Feature: F0XX
- 关联 ADR: ADR-0XX
```

## 7. 行为准则

- 尊重所有贡献者
- 接受建设性批评
- 关注对社区最有利的事情
- 不容忍骚扰或不友善行为

## 8. 许可证

贡献的代码将在 MIT 许可证下发布（见 `LICENSE`）。

---

感谢您的贡献！🎯
